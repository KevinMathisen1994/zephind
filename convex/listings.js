import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireUserId } from "./lib/authz.js";
export const list = query({
    args: {
        ward: v.optional(v.string()),
        priceMin: v.optional(v.number()),
        priceMax: v.optional(v.number()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        let q = ctx.db.query("listings").withIndex("by_ward");
        if (args.ward) {
            q = q.filter((q) => q.eq(q.field("ward"), args.ward));
        }
        const maxLimit = Math.min(args.limit || 1000, 8000);
        const results = await q.take(maxLimit);
        return results.filter((listing) => {
            if (args.priceMin && listing.price && listing.price < args.priceMin)
                return false;
            if (args.priceMax && listing.price && listing.price > args.priceMax)
                return false;
            return true;
        });
    },
});
export const getByIds = query({
    args: { ids: v.array(v.union(v.id("listings"), v.string())) },
    handler: async (ctx, args) => {
        if (!args.ids || args.ids.length === 0) return [];
        const results = [];
        for (const idStr of args.ids) {
            try {
                const normalized = ctx.db.normalizeId("listings", idStr);
                if (normalized) {
                    const doc = await ctx.db.get(normalized);
                    if (doc) results.push(doc);
                }
            } catch (e) {
                // Ignore invalid ID format if any
            }
        }
        return results;
    },
});
export const get = query({
    args: { id: v.id("listings") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.id);
    },
});
export const getByUrl = query({
    args: { url: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db.query("listings").filter((q) => q.eq(q.field("url"), args.url)).first();
    },
});
export const create = mutation({
    args: {
        address: v.optional(v.string()),
        ward: v.optional(v.string()),
        price: v.optional(v.number()),
        area: v.optional(v.number()),
        buildYear: v.optional(v.number()),
        source: v.optional(v.string()),
        status: v.optional(v.string()),
        url: v.optional(v.string()),
        description: v.optional(v.string()),
        title: v.optional(v.string()),
        rooms: v.optional(v.number()),
        layout: v.optional(v.string()),
        station: v.optional(v.string()),
        walkMinutes: v.optional(v.number()),
        buildingCoverageRatio: v.optional(v.number()),
        floorAreaRatio: v.optional(v.number()),
        propertyType: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // Reads stay shared by design (scraped portal data is common
        // infrastructure), but WRITES were fully open: anyone holding the
        // Convex URL from the frontend bundle could insert junk or delete
        // every listing. Shared != unauthenticated.
        await requireUserId(ctx);
        // Idempotent: skip if same address+price exists (area may vary between agents)
        if (args.address && args.price) {
            const existing = await ctx.db
                .query("listings")
                .filter((q) =>
                    q.and(
                        q.eq(q.field("address"), args.address),
                        q.eq(q.field("price"), args.price)
                    )
                )
                .first();
            if (existing) return existing._id;
        }
        return await ctx.db.insert("listings", {
            ...args,
            status: args.status || "new",
            source: args.source || "manual",
        });
    },
});
export const remove = mutation({
    args: { id: v.id("listings") },
    handler: async (ctx, args) => {
        await requireUserId(ctx);
        await ctx.db.delete(args.id);
    },
});

export const update = mutation({
    args: {
        id: v.id("listings"),
        address: v.optional(v.string()),
        ward: v.optional(v.string()),
        price: v.optional(v.number()),
        area: v.optional(v.number()),
        buildYear: v.optional(v.number()),
        source: v.optional(v.string()),
        status: v.optional(v.string()),
        url: v.optional(v.string()),
        description: v.optional(v.string()),
        title: v.optional(v.string()),
        rooms: v.optional(v.number()),
        layout: v.optional(v.string()),
        station: v.optional(v.string()),
        walkMinutes: v.optional(v.number()),
        buildingCoverageRatio: v.optional(v.number()),
        floorAreaRatio: v.optional(v.number()),
        propertyType: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await requireUserId(ctx);
        const { id, ...fields } = args;
        await ctx.db.patch(id, fields);
    },
});
