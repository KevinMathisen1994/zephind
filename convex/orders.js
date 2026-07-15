import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
export const list = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("orders").collect();
    },
});
export const get = query({
    args: { id: v.id("orders") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.id);
    },
});
export const create = mutation({
    args: {
        name: v.optional(v.string()),
        ward: v.optional(v.string()),
        wards: v.optional(v.array(v.string())), // 複数区対応
        priceMin: v.optional(v.number()),
        priceMax: v.optional(v.number()),
        areaMin: v.optional(v.number()),
        areaMax: v.optional(v.number()),
        status: v.optional(v.string()),
        userId: v.optional(v.string()),
        criteria: v.optional(v.any()),
        walkMinutes: v.optional(v.number()),
        minBuildingCoverageRatio: v.optional(v.number()),
        minFloorAreaRatio: v.optional(v.number()),
        propertyTypes: v.optional(v.array(v.string())),
        landSizeMin: v.optional(v.number()),
        landSizeMax: v.optional(v.number()),
        buildingSizeMin: v.optional(v.number()),
        buildingSizeMax: v.optional(v.number()),
        // New filter options
        maxBuildAge: v.optional(v.number()),
        minBuildYear: v.optional(v.number()),
        minYield: v.optional(v.number()),
        maxYield: v.optional(v.number()),
        minRoadWidth: v.optional(v.number()),
        minTotalUnits: v.optional(v.number()),
        maxFloor: v.optional(v.number()),
        excludeFirstFloor: v.optional(v.boolean()),
        minElevators: v.optional(v.number()),
        structureTypes: v.optional(v.array(v.string())),
        layoutTypes: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("orders", {
            ...args,
            status: args.status || "pending",
        });
    },
});
export const remove = mutation({
    args: { id: v.id("orders") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});
