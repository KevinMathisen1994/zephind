/**
 * Data access for the mail ingest flow. Ported from convex/mailIngestData.js.
 *
 * That file existed only because mailIngest.js was a Convex "use node" module
 * and Node actions cannot touch ctx.db — so every read/write had to be a
 * separate V8-runtime function reached through ctx.runQuery/ctx.runMutation.
 * Plain Node has no such split, so these are ordinary functions the sync calls
 * directly.
 */
import { db, type Doc } from "../db";

// Mirrors the PROVIDERS map in ../services/mailIngest.ts (label + which env
// vars must be set).
export const PROVIDER_LABELS: Record<string, { label: string; clientIdEnv: string; clientSecretEnv: string }> = {
  gmail: { label: "Gmail", clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID", clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET" },
  outlook: { label: "Outlook", clientIdEnv: "MICROSOFT_OAUTH_CLIENT_ID", clientSecretEnv: "MICROSOFT_OAUTH_CLIENT_SECRET" },
};

/**
 * Free-text 構造 ("鉄筋コンクリート造陸屋根地下1階付3階建") -> the short code
 * (RC/SRC/S/木造) an order's structureTypes criterion compares against (see
 * hardFilter.js). Lossy for a genuinely mixed-structure building; the checks
 * are ordered to favour the more load-bearing-relevant classification when both
 * terms appear, rather than attempting true multi-structure modelling.
 */
export function deriveStructureType(text: string | undefined): string | undefined {
  const t = text || "";
  if (/鉄骨鉄筋コンクリート|SRC/i.test(t)) return "SRC";
  if (/鉄筋コンクリート|RC(?!C)/i.test(t)) return "RC";
  if (/鉄骨|S造/i.test(t)) return "S";
  if (/木造/.test(t)) return "木造";
  return undefined;
}

/**
 * Trims, drops blanks and de-duplicates one rule list. The UI hands these over
 * as free text split on newlines, so empty entries are routine — and one empty
 * string in requiredKeywords would otherwise match every message.
 */
export function cleanList(list: unknown): string[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
}

// --- OAuth state ----------------------------------------------------------

export async function saveOAuthState(row: {
  state: string; userId: string; provider: string; redirectTo?: string; expiresAt: number;
}) {
  await db.insert("oauthStates", row);
}

/** Single-use, whether or not it has expired. */
export async function consumeOAuthState(state: string): Promise<Doc | null> {
  const row = await db.first("oauthStates", { where: { state } });
  if (!row) return null;
  await db.delete("oauthStates", row._id);
  if ((row.expiresAt as number) < Date.now()) return null;
  return row;
}

// --- Accounts -------------------------------------------------------------

export async function upsertMailAccount(args: {
  userId: string; provider: string; email: string;
  accessToken: string; refreshToken: string; expiresAt: number; scope: string;
}) {
  const existing = await db.first("mailAccounts", {
    where: { userId: args.userId, provider: args.provider },
  });
  const fields = { ...args, connectedAt: Date.now(), needsReconnect: false, lastError: null };
  if (existing) return db.patch("mailAccounts", existing._id, fields);
  await db.insert("mailAccounts", fields);
}

export async function markNeedsReconnect(id: string, lastError: string) {
  await db.patch("mailAccounts", id, { needsReconnect: true, lastError });
}

export async function saveRefreshedToken(
  id: string,
  fields: { accessToken: string; refreshToken: string; expiresAt: number },
) {
  await db.patch("mailAccounts", id, fields);
}

export async function saveSyncCursor(id: string, syncCursor: string | undefined, lastSyncedAt: number) {
  // Explicit null: the db helper strips undefined, which would leave a stale
  // cursor in place and re-sync from the wrong point.
  await db.patch("mailAccounts", id, { syncCursor: syncCursor ?? null, lastSyncedAt });
}

export async function accountsForUser(userId: string) {
  return db.list("mailAccounts", { where: { userId } });
}

export async function allAccounts() {
  return db.list("mailAccounts");
}

// --- Ingest settings ------------------------------------------------------

export async function ingestSettingsForUser(userId: string) {
  return db.first("mailIngestSettings", { where: { userId } });
}

// --- Orders ---------------------------------------------------------------

