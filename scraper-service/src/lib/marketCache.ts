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
