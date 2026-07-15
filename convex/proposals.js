import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
export const list = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("proposals").collect();
    },
});
export const get = query({
    args: { id: v.id("proposals") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.id);
    },
});
export const create = mutation({
    args: {
        propertyId: v.optional(v.string()),
        orderId: v.optional(v.string()),
        status: v.optional(v.string()),
        score: v.optional(v.number()),
        notes: v.optional(v.string()),
        userId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("proposals", {
            ...args,
            status: args.status || "draft",
        });
    },
});
export const remove = mutation({
    args: { id: v.id("proposals") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});
