import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireUserId, requireOwned, listOwned } from "./lib/authz.js";
export const list = query({
    args: {},
    handler: async (ctx) => {
        // Was an unscoped .collect(), so every account saw every account's orders.
        return await listOwned(ctx, "orders");
    },
});
export const get = query({
    args: { id: v.id("orders") },
    handler: async (ctx, args) => {
        const { doc } = await requireOwned(ctx, "オーダー", args.id);
        return doc;
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
        customerId: v.optional(v.string()),
        isScraping: v.optional(v.boolean()),
        scrapingStatus: v.optional(v.string()),
        scrapeRunId: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        // userId is taken from the verified JWT and any client-supplied value is
        // discarded — otherwise a caller could create rows owned by someone else.
        const userId = await requireUserId(ctx);
        const { userId: _ignored, ...fields } = args;
        return await ctx.db.insert("orders", {
            ...fields,
            userId,
            status: args.status || "pending",
        });
    },
});
export const remove = mutation({
    args: { id: v.id("orders") },
    handler: async (ctx, args) => {
        await requireOwned(ctx, "オーダー", args.id);
        await ctx.db.delete(args.id);
    },
});

export const update = mutation({
    args: {
        id: v.id("orders"),
        name: v.optional(v.string()),
        ward: v.optional(v.string()),
        wards: v.optional(v.array(v.string())),
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
        customerId: v.optional(v.string()),
        isScraping: v.optional(v.boolean()),
        scrapingStatus: v.optional(v.string()),
        scrapeRunId: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        // Ownership check first: without it any signed-in user could patch any
        // order by guessing its id.
        await requireOwned(ctx, "オーダー", args.id);
        const { id, userId: _ignored, ...fields } = args;
        await ctx.db.patch(id, fields);
    },
});

