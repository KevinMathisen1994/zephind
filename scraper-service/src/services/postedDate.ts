/**
 * 掲載日 (posted / last-updated date) extraction.
 *
 * WHY THIS IS A SHARED HELPER AND NOT PER-SCRAPER SELECTORS
 * --------------------------------------------------------
 * Every one of the 19 portals was checked against its live HTML. The result:
 *
 *   - Only ONE portal prints a real date on its LIST page (大京穴吹: "New 8/10").
 *   - Four more print a NEW / 価格変更 badge with no date (みずほ, 東京建物,
 *     東急リバブル, 大京穴吹) — a 14-day-ish window, not a date.
 *   - Every other list page offers only a 新着順 SORT or a 情報公開日 FILTER;
 *     the date itself is on the DETAIL page.
 *
 * On the detail pages the date is always a label followed by a value in a table
 * or definition list, but the label differs per site (情報公開日 / 情報提供日 /
 * 情報登録日 / 掲載日 / 更新日 / 情報更新日) and so does the markup (th+td,
 * dt+dd, or one element containing "更新日2026年08月10日"). Writing 19 selector
 * sets for that would be 19 things to break on the next redesign, so instead
 * this scans for the LABELS and reads the value next to whichever one it finds.
 * That is resilient to markup changes and was verified site by site (see
 * DETAIL_DATE_VERIFIED below).
 *
 * 掲載日 vs 更新日: 情報公開日 / 掲載日 / 登録日 mean "first published" and are
 * preferred. 更新日 (re-posted, common when a broker refreshes a stale listing)
 * is accepted as a fallback and flagged via `postedDateKind`, so the UI never
 * claims a re-post date is the original posting date.
 */
import { logger } from "../logger";

/** Which label produced the date — a re-post date is not a posting date. */
export type PostedDateKind = "posted" | "updated";

/**
 * Sources whose DETAIL page carries a date, verified one by one against live
 * pages on 2026-08-17 (one 渋谷区 listing per site, 土地 unless noted):
 *
 *   suumo          情報提供日   2026年8月17日      posted
 *   homes          情報公開日   2026/07/30         posted
 *   kenbiya        情報公開日   2026年8月17日      posted
 *   rakuten        情報公開日   2026年01月28日     posted
 *   hatomark       情報更新日   2026年07月22日     updated
 *   nomu           更新日       2026年8月8日       updated
 *   nomu_pro       更新日       2026年8月17日      updated
 *   mitsui         更新日       2026年08月10日     updated (needs the nav retry)
 *   mizuho         更新日       2026年08月17日     updated
 *   mitsubishi_ufj 更新日       2026/08/17         updated
 *   odakyu         更新日       2026年8月17日      updated
 *   keio           情報更新日   2026年08月17日     updated
 *   haseko         更新日       2026年08月16日     updated
 *   daikyo         更新日       2026/08/17         updated
 *   tokyotatemono  更新日       2026/08/17         updated
 *
 * Excluded, and why — fetching these would be pure cost for no date:
 *   stepon   detail page publishes no date label at all (checked
 *            /tochi/detail_12431040/: only 新着物件 nav links matched)
 *   tokyu    same (checked /tochi/C13267P63/) — its LIST page has a NEW badge,
 *            which is read as `isNew` instead
 *   asahi    same (checked /buy/detail/713811518) — its list only offers
 *            情報更新日／情報登録日 as SORT options, never printed
 *   athome   detail pages answer with 「認証にご協力ください」 (bot verification)
 *            after a couple of hits; the list scrape still works, so do not
 *            burn the block budget on dates
 */
export const DETAIL_DATE_SOURCES = new Set([
  "suumo",
  "homes",
  "kenbiya",
  "rakuten",
  "hatomark",
  "nomu",
  "nomu_pro",
  "mitsui",
  "mizuho",
  "mitsubishi_ufj",
  "odakyu",
  "keio",
  "haseko",
  "daikyo",
  "tokyotatemono",
]);

export interface PostedDateResult {
  /** Epoch ms at local midnight of the extracted date. */
  postedAt?: number;
  postedDateKind?: PostedDateKind;
  /** Raw matched text, kept for debugging a mis-parse. */
  raw?: string;
}

/** Labels meaning "first published", strongest first. */
const POSTED_LABELS = [
  "情報公開日",
  "情報提供日",
  "情報登録日",
  "掲載日",
  "登録日",
  "公開日",
];
/** Labels meaning "last touched" — usable, but not the posting date. */
const UPDATED_LABELS = ["情報更新日", "更新日", "情報更新"];

