import { mutation, query, internalMutation } from "./_generated/server.js";
import { v } from "convex/values";
import { requireUserId, requireOwned, listOwned } from "./lib/authz.js";

export const create = mutation({
  args: {
    orderId: v.optional(v.string()),
    listingId: v.optional(v.string()),
    score: v.optional(v.number()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Matches were inserted with no owner, which is why list() below served
    // every account's matches. userId comes from the verified JWT; the validator
    // deliberately has no userId field so ownership cannot be forged.
    const userId = await requireUserId(ctx);
    const { orderId, listingId } = args;
    // Idempotent: skip if match already exists for this order+listing.
    // The lookup is scoped to the caller as well — unscoped, it could return
    // (and thereby hand out) another account's match id.
    if (orderId && listingId) {
      const existing = await ctx.db
        .query("matching")
        .withIndex("by_order", (q) => q.eq("orderId", orderId))
        .filter((q) => q.eq(q.field("listingId"), listingId))
        .filter((q) => q.eq(q.field("userId"), userId))
        .first();
      if (existing) return existing._id;
    }
    return await ctx.db.insert("matching", {
      ...args,
      userId,
      status: args.status || "pending",
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    // Was an unscoped .collect(). The Orders page filters this client-side by
    // orderId, so every account's matches (and their AI evaluations) were
    // shipped to every browser.
    return await listOwned(ctx, "matching");
  },
});

export const getByOrder = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    // The caller must own the parent ORDER. The arg is a real v.id("orders"),
    // so requireOwned resolves it against the orders table directly.
    const { userId } = await requireOwned(ctx, "オーダー", args.orderId);
    // Second filter on the match's own userId: matching.orderId is a plain
    // string column, so owning the order alone would not stop a legacy or
    // mis-owned row from leaking through.
    return await ctx.db
      .query("matching")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();
  },
});

export const saveEvaluation = mutation({
  args: {
    matchId: v.id("matching"),
    evaluation: v.string(),
  },
  handler: async (ctx, args) => {
    // Was an unguarded patch: any signed-in user could overwrite any account's
    // evaluation text. Reached from the evaluate action via ctx.runMutation,
    // which forwards the caller's identity, so the check holds there too.
    await requireOwned(ctx, "マッチング", args.matchId);
    await ctx.db.patch(args.matchId, { evaluation: args.evaluation });
  },
});

export const saveScore = mutation({
  args: {
    matchId: v.id("matching"),
    score: v.number(),
  },
  handler: async (ctx, args) => {
    // Same as saveEvaluation — an unguarded patch reachable with any id.
    await requireOwned(ctx, "マッチング", args.matchId);
    await ctx.db.patch(args.matchId, { score: args.score });
  },
});

export const saveScoreDetail = mutation({
  args: {
    matchId: v.id("matching"),
    scoreDetail: v.any(),
  },
  handler: async (ctx, args) => {
    // Same as saveEvaluation — an unguarded patch reachable with any id.
    await requireOwned(ctx, "マッチング", args.matchId);
    await ctx.db.patch(args.matchId, { scoreDetail: args.scoreDetail });
  },
});

export const remove = mutation({
  args: { id: v.id("matching") },
  handler: async (ctx, args) => {
    // Was an unguarded delete — any id from any account could be destroyed.
    await requireOwned(ctx, "マッチング", args.id);
    await ctx.db.delete(args.id);
  },
});
