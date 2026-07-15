import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
export const list = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("properties").collect();
    },
});
export const get = query({
    args: { id: v.id("properties") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.id);
    },
});
export const create = mutation({
    args: {
        address: v.optional(v.string()),
        ward: v.optional(v.string()),
        price: v.optional(v.number()),
        area: v.optional(v.number()),
        buildYear: v.optional(v.number()),
        mlitBenchmark: v.optional(v.number()),
        score: v.optional(v.number()),
        listingId: v.optional(v.string()),
        source: v.optional(v.string()),
        status: v.optional(v.string()),
        enrichedAt: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("properties", {
            ...args,
            status: args.status || "pending",
            enrichedAt: args.enrichedAt || Date.now(),
        });
    },
});
export const remove = mutation({
    args: { id: v.id("properties") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});
