import { query, mutation } from "./_generated/server.js";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("deals").order("desc").collect();
  },
});

export const get = query({
  args: { id: v.id("deals") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    customerId: v.optional(v.string()),
    customerName: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
    customerPhone: v.optional(v.string()),
    orderId: v.optional(v.string()),
    orderName: v.optional(v.string()),
    listings: v.optional(v.any()),
    customMessage: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Deduplication check: check for recent duplicate deal in proposed status
    if (args.orderId || args.customerId || args.title) {
      const recentDeals = await ctx.db
        .query("deals")
        .withIndex("by_status", (q) => q.eq("status", "proposed"))
        .collect();

      const existingDuplicate = recentDeals.find((d) => {
        const isSameOrderCust =
          args.orderId &&
          args.customerId &&
          d.orderId === args.orderId &&
          d.customerId === args.customerId;
        const isSameTitle = d.title === args.title;
        const isRecent = now - (d.createdAt || 0) < 10 * 60 * 1000;
        return (isSameOrderCust || isSameTitle) && isRecent;
      });

      if (existingDuplicate) {
        await ctx.db.patch(existingDuplicate._id, {
          ...args,
          updatedAt: now,
        });
        return existingDuplicate._id;
      }
    }

    return await ctx.db.insert("deals", {
      ...args,
      status: args.status || "proposed",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("deals"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("deals") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
