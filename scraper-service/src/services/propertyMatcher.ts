import type { PropertyListing, OrderCriteria } from "../types";
import { logger } from "../logger";

export interface MatchedListing extends PropertyListing {
  matchedOrderIndices: number[];
}

export interface HardFilterResult {
  passed: MatchedListing[];
  failed: PropertyListing[];
  stats: { total: number; passed: number; failed: number; reasons: Record<string, number> };
}

/**
 * Apply hard filters to a list of listings based on order criteria.
 * Returns which order indices each listing matched.
 */
export function hardFilter(
  listings: PropertyListing[],
  criteria: OrderCriteria[]
): HardFilterResult {
  const reasons: Record<string, number> = {};
  const passed: MatchedListing[] = [];
  const failed: PropertyListing[] = [];

  for (const listing of listings) {
    const matchedIndices: number[] = [];
    for (let i = 0; i < criteria.length; i++) {
      if (matchesOrder(listing, criteria[i], reasons)) {
        matchedIndices.push(i);
      }
    }
    if (matchedIndices.length > 0 || criteria.length === 0) {
      passed.push({ ...listing, matchedOrderIndices: matchedIndices });
    } else {
      failed.push(listing);
    }
  }

  const stats = { total: listings.length, passed: passed.length, failed: failed.length, reasons };

  logger.info("Hard filter results", { total: stats.total, passed: stats.passed, failed: stats.failed, rejectionReasons: reasons });

  return { passed, failed, stats };
}

