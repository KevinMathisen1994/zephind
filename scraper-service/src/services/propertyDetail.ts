/**
 * Detail page specification extractor.
 *
 * Scans detail pages for property specifications that are rarely or incompletely
 * provided on search result cards:
 *   - 所在階 / 階数 (`floor`)
 *   - エレベーター基数 (`elevators`)
 *   - 建物構造 (`structure`, `structureType`)
 *   - 総戸数 (`totalUnits`)
 *   - 前面道路幅員 (`roadWidth`)
 *   - 間口 (`frontage`)
 *   - 築年月 (`buildYear`)
 *   - 建ぺい率・容積率 (`buildingCoverageRatio`, `floorAreaRatio`)
 *   - 掲載日 (`postedAt`, `postedDateKind`)
 *
 * Scans standard Japanese real estate table labels across SUUMO, HOME'S, Rakuten,
 * Kenbiya, Hatomark, Nomu, etc.
 */
import { logger } from "../logger";
import {
  type PostedDateKind,
  type PostedDateResult,
  pickPostedDate,
  parseJapaneseDate,
} from "./postedDate";

export interface ListingDetailEnrichment extends PostedDateResult {
  floor?: number;
  elevators?: number;
  structure?: string;
  structureType?: string;
  totalUnits?: number;
  roadWidth?: number;
  frontage?: number;
  buildYear?: number;
  buildingCoverageRatio?: number;
  floorAreaRatio?: number;
}

export type ScanHit = {
  label: string;
  inline: string;
  sibling: string;
  parent: string;
};

// All specification labels across portals
export const SPEC_LABELS = [
  // Dates
  "情報公開日", "情報提供日", "情報登録日", "掲載日", "登録日", "公開日",
  "情報更新日", "更新日", "情報更新",
  // Floor
  "所在階", "階数", "階建/階", "階建て/階", "所在階/階数",
  // Elevators
  "エレベーター", "エレベータ", "EV",
  // Structure
  "建物構造", "構造・階建て", "構造", "造り",
  // Units
  "総戸数", "総戸数（販売戸数）", "全戸数", "戸数",
  // Road & Frontage
  "前面道路", "接道状況", "接道", "道路幅員", "接道方位・幅員", "間口", "接面",
  // Build year
  "築年月", "建築年月", "完成時期", "建築時期", "完成時期（築年月）",
  // BCR / FAR
  "建ぺい率・容積率", "建ぺい率/容積率", "建ぺい率", "容積率", "建蔽率",
  // Equipment / facilities
  "設備", "特徴・設備", "設備・条件", "条件・設備",
];

export const DETAIL_SCAN_BODY = `
  var LABELS = ${JSON.stringify(SPEC_LABELS)};
  var txt = function (e) { return ((e && e.textContent) || "").replace(/\\s+/g, " ").trim(); };
  var out = [];

  var all = Array.prototype.slice.call(document.querySelectorAll("th, td, dt, dd, span, p, div, li, time"));
  for (var i = 0; i < all.length && out.length < 80; i++) {
    var el = all[i];
    if (el.children.length > 1) continue;
    var t = txt(el);
    if (!t || t.length > 80) continue;

    for (var j = 0; j < LABELS.length; j++) {
      var label = LABELS[j];
      if (t.indexOf(label) === -1) continue;
      var inline = t.slice(t.indexOf(label) + label.length);
      var sib = el.nextElementSibling ? txt(el.nextElementSibling) : "";
      var parent = el.parentElement ? txt(el.parentElement) : "";
      out.push({ label: label, inline: inline, sibling: sib, parent: parent });
      break;
    }
  }
  return JSON.stringify(out);
`;

/** Parses floor number (e.g. 1階 -> 1, 3階/10階建 -> 3, B1階 -> -1). */
export function parseFloor(text: string): number | undefined {
  if (!text) return undefined;
  const s = text.replace(/\s+/g, "");

  // Basement: 地下2階, B1階
  const bMatch = s.match(/(?:地下|B)(\d+)階?/);
  if (bMatch) return -parseInt(bMatch[1], 10);

  // "3階部分" or "3階/14階建" or "所在階:3階"
  const m1 = s.match(/(?:所在階[:：]?)?(\d+)階(?:部分|\s*[/／]|\s*$)/);
  if (m1) return parseInt(m1[1], 10);

  // Bare number + 階 (between 1 and 99)
  const m2 = s.match(/(\d{1,2})階/);
  if (m2) return parseInt(m2[1], 10);

  // Bare number + F (e.g. "3F")
  const m3 = s.match(/(?:^|[^\d])(\d{1,2})F(?:[^\d]|$)/i);
  if (m3) return parseInt(m3[1], 10);

  return undefined;
}

/** Parses elevator count or presence. */
export function parseElevators(text: string): number | undefined {
  if (!text) return undefined;
  const s = text.replace(/\s+/g, "");

  // Explicit count: 2基, EV2基, エレベーター有(2基), エレベーター2基以上
  const mCount = s.match(/(\d+)\s*基/);
  if (mCount) return parseInt(mCount[1], 10);

  // Negative: エレベーター無, なし
  if (/(?:エレベーター|エレベータ|EV)\s*(?:無|なし)/i.test(s)) return 0;

  // Positive: エレベーター有, あり, 完備, 設置, or under equipment header
  if (/(?:エレベーター|エレベータ|EV)/i.test(s)) {
    return 1;
  }

  return undefined;
}

