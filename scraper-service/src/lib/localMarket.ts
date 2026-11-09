import { db } from "../db";
import { normalizeWard, mlitTypeForListing } from "./scoring.js";

/**
 * Market baseline from our own scraped listings (asking prices), used when MLIT
 * transaction data is not cached. No external API: one paged read of `listings`,
 * kept in memory for an hour. Median, not mean, so a few junk prices don't move it.
 */
const TTL_MS = 60 * 60 * 1000;
const MIN_SAMPLES = 10;
const PAGE = 1000;

type Bucket = { medianPrice: number; medianPpsm: number | null; n: number };
let cache: { at: number; byKey: Map<string, Bucket> } | null = null;
let building: Promise<Map<string, Bucket>> | null = null;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const keyOf = (ward: unknown, propertyType: unknown) => {
  const w = normalizeWard(ward);
  return w ? `${w}|${mlitTypeForListing(propertyType as string)}` : null;
};

async function build(): Promise<Map<string, Bucket>> {
  const groups = new Map<string, { prices: number[]; ppsm: number[] }>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.raw
      .from("listings")
      .select("ward,propertyType,dealType,price,area,landSize")
      .gt("price", 0)
      .order("_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`local market: ${error.message}`);
    for (const l of data ?? []) {
      if (l.dealType === "rent") continue;
      const key = keyOf(l.ward, l.propertyType);
      if (!key) continue;
      const g = groups.get(key) ?? { prices: [], ppsm: [] };
      g.prices.push(l.price);
      const isLand = mlitTypeForListing(l.propertyType) === "宅地(土地)";
      const area = isLand ? (l.landSize ?? l.area) : (l.area ?? l.landSize);
      if (area > 0) g.ppsm.push(l.price / area);
      groups.set(key, g);
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  const out = new Map<string, Bucket>();
  for (const [k, g] of groups) {
    if (g.prices.length < MIN_SAMPLES) continue;
    out.set(k, {
      medianPrice: Math.round(median(g.prices)),
      medianPpsm: g.ppsm.length >= MIN_SAMPLES ? +median(g.ppsm).toFixed(1) : null,
      n: g.prices.length,
    });
  }
  return out;
}

/** Null when the ward is unknown or fewer than MIN_SAMPLES peers exist. */
export async function getLocalMarket(ward: unknown, propertyType: unknown): Promise<Bucket | null> {
  const key = keyOf(ward, propertyType);
  if (!key) return null;
  if (!cache || Date.now() - cache.at > TTL_MS) {
    building ??= build().finally(() => { building = null; });
    try {
      cache = { at: Date.now(), byKey: await building };
    } catch (e) {
      console.error("[local market]", e);
      return null;
    }
  }
  return cache.byKey.get(key) ?? null;
}
