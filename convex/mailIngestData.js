/**
 * DB-touching half of mailIngest.js. Split out because mailIngest.js is a
 * "use node" file (needs the Node runtime for Buffer, used to decode
 * base64/base64url email and attachment bodies), and Node actions cannot use
 * `ctx.db` directly — only queries/mutations (this file, plain V8 runtime)
 * can, reached via ctx.runQuery/ctx.runMutation.
 */
import { internalMutation, internalQuery, mutation, query } from "./_generated/server.js";
import { v } from "convex/values";
import { requireUserId, requireOwned } from "./lib/authz.js";

// Mirrors mailIngest.js's PROVIDERS map (label + which env vars must be set).
// Duplicated rather than imported: mailIngest.js is "use node" and can only
// export actions, but availableProviders below is a plain query.
const PROVIDER_LABELS = {
  gmail: { label: "Gmail", clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID", clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET" },
  outlook: { label: "Outlook", clientIdEnv: "MICROSOFT_OAUTH_CLIENT_ID", clientSecretEnv: "MICROSOFT_OAUTH_CLIENT_SECRET" },
};

/** Which providers this deployment can actually offer — an unconfigured
 *  deployment shows no connect button rather than one that fails on click. */
export const availableProviders = query({
  args: {},
  handler: async () => {
    return Object.entries(PROVIDER_LABELS).map(([provider, cfg]) => {
      const available = Boolean(process.env[cfg.clientIdEnv] && process.env[cfg.clientSecretEnv]);
      return {
        provider,
        label: cfg.label,
        available,
        unavailableReason: available
          ? undefined
          : `${cfg.clientIdEnv} / ${cfg.clientSecretEnv} が未設定です。`,
      };
    });
  },
});

/** The caller's own connected mailboxes. Never returns tokens — only enough
 *  to render a connection-status card. */
export const myAccounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("mailAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((r) => ({
      _id: r._id,
      provider: r.provider,
      email: r.email,
      connectedAt: r.connectedAt,
      needsReconnect: r.needsReconnect,
      lastError: r.lastError,
      lastSyncedAt: r.lastSyncedAt,
    }));
  },
});

export const disconnect = mutation({
  args: { id: v.id("mailAccounts") },
  handler: async (ctx, args) => {
    await requireOwned(ctx, "メールアカウント", args.id);
    await ctx.db.delete(args.id);
  },
});

/**
 * Free-text 構造 ("鉄筋コンクリート造陸屋根地下1階付3階建") -> the short code
 * (RC/SRC/S/木造) an order's structureTypes criterion actually compares
 * against (see hardFilter.js). A lossy approximation for a mixed-structure
 * building ("鉄骨造一部鉄筋コンクリート造" genuinely has both) — checked in an
 * order chosen to favor the more load-bearing-relevant classification when
 * both terms appear, rather than attempting true multi-structure modeling.
 */
function deriveStructureType(text) {
  const t = text || "";
  if (/鉄骨鉄筋コンクリート|SRC/i.test(t)) return "SRC";
  if (/鉄筋コンクリート|RC(?!C)/i.test(t)) return "RC";
  if (/鉄骨|S造/i.test(t)) return "S";
  if (/木造/.test(t)) return "木造";
  return undefined;
}

export const saveOAuthState = internalMutation({
  args: {
    state: v.string(),
    userId: v.string(),
    provider: v.string(),
    redirectTo: v.optional(v.string()),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("oauthStates", args);
  },
});

export const consumeOAuthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .first();
    if (!row) return null;
    await ctx.db.delete(row._id); // single-use, whether or not it's expired
    if (row.expiresAt < Date.now()) return null;
    return row;
  },
});

export const upsertMailAccount = internalMutation({
  args: {
    userId: v.string(),
    provider: v.string(),
    email: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    scope: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mailAccounts")
      .withIndex("by_user_and_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", args.provider),
      )
      .first();
    const fields = {
      ...args,
      connectedAt: Date.now(),
      needsReconnect: false,
      lastError: undefined,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("mailAccounts", fields);
    }
  },
});

export const markNeedsReconnect = internalMutation({
  args: { id: v.id("mailAccounts"), lastError: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { needsReconnect: true, lastError: args.lastError });
  },
});