/** Parses and normalizes structure string (e.g. 鉄筋コンクリート造 -> RC). */
export function parseStructure(text: string): { structure: string; structureType: string } | undefined {
  if (!text) return undefined;
  const s = text.replace(/\s+/g, "").toUpperCase();

  if (s.includes("鉄骨鉄筋") || s.includes("SRC")) {
    return { structure: "鉄骨鉄筋コンクリート造", structureType: "SRC" };
  }
  if (s.includes("鉄筋コンクリート") || s.includes("RC")) {
    return { structure: "鉄筋コンクリート造", structureType: "RC" };
  }
  if (s.includes("軽量鉄骨")) {
    return { structure: "軽量鉄骨造", structureType: "軽量鉄骨" };
  }
  if (s.includes("鉄骨") || s.includes("S造")) {
    return { structure: "鉄骨造", structureType: "S" };
  }
  if (s.includes("木造") || s.includes("W造")) {
    return { structure: "木造", structureType: "木造" };
  }
  if (s.includes("ALC")) {
    return { structure: "ALC造", structureType: "ALC" };
  }
  return undefined;
}

/** Parses total units count (e.g. 54戸 -> 54). */
export function parseTotalUnits(text: string): number | undefined {
  if (!text) return undefined;
  const m = text.match(/(\d+)\s*戸/);
  if (m) {
    const num = parseInt(m[1], 10);
    if (num > 0 && num < 10000) return num;
  }
  return undefined;
}

/** Parses road width in meters (e.g. 幅員6.0m, 公道 北 8m, 公道 北側 6.0m -> 6.0 / 8.0). */
export function parseRoadWidth(text: string): number | undefined {
  if (!text) return undefined;
  const s = text.replace(/\s+/g, " ");

  // 1. Explicit width indicator: 幅員 6.0m, 幅: 4m
  const m1 = s.match(/(?:幅員|幅)\s*[:：]?\s*([0-9.]+)\s*m/);
  if (m1) return parseFloat(m1[1]);

  // 2. Road type before or after: 公道...6.0m, 6.0m公道
  const m2 = s.match(/(?:公道|私道|道路).*?([0-9.]+)\s*m/);
  if (m2) return parseFloat(m2[1]);

  const m3 = s.match(/([0-9.]+)\s*m\s*(?:公道|私道|道路)/);
  if (m3) return parseFloat(m3[1]);

  // 3. Fallback: bare [0-9.]+m under a road header
  const m4 = s.match(/([0-9.]+)\s*m/);
  if (m4) return parseFloat(m4[1]);

  return undefined;
}

/** Parses frontage in meters (e.g. 間口 8.5m, 接面 10m, 7.5m -> 8.5 / 10.0 / 7.5). */
export function parseFrontage(text: string, allowBareMeters: boolean = false): number | undefined {
  if (!text) return undefined;
  const m1 = text.match(/(?:間口|接面|接面長さ)\s*[:：]?\s*([0-9.]+)\s*m/);
  if (m1) return parseFloat(m1[1]);
  if (allowBareMeters) {
    const m2 = text.match(/([0-9.]+)\s*m/);
    if (m2) return parseFloat(m2[1]);
  }
  return undefined;
}

/** Parses build year (e.g. 2018年, 令和2年, 平成15年, 昭和58年, 新築). */
export function parseBuildYear(text: string): number | undefined {
  if (!text) return undefined;
  if (text.includes("新築")) return new Date().getFullYear();

  const gregorian = text.match(/(20\d{2}|19\d{2})年/);
  if (gregorian) return parseInt(gregorian[1], 10);

  const reiwa = text.match(/令和(\d+)年/);
  if (reiwa) return 2018 + parseInt(reiwa[1], 10);

  const heisei = text.match(/平成(\d+)年/);
  if (heisei) return 1988 + parseInt(heisei[1], 10);

  const showa = text.match(/昭和(\d+)年/);
  if (showa) return 1925 + parseInt(showa[1], 10);

  return undefined;
}

/** Parses building coverage ratio and floor area ratio percentages. */
export function parseBcrFar(text: string): { bcr?: number; far?: number } {
  if (!text) return {};
  const both = text.match(/([0-9.]+)%\s*[/／・\s]\s*([0-9.]+)%/);
  if (both) {
    return { bcr: parseFloat(both[1]), far: parseFloat(both[2]) };
  }

  let bcr: number | undefined;
  let far: number | undefined;
  const bcrM = text.match(/建[ぺ蔽]い率\s*[:：]?\s*([0-9.]+)%/);
  if (bcrM) bcr = parseFloat(bcrM[1]);
  const farM = text.match(/容積率\s*[:：]?\s*([0-9.]+)%/);
  if (farM) far = parseFloat(farM[1]);

  return { bcr, far };
}

