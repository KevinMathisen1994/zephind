/**
 * 保存物件 — a per-user shortlist of starred properties.
 *
 * WHY IT SNAPSHOTS THE LISTING
 * ----------------------------
 * `listings` is shared, disposable inventory: orders.remove deletes a listing
 * once no order matches it any more, and the scraper only ever inserts fresh
 * rows. A shortlist that stored nothing but a listingId would therefore rot into
 * blank rows precisely for the properties someone cared enough to save. Each save
 * copies the fields the UI shows; `listingId` is kept as well so a still-live
 * listing can be linked back to its order and evaluation.
 *
 * Everything here is scoped to the caller: userId comes from the verified JWT and
 * is never accepted as an argument.
 */
import { query, mutation } from "./_generated/server.js";
import { v } from "convex/values";
import { requireUserId, requireOwned, listOwned } from "./lib/authz.js";

/** The caller's shortlist, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await listOwned(ctx, "savedListings");
    return rows.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  },
});

/**
 * Just the saved listingIds, for rendering the star state in a long results list.
 * Separate from list() so the Orders page does not ship every snapshot field it
 * has no use for.
 */
export const savedListingIds = query({
  args: {},
  handler: async (ctx) => {
    const rows = await listOwned(ctx, "savedListings");
    return rows.map((row) => row.listingId).filter(Boolean);
  },
});

const snapshotFields = {
  listingId: v.optional(v.string()),
  orderId: v.optional(v.string()),
  orderName: v.optional(v.string()),
  address: v.optional(v.string()),
  ward: v.optional(v.string()),
  price: v.optional(v.number()),
  area: v.optional(v.number()),
  landSize: v.optional(v.number()),
  source: v.optional(v.string()),
  url: v.optional(v.string()),
  propertyType: v.optional(v.string()),
  station: v.optional(v.string()),
  walkMinutes: v.optional(v.number()),
  score: v.optional(v.number()),
  postedAt: v.optional(v.number()),
  postedDateKind: v.optional(v.string()),
};

/**
 * Star / unstar, in one call.
 *
 * Idempotent per (user, listing): the by_user_and_listing index makes the "is it
 * already saved" check a single indexed read rather than a scan of the shortlist,
 * and stops a double-click from creating two rows.
 */
export const toggle = mutation({
  args: snapshotFields,
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    if (!args.listingId) throw new Error("listingId が必要です");

    const existing = await ctx.db
      .query("savedListings")
      .withIndex("by_user_and_listing", (q) =>
        q.eq("userId", userId).eq("listingId", args.listingId),
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { saved: false };
    }

    await ctx.db.insert("savedListings", {
      ...args,
      userId,
      savedAt: Date.now(),
    });
    return { saved: true };
  },
});

/** Free-text note on a saved property (why it was kept, what to ask the seller). */
export const setNote = mutation({
  args: { id: v.id("savedListings"), note: v.string() },
  handler: async (ctx, args) => {
    await requireOwned(ctx, "保存物件", args.id);
    await ctx.db.patch(args.id, { note: args.note });
  },
});

export const remove = mutation({
  args: { id: v.id("savedListings") },
  handler: async (ctx, args) => {
    await requireOwned(ctx, "保存物件", args.id);
    await ctx.db.delete(args.id);
  },
});
