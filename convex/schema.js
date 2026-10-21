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
        // Read by convex/evaluate.js / convex/lib/scoring.js for years, but
        // never actually declared here — no scraper (or, until now, email
        // extraction) could ever have written these without hitting the exact
        // "extra field not in the validator" error a stray dealType write hit
        // this morning. Real listings to date simply have none of this data.
        yield: v.optional(v.number()), // 利回り (%)
        structure: v.optional(v.string()), // free text, e.g. "鉄筋コンクリート造"
        // Short code (RC/SRC/S/木造) for matching against an order's
        // structureTypes — propertyMatcher.ts's hardFilter (and its
        // convex/lib/hardFilter.js port, for email listings) key off THIS
        // field, not the free-text `structure` above.
        structureType: v.optional(v.string()),
        totalUnits: v.optional(v.number()), // 総戸数
        // 掲載日 (epoch ms) as published by the portal, and which label it came
        // from: "posted" = 情報公開日/掲載日 (first published), "updated" = 更新日
        // (a re-post). Absent when the portal publishes no date — the UI then
        // falls back to _creationTime (when WE found it) and says so.
        postedAt: v.optional(v.number()),
        postedDateKind: v.optional(v.string()),
        // The portal's own NEW/新着 badge, for the sites that show a badge but
        // never a date (東急リバブル, みずほ, 東京建物).
        isNew: v.optional(v.boolean()),
        // "rent" for a 賃貸 (rental) listing scraped from a site's rental
        // vertical, "buy" (or absent, for every pre-existing row) for a
        // for-sale listing. Stamped by the scraper itself — the ONLY place
        // that knows which vertical a card came from — so matching can gate
        // on it without re-deriving it from price/rent field presence, which
        // would misclassify a for-sale listing that happens to omit price.
        dealType: v.optional(v.string()),
        // Rental-only economics. `price` stays the field that free-text
        // display code already reads everywhere; these are additive, not a
        // rename, so no existing buy-side code needs to change.
        rent: v.optional(v.number()), // 賃料 (万円/月)
        managementFee: v.optional(v.number()), // 管理費・共益費 (万円/月)
        deposit: v.optional(v.number()), // 敷金 (万円 — absolute amount, not a month-multiple)
        keyMoney: v.optional(v.number()), // 礼金 (万円 — absolute amount, not a month-multiple)
        petsAllowed: v.optional(v.boolean()),
        // "email" listings (source: "email") — a broker sent this directly
        // rather than it being scraped off a public portal. `url` is a
        // synthesized `email:{provider}:{messageId}` (not a real link), which
        // reuses the by_url dedup index for free instead of needing a second
        // unique-key mechanism just for this source.
        emailFrom: v.optional(v.string()), // "氏名 <address>" as the message gave it
        emailReceivedAt: v.optional(v.number()), // epoch ms
        emailSubject: v.optional(v.string()),
        emailBody: v.optional(v.string()),
        emailAttachments: v.optional(
            v.array(
                v.object({
                    id: v.optional(v.string()),
                    filename: v.string(),
                    mimeType: v.string(),
                    size: v.number(),
                }),
            ),
        ),
    })
        .index("by_ward", ["ward"])
        .index("by_price", ["price"])
        .index("by_source", ["source"])
        // The scheduled scraper dedupes every scraped listing by url on each run.
        // Without this index that is a full table scan per listing, which blows
        // the read limit as soon as the table grows.
        .index("by_url", ["url"])
        // Finds the listings still missing a 掲載日 so a run can backfill them.
        // Without this, locating them means scanning the whole table — and it gets
        // worse precisely as the backfill succeeds and matches thin out.
        .index("by_postedAt", ["postedAt"]),
    orders: defineTable({
        name: v.optional(v.string()),
        ward: v.optional(v.string()),
        wards: v.optional(v.array(v.string())), // 複数区対応
        // "buy" (default when absent, for every order created before this field
        // existed) or "rent". An order is ONE or the other, never both — the
        // form only ever shows one field set, matching only ever gates a
        // listing's own dealType against this, and a scraper asked for "rent"
        // fetches ONLY that site's 賃貸 vertical, never its for-sale one.
        dealType: v.optional(v.string()),
        priceMin: v.optional(v.number()),
        priceMax: v.optional(v.number()),
        // Rental budget (万円/月). Kept separate from priceMin/priceMax rather
        // than reusing them: a 買う order's price and a 借りる order's rent are
        // different units on a different scale, and reusing the same column
        // would make a stale buy-order's priceMax silently apply as a rent
        // ceiling (or vice versa) the moment dealType flips.
        rentMin: v.optional(v.number()),
        rentMax: v.optional(v.number()),
        maxDeposit: v.optional(v.number()), // 敷金上限 (万円)
        maxKeyMoney: v.optional(v.number()), // 礼金上限 (万円)
        petsRequired: v.optional(v.boolean()), // ペット可のみ
        areaMin: v.optional(v.number()),
        areaMax: v.optional(v.number()),
        status: v.optional(v.string()),
        userId: v.optional(v.string()),
        criteria: v.optional(v.any()),
        walkMinutes: v.optional(v.number()),
        minBuildingCoverageRatio: v.optional(v.number()),
        minFloorAreaRatio: v.optional(v.number()),
        propertyTypes: v.optional(v.array(v.string())),
        // オーナーチェンジ: the buyer wants tenanted units sold as-is (賃貸中の
        // まま売却). Not a building shape, so it is a flag alongside
        // propertyTypes rather than another entry in it.
        ownerChange: v.optional(v.boolean()),
        landSizeMin: v.optional(v.number()),
        landSizeMax: v.optional(v.number()),
        // 専有面積 (マンション) / 建物面積. Matched against listing.area.
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
        activeSource: v.optional(v.string()),
        scrapeRunId: v.optional(v.number()),
        // Who last asked for a search, and when. Stamped server-side from the
        // verified JWT in convex/scrapeTrigger.js so the card can say "取得:
        // 8/17 14:03 / 柴田" instead of leaving the user to guess whether the
        // listings in front of them are from today or from last month.
        lastScrapeAt: v.optional(v.number()),
        lastScrapeBy: v.optional(v.string()),
    })
        .index("by_status", ["status"])
        .index("by_user", ["userId"]),
    properties: defineTable({
        // Owner (Clerk JWT subject). Added for parity with the other
        // per-user tables; optional so any legacy row still parses.
        userId: v.optional(v.string()),
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
        .index("by_score", ["score"])
        .index("by_user", ["userId"]),
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
        // Cache of the MLIT reinfolib response for this ward+year, so repeat
        // evaluations don't re-hit the external API. `comparables` is capped
        // to a bounded snapshot per (ward, year), not an append-only list.
        comparables: v.optional(v.array(v.any())),
        fetchedAt: v.optional(v.number()),
    })
        .index("by_ward_year", ["ward", "year"]),
    // Cache of Google Places lookups, keyed by the listing address queried.
    placesCache: defineTable({
        address: v.string(),
        nearbyTotalCount: v.optional(v.number()),
        nearbyInfo: v.optional(v.string()),
        fetchedAt: v.number(),
    })
        .index("by_address", ["address"]),
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
        // Market comps + score breakdown behind the evaluation narrative
        // (comparables, marketAvgPrice, dataWarnings, etc.) — kept alongside
        // so the report UI can render them without re-running the model.
        scoreDetail: v.optional(v.any()),
    })
        .index("by_order", ["orderId"])
        .index("by_user", ["userId"])
        // Lets order deletion check "does any OTHER order still match this
        // listing" without a full table scan before deleting the listing.
        .index("by_listing", ["listingId"]),
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
    // Starred listings ("保存物件"). A per-user shortlist that survives order
    // deletion — the whole point is to keep a property someone liked even after
    // the search that surfaced it is gone, so this stores a SNAPSHOT of the
    // fields shown in the list alongside the listingId. Without the snapshot a
    // starred property would turn into a blank row as soon as the listing was
    // cleaned up with its order (see orders.remove).
    savedListings: defineTable({
        userId: v.optional(v.string()),
        listingId: v.optional(v.string()),
        // Which search it came from, for context on the saved page.
        orderId: v.optional(v.string()),
        orderName: v.optional(v.string()),
        note: v.optional(v.string()),
        savedAt: v.optional(v.number()),
        // Snapshot (see above).
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
    })
        .index("by_user", ["userId"])
        // Lets the star button ask "is THIS listing already saved by me" without
        // scanning the user's whole shortlist.
        .index("by_user_and_listing", ["userId", "listingId"]),
    // Per-user email settings: the signature block appended to every proposal
    // mail (会社所在地・宅建番号・取引態様 etc.).
    //
    // It used to live ONLY in localStorage, which is per-browser: what one laptop
    // had, another did not. Storing it per user account means the settings follow
    // the person, not the browser.
    //
    // SENDING a proposal is not configured here or anywhere server-side: the
    // proposal modal opens the user's own mail client (mailto:) with the
    // subject/body prefilled — there is no relay for that. mailAccounts below
    // is a SEPARATE, READ-ONLY connection (inbound broker emails), not this.
    emailSettings: defineTable({
        userId: v.optional(v.string()),
        signature: v.optional(v.string()),
        updatedAt: v.optional(v.number()),
    })
        .index("by_user", ["userId"]),
    /**
     * A mailbox connected by OAuth so incoming broker emails (物件紹介) can be
     * read and matched against orders automatically — READ-ONLY (gmail.readonly
     * / Mail.Read), and a wholly separate concern from the removed SEND
     * integration: this reads the user's inbox, it never sends as them.
     *
     * Holds live credentials — same handling as the deals in propertyMatcher.ts's
     * commit history: never returned to the browser, read only by internal
     * server-side functions.
     */
    mailAccounts: defineTable({
        userId: v.optional(v.string()),
        provider: v.optional(v.string()), // "gmail" | "outlook"
        email: v.optional(v.string()),
        accessToken: v.optional(v.string()),
        refreshToken: v.optional(v.string()),
        expiresAt: v.optional(v.number()), // epoch ms; refreshed near expiry
        scope: v.optional(v.string()),
        connectedAt: v.optional(v.number()),
        needsReconnect: v.optional(v.boolean()),
        lastError: v.optional(v.string()),
        // Provider-native incremental-sync cursor: Gmail's `historyId`, or
        // Microsoft Graph's delta link. Absent on first sync (full backfill).
        syncCursor: v.optional(v.string()),
        lastSyncedAt: v.optional(v.number()),
    })
        .index("by_user", ["userId"])
        .index("by_user_and_provider", ["userId", "provider"]),
    /**
     * Per-user rules deciding which incoming messages the mail sync bothers
     * reading. Separate from emailSettings above, which configures the OUTGOING
     * proposal signature and has nothing to do with the inbox.
     *
     * Every list is optional and an empty list means "no opinion", so an
     * unconfigured account behaves exactly as it did before this existed.
     */
    mailIngestSettings: defineTable({
        userId: v.optional(v.string()),
        // At least one must appear in subject or body. Empty = accept any.
        requiredKeywords: v.optional(v.array(v.string())),
        // Any match rejects the message outright.
        blockedKeywords: v.optional(v.array(v.string())),
        // Substring-matched against the From header, so "@example.co.jp"
        // covers a whole broker and a full address covers one person.
        allowedSenders: v.optional(v.array(v.string())),
        blockedSenders: v.optional(v.array(v.string())),
        // Skip anything with no attachment — some brokers only ever send マイソク.
        requireAttachment: v.optional(v.boolean()),
        updatedAt: v.optional(v.number()),
    })
        .index("by_user", ["userId"]),
    /** Short-lived CSRF state for an in-flight OAuth authorization — see the
     *  identical need explained on mailAccounts above: the provider redirects
     *  the BROWSER to our callback, which carries no Clerk session, so this
     *  row (created by an authenticated action, single-use, expiring in
     *  minutes) is the only link back to who is connecting. */
    oauthStates: defineTable({
        state: v.optional(v.string()),
        userId: v.optional(v.string()),
        provider: v.optional(v.string()),
        redirectTo: v.optional(v.string()),
        expiresAt: v.optional(v.number()),
    })
        .index("by_state", ["state"]),
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
