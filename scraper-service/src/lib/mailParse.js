/**
 * Rule-based extraction of listing fields from a broker's 物件紹介 email body.
 *
 * WHY THIS EXISTS
 * ------------------------------------------------------------------
 * extractListings() in mailIngest.js sends every message to an LLM. That
 * burns a paid/rate-limited quota on mail whose useful content is already
 * label-value text ("価格：34,000万円"), and it is the only reason a sync can
 * fail wholesale — Groq's 200k tokens/day cap aborted a real 25-message batch
 * mid-way, and the Rax AI gateway has been in maintenance for longer than
 * that. Parsing the body in code removes the LLM from the common path
 * entirely; it stays as a fallback for what rules genuinely cannot read.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * ------------------------------------------------------------------
 * PDF attachments. pdfToText on the マイソク templates these brokers use
 * (BASE's, シアリード不動産's) returns the page's text runs in layout order,
 * which shreds the two-column sheet into a list of labels followed much later
 * by an unrelated list of values — "価格" and "3億2,500万円" end up 20 lines
 * apart with no recoverable association. Guessing at that pairing would
 * invent data. Those messages escalate to the LLM instead (see needsLlm).
 *
 * FIELD NAMES match the object extractListings() already returns, so this is a
 * drop-in producer for the same saveEmailListing path.
 */

import { normalizeWard } from "./scoring.js";

/** 全角 digits/latin/punctuation appear mid-number in real mail ("4億１,800万円"),
 *  which breaks every numeric regex. Normalize once, up front. ㎡ and 坪 are
 *  left alone — they are the unit markers the parsers key off. */
function toHalfWidth(s) {
  return s
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ":")
    .replace(/[％]/g, "%")
    .replace(/[，]/g, ",")
    .replace(/[．]/g, ".")
    // NOT ー (U+30FC): it is the katakana prolonged-sound mark, and folding it
    // into a hyphen turned 鉄筋コンクリート造 into 鉄筋コンクリ-ト造, which then
    // failed every structure test downstream.
    .replace(/[－−―‐]/g, "-")
    .replace(/[　]/g, " ");
}

/** Leading bullets/box-drawing and the 【】《》 that wrap PDF-style labels. */
function stripOrnaments(s) {
  return s.replace(/^[\s・■●◆▪*+\-=＝◇○▼▲▽△【《]+/, "").replace(/[】》\s]+$/, "");
}

// ---------------------------------------------------------------------------
// Value parsers
// ---------------------------------------------------------------------------

/** "6億9,800万円" / "3.9億円" / "34,000万円" -> 万円, the unit the rest of the
 *  app stores. Same 億+万 composition the scraper services parse (see
 *  tokyotatemono.ts) — a listing priced "1億979万円" must not truncate to 979. */
export function parsePriceMan(raw) {
  if (!raw) return null;
  const s = toHalfWidth(String(raw)).replace(/\s/g, "");
  const oku = s.match(/([\d,]+(?:\.\d+)?)億/);
  const man = s.match(/([\d,]+(?:\.\d+)?)万/);
  if (!oku && !man) {
    // Bare yen ("37,000,000円") — only trust it at a magnitude that cannot be
    // a phone number, a 坪単価 or a monthly rent.
    const yen = s.match(/([\d,]{7,})円/);
    if (!yen) return null;
    const n = parseFloat(yen[1].replace(/,/g, ""));
    return Number.isFinite(n) ? Math.round(n / 10000) : null;
  }
  const o = oku ? parseFloat(oku[1].replace(/,/g, "")) * 10000 : 0;
  const m = man ? parseFloat(man[1].replace(/,/g, "")) : 0;
  const total = o + m;
  return total > 0 ? total : null;
}

/** First ㎡ figure, ignoring the 坪 conversion that always follows it.
 *  A two-building deal states each separately ("1号棟 378.00㎡ / 2号棟
 *  300.00㎡") and is sold as one lot, so those sum rather than taking the
 *  first — otherwise the listing reads as barely half its real size. */
