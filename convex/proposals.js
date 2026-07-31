import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireUserId, requireOwned, listOwned } from "./lib/authz.js";
export const list = query({
    args: {},
    handler: async (ctx) => {
        // Was an unscoped .collect(), so every account saw every account's
        // proposals. The userId column and by_user index already existed —
        // nothing was ever reading them.
        return await listOwned(ctx, "proposals");
    },
});
export const get = query({
    args: { id: v.id("proposals") },
    handler: async (ctx, args) => {
        // Was a bare ctx.db.get(), so any signed-in user could read any
        // proposal by guessing an id.
        const { doc } = await requireOwned(ctx, "提案", args.id);
        return doc;
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
        // userId is taken from the verified JWT and any client-supplied value is
        // discarded — the validator accepts a userId field, so without this a
        // caller could create proposals owned by another account.
        const userId = await requireUserId(ctx);
        const { userId: _ignored, ...fields } = args;
        return await ctx.db.insert("proposals", {
            ...fields,
            userId,
            status: args.status || "draft",
        });
    },
});
export const remove = mutation({
    args: { id: v.id("proposals") },
    handler: async (ctx, args) => {
        // Was an unguarded delete — any id from any account could be destroyed.
        await requireOwned(ctx, "提案", args.id);
        await ctx.db.delete(args.id);
    },
});
