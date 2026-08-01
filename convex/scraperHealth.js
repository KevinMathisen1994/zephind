import { query, mutation } from "./_generated/server.js";
import { v } from "convex/values";
import { requireUserId } from "./lib/authz.js";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("scraperHealth").collect();
  },
});

/**
 * Upsert by source — we want the CURRENT status of each scraper, not an
 * ever-growing audit log. One row per scraper keeps the admin board a simple
 * read and avoids unbounded table growth from repeated checks.
 */
export const record = mutation({
  args: {
    source: v.string(),
    label: v.optional(v.string()),
    status: v.string(),
    listingCount: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    areaCode: v.optional(v.string()),
    checkedAt: v.number(),
    issues: v.optional(v.array(v.string())),
    coverage: v.optional(v.any()),
    sample: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Status board is readable by all, but only a signed-in user may write to it.
    await requireUserId(ctx);
    const existing = await ctx.db
      .query("scraperHealth")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("scraperHealth", args);
  },
});