/**
 * Browser-side scan, as a STRING for `new Function`.
 *
 * It must be a string, not a closure: tsx injects `__name` helpers into
 * closures, which do not exist in the page context and throw. Every scraper in
 * this directory does the same for the same reason.
 *
 * Returns every label hit with the text around it; the Node side picks and
 * parses. Returning candidates rather than a parsed date keeps the date parsing
 * (and its tests) out of the page sandbox.
 */
export const DATE_SCAN_BODY = `
  var LABELS = ${JSON.stringify([...POSTED_LABELS, ...UPDATED_LABELS])};
  var txt = function (e) { return ((e && e.textContent) || "").replace(/\\s+/g, " ").trim(); };
  var out = [];

  var all = Array.prototype.slice.call(document.querySelectorAll("th, td, dt, dd, span, p, div, li, time"));
  for (var i = 0; i < all.length && out.length < 40; i++) {
    var el = all[i];
    // Leaf-ish only: an ancestor holding the whole table would match every label
    // and drown the real pairing.
    if (el.children.length > 1) continue;
    var t = txt(el);
    if (!t || t.length > 60) continue;

    for (var j = 0; j < LABELS.length; j++) {
      var label = LABELS[j];
      if (t.indexOf(label) === -1) continue;
      // 1) Value inside the same element ("更新日2026年08月10日").
      var inline = t.slice(t.indexOf(label) + label.length);
      // 2) Value in the next cell (th -> td, dt -> dd).
      var sib = el.nextElementSibling ? txt(el.nextElementSibling) : "";
      // 3) Value elsewhere in the parent row.
      var parent = el.parentElement ? txt(el.parentElement) : "";
      out.push({ label: label, inline: inline, sibling: sib, parent: parent });
      break;
    }
  }
  return JSON.stringify(out);
`;

type ScanHit = { label: string; inline: string; sibling: string; parent: string };

const WAREKI_ERA_START = 2018; // 令和1年 = 2019, so year = 2018 + n

/**
 * Japanese date text -> epoch ms, or undefined.
 *
 * Handles 2026年8月10日 / 2026/8/10 / 2026-08-10 / 令和8年8月10日 / 8/10 (current
 * year) / 本日. Two-digit years are NOT guessed at: "26/8/10" is ambiguous
 * between a date and a price fragment, so it is rejected rather than invented.
 */
export function parseJapaneseDate(
  text: string,
  now: Date = new Date(),
): { ms: number; raw: string } | undefined {
  if (!text) return undefined;
  const s = text.replace(/\s+/g, "").replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );

  if (/(本日|今日)/.test(s)) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { ms: d.getTime(), raw: "本日" };
  }

  const wareki = s.match(/令和(\d{1,2})年(\d{1,2})月(\d{1,2})日?/);
  if (wareki) {
    const year = WAREKI_ERA_START + Number(wareki[1]);
    return build(year, Number(wareki[2]), Number(wareki[3]), wareki[0], now);
  }

  const full = s.match(/(20\d{2})[年/.\-](\d{1,2})[月/.\-](\d{1,2})日?/);
  if (full) {
    return build(Number(full[1]), Number(full[2]), Number(full[3]), full[0], now);
  }

  // Month/day only (大京穴吹's "New 8/10"). Assume the current year, except when
  // that would put the date in the future — a listing posted "12/28" seen on
  // Jan 3rd is from last year, not eleven months from now.
  const md = s.match(/(?:^|[^\d/.])(\d{1,2})[/.](\d{1,2})(?:[^\d/.]|$)/);
  if (md) {
    const month = Number(md[1]);
    const day = Number(md[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let year = now.getFullYear();
      const candidate = new Date(year, month - 1, day);
      // 2 days of slack: a portal can stamp "tomorrow" in its own timezone.
      if (candidate.getTime() - now.getTime() > 2 * 86_400_000) year -= 1;
      return build(year, month, day, `${month}/${day}`, now);
    }
  }

  return undefined;
}

function build(
  year: number,
  month: number,
  day: number,
  raw: string,
  now: Date,
): { ms: number; raw: string } | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const d = new Date(year, month - 1, day);
  // Reject a parse that produced a different date than asked for (2月30日).
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return undefined;
  // Sanity window: property portals do not carry 1990 postings, and a date more
  // than a week ahead of today is a mis-parse, not a listing.
  const year_ = d.getFullYear();
  if (year_ < 2000 || year_ > now.getFullYear() + 1) return undefined;
  // A publication or update date is never in the future. Anything ahead of today
  // is a 次回更新予定 ("next scheduled update", which several brokers print right
  // next to the real 更新日) or a mis-parse. 2 days of slack for the portal's own
  // timezone and clock.
  if (d.getTime() - now.getTime() > 2 * 86_400_000) return undefined;
  return { ms: d.getTime(), raw };
}

