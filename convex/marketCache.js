import { internalQuery, internalMutation } from "./_generated/server.js";
import { v } from "convex/values";

// MLIT publishes transaction data quarterly, and Places results for a fixed
// address rarely move week to week, so a month-long cache trades a small
// amount of staleness for far fewer external calls on every "再評価" click.
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const getMlitCache = internalQuery({
  args: { ward: v.string(), year: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("historicalData")
      .withIndex("by_ward_year", (q) =>
        q.eq("ward", args.ward).eq("year", args.year),
      )
      .unique();
  },
});

export const saveMlitCache = internalMutation({
  args: {
    ward: v.string(),
    year: v.number(),
    avgPrice: v.optional(v.number()),
    avgArea: v.optional(v.number()),
    transactionCount: v.optional(v.number()),
    comparables: v.optional(v.array(v.any())),
    fetchedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("historicalData")
      .withIndex("by_ward_year", (q) =>
        q.eq("ward", args.ward).eq("year", args.year),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("historicalData", args);
    }
  },
});

export const getPlacesCache = internalQuery({
  args: { address: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("placesCache")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .unique();
  },
});

export const savePlacesCache = internalMutation({
  args: {
    address: v.string(),
    nearbyTotalCount: v.optional(v.number()),
    nearbyInfo: v.optional(v.string()),
    fetchedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("placesCache")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("placesCache", args);
    }
  },
});