/** Extracts all available details from page scan hits. */
export function extractDetailsFromHits(hits: ScanHit[], now: Date = new Date()): ListingDetailEnrichment {
  const result: ListingDetailEnrichment = {};

  // 1. Date
  const dateRes = pickPostedDate(hits, now);
  if (dateRes.postedAt != null) {
    result.postedAt = dateRes.postedAt;
    result.postedDateKind = dateRes.postedDateKind;
    result.raw = dateRes.raw;
  }

  // 2. Specifications
  for (const hit of hits) {
    const val = (hit.inline || hit.sibling || hit.parent).trim();
    if (!val) continue;

    // Floor
    if (result.floor == null && ["所在階", "階数", "階建/階", "階建て/階", "所在階/階数"].includes(hit.label)) {
      result.floor = parseFloor(hit.inline || hit.sibling) ?? parseFloor(hit.parent);
    }

    // Elevators
    if (result.elevators == null && ["エレベーター", "エレベータ", "EV"].includes(hit.label)) {
      result.elevators = parseElevators(hit.label + " " + val);
    } else if (result.elevators == null && ["設備", "特徴・設備", "設備・条件"].includes(hit.label)) {
      if (val.includes("エレベーター") || val.includes("エレベータ") || val.includes("EV")) {
        result.elevators = parseElevators(val);
      }
    }

    // Structure
    if (!result.structure && ["建物構造", "構造・階建て", "構造", "造り"].includes(hit.label)) {
      const s = parseStructure(val);
      if (s) {
        result.structure = s.structure;
        result.structureType = s.structureType;
      }
    }

    // Total units
    if (result.totalUnits == null && ["総戸数", "総戸数（販売戸数）", "全戸数", "戸数"].includes(hit.label)) {
      result.totalUnits = parseTotalUnits(val);
    }

    // Road width
    if (result.roadWidth == null && ["前面道路", "接道状況", "接道", "道路幅員", "接道方位・幅員"].includes(hit.label)) {
      result.roadWidth = parseRoadWidth(val);
    }

    // Frontage
    if (result.frontage == null && ["間口", "接面"].includes(hit.label)) {
      result.frontage = parseFrontage(val, true);
    } else if (result.frontage == null && ["接道状況", "前面道路", "接道"].includes(hit.label)) {
      result.frontage = parseFrontage(val, false);
    }

    // Build year
    if (result.buildYear == null && ["築年月", "建築年月", "完成時期", "建築時期", "完成時期（築年月）"].includes(hit.label)) {
      result.buildYear = parseBuildYear(val);
    }

    // BCR & FAR
    if ((result.buildingCoverageRatio == null || result.floorAreaRatio == null) &&
        ["建ぺい率・容積率", "建ぺい率/容積率", "建ぺい率", "容積率", "建蔽率"].includes(hit.label)) {
      const { bcr, far } = parseBcrFar(val);
      if (result.buildingCoverageRatio == null && bcr != null) result.buildingCoverageRatio = bcr;
      if (result.floorAreaRatio == null && far != null) result.floorAreaRatio = far;
    }
  }

  return result;
}

/** Reads all specification fields off ONE already-loaded detail page. */
export async function readDetailsFromPage(
  page: any,
  now: Date = new Date(),
): Promise<ListingDetailEnrichment> {
  try {
    const raw = (await page.evaluate(new Function(DETAIL_SCAN_BODY))) as string;
    const hits = JSON.parse(raw) as ScanHit[];
    return extractDetailsFromHits(hits, now);
  } catch (err) {
    logger.debug(`[readDetailsFromPage] parse failed: ${err}`);
    return {};
  }
}

/**
 * Visits a batch of URLs sequentially and enriches them with detail specifications.
 */
export async function fetchListingDetails(
  page: any,
  urls: string[],
  opts: { source: string; limit: number; delayMs?: number; timeoutMs?: number },
): Promise<{ details: Map<string, ListingDetailEnrichment>; attempted: number; skipped: number }> {
  const details = new Map<string, ListingDetailEnrichment>();
  const limit = Math.max(0, opts.limit);
  const targets = urls.slice(0, limit);
  const skipped = urls.length - targets.length;

  if (skipped > 0) {
    logger.warn(
      `[${opts.source}] 詳細取得: ${urls.length} listings but limit is ${limit} — ` +
        `${skipped} will keep card data only`,
    );
  }

  let enrichedCount = 0;
  for (const url of targets) {
    try {
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: opts.timeoutMs ?? 25000,
        });
      } catch {
        await page.goto(url, {
          waitUntil: "networkidle2",
          timeout: (opts.timeoutMs ?? 25000) + 15000,
        });
      }

      const res = await readDetailsFromPage(page);
      if (Object.keys(res).length > 0) {
        details.set(url, res);
        enrichedCount++;
      }
    } catch {
      // Don't fail the whole batch for one unreachable page
    }
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
  }

  logger.info(
    `[${opts.source}] 詳細取得: ${enrichedCount}/${targets.length} detail page(s) successfully enriched`,
  );
  return { details, attempted: targets.length, skipped };
}
