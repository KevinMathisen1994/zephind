import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireUserId, requireOwned, listOwned } from "./lib/authz.js";
export const list = query({
    args: {},
    handler: async (ctx) => {
        // Unused/legacy table, but list/get were unscoped reads and create/remove
        // were unauthenticated WRITES reachable by anyone holding the Convex URL
        // (which ships in the frontend bundle). Scoped for parity so it is safe
        // if this table is ever revived.
        return await listOwned(ctx, "properties");
    },
});
export const get = query({
    args: { id: v.id("properties") },
    handler: async (ctx, args) => {
        const { doc } = await requireOwned(ctx, "物件", args.id);
        return doc;
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
        const userId = await requireUserId(ctx);
        return await ctx.db.insert("properties", {
            ...args,
            userId,
            status: args.status || "pending",
            enrichedAt: args.enrichedAt || Date.now(),
        });
    },
});
export const remove = mutation({
    args: { id: v.id("properties") },
    handler: async (ctx, args) => {
        await requireOwned(ctx, "物件", args.id);
        await ctx.db.delete(args.id);
    },
});
