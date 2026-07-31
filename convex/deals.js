import { query, mutation } from "./_generated/server.js";
import { v } from "convex/values";
import { requireUserId, requireOwned } from "./lib/authz.js";

export const list = query({
  args: {},
  handler: async (ctx) => {
    // Was an unscoped .collect(), so every account saw every account's deals.
    // Not listOwned() because this list is newest-first and the by_user index
    // reads ascending by _creationTime, so .order("desc") is kept explicitly.
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("deals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { id: v.id("deals") },
  handler: async (ctx, args) => {
    // Was a bare ctx.db.get(), so any signed-in user could read any deal —
    // including the customer contact details embedded in it — by id.
    const { doc } = await requireOwned(ctx, "案件", args.id);
    return doc;
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
    // userId comes from the verified JWT; the validator deliberately has no
    // userId field so a caller cannot create a deal owned by someone else.
    const userId = await requireUserId(ctx);
    const now = Date.now();

    // Deduplication check: check for recent duplicate deal in proposed status.
    // This scanned the by_status index across the WHOLE table, so a matching
    // title from another account was treated as "our" duplicate and got patched
    // with this caller's data — a cross-account write, not just a read leak.
    // Scoped to the caller's own deals via by_user.
    if (args.orderId || args.customerId || args.title) {
      const recentDeals = await ctx.db
        .query("deals")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) => q.eq(q.field("status"), "proposed"))
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
      userId,
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
    // Ownership check first: without it any signed-in user could move any
    // account's deal through the pipeline by guessing its id.
    await requireOwned(ctx, "案件", args.id);
    await ctx.db.patch(args.id, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("deals") },
  handler: async (ctx, args) => {
    // Was an unguarded delete — any id from any account could be destroyed.
    await requireOwned(ctx, "案件", args.id);
    await ctx.db.delete(args.id);
  },
});