/** Pick the best date out of the raw label hits from DATE_SCAN_BODY. */
export function pickPostedDate(
  hits: ScanHit[],
  now: Date = new Date(),
): PostedDateResult {
  let posted: { ms: number; raw: string } | undefined;
  let updated: { ms: number; raw: string } | undefined;

  for (const hit of hits) {
    // Same order the fields are tried in: value in this element, then the next
    // cell, then anywhere in the row. `parent` is last because it can contain a
    // neighbouring row's date.
    const candidate =
      parseJapaneseDate(hit.inline, now) ??
      parseJapaneseDate(hit.sibling, now) ??
      parseJapaneseDate(stripLabel(hit.parent, hit.label), now);
    if (!candidate) continue;

    const isPosted = POSTED_LABELS.includes(hit.label);
    if (isPosted) {
      // Earliest 公開日 wins: a page can show both 情報公開日 and 次回更新予定.
      if (!posted || candidate.ms < posted.ms) posted = candidate;
    } else if (!updated || candidate.ms < updated.ms) {
      updated = candidate;
    }
  }

  if (posted) return { postedAt: posted.ms, postedDateKind: "posted", raw: posted.raw };
  if (updated) return { postedAt: updated.ms, postedDateKind: "updated", raw: updated.raw };
  return {};
}

function stripLabel(text: string, label: string): string {
  const i = text.indexOf(label);
  return i === -1 ? text : text.slice(i + label.length);
}

/**
 * Turn a scraper's raw `postedText` (whatever the list card printed, e.g. "8/10")
 * into `postedAt`, in place, and drop the raw field.
 *
 * Page-side code returns the TEXT rather than a parsed date on purpose: date
 * parsing belongs in one tested place, not duplicated inside every page sandbox.
 */
export function applyListPostedText<
  T extends { postedText?: string; postedAt?: number; postedDateKind?: PostedDateKind },
>(listings: T[], now: Date = new Date()): T[] {
  for (const listing of listings) {
    const text = listing.postedText;
    delete listing.postedText;
    if (!text || listing.postedAt != null) continue;
    const parsed = parseJapaneseDate(text, now);
    if (parsed) {
      listing.postedAt = parsed.ms;
      // A list-card date sits next to the portal's own NEW badge, i.e. it marks
      // when the listing appeared — a posting date, not a re-post.
      listing.postedDateKind = "posted";
    }
  }
  return listings;
}

/**
 * Read the posted date off ONE already-loaded detail page.
 * Never throws: a page that does not show a date is a missing field, not a
 * failed scrape.
 */
export async function readPostedDateFromPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  now: Date = new Date(),
): Promise<PostedDateResult> {
  try {
    const raw = (await page.evaluate(new Function(DATE_SCAN_BODY))) as string;
    return pickPostedDate(JSON.parse(raw) as ScanHit[], now);
  } catch {
    return {};
  }
}

/**
 * Visit each url and read its posted date.
 *
 * Deliberately sequential and capped. One detail page per listing is the most
 * expensive thing this codebase can do — an unbounded version would turn a
 * 20-minute sweep into a multi-hour one and get us rate-limited (athome and
 * homes already serve a "Human Verification" page after bursts). Callers pass
 * only the urls that are NEW to the database, so a listing's date is fetched
 * once in its lifetime, not on every nightly run.
 */
export async function fetchPostedDates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  urls: string[],
  opts: { source: string; limit: number; delayMs?: number; timeoutMs?: number },
): Promise<{ dates: Map<string, PostedDateResult>; attempted: number; skipped: number }> {
  const dates = new Map<string, PostedDateResult>();
  const limit = Math.max(0, opts.limit);
  const targets = urls.slice(0, limit);
  const skipped = urls.length - targets.length;
  if (skipped > 0) {
    // Never a silent cap: a truncated pass must be visible in the run log.
    logger.warn(
      `[${opts.source}] 掲載日: ${urls.length} new listing(s) but limit is ${limit} — ` +
        `${skipped} will keep 取得日時 only until a later run picks them up`,
    );
  }

  let found = 0;
  for (const url of targets) {
    try {
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: opts.timeoutMs ?? 25000,
        });
      } catch {
        // rehouse.co.jp (三井) times out on domcontentloaded but renders fine —
        // verified: the retry is the difference between a date and nothing.
        await page.goto(url, {
          waitUntil: "networkidle2",
          timeout: (opts.timeoutMs ?? 25000) + 15000,
        });
      }
      const result = await readPostedDateFromPage(page);
      if (result.postedAt != null) {
        dates.set(url, result);
        found++;
      }
    } catch {
      // A single unreachable detail page must not abort the batch.
    }
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
  }

  logger.info(
    `[${opts.source}] 掲載日: ${found}/${targets.length} detail page(s) yielded a date`,
  );
  return { dates, attempted: targets.length, skipped };
}
