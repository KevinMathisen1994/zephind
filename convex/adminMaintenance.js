import { internalQuery, internalMutation } from "./_generated/server.js";
import { v } from "convex/values";

/**
 * One-off maintenance helpers, run from the CLI (`npx convex run`), never from
 * the browser. They are `internal*` precisely so no client can invoke them.
 *
 * Context: per-user isolation was added after this data already existed, so
 * every pre-existing row has no `userId` and is therefore invisible and
 * un-mutatable through the normal (now access-controlled) API.
 */

const TENANT_TABLES = ["orders", "customers", "deals", "matching", "proposals"];

/** Counts rows and how many are orphaned (no owner). Read-only. */
export const dataOwnershipReport = internalQuery({
  args: {},
  handler: async (ctx) => {
    const report = {};
    for (const table of [...TENANT_TABLES, "listings"]) {
      const rows = await ctx.db.query(table).collect();
      report[table] = {
        total: rows.length,
        orphaned: rows.filter((r) => !r.userId).length,
      };
    }
    return report;
  },
});

/**
 * Deletes ALL rows from the per-user tables. Destructive and irreversible.
 *
 * `listings` is deliberately excluded: it is shared scraped data (public
 * portal listings), expensive to rebuild, and carries no ownership.
 *
 * Requires confirm: "DELETE" so an accidental invocation is a no-op.
 */
export const wipeTenantData = internalMutation({
  args: { confirm: v.string() },
  handler: async (ctx, args) => {
    if (args.confirm !== "DELETE") {
      throw new Error('Refusing to run: pass { confirm: "DELETE" }');
    }
    const deleted = {};
    for (const table of TENANT_TABLES) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) await ctx.db.delete(row._id);
      deleted[table] = rows.length;
    }
    return { deleted, note: "listings left intact (shared scraped data)" };
  },
});

/**
 * Deletes ONLY the pre-isolation rows (those with no `userId`), leaving
 * everything created since auth was added intact.
 *
 * This is almost always the one you want. `wipeTenantData` above empties the
 * tables wholesale — it was written when 100% of rows were orphaned. Once real
 * per-user data exists (orders you created after signing in, matches from a
 * scheduled scrape) a full wipe destroys that too.
 */
export const wipeOrphanedData = internalMutation({
  args: { confirm: v.string() },
  handler: async (ctx, args) => {
    if (args.confirm !== "DELETE") {
      throw new Error('Refusing to run: pass { confirm: "DELETE" }');
    }
    const deleted = {};
    const kept = {};
    for (const table of TENANT_TABLES) {
      const rows = await ctx.db.query(table).collect();
      let d = 0;
      for (const row of rows) {
        if (!row.userId) {
          await ctx.db.delete(row._id);
          d++;
        }
      }
      deleted[table] = d;
      kept[table] = rows.length - d;
    }
    return { deleted, kept, note: "listings untouched (shared scraped data)" };
  },
});

/**
 * Deletes scraped listings. Safe-ish: listings are shared, contain no user data,
 * and a scrape rebuilds them — but any `matching` row pointing at a deleted
 * listing becomes a dangling reference, so this also drops those.
 *
 * Batched via `limit` because a single Convex mutation has execution limits and
 * there are >1,200 rows. Call repeatedly until `remaining` is 0.
 */
export const wipeListings = internalMutation({
  args: { confirm: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (args.confirm !== "DELETE") {
      throw new Error('Refusing to run: pass { confirm: "DELETE" }');
    }
    const batch = args.limit ?? 500;
    const rows = await ctx.db.query("listings").take(batch);
    const ids = new Set(rows.map((r) => r._id));
    for (const row of rows) await ctx.db.delete(row._id);

    // Drop matching rows whose listing just went away, so the UI doesn't show
    // matches that resolve to nothing.
    let orphanedMatches = 0;
    for (const m of await ctx.db.query("matching").collect()) {
      if (m.listingId && ids.has(m.listingId)) {
        await ctx.db.delete(m._id);
        orphanedMatches++;
      }
    }

    const remaining = (await ctx.db.query("listings").take(1)).length;
    return {
      listingsDeleted: rows.length,
      matchingDeleted: orphanedMatches,
      remaining: remaining > 0 ? "more — run again" : 0,
    };
  },
});

/**
 * Alternative to wiping: assign every orphaned row to one Clerk user id.
 * Kept alongside the wipe so the decision stays reversible in spirit — if you
 * change your mind before running the wipe, this recovers the same data.
 */
export const claimOrphanedData = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const claimed = {};
    for (const table of TENANT_TABLES) {
      const rows = await ctx.db.query(table).collect();
      let n = 0;
      for (const row of rows) {
        if (!row.userId) {
          await ctx.db.patch(row._id, { userId: args.userId });
          n++;
        }
      }
      claimed[table] = n;
    }
    return claimed;
  },
});
