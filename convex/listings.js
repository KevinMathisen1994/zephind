import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
export const list = query({
    args: {
        ward: v.optional(v.string()),
        priceMin: v.optional(v.number()),
        priceMax: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        let q = ctx.db.query("listings").withIndex("by_ward");
        if (args.ward) {
            q = q.filter((q) => q.eq(q.field("ward"), args.ward));
        }
        const results = await q.collect();
        return results.filter((listing) => {
            if (args.priceMin && listing.price && listing.price < args.priceMin)
                return false;
            if (args.priceMax && listing.price && listing.price > args.priceMax)
                return false;
            return true;
        });
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
        const { id, ...fields } = args;
        await ctx.db.patch(id, fields);
    },
});
