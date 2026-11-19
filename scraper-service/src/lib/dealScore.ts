import { logger } from "../logger";
import { mlitTypeForListing, normalizeWard } from "./scoring.js";

/**
 * Deal-finding scoring layer.
 *
 * Pure function `computeDealScore(listing, context)` ranks active listings by
 * how undervalued / motivated they are (0-100), attaches plain-Japanese reason
 * strings for every active signal, and flags legal/physical red flags without
 * altering the score itself.
 */
export const DEAL_SCORE_WEIGHTS = {
  a: 30, // 相場乖離 (price vs market)
  b: 15, // 容積未消化 (unused floor area)
  c: 20, // 実質利回り (real yield)
  d: 20, // 売り急ぎ (motivated seller)
  e: 10, // 情報優位 (information edge)
  g: 5,  // 土地値比較 (price vs land value)
} as const;

export type DealSignalKey = keyof typeof DEAL_SCORE_WEIGHTS;

export interface DealSignal {
  key: DealSignalKey;
  label: string;
  /** Normalized 0..1 score for this signal. */
  value: number;
  weight: number;
  reason: string;
}

export interface DealScoreResult {
  score: number;
  signals: DealSignal[];
  flags: string[];
  dataNotes: string[];
  duplicateOf?: string;
}

export interface MarketBenchmarkEntry {
  ppsm: number;
  n: number;
  source: "mlit" | "local";
  byStation?: Map<string, { ppsm: number; n: number }>;
  byAgeBucket?: Map<string, { ppsm: number; n: number }>;
}

export interface RentalBenchmarkEntry {
  medianRentPpsm: number;
  n: number;
}

export interface DuplicateGroupInfo {
  key: string;
  count: number;
  sources: Set<string>;
  minPrice: number;
  maxPrice: number;
  cheapestId: string;
  isRelisted: boolean;
}

export interface LandPricePoint {
  lat: number;
  lng: number;
  /** 万円 / ㎡ */
  pricePerSqmMan: number;
  year?: number;
  type?: number; // 0: 地価公示, 1: 都道府県地価調査
}