export function parseAreaSqm(raw) {
  if (!raw) return null;
  const s = toHalfWidth(String(raw));
  const all = [...s.matchAll(/([\d,]+(?:\.\d+)?)\s*(?:㎡|m2|平米|平方メートル)/g)]
    .map((m) => parseFloat(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (all.length === 0) return null;
  if (all.length > 1 && /号棟|号館/.test(s)) {
    return Math.round(all.reduce((a, b) => a + b, 0) * 100) / 100;
  }
  return all[0];
}

export function parsePercent(raw) {
  if (!raw) return null;
  const m = toHalfWidth(String(raw)).match(/([\d.]+)\s*%/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

const ERA_BASE = { 昭和: 1925, 平成: 1988, 令和: 2018 };

/** "1990年3月築（平成2年）", "昭和62年2月築", "平成19年12月", "築25年".
 *  Western years win when both are present — they are unambiguous. */
export function parseBuildYear(raw, now = Date.now()) {
  if (!raw) return null;
  const s = toHalfWidth(String(raw));

  const western = s.match(/(1[89]\d{2}|20\d{2})\s*年/);
  if (western) return parseInt(western[1], 10);

  const era = s.match(/(昭和|平成|令和)\s*(\d{1,2})\s*年/);
  if (era) return ERA_BASE[era[1]] + parseInt(era[2], 10);

  const age = s.match(/築\s*(\d{1,3})\s*年/);
  if (age) return new Date(now).getFullYear() - parseInt(age[1], 10);

  return null;
}

/** "JR山手線「目黒」駅 徒歩18分" / "大江戸線「豊島園」駅徒歩4分" /
 *  "JR中央線「武蔵小金井」駅 徒歩12分". Returns the closest one when a listing
 *  lists several — that is the one a buyer's walk-time criterion is judged on. */
export function parseAccess(text) {
  const s = toHalfWidth(String(text || ""));
  const hits = [];
  const re = /(?:「([^」]{1,12})」|([^\s、。：:「」（）()]{1,12}?))駅\s*(?:から)?\s*徒歩\s*(?:約)?\s*(\d{1,3})\s*分/g;
  for (const m of s.matchAll(re)) {
    const name = (m[1] || m[2] || "").trim();
    const minutes = parseInt(m[3], 10);
    if (name && Number.isFinite(minutes)) hits.push({ station: `${name}駅`, walkMinutes: minutes });
  }
  if (hits.length === 0) return { station: null, walkMinutes: null };
  return hits.reduce((a, b) => (b.walkMinutes < a.walkMinutes ? b : a));
}

/** "西側：約6.2ｍ、南側：約7.5ｍ" / "南東側：幅員約4.0ｍ（公道）" -> the widest
 *  frontage, which is the one that governs what can be built. */
export function parseRoadWidth(raw) {
  if (!raw) return null;
  const s = toHalfWidth(String(raw));
  const all = [...s.matchAll(/([\d.]+)\s*(?:m|ｍ|M|メートル)/g)]
    .map((m) => parseFloat(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 100);
  return all.length ? Math.max(...all) : null;
}

const STRUCTURE_RE =
  /(鉄骨鉄筋コンクリート造|鉄筋コンクリート造|軽量鉄骨造|重量鉄骨造|鉄骨造|木造|SRC造|RC造|S造)[^\s、。]*/;

/** 種別 in these mails is the building's use ("共同住宅・店舗"), not the
 *  category the app filters on. Map it, disambiguating 共同住宅 by structure:
 *  the trade calls an RC/SRC block a 一棟マンション and a wood/light-steel one
 *  an アパート, and the buy-side criteria use exactly that split. */
export function canonicalType(typeText, contextText) {
  const t = toHalfWidth(String(typeText || "")).replace(/\s/g, "");
  const ctx = toHalfWidth(String(contextText || ""));
  if (/土地|更地|用地|宅地/.test(t)) return "土地";
  if (/戸建|テラスハウス|タウンハウス/.test(t)) return "一戸建て";
  if (/アパート/.test(t)) return "アパート";
  if (/ビル/.test(t)) return "ビル";
  if (/(一棟|1棟)/.test(t) && /マンション/.test(t)) return "一棟マンション";
  if (/マンション/.test(t)) return "マンション";
  if (/共同住宅/.test(t)) {
    return /鉄筋コンクリート造|鉄骨鉄筋コンクリート造|RC造|SRC造/.test(`${t}${ctx}`)
      ? "一棟マンション"
      : "アパート";
  }
  if (/店舗|事務所|ソシアル/.test(t)) return "店舗";
  return null;
}

/** Narrows a segment to the phrase that actually states an age before
 *  parseBuildYear sees it. Without this the fallback scan happily read the
 *  "日付: 2026年6月15日" of the forwarded-mail header as a build year. */
function datedBuildPhrase(text) {
  const s = toHalfWidth(String(text || ""));
  const m = s.match(
    /(?:(?:1[89]\d{2}|20\d{2})|(?:昭和|平成|令和)\s*\d{1,2})\s*年\s*(?:\d{1,2}\s*月)?\s*築|築\s*\d{1,3}\s*年/,
  );
  return m ? m[0] : null;
}

const LAND_RE = /更地|開発用地|建築用地|事業用地|ホテル用地|解体後|現況更地/;

/** Property type, from the 種別 label when there is one and from the segment's
 *  own vocabulary when there is not. Returns null rather than a guess: a wrong
 *  type silently excludes a listing from every order whose criteria name the
 *  right one, which is worse than an absent one that simply is not filtered.
 *
 *  Inference deliberately ignores the words 土地 and 土地面積 on their own —
 *  every 一棟 listing states a 土地面積, so keying 土地 off that made every
 *  building in the corpus come back as land. 用地/更地 count only when nothing
 *  indicates a building is standing. */
function resolveType(labelText, segText, structure, area) {
  const fromLabel = canonicalType(labelText, `${structure || ""}${segText}`);
  if (fromLabel) return fromLabel;

  const s = toHalfWidth(String(segText || ""));
  const hasBuilding = Boolean(structure || area);

  if (LAND_RE.test(s) && !hasBuilding) return "土地";
  if (/アパート/.test(s)) return "アパート";
  if (/(一棟|1棟)[^\s]{0,4}(マンション|収益)/.test(s)) return "一棟マンション";
  if (/(一棟|1棟)[^\s]{0,4}(ビル|店舗)/.test(s)) return "ビル";
  if (/戸建/.test(s) && !/戸建用地/.test(s)) return "一戸建て";
  if (!hasBuilding && /マンション/.test(s)) return "マンション";

  // No vocabulary hit, but a structure and multiple dwellings is unambiguously
  // a whole rental building; the trade splits those by frame material.
  if (structure && /(\d{1,4})\s*戸(?!建)/.test(s)) {
    return /鉄筋コンクリート|鉄骨鉄筋|RC造|SRC造|重量鉄骨|鉄骨造/.test(structure)
      ? "一棟マンション"
      : "アパート";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Label scanning
// ---------------------------------------------------------------------------

/** Label spellings seen across the real corpus. Matched after ornaments are
 *  stripped and internal spaces removed, so "・土地面積 ：" and "《 地 積 》"
 *  both reduce to a key here. Order matters within a field: the first hit on a
 *  line wins, so more specific spellings are not needed — lookup is exact. */
const LABELS = {
  title: ["物件名", "物件名称", "名称"],
  address: ["所在地", "住所", "物件所在地", "住居表示"],
  price: ["価格", "売買価格", "販売価格", "売出価格"],
  landSize: ["地積", "土地面積", "敷地面積", "土地", "公簿面積"],
  area: ["延床面積", "延床", "建物面積", "床面積", "専有面積"],
  yield: ["利回り", "満室想定利回り", "表面利回り", "満室表面利回", "想定利回り"],
  buildYear: ["築年", "築年月", "建築年月", "築年数"],
  structure: ["構造", "規模構造", "規模・構造"],
  propertyType: ["種別", "物件種別", "用途", "種類"],
  access: ["交通", "最寄駅", "最寄り駅", "駅", "線駅"],
  buildingCoverageRatio: ["建蔽率", "建ぺい率"],
  floorAreaRatio: ["容積率"],
  roadWidth: ["道路", "前面道路", "接道"],
  totalUnits: ["総戸数", "戸数"],
};

const LABEL_TO_FIELD = (() => {
  const map = {};
  for (const [field, names] of Object.entries(LABELS)) {
    for (const n of names) map[n] = field;
  }
  return map;
})();

/** One "label: value" line, or null. Requires a colon: without it, a signature
 *  block's "◆買取価格〜10億円以内" and "※... 利回り7～8%以上" would both read as
 *  real fields on the property being sold. Every genuine field line in the
 *  corpus has one. */
function parseLabelLine(line) {
  const s = toHalfWidth(line);
  const idx = s.search(/[:：]/);
  if (idx < 0) return null;
  const label = stripOrnaments(s.slice(0, idx)).replace(/\s/g, "");
  if (!label || label.length > 10) return null;
  const field = LABEL_TO_FIELD[label];
  if (!field) return null;
  return { field, value: s.slice(idx + 1).trim() };
}

/** Google Maps links are inserted inline by Gmail after every address and
 *  carry a percent-encoded copy of it — which parses as a second address and
 *  as junk digits. Drop them before anything else looks at the text. */
function cleanBody(text) {
  return String(text || "")
    .replace(/<https?:\/\/[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .split(/\r?\n/);
}

const PREFECTURE_RE = /(東京都|神奈川県|埼玉県|千葉県|大阪府|京都府|北海道|[^\s]{2,3}県)/;

/** A line made only of rule/box-drawing characters, which is how every sender
 *  in the corpus opens their signature block (┏━━━, /_/_/_/, ▼△▼△, ------).
 *  Lines that merely contain dashes around words ("-----Original Message-----",
 *  "---------- 転送メッセージ ---------") carry text and so do not match. */
const RULE_LINE_RE = /^[\s]*[┏┗┃━─│＝=_\-\/▼▲△▽◇◆*＊＋+~〜]{6,}[\s]*$/;

/**
 * Drops the sender's signature before segmentation.
 *
 * The signature is not inert text: these brokers advertise their own buying
 * criteria in it ("◆高利回り一棟収益/空ビル…", "◆買取価格〜10億円以内"), and the
 * last property in an email would otherwise absorb all of it — which is
 * exactly how a 一棟店舗ビル came back typed as 一棟マンション, off the word
 * 一棟収益 in a signature 30 lines below it.
 *
 * Only cuts at a marker that appears after real content has started, so the
 * "---------- 転送メッセージ ---------" and "-----Original Message-----" banners
 * that open every forwarded mail cannot truncate the whole body.
 */
function trimSignature(lines) {
  let contentSeen = false;
  for (let i = 0; i < lines.length; i++) {
    const line = toHalfWidth(lines[i]);
    if (!contentSeen) {
      if (parseLabelLine(lines[i]) || isSegmentStart(lines[i])) contentSeen = true;
      continue;
    }
    if (RULE_LINE_RE.test(line) || /^\s*〒\s*\d{3}-?\d{4}/.test(line)) {
      return lines.slice(0, i);
    }
  }
  return lines;
}


/** A bare address on its own bulleted line starts a new property; a *labelled*
 *  address ("所在地：東京都…") is a field of the property already being read.
 *  That distinction is what separates the one email in the corpus that
 *  introduces two unrelated buildings (練馬 and 国立, each led by "・東京都…")
 *  from the several that state one property with a 所在地 line. Lines carrying
 *  〒 are the sender's own office address in the signature, never the listing. */
function isSegmentStart(line) {
  const s = toHalfWidth(line);
  if (s.includes("〒")) return false;
  if (/^[\s]*[・■●◆▪*]/.test(s) === false) return false;
  const body = stripOrnaments(s);
  if (/[:：]/.test(body.slice(0, 12))) return false;
  return PREFECTURE_RE.test(body.slice(0, 8));
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function extractFromSegment(lines, seededAddress) {
  const raw = {};
  for (const line of lines) {
    const hit = parseLabelLine(line);
    if (!hit) continue;
    // First occurrence wins: the property's own 価格 precedes any later
    // mention, and a repeated label in a quoted reply is the older copy.
    if (raw[hit.field] === undefined && hit.value) raw[hit.field] = hit.value;
  }

  // Normalized once: the prose fallbacks below match on % and ASCII digits, and
  // real mail writes both full-width ("容積率400％").
  const segText = toHalfWidth(lines.join("\n"));
  const address = seededAddress || raw.address || null;
  const access = parseAccess(raw.access || segText);
  const structure = raw.structure || (segText.match(STRUCTURE_RE) || [])[0] || null;

  const listing = {
    title: raw.title || null,
    address,
    ward: normalizeWard(address || ""),
    price: parsePriceMan(raw.price),
    area: parseAreaSqm(raw.area),
    landSize: parseAreaSqm(raw.landSize),
    station: access.station,
    walkMinutes: access.walkMinutes,
    propertyType: null, // resolved below, once structure/area are known
    yield: parsePercent(raw.yield),
    buildYear: parseBuildYear(raw.buildYear || datedBuildPhrase(segText)),
    structure,
    buildingCoverageRatio: parsePercent(raw.buildingCoverageRatio),
    floorAreaRatio: parsePercent(raw.floorAreaRatio),
    roadWidth: parseRoadWidth(raw.roadWidth),
    totalUnits: null,
    description: null,
  };

  listing.propertyType = resolveType(raw.propertyType, segText, structure, listing.area);

  // Several fields are stated in prose rather than as fields of their own — a
  // yield tacked onto the end of the price line ("価格：3,700万円 満室想定利回り
  // 11.06%"), or 建ぺい率/容積率 inside a 備考 line. Fall back to the segment,
  // which the signature trim has already bounded to this property.
  if (listing.yield == null) {
    listing.yield = parsePercent((segText.match(/(?:満室想定|満室|表面|想定)?利回り\s*:?\s*[\d.]+\s*%/) || [])[0]);
  }
  // 建ぺい率/容積率 are often prose inside a 備考 line rather than fields of
  // their own ("備考 ：建ぺい率80%／容積率400%"), so fall back to the segment.
  if (listing.buildingCoverageRatio == null) {
    listing.buildingCoverageRatio = parsePercent((segText.match(/建[ぺ蔽]い?率\s*:?\s*[\d.]+\s*%/) || [])[0]);
  }
  if (listing.floorAreaRatio == null) {
    listing.floorAreaRatio = parsePercent((segText.match(/容積率\s*:?\s*[\d.]+\s*%/) || [])[0]);
  }

  // "13戸" but not "戸建" — and not the 号棟 breakdown ("1号棟：14戸 2号棟：6戸"),
  // where the individual counts have to be summed to describe the deal.
  const unitHits = [...toHalfWidth(raw.totalUnits || segText).matchAll(/(\d{1,4})\s*戸(?!建)/g)]
    .map((m) => parseInt(m[1], 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (unitHits.length === 1) listing.totalUnits = unitHits[0];
  else if (unitHits.length > 1 && /号棟|号館/.test(segText)) {
    listing.totalUnits = unitHits.reduce((a, b) => a + b, 0);
  }

  return listing;
}

/** A parse is trustworthy enough to skip the LLM only with a located property
 *  and a price. Anything less is a 物件求 (a broker asking to be *sent*
 *  listings), a cover note whose data is all in the PDF, or a newsletter —
 *  all of which produced junk rows when the LLM was asked to read them. */
function isConfident(l) {
  return Boolean(l.price && (l.address || l.title));
}

const WANTED_RE =
  /ご紹介のお願い|紹介頂けれ|ご紹介いただけれ|ご紹介ください|探して(おり|い)ます|仕入(を|れ|強化)|買取り?(致し|し|強化|可能)|を買います|求む/;

/** Does this message look like it describes a property at all? Gates the LLM
 *  fallback so a sync does not spend quota re-reading newsletters and buying
 *  requests that rules correctly found nothing in. */
function looksLikeListing(text) {
  const s = toHalfWidth(text);
  const hasPrice = /[\d,]+\s*万円|[\d.]+\s*億/.test(s);
  const hasPlace = PREFECTURE_RE.test(s);
  const hasFieldish = /物件概要|所在地\s*:|売買価格|利回り|延床面積|地積|土地面積/.test(s);
  return hasPrice && hasPlace && hasFieldish;
}

/**
 * @param {string} emailText  subject + from + body, as syncOneAccount builds it
 * @param {string[]} pdfTexts pdfToText output per attachment, for the LLM gate only
 * @returns {{listings: object[], needsLlm: boolean, reason: string}}
 */
export function parseEmailListings(emailText, pdfTexts = []) {
  const lines = trimSignature(cleanBody(emailText));

  const startIdx = [];
  lines.forEach((line, i) => {
    if (isSegmentStart(line)) startIdx.push(i);
  });

  let listings;
  if (startIdx.length >= 2) {
    listings = startIdx.map((start, n) => {
      const end = n + 1 < startIdx.length ? startIdx[n + 1] : lines.length;
      const seg = lines.slice(start, end);
      return extractFromSegment(seg, stripOrnaments(toHalfWidth(seg[0])));
    });
  } else {
    listings = [extractFromSegment(lines, null)];
  }

  const confident = listings.filter(isConfident);
  if (confident.length > 0) {
    return { listings: confident, needsLlm: false, reason: "parsed" };
  }

  const haystack = `${emailText}\n${(pdfTexts || []).join("\n")}`;

  // A 物件求 — a broker publishing what they want to BUY — reads as
  // property-like to every content test (prices, wards, 土地面積, 容積率) while
  // describing no actual listing. Left ungated it sent the LLM a criteria
  // sheet and got invented rows back. Only applies once rules have found
  // nothing, so a real listing that merely carries a 買取 pitch in its
  // signature is unaffected.
  //
  // Both halves deliberately look at more than the raw body:
  //  - the trigger reads the SIGNATURE-TRIMMED body, because 【弊社買取可能条件】
  //    is a standard broker footer and appears under real listings;
  //  - the counter-evidence reads the PDFs too, because a cover note whose
  //    listing lives entirely in an attached マイソク carries none of these
  //    labels in its own text.
  // Together they were misclassifying genuine 売主 introductions as 物件求.
  const trimmedBody = toHalfWidth(lines.join("\n"));
  if (
    WANTED_RE.test(trimmedBody) &&
    !/物件概要|所在地\s*[:：]|売買価格/.test(toHalfWidth(haystack))
  ) {
    return { listings: [], needsLlm: false, reason: "buying request, not a listing" };
  }

  if (looksLikeListing(haystack)) {
    return { listings: [], needsLlm: true, reason: "property-like but unparsed" };
  }
  return { listings: [], needsLlm: false, reason: "not a listing email" };
}

// ---------------------------------------------------------------------------
// Per-user ingest rules
// ---------------------------------------------------------------------------

/**
 * Decides whether a message is worth reading at all, from the rules a user set
 * in the メール取り込み設定 modal.
 *
 * Applied after the message is fetched (subject and sender are only known
 * then) but before parsing or any LLM call, so a rejected message costs one
 * cheap API read and nothing else.
 *
 * Every list is optional and an empty one means "no opinion" — an account that
 * has never opened the settings modal accepts everything, as it did before
 * these rules existed. Rejections are ordered most-specific first so the
 * reason shown back to the user is the one they would expect: an explicitly
 * blocked sender reports as blocked, not as "missing a required word".
 *
 * @param {{subject?: string, from?: string, bodyText?: string, attachments?: unknown[]}} msg
 * @param {object|null} settings row from mailIngestSettings
 * @returns {{accepted: boolean, reason: string|null}}
 */
export function applyIngestRules(msg, settings) {
  if (!settings) return { accepted: true, reason: null };

  const from = String(msg.from || "").toLowerCase();
  const haystack = `${msg.subject || ""}\n${msg.bodyText || ""}`.toLowerCase();
  const has = (needle) => haystack.includes(String(needle).toLowerCase());

  const blockedSenders = settings.blockedSenders || [];
  const hitBlockedSender = blockedSenders.find((s) => from.includes(String(s).toLowerCase()));
  if (hitBlockedSender) {
    return { accepted: false, reason: `除外する送信者「${hitBlockedSender}」に一致` };
  }

  const allowedSenders = settings.allowedSenders || [];
  if (allowedSenders.length > 0 && !allowedSenders.some((s) => from.includes(String(s).toLowerCase()))) {
    return { accepted: false, reason: "許可した送信者ではありません" };
  }

  const blockedKeywords = settings.blockedKeywords || [];
  const hitBlockedWord = blockedKeywords.find(has);
  if (hitBlockedWord) {
    return { accepted: false, reason: `除外ワード「${hitBlockedWord}」を含みます` };
  }

  const requiredKeywords = settings.requiredKeywords || [];
  if (requiredKeywords.length > 0 && !requiredKeywords.some(has)) {
    return { accepted: false, reason: "必須ワードが含まれていません" };
  }

  if (settings.requireAttachment && (msg.attachments || []).length === 0) {
    return { accepted: false, reason: "添付ファイルがありません" };
  }

  return { accepted: true, reason: null };
}
