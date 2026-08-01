import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
    listings: defineTable({
        address: v.optional(v.string()),
        ward: v.optional(v.string()),
        price: v.optional(v.number()),
        area: v.optional(v.number()),
        landSize: v.optional(v.number()),
        buildYear: v.optional(v.number()),
        source: v.optional(v.string()),
        status: v.optional(v.string()),
        url: v.optional(v.string()),
        description: v.optional(v.string()),
        rooms: v.optional(v.number()),
        layout: v.optional(v.string()),
        station: v.optional(v.string()),
        stationName: v.optional(v.string()),
        walkMinutes: v.optional(v.number()),
        walkingMinutes: v.optional(v.number()),
        mlitBenchmark: v.optional(v.number()),
        score: v.optional(v.number()),
        latitude: v.optional(v.number()),
        longitude: v.optional(v.number()),
        title: v.optional(v.string()),
        images: v.optional(v.array(v.string())),
        buildingCoverageRatio: v.optional(v.number()),
        floorAreaRatio: v.optional(v.number()),
        propertyType: v.optional(v.string()),
        roadWidth: v.optional(v.number()),
        frontage: v.optional(v.number()),
        zoning: v.optional(v.string()),
        pdfUrl: v.optional(v.string()),
    })
        .index("by_ward", ["ward"])
        .index("by_price", ["price"])
        .index("by_source", ["source"])
        // The scheduled scraper dedupes every scraped listing by url on each run.
        // Without this index that is a full table scan per listing, which blows
        // the read limit as soon as the table grows.
        .index("by_url", ["url"]),
    orders: defineTable({
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
    })
        .index("by_status", ["status"])
        .index("by_user", ["userId"]),
    properties: defineTable({
        address: v.optional(v.string()),
        ward: v.optional(v.string()),
        price: v.optional(v.number()),
        area: v.optional(v.number()),
        landSize: v.optional(v.number()),
        buildYear: v.optional(v.number()),
        mlitBenchmark: v.optional(v.number()),
        score: v.optional(v.number()),
        listingId: v.optional(v.string()),
        source: v.optional(v.string()),
        status: v.optional(v.string()),
        enrichedAt: v.optional(v.number()),
        title: v.optional(v.string()),
        description: v.optional(v.string()),
        sourceUrl: v.optional(v.string()),
        images: v.optional(v.array(v.string())),
        latitude: v.optional(v.number()),
        longitude: v.optional(v.number()),
        stationName: v.optional(v.string()),
        walkingMinutes: v.optional(v.number()),
        buildingCoverageRatio: v.optional(v.number()),
        floorAreaRatio: v.optional(v.number()),
        roadWidth: v.optional(v.number()),
        frontage: v.optional(v.number()),
        hotelsCount: v.optional(v.number()),
        attractionsCount: v.optional(v.number()),
        restaurantsCount: v.optional(v.number()),
        inboundScore: v.optional(v.number()),
        inboundStars: v.optional(v.number()),
        hardFiltersPassed: v.optional(v.boolean()),
        isMatch: v.optional(v.boolean()),
        createdAt: v.optional(v.number()),
        updatedAt: v.optional(v.number()),
        aiRecommendation: v.optional(v.string()),
        aiSummary: v.optional(v.string()),
        aiStrengths: v.optional(v.array(v.string())),
        aiWeaknesses: v.optional(v.array(v.string())),
        discountPercent: v.optional(v.number()),
        expectedMarketValue: v.optional(v.number()),
    })
        .index("by_ward", ["ward"])
        .index("by_score", ["score"]),
    proposals: defineTable({
        propertyId: v.optional(v.string()),
        orderId: v.optional(v.string()),
        status: v.optional(v.string()),
        score: v.optional(v.number()),
        notes: v.optional(v.string()),
        userId: v.optional(v.string()),
    })
        .index("by_status", ["status"])
        .index("by_user", ["userId"]),
    users: defineTable({
        clerkId: v.optional(v.string()),
        email: v.optional(v.string()),
        name: v.optional(v.string()),
        role: v.optional(v.string()),
    })
        .index("by_clerkId", ["clerkId"]),
    savedSearches: defineTable({
        userId: v.optional(v.string()),
        name: v.optional(v.string()),
        criteria: v.optional(v.any()),
        createdAt: v.optional(v.number()),
        maxLandSize: v.optional(v.number()),
        maxPrice: v.optional(v.number()),
        maxWalkingMinutes: v.optional(v.number()),
        minFrontage: v.optional(v.number()),
        minInboundStars: v.optional(v.number()),
        minLandSize: v.optional(v.number()),
        minPrice: v.optional(v.number()),
        minRoadWidth: v.optional(v.number()),
        wards: v.optional(v.array(v.string())),
    })
        .index("by_user", ["userId"]),
    historicalData: defineTable({
        ward: v.optional(v.string()),
        year: v.optional(v.number()),
        quarter: v.optional(v.number()),
        avgPrice: v.optional(v.number()),
        avgArea: v.optional(v.number()),
        transactionCount: v.optional(v.number()),
    })
        .index("by_ward_year", ["ward", "year"]),
    criteria: defineTable({
        orderId: v.optional(v.string()),
        userId: v.optional(v.string()),
        criteria: v.optional(v.any()),
    })
        .index("by_order", ["orderId"])
        .index("by_user", ["userId"]),
    evaluations: defineTable({
        propertyId: v.optional(v.string()),
        orderId: v.optional(v.string()),
        score: v.optional(v.number()),
        breakdown: v.optional(v.any()),
        userId: v.optional(v.string()),
        createdAt: v.optional(v.number()),
        recommendation: v.optional(v.string()),
        strengths: v.optional(v.array(v.string())),
        summary: v.optional(v.string()),
        weaknesses: v.optional(v.array(v.string())),
    })
        .index("by_property", ["propertyId"]),
    enrichment: defineTable({
        propertyId: v.optional(v.string()),
        data: v.optional(v.any()),
        source: v.optional(v.string()),
        enrichedAt: v.optional(v.number()),
    })
        .index("by_property", ["propertyId"]),
    market: defineTable({
        ward: v.optional(v.string()),
        data: v.optional(v.any()),
        period: v.optional(v.string()),
    })
        .index("by_ward", ["ward"]),
    matching: defineTable({
        // Owner (Clerk JWT subject). Required for per-user data isolation;
        // optional in the validator only so pre-existing rows still parse.
        userId: v.optional(v.string()),
        orderId: v.optional(v.string()),
        listingId: v.optional(v.string()),
        score: v.optional(v.number()),
        status: v.optional(v.string()),
        evaluation: v.optional(v.string()),
    })
        .index("by_order", ["orderId"])
        .index("by_user", ["userId"]),
    propertySources: defineTable({
        name: v.optional(v.string()),
        url: v.optional(v.string()),
        type: v.optional(v.string()),
        lastScraped: v.optional(v.number()),
        lastScrapeTime: v.optional(v.number()),
        failures: v.optional(v.number()),
        newListingsFound: v.optional(v.number()),
        status: v.optional(v.string()),
    }),
    tourism: defineTable({
        ward: v.optional(v.string()),
        data: v.optional(v.any()),
    }),
    mlitEnrichment: defineTable({
        propertyId: v.optional(v.string()),
        data: v.optional(v.any()),
        source: v.optional(v.string()),
    }),
    ingestEvents: defineTable({
        type: v.optional(v.string()),
        data: v.optional(v.any()),
        processedAt: v.optional(v.number()),
    }),
    customers: defineTable({
        // Owner (Clerk JWT subject). Required for per-user data isolation;
        // optional in the validator only so pre-existing rows still parse.
        userId: v.optional(v.string()),
        name: v.string(),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        company: v.optional(v.string()),
        address: v.optional(v.string()),
        notes: v.optional(v.string()),
        createdAt: v.optional(v.number()),
    })
        .index("by_name", ["name"])
        .index("by_user", ["userId"]),
    deals: defineTable({
        // Owner (Clerk JWT subject). Required for per-user data isolation;
        // optional in the validator only so pre-existing rows still parse.
        userId: v.optional(v.string()),
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
        createdAt: v.optional(v.number()),
        updatedAt: v.optional(v.number()),
    })
        .index("by_status", ["status"])
        .index("by_customer", ["customerId"])
        .index("by_user", ["userId"]),
    // One row per scraper, upserted on each health check, so the admin board
    // shows last-known status immediately on page load instead of needing a
    // multi-minute re-run of all 19 scrapers.
    scraperHealth: defineTable({
        source: v.string(),
        label: v.optional(v.string()),
        status: v.string(), // "ok" | "degraded" | "broken"
        listingCount: v.optional(v.number()),
        durationMs: v.optional(v.number()),
        areaCode: v.optional(v.string()),
        checkedAt: v.number(),
        issues: v.optional(v.array(v.string())),
        coverage: v.optional(v.any()),
        sample: v.optional(v.any()),
        error: v.optional(v.string()),
    }).index("by_source", ["source"]),
});