function matchesOrder(
  listing: PropertyListing,
  criteria: OrderCriteria,
  reasons: Record<string, number>
): boolean {
  // Ward filter — supports both single ward and multiple wards
  if (criteria.wards && criteria.wards.length > 0) {
    if (!listing.ward || !criteria.wards.includes(listing.ward)) {
      incrementReason(reasons, "区不一致");
      return false;
    }
  } else if (criteria.ward && listing.ward !== criteria.ward) {
    incrementReason(reasons, "区不一致");
    return false;
  }

  // Price range
  if (criteria.priceMin && listing.price < criteria.priceMin) {
    incrementReason(reasons, "価格下限未満");
    return false;
  }
  if (criteria.priceMax && listing.price > criteria.priceMax) {
    incrementReason(reasons, "価格上限超過");
    return false;
  }

  // Walk minutes
  if (criteria.walkMinutes) {
    const walk = listing.walkMinutes ?? 99;
    if (walk > criteria.walkMinutes) {
      incrementReason(reasons, "徒歩分数超過");
      return false;
    }
  }

  // Building coverage ratio — skip check if listing has no data
  if (criteria.minBuildingCoverageRatio && listing.buildingCoverageRatio != null) {
    if (listing.buildingCoverageRatio < criteria.minBuildingCoverageRatio) {
      incrementReason(reasons, "建ぺい率未満");
      return false;
    }
  }

  // Floor area ratio — skip check if listing has no data
  if (criteria.minFloorAreaRatio && listing.floorAreaRatio != null) {
    if (listing.floorAreaRatio < criteria.minFloorAreaRatio) {
      incrementReason(reasons, "容積率未満");
      return false;
    }
  }

  // Property type filter
  if (criteria.propertyTypes && criteria.propertyTypes.length > 0) {
    if (!listing.propertyType || !criteria.propertyTypes.includes(listing.propertyType)) {
      incrementReason(reasons, "物件種別不一致");
      return false;
    }
  }

  // Land size range
  if (criteria.landSizeMin && listing.landSize != null && listing.landSize < criteria.landSizeMin) {
    incrementReason(reasons, "土地面積下限未満");
    return false;
  }
  if (criteria.landSizeMax && listing.landSize != null && listing.landSize > criteria.landSizeMax) {
    incrementReason(reasons, "土地面積上限超過");
    return false;
  }

  // Building size range (using area field as proxy for building size)
  if (criteria.buildingSizeMin && listing.area != null && listing.area < criteria.buildingSizeMin) {
    incrementReason(reasons, "建物面積下限未満");
    return false;
  }
  if (criteria.buildingSizeMax && listing.area != null && listing.area > criteria.buildingSizeMax) {
    incrementReason(reasons, "建物面積上限超過");
    return false;
  }

  // --- NEW FILTERS ---

  // Build year / age
  if (criteria.maxBuildAge != null && listing.buildYear != null) {
    const currentYear = new Date().getFullYear();
    const buildAge = currentYear - listing.buildYear;
    if (buildAge > criteria.maxBuildAge) {
      incrementReason(reasons, "築年数超過");
      return false;
    }
  }
  if (criteria.minBuildYear != null && listing.buildYear != null) {
    if (listing.buildYear < criteria.minBuildYear) {
      incrementReason(reasons, "築年下限未満");
      return false;
    }
  }

  // Yield (利回り) — skip check if listing has no yield data
  if (criteria.minYield != null && listing.yield != null) {
    if (listing.yield < criteria.minYield) {
      incrementReason(reasons, "利回り未満");
      return false;
    }
  }
  if (criteria.maxYield != null && listing.yield != null) {
    if (listing.yield > criteria.maxYield) {
      incrementReason(reasons, "利回り超過");
      return false;
    }
  }

  // Road width (道路幅員) — skip check if listing has no data
  if (criteria.minRoadWidth != null && listing.roadWidth != null) {
    if (listing.roadWidth < criteria.minRoadWidth) {
      incrementReason(reasons, "道路幅員未満");
      return false;
    }
  }

  // Total units (総戸数) — skip check if listing has no data
  if (criteria.minTotalUnits != null && listing.totalUnits != null) {
    if (listing.totalUnits < criteria.minTotalUnits) {
      incrementReason(reasons, "総戸数未満");
      return false;
    }
  }

  // Max floor (最高階数)
  if (criteria.maxFloor != null && listing.floor != null) {
    if (listing.floor > criteria.maxFloor) {
      incrementReason(reasons, "階数超過");
      return false;
    }
  }

  // Exclude first floor (一階不可)
  if (criteria.excludeFirstFloor && listing.floor != null) {
    if (listing.floor <= 1) {
      incrementReason(reasons, "一階");
      return false;
    }
  }

  // Min elevators (最低エレベーター数)
  if (criteria.minElevators != null && listing.elevators != null) {
    if (listing.elevators < criteria.minElevators) {
      incrementReason(reasons, "エレベーター数未満");
      return false;
    }
  }

  // Structure types (構造種別)
  if (criteria.structureTypes && criteria.structureTypes.length > 0) {
    if (!listing.structureType || !criteria.structureTypes.includes(listing.structureType)) {
      incrementReason(reasons, "構造種別不一致");
      return false;
    }
  }

  // Layout types (間取りタイプ)
  if (criteria.layoutTypes && criteria.layoutTypes.length > 0) {
    const layout = listing.layout ? listing.layout.toUpperCase().replace(/\s+/g, "") : "";
    let matchesLayout = false;

    // Check fallback listing.layoutType first
    if (listing.layoutType && criteria.layoutTypes.includes(listing.layoutType)) {
      matchesLayout = true;
    } else {
      for (const t of criteria.layoutTypes) {
        if (t === "ファミリー") {
          const match = layout.match(/^(\d+)/);
          if (match) {
            const rooms = parseInt(match[1], 10);
            if (rooms >= 3) {
              matchesLayout = true;
              break;
            }
          }
        } else {
          if (layout === t.toUpperCase().replace(/\s+/g, "")) {
            matchesLayout = true;
            break;
          }
        }
      }
    }

    if (!matchesLayout) {
      incrementReason(reasons, "間取りタイプ不一致");
      return false;
    }
  }

  return true;
}

function incrementReason(reasons: Record<string, number>, key: string) {
  reasons[key] = (reasons[key] || 0) + 1;
}

export function calculateScore(listing: PropertyListing, benchmark?: number): number {
  if (!benchmark || !listing.price || !listing.area) return 0;

  const pricePerSqm = listing.price / listing.area;
  const benchmarkPerSqm = benchmark;

  if (benchmarkPerSqm <= 0) return 0;

  const ratio = benchmarkPerSqm / pricePerSqm;
  const score = Math.min(100, Math.round(ratio * 50));

  return Math.max(0, Math.min(100, score));
}

export function isUnderMarket(listing: PropertyListing, benchmark?: number, threshold = 10): boolean {
  if (!benchmark) return false;
  const score = calculateScore(listing, benchmark);
  return score >= threshold;
}

export function enrichListing(listing: PropertyListing, benchmark?: number): PropertyListing & { score: number; mlitBenchmark?: number } {
  const score = calculateScore(listing, benchmark);
  return { ...listing, score, mlitBenchmark: benchmark };
}

export function filterUnderMarket(listings: PropertyListing[], benchmark?: number, threshold = 10): PropertyListing[] {
  if (!benchmark) return listings;
  return listings.filter((l) => isUnderMarket(l, benchmark, threshold));
}