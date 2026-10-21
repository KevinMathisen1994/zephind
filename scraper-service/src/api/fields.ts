/**
 * Per-table write allowlists.
 *
 * Convex's arg validators doubled as these: a field absent from the validator
 * could not be written by a client. Express has no equivalent, so the lists are
 * explicit here. `userId` is never in one — it comes from the verified JWT, so a
 * caller cannot create or move rows owned by someone else.
 */
export function pick<T extends Record<string, any>>(body: T, allowed: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

export const ORDER_FIELDS = [
  "name", "ward", "wards", "dealType",
  "priceMin", "priceMax", "rentMin", "rentMax",
  "maxDeposit", "maxKeyMoney", "petsRequired",
  "areaMin", "areaMax", "status", "criteria", "walkMinutes",
  "minBuildingCoverageRatio", "minFloorAreaRatio", "propertyTypes", "ownerChange",
  "landSizeMin", "landSizeMax", "buildingSizeMin", "buildingSizeMax",
  "maxBuildAge", "minBuildYear", "minYield", "maxYield", "minRoadWidth",
  "minTotalUnits", "maxFloor", "excludeFirstFloor", "minElevators",
  "structureTypes", "layoutTypes", "customerId",
  "isScraping", "scrapingStatus", "activeSource", "scrapeRunId",
  "lastScrapeAt", "lastScrapeBy",
] as const;

export const CUSTOMER_FIELDS = [
  "name", "email", "phone", "company", "address", "notes",
] as const;

export const DEAL_FIELDS = [
  "title", "customerId", "customerName", "customerEmail", "customerPhone",
  "orderId", "orderName", "listings", "customMessage", "status",
] as const;

export const SAVED_LISTING_FIELDS = [
  "listingId", "orderId", "orderName", "note",
  "address", "ward", "price", "area", "landSize", "source", "url",
  "propertyType", "station", "walkMinutes", "score", "postedAt", "postedDateKind",
] as const;

export const PROPERTY_FIELDS = [
  "address", "ward", "price", "area", "landSize", "buildYear", "mlitBenchmark",
  "score", "listingId", "source", "status", "enrichedAt", "title", "description",
  "sourceUrl", "images", "latitude", "longitude", "stationName", "walkingMinutes",
  "buildingCoverageRatio", "floorAreaRatio", "roadWidth", "frontage",
  "hotelsCount", "attractionsCount", "restaurantsCount", "inboundScore",
  "inboundStars", "hardFiltersPassed", "isMatch", "aiRecommendation", "aiSummary",
  "aiStrengths", "aiWeaknesses", "discountPercent", "expectedMarketValue",
] as const;

export const PROPOSAL_FIELDS = [
  "propertyId", "orderId", "status", "score", "notes",
] as const;

export const MAIL_INGEST_SETTING_FIELDS = [
  "requiredKeywords", "blockedKeywords", "allowedSenders", "blockedSenders",
  "requireAttachment",
] as const;
