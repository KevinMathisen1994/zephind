import { query, mutation } from "./_generated/server.js";
import { v } from "convex/values";
import { requireUserId, requireOwned, listOwned } from "./lib/authz.js";

export const list = query({
  args: {},
  handler: async (ctx) => {
    // Was an unscoped .collect(), so every account saw every account's
    // customers — names, emails and phone numbers included.
    return await listOwned(ctx, "customers");
  },
});

export const get = query({
  args: { id: v.id("customers") },
  handler: async (ctx, args) => {
    // Was a bare ctx.db.get(), so any signed-in user could read any customer
    // record by guessing an id.
    const { doc } = await requireOwned(ctx, "顧客", args.id);
    return doc;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    company: v.optional(v.string()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Rows used to be inserted with no owner at all, which is why list() had
    // nothing to filter on. userId comes from the verified JWT; the validator
    // deliberately has no userId field so a caller cannot supply one.
    const userId = await requireUserId(ctx);
    return await ctx.db.insert("customers", {
      ...args,
      userId,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("customers"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    company: v.optional(v.string()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Ownership check first: without it any signed-in user could overwrite any
    // customer by guessing its id.
    await requireOwned(ctx, "顧客", args.id);
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("customers") },
  handler: async (ctx, args) => {
    // Was an unguarded delete — any id from any account could be destroyed.
    await requireOwned(ctx, "顧客", args.id);
    await ctx.db.delete(args.id);
  },
});
