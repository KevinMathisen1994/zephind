/**
 * One-off maintenance helpers, ported from convex/adminMaintenance.js.
 *
 * Run from the CLI (`npm run maintain -- <command>`), never from the browser —
 * these were Convex `internal*` functions precisely so no client could invoke
 * them, and there is deliberately no HTTP route for any of them.
 *
 * Context: per-user isolation was added after this data already existed, so
 * every pre-existing row has no `userId` and is invisible through the normal
 * (access-controlled) API.
 */
import { db } from "../db";

const TENANT_TABLES = ["orders", "customers", "deals", "matching", "proposals"];

/** Counts rows and how many are orphaned (no owner). Read-only. */
export async function dataOwnershipReport() {
  const report: Record<string, { total: number; orphaned: number }> = {};
  for (const table of [...TENANT_TABLES, "listings"]) {
    const total = await db.count(table);
    // `listings` has no userId column at all, so "orphaned" is meaningless there.
    const orphaned = table === "listings" ? 0 : await db.count(table, { userId: null });
    report[table] = { total, orphaned };
  }
  return report;
}

/**
 * Deletes ALL rows from the per-user tables. Destructive and irreversible.
 * `listings` is deliberately excluded: shared scraped data, expensive to
 * rebuild, and carries no ownership.
 */
export async function wipeTenantData(confirm: string) {
  if (confirm !== "DELETE") throw new Error('Refusing to run: pass confirm "DELETE"');
  const deleted: Record<string, number> = {};
  for (const table of TENANT_TABLES) deleted[table] = await db.deleteWhere(table, {});
  return { deleted, note: "listings left intact (shared scraped data)" };
}

/**
 * Deletes ONLY the pre-isolation rows (no `userId`), leaving everything created
 * since auth was added intact. Almost always the one you want: wipeTenantData
 * was written when 100% of rows were orphaned.
 */
export async function wipeOrphanedData(confirm: string) {
  if (confirm !== "DELETE") throw new Error('Refusing to run: pass confirm "DELETE"');
  const deleted: Record<string, number> = {};
  const kept: Record<string, number> = {};
  for (const table of TENANT_TABLES) {
    const total = await db.count(table);
    deleted[table] = await db.deleteWhere(table, { userId: null });
    kept[table] = total - deleted[table];
  }
  return { deleted, kept, note: "listings untouched (shared scraped data)" };
}

/**
 * Deletes scraped listings, and the matching rows that pointed at them so the
 * UI does not show matches resolving to nothing.
 *
 * No batching any more: the Convex version chunked because one mutation had
 * execution limits, but this is a single SQL statement.
 */
export async function wipeListings(confirm: string) {
  if (confirm !== "DELETE") throw new Error('Refusing to run: pass confirm "DELETE"');
  const { data, error } = await db.raw.from("listings").delete().neq("_id", "").select("_id");
  if (error) throw new Error(`wipeListings: ${error.message}`);
  const ids = (data ?? []).map((r: any) => r._id);
  // Every listing id in one `in` filter would be a megabyte-long URL; the
  // matches are found in batches instead, then deleted by their own ids.
  let matchingDeleted = 0;
  if (ids.length > 0) {
    const orphans = await db.selectIn("matching", "_id", "listingId", ids);
    matchingDeleted = await db.deleteMany("matching", orphans.map((r) => r._id));
  }
  return { listingsDeleted: ids.length, matchingDeleted };
}

/**
 * Alternative to wiping: assign every orphaned row to one Clerk user id. Kept
 * alongside the wipe so the decision stays reversible in spirit.
 */
export async function claimOrphanedData(userId: string) {
  const claimed: Record<string, number> = {};
  for (const table of TENANT_TABLES) {
    claimed[table] = await db.patchWhere(table, { userId: null }, { userId });
  }
  return claimed;
}