/**
 * Every order, reduced to the OrderCriteria shape hardFilter.js expects — same
 * "top-level field, else fall back to the nested `criteria` blob" logic as the
 * frontend's buildOrderCriteria() and cli.ts's toCriteria(), so an older order
 * that only has walkMinutes etc. nested still matches correctly.
 */
export async function listAllOrderCriteria() {
  const orders = await db.list("orders");
  return orders.map((order) => {
    const nested: any = order.criteria || {};
    const pick = (name: string) => (order[name] !== undefined && order[name] !== null ? order[name] : nested[name]);
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
}

// --- Email-derived listings ----------------------------------------------

export interface EmailAttachment {
  id?: string;
  filename: string;
  mimeType: string;
  size: number;
}

/**
 * Insert an email-derived listing and create a `matching` row for each order it
 * satisfied. An existing pseudo-url is SKIPPED, never patched — the same rule
 * ingestScrape uses, so downstream enrichment like a score is not clobbered by
 * a re-sync.
 */
export async function saveEmailListing(args: {
  url: string;
  userId: string;
  listing: any;
  emailFrom: string;
  emailReceivedAt: number;
  emailSubject?: string;
  emailBody?: string;
  emailAttachments?: EmailAttachment[];
  matchedOrderIds: string[];
}) {
  const existing = await db.first("listings", { where: { url: args.url } });

  let listingId: string;
  if (existing) {
    listingId = existing._id;
  } else {
    const l = args.listing ?? {};
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const num = (v: unknown) => (typeof v === "number" ? v : undefined);
    listingId = await db.insert("listings", {
      url: args.url,
      source: "email",
      status: "new",
      title: str(l.title),
      address: str(l.address),
      ward: str(l.ward),
      price: num(l.price),
      area: num(l.area),
      landSize: num(l.landSize),
      station: str(l.station),
      walkMinutes: num(l.walkMinutes),
      propertyType: str(l.propertyType),
      yield: num(l.yield),
      buildYear: num(l.buildYear),
      structure: str(l.structure),
      buildingCoverageRatio: num(l.buildingCoverageRatio),
      floorAreaRatio: num(l.floorAreaRatio),
      roadWidth: num(l.roadWidth),
      totalUnits: num(l.totalUnits),
      structureType: deriveStructureType(str(l.structure)),
      description: str(l.description),
      emailFrom: args.emailFrom,
      emailReceivedAt: args.emailReceivedAt,
      emailSubject: args.emailSubject,
      emailBody: args.emailBody,
      emailAttachments: args.emailAttachments,
    });
  }

  let matchesCreated = 0;
  if (args.matchedOrderIds.length > 0) {
    const orders = await db.getMany("orders", args.matchedOrderIds);
    const { data: existingMatches } = await db.raw
      .from("matching")
      .select("orderId")
      .eq("listingId", listingId)
      .in("orderId", args.matchedOrderIds);
    const already = new Set((existingMatches ?? []).map((r: any) => r.orderId));

    const toInsert = orders
      .filter((o): o is Doc => Boolean(o?.userId) && !already.has(o!._id))
      // Ownership comes from the ORDER, never from the caller.
      .map((o) => ({ userId: o.userId, orderId: o._id, listingId, status: "matched" }));
    if (toInsert.length > 0) {
      await db.insertMany("matching", toInsert);
      matchesCreated = toInsert.length;
    }
  }
  return { listingId, matchesCreated };
}

/**
 * Listings already ingested from one message, found by the `email:{provider}:
 * {messageId}:{n}` pseudo-url saveEmailListing mints. Lets the inspector show
 * what is stored instead of paying a model to re-read mail already processed.
 */
export async function listingsForMessage(provider: string, messageId: string) {
  const { data, error } = await db.raw
    .from("listings")
    .select("*")
    .like("url", `email:${provider}:${messageId}:%`);
  if (error) throw new Error(`listingsForMessage: ${error.message}`);
  return data ?? [];
}

export async function getListingById(id: string) {
  return db.get("listings", id);
}

export async function updateListingEmailDetails(
  listingId: string,
  fields: { emailSubject?: string; emailBody?: string; emailAttachments?: EmailAttachment[] },
) {
  await db.patch("listings", listingId, fields);
}