export const saveRefreshedToken = internalMutation({
  args: {
    id: v.id("mailAccounts"),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const saveSyncCursor = internalMutation({
  args: { id: v.id("mailAccounts"), syncCursor: v.optional(v.string()), lastSyncedAt: v.number() },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const accountsForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("mailAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const allAccounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("mailAccounts").collect();
  },
});

/**
 * Every order in the system, reduced to the OrderCriteria shape hardFilter.js
 * expects — same "top-level field, else fall back to the nested `criteria`
 * blob" logic as the frontend's buildOrderCriteria() and scraper-service's
 * cli.ts toCriteria(), so an older order that only has walkMinutes etc. nested
 * still matches correctly.
 */
/** Trims, drops blanks, and de-duplicates one rule list. The UI hands these
 *  over as free text split on newlines, so empty entries are routine — and one
 *  empty string in requiredKeywords would otherwise match every message. */
function cleanList(list) {
  if (!Array.isArray(list)) return undefined;
  return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
}

export const getIngestSettings = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("mailIngestSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const saveIngestSettings = mutation({
  args: {
    requiredKeywords: v.optional(v.array(v.string())),
    blockedKeywords: v.optional(v.array(v.string())),
    allowedSenders: v.optional(v.array(v.string())),
    blockedSenders: v.optional(v.array(v.string())),
    requireAttachment: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const patch = {
      requiredKeywords: cleanList(args.requiredKeywords),
      blockedKeywords: cleanList(args.blockedKeywords),
      allowedSenders: cleanList(args.allowedSenders),
      blockedSenders: cleanList(args.blockedSenders),
      requireAttachment: args.requireAttachment ?? false,
      updatedAt: Date.now(),
    };
    const existing = await ctx.db
      .query("mailIngestSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("mailIngestSettings", { userId, ...patch });
  },
});

/** Same row, read by the Node action that runs the sync. */
export const ingestSettingsForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("mailIngestSettings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
  },
});

export const listAllOrderCriteria = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orders = await ctx.db.query("orders").collect();
    return orders.map((order) => {
      const nested = order.criteria || {};
      const pick = (name) => (order[name] !== undefined ? order[name] : nested[name]);
      return {
        orderId: order._id,
        criteria: {
          dealType: order.dealType,
          ward: order.ward,
          wards: order.wards,
          priceMin: order.priceMin,
          priceMax: order.priceMax,
          walkMinutes: pick("walkMinutes"),
          minBuildingCoverageRatio: pick("minBuildingCoverageRatio"),
          minFloorAreaRatio: pick("minFloorAreaRatio"),
          propertyTypes: order.propertyTypes,
          landSizeMin: order.landSizeMin,
          landSizeMax: order.landSizeMax,
          buildingSizeMin: order.buildingSizeMin,
          buildingSizeMax: order.buildingSizeMax,
          maxBuildAge: order.maxBuildAge,
          minBuildYear: order.minBuildYear,
          minYield: order.minYield,
          maxYield: order.maxYield,
          minRoadWidth: order.minRoadWidth,
          minTotalUnits: order.minTotalUnits,
          maxFloor: order.maxFloor,
          excludeFirstFloor: order.excludeFirstFloor,
          minElevators: order.minElevators,
          structureTypes: order.structureTypes,
        },
      };
    });
  },
});

/**
 * Insert an email-derived listing (skip if its pseudo-url already exists —
 * same "never patch an existing row" rule ingestScrape() uses, so downstream
 * enrichment like a score is never clobbered by a re-sync) and create a
 * `matching` row for each order it satisfied.
 */
export const saveEmailListing = internalMutation({
  args: {
    url: v.string(),
    userId: v.string(),
    listing: v.any(),
    emailFrom: v.string(),
    emailReceivedAt: v.number(),
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
    matchedOrderIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("listings")
      .withIndex("by_url", (q) => q.eq("url", args.url))
      .first();

    let listingId;
    if (existing) {
      listingId = existing._id;
    } else {
      const l = args.listing;
      listingId = await ctx.db.insert("listings", {
        url: args.url,
        source: "email",
        status: "new",
        title: typeof l.title === "string" ? l.title : undefined,
        address: typeof l.address === "string" ? l.address : undefined,
        ward: typeof l.ward === "string" ? l.ward : undefined,
        price: typeof l.price === "number" ? l.price : undefined,
        area: typeof l.area === "number" ? l.area : undefined,
        landSize: typeof l.landSize === "number" ? l.landSize : undefined,
        station: typeof l.station === "string" ? l.station : undefined,
        walkMinutes: typeof l.walkMinutes === "number" ? l.walkMinutes : undefined,
        propertyType: typeof l.propertyType === "string" ? l.propertyType : undefined,
        yield: typeof l.yield === "number" ? l.yield : undefined,
        buildYear: typeof l.buildYear === "number" ? l.buildYear : undefined,
        structure: typeof l.structure === "string" ? l.structure : undefined,
        buildingCoverageRatio: typeof l.buildingCoverageRatio === "number" ? l.buildingCoverageRatio : undefined,
        floorAreaRatio: typeof l.floorAreaRatio === "number" ? l.floorAreaRatio : undefined,
        roadWidth: typeof l.roadWidth === "number" ? l.roadWidth : undefined,
        totalUnits: typeof l.totalUnits === "number" ? l.totalUnits : undefined,
        structureType: typeof l.structure === "string" ? deriveStructureType(l.structure) : undefined,
        description: typeof l.description === "string" ? l.description : undefined,
        emailFrom: args.emailFrom,
        emailReceivedAt: args.emailReceivedAt,
        emailSubject: args.emailSubject,
        emailBody: args.emailBody,
        emailAttachments: args.emailAttachments,
      });
    }

    let matchesCreated = 0;
    for (const orderId of args.matchedOrderIds) {
      const normalized = ctx.db.normalizeId("orders", orderId);
      const order = normalized ? await ctx.db.get(normalized) : null;
      if (!order || !order.userId) continue;

      const existingMatch = await ctx.db
        .query("matching")
        .withIndex("by_order", (q) => q.eq("orderId", orderId))
        .filter((q) => q.eq(q.field("listingId"), listingId))
        .first();
      if (existingMatch) continue;

      await ctx.db.insert("matching", {
        userId: order.userId,
        orderId,
        listingId,
        status: "matched",
      });
      matchesCreated++;
    }
    return { listingId, matchesCreated };
  },
});

export const getListingById = internalQuery({
  args: { id: v.id("listings") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const updateListingEmailDetails = internalMutation({
  args: {
    listingId: v.id("listings"),
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
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.listingId, {
      emailSubject: args.emailSubject,
      emailBody: args.emailBody,
      emailAttachments: args.emailAttachments,
    });
  },
});