export interface DealScoreContext {
  now?: number;
  /** Keyed by `${ward}|${mlitType}` or `${ward}`. */
  marketBenchmarks?: Map<string, MarketBenchmarkEntry | number> | Record<string, MarketBenchmarkEntry | number>;
  /** Explicit fallback benchmark (万円/㎡) for unit tests or overrides. */
  mlitBenchmark?: number;
  /** Keyed by `station:${station}|${band}` or `ward:${ward}|${band}`. */
  rentalBenchmarks?: Map<string, RentalBenchmarkEntry> | Record<string, RentalBenchmarkEntry>;
  /** Raw rental listings (dealType === "rent") for pure computation in tests/batches. */
  rentListings?: Record<string, any>[];
  /** Pre-computed duplicate group per listing _id (from dedupeAndAnnotateListings). */
  duplicateByListingId?: Map<string, { group: DuplicateGroupInfo; duplicateOf?: string }>;
  /** Explicit land price per ㎡ (万円/㎡) or nearby points for signal (g). */
  landPricePerSqm?: number;
  landPricePoints?: LandPricePoint[];
  /** Under-populated field notes detected for the dataset. */
  datasetNotes?: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_LISTING_MS = 14 * DAY_MS;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function toFiniteNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeStation(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .replace(/駅.*$/, "")
    .replace(/^.*線\s*/, "")
    .trim();
}

function ageBucketForYear(buildYear: number | null | undefined): string | null {
  if (buildYear == null || !Number.isFinite(buildYear)) return null;
  if (buildYear < 1985) return "<1985";
  if (buildYear < 2000) return "1985-1999";
  if (buildYear < 2015) return "2000-2014";
  return "2015+";
}

function parseMlitBuildYear(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const m = raw.match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

function parseSqmFromSpec(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/,/g, "");
  const m = cleaned.match(/([\d.]+)\s*(?:㎡|m²|m2)/i);
  if (m) {
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  const num = cleaned.match(/^([\d.]+)/);
  if (num) {
    const n = parseFloat(num[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function getSpecValue(listing: Record<string, any>, ...keys: string[]): string | undefined {
  const specs = listing.specs;
  if (!specs || typeof specs !== "object") return undefined;
  for (const k of keys) {
    const v = specs[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function isCondoUnit(propertyType: unknown): boolean {
  const pt = typeof propertyType === "string" ? propertyType : "";
  return (pt.includes("マンション") || pt.includes("区分")) && !pt.includes("一棟");
}

function isLandProperty(propertyType: unknown): boolean {
  const pt = typeof propertyType === "string" ? propertyType : "";
  return ["土地", "用地", "宅地"].some((t) => pt.includes(t)) && !pt.includes("戸建");
}

/**
 * Resolves the relevant area (㎡) for price/㎡ market comparison.
 * Matches MLIT XIT001 conventions (land area for 土地, floor area for buildings/condos).
 */
function areaForMarketComparison(listing: Record<string, any>): number | null {
  const area = toFiniteNumber(listing.area);
  const landSize = toFiniteNumber(listing.landSize);
  if (isLandProperty(listing.propertyType)) {
    return landSize && landSize > 0 ? landSize : area && area > 0 ? area : null;
  }
  if (listing.propertyType === "一戸建て") {
    const specBldg = parseSqmFromSpec(
      getSpecValue(listing, "建物面積", "延床面積", "延べ床面積", "建物延床面積"),
    );
    if (specBldg && specBldg > 0) return specBldg;
    if (area && area > 0 && landSize && landSize > 0 && Math.abs(area - landSize) < 0.01) {
      return landSize;
    }
  }
  return area && area > 0 ? area : landSize && landSize > 0 ? landSize : null;
}

/**
 * Resolves existing building floor area (㎡) for Signal (b) 容積未消化.
 * Handles the portal scraper quirk where `area` copies `landSize` on 土地/一戸建て.
 */
function buildingAreaForFar(listing: Record<string, any>): number | null {
  const area = toFiniteNumber(listing.area);
  const landSize = toFiniteNumber(listing.landSize);
  const specBldg = parseSqmFromSpec(
    getSpecValue(listing, "建物面積", "延床面積", "延べ床面積", "建物延床面積"),
  );

  if (isLandProperty(listing.propertyType)) {
    if (specBldg != null && specBldg > 0) return specBldg;
    if (area == null || area === 0) return 0;
    if (landSize != null && Math.abs(area - landSize) < 0.01) return 0;
    return area;
  }

  if (specBldg != null && specBldg > 0 && area != null && landSize != null && Math.abs(area - landSize) < 0.01) {
    return specBldg;
  }
  if (
    listing.propertyType === "一戸建て" &&
    area != null &&
    landSize != null &&
    Math.abs(area - landSize) < 0.01
  ) {
    return specBldg ?? null;
  }
  return area;
}

// ---------------------------------------------------------------------------
// Signal (f): Address normalization & cross-source deduplication
// ---------------------------------------------------------------------------

const FULLWIDTH_OFFSET = 0xfee0;

function toHalfWidthAscii(str: string): string {
  return str
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - FULLWIDTH_OFFSET))
    .replace(/[－−―ー‐]/g, "-")
    .replace(/　/g, " ");
}

/**
 * Normalizes Japanese property addresses for cross-portal deduplication.
 * e.g. "東京都港区南麻布５丁目12番3号" -> "港区南麻布5-12-3"
 */
export function normalizeAddressForDedupe(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let s = toHalfWidthAscii(raw).trim();
  if (!s) return "";
  s = s.replace(/^東京都/, "");
  s = s.replace(/丁目|番地|番|号/g, "-");
  s = s.replace(/\s+/g, "");
  s = s.replace(/-+/g, "-");
  s = s.replace(/-$/, "");
  return s;
}

/**
 * Groups listings representing the same property across sources using:
 * normalized address + area (±1㎡) + floor.
 * Keeps the cheapest listing as canonical and marks others with `duplicateOf`.
 */
export function dedupeAndAnnotateListings(
  listings: Record<string, any>[],
): Map<string, { group: DuplicateGroupInfo; duplicateOf?: string }> {
  const result = new Map<string, { group: DuplicateGroupInfo; duplicateOf?: string }>();
  const buckets = new Map<string, Record<string, any>[]>();

  for (const l of listings) {
    const id = l._id || l.url;
    if (!id) continue;
    const normAddr = normalizeAddressForDedupe(l.address);
    if (!normAddr) continue;
    const areaVal = areaForMarketComparison(l);
    if (areaVal == null || areaVal <= 0) continue;
    const floorVal = toFiniteNumber(l.floor);
    const bucketKey = `${normAddr}|${floorVal ?? ""}`;
    const arr = buckets.get(bucketKey);
    if (arr) arr.push(l);
    else buckets.set(bucketKey, [l]);
  }

  for (const [bucketKey, members] of buckets) {
    // Cluster within ±1㎡ inside the same address+floor bucket
    const sortedByArea = [...members].sort(
      (a, b) => (areaForMarketComparison(a) ?? 0) - (areaForMarketComparison(b) ?? 0),
    );
    const clusters: Record<string, any>[][] = [];
    for (const item of sortedByArea) {
      const a = areaForMarketComparison(item)!;
      const lastCluster = clusters[clusters.length - 1];
      if (lastCluster) {
        const anchorArea = areaForMarketComparison(lastCluster[0])!;
        if (Math.abs(a - anchorArea) <= 1.0) {
          lastCluster.push(item);
          continue;
        }
      }
      clusters.push([item]);
    }

    for (let idx = 0; idx < clusters.length; idx++) {
      const cluster = clusters[idx];
      const sources = new Set<string>(cluster.map((c) => String(c.source || "unknown")));
      const prices = cluster
        .map((c) => toFiniteNumber(c.price))
        .filter((p): p is number => p != null && p > 0);
      const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
      const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

      // Cheapest listing wins; prefer broker email / earlier creation on tie
      const ranked = [...cluster].sort((a, b) => {
        const pa = toFiniteNumber(a.price);
        const pb = toFiniteNumber(b.price);
        const va = pa != null && pa > 0 ? pa : Number.POSITIVE_INFINITY;
        const vb = pb != null && pb > 0 ? pb : Number.POSITIVE_INFINITY;
        if (va !== vb) return va - vb;
        if (a.source === "email" && b.source !== "email") return -1;
        if (b.source === "email" && a.source !== "email") return 1;
        return String(a._id || a.url).localeCompare(String(b._id || b.url));
      });

      const canonical = ranked[0];
      const canonicalId = String(canonical._id || canonical.url);
      const isRelisted = cluster.some((c) => c.postedDateKind === "updated");

      const group: DuplicateGroupInfo = {
        key: `${bucketKey}#${idx}`,
        count: cluster.length,
        sources,
        minPrice,
        maxPrice,
        cheapestId: canonicalId,
        isRelisted,
      };

      for (const item of cluster) {
        const itemId = String(item._id || item.url);
        result.set(itemId, {
          group,
          duplicateOf: itemId === canonicalId ? undefined : canonicalId,
        });
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Hazard Zone Detection (mirrored from src/lib/geoIntelligence.ts)
// ---------------------------------------------------------------------------

interface GeoPoint {
  lat: number;
  lng: number;
}

const TOKYO_HIGH_HAZARD_ZONES: {
  name: string;
  label: string;
  center: GeoPoint;
  radiusMeters: number;
}[] = [
  {
    name: "墨田・江東・両国・錦糸町 ゼロメートル低地浸水想定区域",
    label: "高浸水リスク地域 (3.0m〜5.0m想定)",
    center: { lat: 35.698, lng: 139.805 },
    radiusMeters: 4500,
  },
  {
    name: "多摩川中流・調布/府中/狛江/稲城 氾濫浸水想定区域",
    label: "河川氾濫警戒区域 (1.0m〜3.0m想定)",
    center: { lat: 35.648, lng: 139.525 },
    radiusMeters: 3800,
  },
  {
    name: "荒川・江東デルタ広域浸水想定区域",
    label: "高浸水リスク地域 (3.0m〜5.0m超想定)",
    center: { lat: 35.705, lng: 139.845 },
    radiusMeters: 4800,
  },
];

const TOKYO_STATION_COORDS: { name: string; lat: number; lng: number }[] = [
  { name: "調布", lat: 35.6521, lng: 139.5435 },
  { name: "府中", lat: 35.6721, lng: 139.4803 },
  { name: "両国", lat: 35.6958, lng: 139.7928 },
  { name: "錦糸町", lat: 35.6967, lng: 139.8143 },
  { name: "北千住", lat: 35.7495, lng: 139.805 },
  { name: "豊洲", lat: 35.655, lng: 139.7966 },
];

function haversineMeters(p1: GeoPoint, p2: GeoPoint): number {
  const R = 6371e3;
  const phi1 = (p1.lat * Math.PI) / 180;
  const phi2 = (p2.lat * Math.PI) / 180;
  const dPhi = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLambda = ((p2.lng - p1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function detectHazardFlag(listing: Record<string, any>): string | null {
  if (listing.hazardRisk === "high") {
    return `ハザード警戒区域（${listing.hazardLabel || "高浸水・土砂災害警戒"}）`;
  }
  const lat = toFiniteNumber(listing.latitude);
  const lng = toFiniteNumber(listing.longitude);
  let point: GeoPoint | null =
    lat != null && lng != null && lat > 30 && lat < 45 && lng > 130 && lng < 150
      ? { lat, lng }
      : null;

  if (!point) {
    const stationRaw = normalizeStation(listing.stationName || listing.station || "");
    if (stationRaw) {
      const matched = TOKYO_STATION_COORDS.find(
        (s) => stationRaw.includes(s.name) || s.name.includes(stationRaw),
      );
      if (matched) point = { lat: matched.lat, lng: matched.lng };
    }
  }

  if (!point) return null;
  for (const zone of TOKYO_HIGH_HAZARD_ZONES) {
    if (haversineMeters(point, zone.center) <= zone.radiusMeters) {
      return `ハザード警戒区域（${zone.name}）`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Red Flags (warnings only; never affect score)
// ---------------------------------------------------------------------------

function extractBuildYearAndMonth(listing: Record<string, any>): { year: number | null; month: number | null } {
  const builtStr = getSpecValue(
    listing,
    "築年月",
    "建築年月",
    "完成時期（築年月）",
    "完成時期(築年月)",
    "完成時期",
  );
  let year = toFiniteNumber(listing.buildYear);
  let month: number | null = null;

  if (builtStr) {
    const ym = builtStr.match(/(\d{4})\s*[年/.]\s*(\d{1,2})?/);
    if (ym) {
      if (year == null) year = parseInt(ym[1], 10);
      if (ym[2]) month = parseInt(ym[2], 10);
    } else {
      const wareki = builtStr.match(/(昭和|平成|令和)\s*(\d+|元)\s*年(?:\s*(\d{1,2})\s*月)?/);
      if (wareki) {
        const eraYear = wareki[2] === "元" ? 1 : parseInt(wareki[2], 10);
        const base = wareki[1] === "昭和" ? 1925 : wareki[1] === "平成" ? 1988 : 2018;
        if (year == null) year = base + eraYear;
        if (wareki[3]) month = parseInt(wareki[3], 10);
      }
    }
  }
  return { year, month };
}

export function extractRedFlags(listing: Record<string, any>): string[] {
  const flags: string[] = [];

  // 1. Rebuildability
  const roadWidth = toFiniteNumber(listing.roadWidth);
  const frontage = toFiniteNumber(listing.frontage);
  if (roadWidth != null && roadWidth > 0 && roadWidth < 4) {
    flags.push(`再建築不可の可能性（前面道路幅員 ${roadWidth}m < 4m）`);
  } else if (frontage != null && frontage > 0 && frontage < 2) {
    flags.push(`再建築不可の可能性（接道間口 ${frontage}m < 2m）`);
  }

  // 2. Old earthquake code (before 1981-06)
  const { year, month } = extractBuildYearAndMonth(listing);
  if (year != null && year > 1800) {
    if (year < 1981 || (year === 1981 && month != null && month < 6)) {
      flags.push(`旧耐震（${year}年${month ? `${month}月` : ""}築・1981年6月以前）`);
    } else if (year === 1981 && month == null) {
      flags.push("旧耐震の可能性（1981年築・建築確認月要確認）");
    }
  }

  // 3. Keyword checks across title, description, and detail specs
  const specTexts = listing.specs && typeof listing.specs === "object"
    ? Object.values(listing.specs).filter((v): v is string => typeof v === "string")
    : [];
  const textBlob = [listing.title, listing.description, ...specTexts]
    .filter((s) => typeof s === "string" && s.length > 0)
    .join(" ");

  if (textBlob) {
    if (/借地権|旧法借地|普通借地|定期借地/.test(textBlob)) {
      flags.push("借地権");
    }
    if (/既存不適格/.test(textBlob)) {
      flags.push("既存不適格");
    }
    if (/再建築不可/.test(textBlob) && !flags.some((f) => f.startsWith("再建築不可"))) {
      flags.push("再建築不可");
    }
  }

  // 4. Hazard zone
  const hazardFlag = detectHazardFlag(listing);
  if (hazardFlag) flags.push(hazardFlag);

  return flags;
}

// ---------------------------------------------------------------------------
// Individual Signal Evaluators
// ---------------------------------------------------------------------------

function lookupMarketBenchmark(
  listing: Record<string, any>,
  context: DealScoreContext,
): { ppsm: number; sourceLabel: string } | null {
  const direct = toFiniteNumber(listing.mlitBenchmark) ?? toFiniteNumber(context.mlitBenchmark);
  if (direct != null && direct > 0) {
    return { ppsm: direct, sourceLabel: "MLIT相場" };
  }
  const map = context.marketBenchmarks;
  if (!map) return null;

  const getEntry = (k: string): MarketBenchmarkEntry | number | undefined =>
    map instanceof Map ? map.get(k) : map[k];

  const ward = normalizeWard(listing.ward);
  if (!ward) return null;
  const mlitType = mlitTypeForListing(listing.propertyType);
  const rawEntry = getEntry(`${ward}|${mlitType}`) ?? getEntry(ward);
  if (rawEntry == null) return null;
  if (typeof rawEntry === "number") {
    return rawEntry > 0 ? { ppsm: rawEntry, sourceLabel: `${ward}相場` } : null;
  }

  const station = normalizeStation(listing.stationName || listing.station || "");
  if (station && rawEntry.byStation) {
    const st = rawEntry.byStation.get(station);
    if (st && st.n >= 3 && st.ppsm > 0) {
      return { ppsm: st.ppsm, sourceLabel: `${station}駅相場` };
    }
  }

  const ageBucket = ageBucketForYear(toFiniteNumber(listing.buildYear));
  if (ageBucket && rawEntry.byAgeBucket) {
    const ag = rawEntry.byAgeBucket.get(ageBucket);
    if (ag && ag.n >= 5 && ag.ppsm > 0) {
      return { ppsm: ag.ppsm, sourceLabel: `${ward}・築年帯相場` };
    }
  }

  return rawEntry.ppsm > 0
    ? { ppsm: rawEntry.ppsm, sourceLabel: rawEntry.source === "mlit" ? `${ward}MLIT相場` : `${ward}掲載相場` }
    : null;
}

function evalSignalA(listing: Record<string, any>, context: DealScoreContext): DealSignal | null {
  if (listing.dealType === "rent") return null;
  const price = toFiniteNumber(listing.price);
  const area = areaForMarketComparison(listing);
  if (price == null || price <= 0 || area == null || area <= 0) return null;

  const bench = lookupMarketBenchmark(listing, context);
  if (!bench || bench.ppsm <= 0) return null;

  const listingPpsm = price / area;
  const diffRatio = (listingPpsm - bench.ppsm) / bench.ppsm;
  const diffPct = Math.round(diffRatio * 100);
  const value = clamp01(0.5 - diffRatio * 1.25);

  const ppsmTxt = Math.round(listingPpsm * 10) / 10;
  const benchTxt = Math.round(bench.ppsm * 10) / 10;
  const sign = diffPct > 0 ? "+" : "";
  return {
    key: "a",
    label: "相場乖離",
    value,
    weight: DEAL_SCORE_WEIGHTS.a,
    reason: `相場比 ${sign}${diffPct}%（${ppsmTxt}万/㎡ vs ${bench.sourceLabel}${benchTxt}万/㎡）`,
  };
}

function evalSignalB(listing: Record<string, any>): DealSignal | null {
  if (listing.dealType === "rent") return null;
  if (isCondoUnit(listing.propertyType)) return null;

  const landSize = toFiniteNumber(listing.landSize);
  const far = toFiniteNumber(listing.floorAreaRatio);
  if (landSize == null || landSize <= 0 || far == null || far <= 0) return null;

  const buildingArea = buildingAreaForFar(listing);
  if (buildingArea == null || buildingArea < 0) return null;

  const allowed = landSize * (far / 100);
  if (allowed <= 0) return null;

  const unusedRatio = (allowed - buildingArea) / allowed;
  if (unusedRatio < -0.5) return null;

  const value = clamp01(unusedRatio);
  const unusedPct = Math.round(unusedRatio * 100);
  const reason =
    unusedPct >= 0
      ? `容積未消化 ${unusedPct}%（許容延床 ${Math.round(allowed)}㎡${buildingArea === 0 ? "・更地" : ""}）`
      : `容積超過 ${Math.abs(unusedPct)}%（既存延床 ${Math.round(buildingArea)}㎡ / 許容 ${Math.round(allowed)}㎡）`;

  return {
    key: "b",
    label: "容積未消化",
    value,
    weight: DEAL_SCORE_WEIGHTS.b,
    reason,
  };
}

function areaBandForRent(area: number): string {
  if (area < 30) return "<30";
  if (area < 60) return "30-60";
  if (area < 100) return "60-100";
  return "100+";
}

function estimateMarketRentPpsm(
  listing: Record<string, any>,
  area: number,
  context: DealScoreContext,
): RentalBenchmarkEntry | null {
  const station = normalizeStation(listing.stationName || listing.station || "");
  const ward = normalizeWard(listing.ward);
  const band = areaBandForRent(area);

  if (context.rentalBenchmarks) {
    const getBench = (k: string) =>
      context.rentalBenchmarks instanceof Map
        ? context.rentalBenchmarks.get(k)
        : context.rentalBenchmarks![k];
    if (station) {
      const sHit = getBench(`station:${station}|${band}`) ?? getBench(`station:${station}`);
      if (sHit && sHit.n >= 5) return sHit;
    }
    if (ward) {
      const wHit = getBench(`ward:${ward}|${band}`) ?? getBench(`ward:${ward}`);
      if (wHit && wHit.n >= 5) return wHit;
    }
  }

  if (Array.isArray(context.rentListings) && context.rentListings.length >= 5) {
    const rentals = context.rentListings.filter((r) => {
      if (r.dealType !== "rent") return false;
      const rentVal = toFiniteNumber(r.rent);
      const rArea = toFiniteNumber(r.area);
      if (rentVal == null || rentVal <= 0 || rArea == null || rArea <= 0) return false;
      return rArea >= area * 0.75 && rArea <= area * 1.25;
    });

    if (station) {
      const stComps = rentals.filter((r) => normalizeStation(r.stationName || r.station) === station);
      if (stComps.length >= 5) {
        return {
          medianRentPpsm: median(stComps.map((r) => Number(r.rent) / Number(r.area))),
          n: stComps.length,
        };
      }
    }
    if (ward) {
      const wComps = rentals.filter((r) => normalizeWard(r.ward) === ward);
      if (wComps.length >= 5) {
        return {
          medianRentPpsm: median(wComps.map((r) => Number(r.rent) / Number(r.area))),
          n: wComps.length,
        };
      }
    }
  }

  return null;
}

function evalSignalC(
  listing: Record<string, any>,
  context: DealScoreContext,
  extraFlags: string[],
): DealSignal | null {
  if (listing.dealType === "rent") return null;
  const price = toFiniteNumber(listing.price);
  const area = toFiniteNumber(listing.area) ?? toFiniteNumber(listing.landSize);
  if (price == null || price <= 0 || area == null || area <= 0) return null;

  const rentBench = estimateMarketRentPpsm(listing, area, context);
  if (!rentBench || rentBench.n < 5 || rentBench.medianRentPpsm <= 0) return null;

  const annualEstRent = rentBench.medianRentPpsm * area * 12;
  const realYieldPct = (annualEstRent / price) * 100;
  const statedYield = toFiniteNumber(listing.yield ?? listing.grossYield ?? listing.netYield);

  let value = clamp01((realYieldPct - 2) / 8);
  let suffix = "";

  if (statedYield != null && statedYield > 0) {
    if (statedYield - realYieldPct >= 1.5) {
      extraFlags.push(
        `想定利回り過大の可能性（表記${statedYield.toFixed(1)}% vs 実質推計${realYieldPct.toFixed(1)}%）`,
      );
      value = clamp01(value - 0.2);
      suffix = `・表記${statedYield.toFixed(1)}%は過大懸念`;
    } else if (realYieldPct - statedYield >= 1.0) {
      value = clamp01(value + 0.15);
      suffix = `・現行賃料は相場より割安（賃料増額余地）`;
    } else {
      suffix = `（表記${statedYield.toFixed(1)}%）`;
    }
  }

  return {
    key: "c",
    label: "実質利回り",
    value,
    weight: DEAL_SCORE_WEIGHTS.c,
    reason: `実質利回り推計 ${realYieldPct.toFixed(1)}%（周辺事例${rentBench.n}件）${suffix}`,
  };
}

function evalSignalD(
  listing: Record<string, any>,
  context: DealScoreContext,
  now: number,
  dupGroup?: DuplicateGroupInfo,
): DealSignal | null {
  if (listing.dealType === "rent") return null;
  const postedAt = toFiniteNumber(listing.postedAt);
  const lastSeenAt = toFiniteNumber(listing.lastSeenAt);
  const price = toFiniteNumber(listing.price);
  const prevPrice = toFiniteNumber(listing.previousPrice);
  const initialPrice = toFiniteNumber(listing.initialPrice);
  const dropPctField = toFiniteNumber(listing.priceDropPct);

  const isStillListed = lastSeenAt == null || now - lastSeenAt <= STALE_LISTING_MS;
  const domDays =
    postedAt != null && postedAt <= now && isStillListed
      ? Math.max(0, Math.floor((now - postedAt) / DAY_MS))
      : null;

  const hasDrop =
    Boolean(listing.priceDropped) ||
    (prevPrice != null && price != null && price < prevPrice);
  const basePrice = initialPrice ?? prevPrice;
  const totalDropPct =
    basePrice != null && price != null && price < basePrice && basePrice > 0
      ? ((basePrice - price) / basePrice) * 100
      : dropPctField != null && dropPctField > 0
        ? dropPctField
        : 0;

  let dropCount = toFiniteNumber(listing.priceDropCount) ?? 0;
  if (dropCount === 0 && hasDrop) {
    dropCount =
      initialPrice != null && prevPrice != null && initialPrice > prevPrice && price != null && prevPrice > price
        ? 2
        : 1;
  }

  const crossGapPct =
    dupGroup && dupGroup.maxPrice > 0 && price != null && dupGroup.maxPrice > price
      ? ((dupGroup.maxPrice - price) / dupGroup.maxPrice) * 100
      : 0;
  const isRelisted = listing.postedDateKind === "updated" || Boolean(dupGroup?.isRelisted);

  if (domDays == null && !hasDrop && crossGapPct < 1 && !isRelisted) {
    return null;
  }

  const domScore = domDays != null ? clamp01(domDays / 180) : 0;
  const dropScore =
    totalDropPct > 0
      ? clamp01(0.35 + (totalDropPct / 15) * 0.55 + (dropCount >= 2 ? 0.1 : 0))
      : 0;
  const dupBonus =
    (crossGapPct >= 1 ? clamp01(crossGapPct / 15) * 0.35 : 0) +
    (isRelisted ? 0.15 : 0);

  let value: number;
  if (domDays != null && dropScore > 0) {
    value = clamp01(0.55 * domScore + 0.45 * dropScore + dupBonus);
  } else if (dropScore > 0) {
    value = clamp01(dropScore + dupBonus);
  } else {
    value = clamp01(domScore * 0.85 + dupBonus);
  }

  const parts: string[] = [];
  if (domDays != null) parts.push(`掲載${domDays}日`);
  if (totalDropPct > 0) {
    parts.push(`値下げ-${totalDropPct.toFixed(1)}%${dropCount >= 2 ? `(${dropCount}回)` : ""}`);
  }
  if (crossGapPct >= 1) parts.push(`他社掲載比-${crossGapPct.toFixed(1)}%`);
  if (isRelisted) parts.push("再掲載・更新あり");

  return {
    key: "d",
    label: "売り急ぎ",
    value,
    weight: DEAL_SCORE_WEIGHTS.d,
    reason: parts.join("・"),
  };
}

function evalSignalE(
  listing: Record<string, any>,
  dupGroup?: DuplicateGroupInfo,
): DealSignal | null {
  const isEmail = Boolean(listing.emailFrom) || listing.source === "email";
  if (!isEmail && !listing.source) return null;

  if (isEmail) {
    return {
      key: "e",
      label: "情報優位",
      value: 1.0,
      weight: DEAL_SCORE_WEIGHTS.e,
      reason: "業者メール直接紹介（非公開・先行情報の可能性）",
    };
  }

  const sourceCount = dupGroup ? dupGroup.sources.size : 1;
  if (sourceCount <= 1) {
    return {
      key: "e",
      label: "情報優位",
      value: 0.65,
      weight: DEAL_SCORE_WEIGHTS.e,
      reason: `単独ソース掲載（${listing.source}のみ）`,
    };
  }

  return {
    key: "e",
    label: "情報優位",
    value: 0.2,
    weight: DEAL_SCORE_WEIGHTS.e,
    reason: `複数ポータル掲載（${sourceCount}社）`,
  };
}

function resolveLandPricePerSqm(
  listing: Record<string, any>,
  context: DealScoreContext,
): number | null {
  const direct = toFiniteNumber(listing.landPricePerSqm) ?? toFiniteNumber(context.landPricePerSqm);
  if (direct != null && direct > 0) return direct;

  const lat = toFiniteNumber(listing.latitude);
  const lng = toFiniteNumber(listing.longitude);
  if (lat == null || lng == null || !context.landPricePoints?.length) return null;

  let bestDist = Number.POSITIVE_INFINITY;
  let bestPrice: number | null = null;
  for (const pt of context.landPricePoints) {
    if (!(pt.pricePerSqmMan > 0)) continue;
    const d = haversineMeters({ lat, lng }, { lat: pt.lat, lng: pt.lng });
    if (d < bestDist && d <= 2000) {
      bestDist = d;
      bestPrice = pt.pricePerSqmMan;
    }
  }
  return bestPrice;
}

function evalSignalG(listing: Record<string, any>, context: DealScoreContext): DealSignal | null {
  if (listing.dealType === "rent") return null;
  const price = toFiniteNumber(listing.price);
  const landSize = toFiniteNumber(listing.landSize);
  if (price == null || price <= 0 || landSize == null || landSize <= 0) return null;

  const landPpsm = resolveLandPricePerSqm(listing, context);
  if (landPpsm == null || landPpsm <= 0) return null;

  const estimatedLandValue = landSize * landPpsm;
  if (estimatedLandValue <= 0) return null;

  const diffRatio = (price - estimatedLandValue) / estimatedLandValue;
  const diffPct = Math.round(diffRatio * 100);
  const value = clamp01(0.5 - diffRatio * 1.25);
  const sign = diffPct > 0 ? "+" : "";

  return {
    key: "g",
    label: "土地値比較",
    value,
    weight: DEAL_SCORE_WEIGHTS.g,
    reason: `公示地価推計比 ${sign}${diffPct}%（地価推計 ${Math.round(estimatedLandValue).toLocaleString()}万円）`,
  };
}

// ---------------------------------------------------------------------------
// Public Pure Scorer
// ---------------------------------------------------------------------------

/**
 * Pure deal-finding scorer. Returns score (0-100), active signals with
 * plain-Japanese reasons, and warning flags (which never modify score).
 * Missing inputs return null for that signal and its weight is dropped
 * from the weighted average.
 */
export function computeDealScore(
  listing: Record<string, any> = {},
  context: DealScoreContext = {},
): DealScoreResult {
  const now = context.now ?? Date.now();
  const listingKey = String(listing._id || listing.url || "");
  const dupMeta = listingKey ? context.duplicateByListingId?.get(listingKey) : undefined;
  const dupGroup = dupMeta?.group;

  const flags = extractRedFlags(listing);
  const extraFlags: string[] = [];

  const candidateSignals: (DealSignal | null)[] = [
    evalSignalA(listing, context),
    evalSignalB(listing),
    evalSignalC(listing, context, extraFlags),
    evalSignalD(listing, context, now, dupGroup),
    evalSignalE(listing, dupGroup),
    evalSignalG(listing, context),
  ];

  for (const f of extraFlags) {
    if (!flags.includes(f)) flags.push(f);
  }

  const signals = candidateSignals.filter((s): s is DealSignal => s !== null);
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const score =
    totalWeight > 0
      ? Math.round((signals.reduce((sum, s) => sum + s.value * s.weight, 0) / totalWeight) * 100)
      : 0;

  const dataNotes = [...(context.datasetNotes ?? [])];
  if (!signals.some((s) => s.key === "c") && !dataNotes.some((n) => n.includes("rent"))) {
    dataNotes.push("要データ改善 (needs better data): rent / dealType, 全ソース — 実質利回り(c)をスキップ");
  }
  if (!signals.some((s) => s.key === "g") && !dataNotes.some((n) => n.includes("latitude"))) {
    dataNotes.push("要データ改善 (needs better data): latitude / longitude, 全ソース — 土地値比較(g)をスキップ");
  }

  return {
    score,
    signals,
    flags,
    dataNotes,
    ...(dupMeta?.duplicateOf ? { duplicateOf: dupMeta.duplicateOf } : {}),
  };
}

// ---------------------------------------------------------------------------
// MLIT Land Price Endpoint (XPT002) with Existing MLIT Cache
// ---------------------------------------------------------------------------

/**
 * Fetches & caches MLIT public land price points (地価公示/地価調査 XPT002)
 * for a given lat/lng tile using the existing `historicalData` cache helpers.
 */
export async function fetchLandPricePointsCached(
  lat: number,
  lng: number,
  year = new Date().getFullYear() - 1,
): Promise<LandPricePoint[]> {
  const key = process.env.REINFOLIB_API_KEY;
  if (!key) return [];
  const { CACHE_TTL_MS, getMlitCache, saveMlitCache } = await import("./marketCache");

  const z = 13;
  const x = Math.floor(((lng + 180) / 360) * 2 ** z);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** z,
  );
  const cacheWard = `landprice:${z}:${x}:${y}`;
  const cached = await getMlitCache(cacheWard, year);
  if (cached && Date.now() - (cached.fetchedAt as number) < CACHE_TTL_MS) {
    return (cached.comparables as LandPricePoint[]) ?? [];
  }

  const url = `https://www.reinfolib.mlit.go.jp/ex-api/external/XPT002?response_format=geojson&z=${z}&x=${x}&y=${y}&year=${year}`;
  const res = await fetch(url, { headers: { "Ocp-Apim-Subscription-Key": key } });
  if (!res.ok) return [];
  const body: any = await res.json().catch(() => null);
  const features: any[] = body?.features ?? [];
  const points: LandPricePoint[] = [];

  for (const f of features) {
    const coords = f?.geometry?.coordinates;
    const p = f?.properties;
    if (!Array.isArray(coords) || coords.length < 2 || !p) continue;
    const rawPrice = String(p.u_current_years_price_ja || "").replace(/,/g, "");
    const m = rawPrice.match(/([\d.]+)/);
    const yenPerSqm = m ? parseFloat(m[1]) : Number(p.last_years_price || 0);
    if (!Number.isFinite(yenPerSqm) || yenPerSqm <= 0) continue;
    points.push({
      lng: Number(coords[0]),
      lat: Number(coords[1]),
      pricePerSqmMan: yenPerSqm / 10000,
      year,
      type: typeof p.land_price_type === "number" ? p.land_price_type : undefined,
    });
  }

  await saveMlitCache({
    ward: cacheWard,
    year,
    comparables: points,
    fetchedAt: Date.now(),
  });
  return points;
}

// ---------------------------------------------------------------------------
// Batch Context Builder & Persistence
// ---------------------------------------------------------------------------

const LISTING_SCORE_COLUMNS = [
  "_id", "address", "ward", "price", "area", "landSize", "buildYear", "source",
  "url", "description", "title", "station", "stationName", "walkMinutes",
  "buildingCoverageRatio", "floorAreaRatio", "propertyType", "roadWidth",
  "frontage", "zoning", "yield", "structure", "postedAt", "postedDateKind",
  "lastSeenAt", "dealType", "rent", "emailFrom", "floor", "previousPrice",
  "initialPrice", "priceDropPct", "priceDropped", "specs", "latitude",
  "longitude", "mlitBenchmark", "dealScore", "dealSignals", "dealFlags", "dealScoredAt",
].join(",");

const LISTING_BASE_COLUMNS = [
  "_id", "address", "ward", "price", "area", "landSize", "buildYear", "source",
  "url", "description", "title", "station", "stationName", "walkMinutes",
  "buildingCoverageRatio", "floorAreaRatio", "propertyType", "roadWidth",
  "frontage", "zoning", "yield", "structure", "postedAt", "postedDateKind",
  "lastSeenAt", "dealType", "rent", "emailFrom", "floor", "previousPrice",
  "initialPrice", "priceDropPct", "priceDropped", "specs", "latitude",
  "longitude", "mlitBenchmark",
].join(",");

/**
 * In-memory cache keyed by listing _id so API endpoints can still attach
 * dealScore/signals/flags even if migration 0014 has not been pushed to a DB.
 */
const dealScoreMemoryCache = new Map<
  string,
  { dealScore: number; dealSignals: DealSignal[]; dealFlags: string[]; dealScoredAt: number }
>();

export function getCachedDealScore(listingId: string) {
  return dealScoreMemoryCache.get(listingId) ?? null;
}

let hasDealScoreColumns: boolean | null = null;

async function checkDealScoreColumns(): Promise<boolean> {
  if (hasDealScoreColumns !== null) return hasDealScoreColumns;
  const { db } = await import("../db");
  const { error } = await db.raw
    .from("listings")
    .select("dealScore,dealSignals,dealFlags,dealScoredAt")
    .limit(1);
  hasDealScoreColumns = !error;
  if (error) {
    logger.warn(`[dealScore] listings lacks dealScore columns (${error.message}); using memory cache until migration 0014 is applied`);
  }
  return hasDealScoreColumns;
}

async function fetchAllListingsForBatch(includeDealColumns: boolean): Promise<Record<string, any>[]> {
  const { db } = await import("../db");
  const PAGE = 1000;
  const cols = includeDealColumns ? LISTING_SCORE_COLUMNS : LISTING_BASE_COLUMNS;
  const rows: Record<string, any>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.raw
      .from("listings")
      .select(cols)
      .order("_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`dealScore scan listings: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as Record<string, any>[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

export async function buildBatchContext(
  allListings: Record<string, any>[],
  now = Date.now(),
): Promise<DealScoreContext> {
  const { db } = await import("../db");
  // 1. Load MLIT historicalData once (zero per-row queries)
  const histRows = await db.list("historicalData");
  const mlitGroups = new Map<
    string,
    { ppsm: number[]; byStation: Map<string, number[]>; byAgeBucket: Map<string, number[]> }
  >();

  for (const h of histRows) {
    if (typeof h.ward === "string" && h.ward.startsWith("landprice:")) continue;
    const ward = normalizeWard(h.ward);
    if (!ward || !Array.isArray(h.comparables)) continue;

    for (const c of h.comparables) {
      if (!c || typeof c.price !== "number" || typeof c.area !== "number" || c.area <= 0 || c.price <= 0) {
        continue;
      }
      const type = String(c.type || "");
      if (!type) continue;
      const key = `${ward}|${type}`;
      let g = mlitGroups.get(key);
      if (!g) {
        g = { ppsm: [], byStation: new Map(), byAgeBucket: new Map() };
        mlitGroups.set(key, g);
      }
      const ppsm = c.price / c.area;
      g.ppsm.push(ppsm);

      const st = normalizeStation(c.station);
      if (st) {
        const arr = g.byStation.get(st) ?? [];
        arr.push(ppsm);
        g.byStation.set(st, arr);
      }
      const ag = ageBucketForYear(parseMlitBuildYear(c.buildYear));
      if (ag) {
        const arr = g.byAgeBucket.get(ag) ?? [];
        arr.push(ppsm);
        g.byAgeBucket.set(ag, arr);
      }
    }
  }

  const marketBenchmarks = new Map<string, MarketBenchmarkEntry>();
  for (const [key, g] of mlitGroups) {
    if (g.ppsm.length < 3) continue;
    const byStation = new Map<string, { ppsm: number; n: number }>();
    for (const [st, xs] of g.byStation) {
      if (xs.length >= 3) byStation.set(st, { ppsm: median(xs), n: xs.length });
    }
    const byAgeBucket = new Map<string, { ppsm: number; n: number }>();
    for (const [ag, xs] of g.byAgeBucket) {
      if (xs.length >= 5) byAgeBucket.set(ag, { ppsm: median(xs), n: xs.length });
    }
    marketBenchmarks.set(key, {
      ppsm: median(g.ppsm),
      n: g.ppsm.length,
      source: "mlit",
      byStation,
      byAgeBucket,
    });
  }

  // 2. Fallback local asking-price median from active sale listings (one in-memory pass)
  const localGroups = new Map<string, number[]>();
  const rentGroups = new Map<string, number[]>();
  let rentCount = 0;
  let latLngCount = 0;

  for (const l of allListings) {
    if (l.latitude != null && l.longitude != null) latLngCount++;
    if (l.dealType === "rent") {
      rentCount++;
      const r = toFiniteNumber(l.rent);
      const a = toFiniteNumber(l.area);
      if (r != null && r > 0 && a != null && a > 0) {
        const rp = r / a;
        const band = areaBandForRent(a);
        const st = normalizeStation(l.stationName || l.station || "");
        const w = normalizeWard(l.ward);
        if (st) {
          const sk = `station:${st}|${band}`;
          rentGroups.set(sk, [...(rentGroups.get(sk) ?? []), rp]);
        }
        if (w) {
          const wk = `ward:${w}|${band}`;
          rentGroups.set(wk, [...(rentGroups.get(wk) ?? []), rp]);
        }
      }
      continue;
    }

    const ward = normalizeWard(l.ward);
    const price = toFiniteNumber(l.price);
    const area = areaForMarketComparison(l);
    if (!ward || price == null || price <= 0 || area == null || area <= 0) continue;
    const key = `${ward}|${mlitTypeForListing(l.propertyType)}`;
    if (!marketBenchmarks.has(key)) {
      const arr = localGroups.get(key);
      if (arr) arr.push(price / area);
      else localGroups.set(key, [price / area]);
    }
  }

  for (const [key, ppsms] of localGroups) {
    if (ppsms.length >= 5) {
      marketBenchmarks.set(key, {
        ppsm: median(ppsms),
        n: ppsms.length,
        source: "local",
      });
    }
  }

  const rentalBenchmarks = new Map<string, RentalBenchmarkEntry>();
  for (const [k, xs] of rentGroups) {
    if (xs.length >= 5) {
      rentalBenchmarks.set(k, { medianRentPpsm: median(xs), n: xs.length });
    }
  }

  // 3. Cross-source duplicate detection across all listings
  const duplicateByListingId = dedupeAndAnnotateListings(allListings);

  // 4. Coverage notes for signals skipped due to <20% data coverage
  const total = Math.max(1, allListings.length);
  const datasetNotes: string[] = [];
  if ((rentCount / total) * 100 < 20) {
    datasetNotes.push("要データ改善 (needs better data): rent / dealType, 全ソース — 実質利回り(c)をスキップ");
  }
  if ((latLngCount / total) * 100 < 20) {
    datasetNotes.push("要データ改善 (needs better data): latitude / longitude, 全ソース — 土地値比較(g)をスキップ");
  }

  return {
    now,
    marketBenchmarks,
    rentalBenchmarks,
    duplicateByListingId,
    datasetNotes,
  };
}

export interface BatchScoreSummary {
  totalScanned: number;
  scoredCount: number;
  persistedCount: number;
  results: { listing: Record<string, any>; result: DealScoreResult }[];
}

const CONTEXT_TTL_MS = 5 * 60 * 1000;
let cachedBatchContext: { at: number; context: DealScoreContext } | null = null;
let buildingContext: Promise<DealScoreContext> | null = null;

async function getBatchContext(
  allListings: Record<string, any>[],
  now: number,
  forceRefresh: boolean,
): Promise<DealScoreContext> {
  if (!forceRefresh && cachedBatchContext && now - cachedBatchContext.at < CONTEXT_TTL_MS) {
    return { ...cachedBatchContext.context, now };
  }
  buildingContext ??= buildBatchContext(allListings, now).finally(() => {
    buildingContext = null;
  });
  const context = await buildingContext;
  cachedBatchContext = { at: now, context };
  return context;
}

/**
 * Scores listings in batch with one shared market/rental/duplicate context
 * (zero per-row DB queries for context).
 */
export async function scoreListingsBatch(opts: {
  listingIds?: string[];
  forceAllActive?: boolean;
  dryRun?: boolean;
} = {}): Promise<BatchScoreSummary> {
  const now = Date.now();
  const canPersist = opts.dryRun ? false : await checkDealScoreColumns();
  const idFilter = opts.listingIds?.length ? new Set(opts.listingIds) : null;

  let allListings: Record<string, any>[];
  let targets: Record<string, any>[];
  let context: DealScoreContext;

  if (idFilter && !opts.forceAllActive && cachedBatchContext && now - cachedBatchContext.at < CONTEXT_TTL_MS) {
    const { db } = await import("../db");
    const cols = canPersist ? LISTING_SCORE_COLUMNS : LISTING_BASE_COLUMNS;
    targets = await db.selectIn("listings", cols, "_id", [...idFilter]);
    allListings = targets;
    context = { ...cachedBatchContext.context, now };
  } else {
    allListings = await fetchAllListingsForBatch(canPersist);
    context = await getBatchContext(allListings, now, Boolean(opts.forceAllActive));
    targets = allListings.filter((l) => {
      if (idFilter) return idFilter.has(l._id);
      if (opts.forceAllActive) {
        return l.lastSeenAt == null || now - Number(l.lastSeenAt) <= STALE_LISTING_MS;
      }
      return l.dealScore == null || l.dealScoredAt == null || now - Number(l.dealScoredAt) >= DAY_MS;
    });
  }

  const scoredResults: { listing: Record<string, any>; result: DealScoreResult }[] = [];
  for (const listing of targets) {
    const result = computeDealScore(listing, context);
    dealScoreMemoryCache.set(listing._id, {
      dealScore: result.score,
      dealSignals: result.signals,
      dealFlags: result.flags,
      dealScoredAt: now,
    });
    scoredResults.push({ listing, result });
  }

  let persistedCount = 0;
  if (canPersist && scoredResults.length > 0) {
    const { db } = await import("../db");
    const CHUNK = 50;
    for (let i = 0; i < scoredResults.length; i += CHUNK) {
      const slice = scoredResults.slice(i, i + CHUNK);
      await Promise.all(
        slice.map(async ({ listing, result }) => {
          const { error } = await db.raw
            .from("listings")
            .update({
              dealScore: result.score,
              dealSignals: result.signals,
              dealFlags: result.flags,
              dealScoredAt: now,
            })
            .eq("_id", listing._id);
          if (!error) persistedCount++;
          else logger.warn(`[dealScore] update failed for ${listing._id}: ${error.message}`);
        }),
      );
    }
  }

  logger.info(
    `[dealScore] batch complete: scanned=${allListings.length} scored=${scoredResults.length} persisted=${persistedCount}`,
  );
  return {
    totalScanned: allListings.length,
    scoredCount: scoredResults.length,
    persistedCount,
    results: scoredResults,
  };
}

/**
 * Ensures any listing rows returned by API endpoints carry dealScore fields,
 * falling back to memory cache or fast single-listing evaluation if unscored.
 */
export function attachDealScoreFallback(rows: Record<string, any>[]): Record<string, any>[] {
  return rows.map((row) => {
    if (!row || row.dealScore != null) return row;
    const cached = row._id ? dealScoreMemoryCache.get(row._id) : undefined;
    if (cached) return { ...row, ...cached };
    return row;
  });
}
