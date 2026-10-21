/**
 * Per-user email settings: the proposal-mail signature block.
 *
 * WHY THIS EXISTS
 * ---------------
 * It was previously read from localStorage, so it existed only in the one browser
 * where someone had typed it. Keeping it in Convex ties it to the signed-in
 * account instead of the browser profile.
 *
 * Sending itself is NOT configured here — the proposal modal opens the user's
 * own mail client (mailto:) with the subject/body prefilled; there is no
 * server-side send path.
 *
 * The signature is intentionally a single free-text block rather than a dozen
 * columns: the layout (宅建番号 left, 取引態様 right, rule, address, company,
 * name, tel, mail) is chosen by whoever signs the mail, and they can edit it in
 * the UI without a code change.
 */
import { query, mutation } from "./_generated/server.js";
import { v } from "convex/values";
import { requireUserId } from "./lib/authz.js";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("emailSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const save = mutation({
  args: {
    signature: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("emailSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const fields = { ...args, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    // userId comes from the verified JWT, never from an argument.
    return await ctx.db.insert("emailSettings", { ...fields, userId });
  },
});
