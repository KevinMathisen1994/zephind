import { db } from "../db";

/**
 * Cache of external market lookups. Ported from convex/marketCache.js.
 *
 * MLIT publishes transaction data quarterly, and Places results for a fixed
 * address rarely move week to week, so a month-long cache trades a small amount
 * of staleness for far fewer external calls on every 再評価 click.
 */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function getMlitCache(ward: string, year: number) {
  return db.first("historicalData", { where: { ward, year } });
}

export async function saveMlitCache(fields: {
  ward: string;
  year: number;
  avgPrice?: number;
  avgArea?: number;
  transactionCount?: number;
  comparables?: unknown[];
  fetchedAt: number;
}) {
  const existing = await db.first("historicalData", { where: { ward: fields.ward, year: fields.year } });
  if (existing) return db.patch("historicalData", existing._id, fields);
  await db.insert("historicalData", fields);
}

export async function getPlacesCache(address: string) {
  return db.first("placesCache", { where: { address } });
}

export async function savePlacesCache(fields: {
  address: string;
  nearbyTotalCount?: number;
  nearbyInfo?: string;
  fetchedAt: number;
}) {
  const existing = await db.first("placesCache", { where: { address: fields.address } });
  if (existing) return db.patch("placesCache", existing._id, fields);
  await db.insert("placesCache", fields);
}

/**
 * One ward-year of MLIT XIT001 trades (all types), from cache or fetched and cached.
 * fetchIfMissing=false returns [] on a cache miss, for bulk paths that must not hit the network.
 */
export async function loadMlitYear(
  ward: string,
  cityCode: string,
  year: number,
  fetchIfMissing: boolean,
): Promise<any[]> {
  const cached = await getMlitCache(ward, year);
  if (cached && Date.now() - (cached.fetchedAt as number) < CACHE_TTL_MS) return cached.comparables || [];
  const key = process.env.REINFOLIB_API_KEY;
  if (!fetchIfMissing || !key) return [];
  const res = await fetch(
    `https://www.reinfolib.mlit.go.jp/ex-api/external/XIT001?year=${year}&area=13&city=${cityCode}&language=ja`,
    { headers: { "Ocp-Apim-Subscription-Key": key } },
  );
  if (!res.ok) throw new Error(`MLIT API HTTP ${res.status}`);
  const data: any = await res.json();
  const items = (data.data || [])
    .filter((i: any) => i.TradePrice)
    .map((i: any) => ({
      type: i.Type,
      district: i.DistrictName,
      station: i.NearestStation,
      walkMinutes: i.TimeToNearestStation,
      price: Math.round(parseFloat(i.TradePrice.replace(/,/g, "")) / 10000),
      area: i.Area ? parseFloat(i.Area) : null,
      buildYear: i.BuildingYear,
      structure: i.Structure,
      period: i.Period,
    }))
    .slice(0, 200); // bounded snapshot, refreshed wholesale, not appended to
  await saveMlitCache({ ward, year, comparables: items, fetchedAt: Date.now() });
  return items;
}
