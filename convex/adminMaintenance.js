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
