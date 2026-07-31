import { mutation, query, internalMutation } from "./_generated/server.js";
import { v } from "convex/values";

export const create = mutation({
  args: {
    orderId: v.optional(v.string()),
    listingId: v.optional(v.string()),
    score: v.optional(v.number()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Idempotent: skip if match already exists for this order+listing
    const { orderId, listingId } = args;
    if (orderId && listingId) {
      const existing = await ctx.db
        .query("matching")
        .withIndex("by_order", (q) => q.eq("orderId", orderId))
        .filter((q) => q.eq(q.field("listingId"), listingId))
        .first();
      if (existing) return existing._id;
    }
    return await ctx.db.insert("matching", {
      ...args,
      status: args.status || "pending",
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("matching").collect();
  },
});

export const getByOrder = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("matching")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .collect();
  },
});

export const saveEvaluation = mutation({
  args: {
    matchId: v.id("matching"),
    evaluation: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.matchId, { evaluation: args.evaluation });
  },
});

export const saveScore = mutation({
  args: {
    matchId: v.id("matching"),
    score: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.matchId, { score: args.score });
  },
});

export const remove = mutation({
  args: { id: v.id("matching") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
