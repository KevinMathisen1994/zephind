import type { PropertyListing, OrderCriteria } from "../types";
import { logger } from "../logger";

export interface MatchedListing extends PropertyListing {
  matchedOrderIndices: number[];
}

export interface FailedListing extends PropertyListing {
  rejectionReason?: string;
}

export interface HardFilterResult {
  passed: MatchedListing[];
  failed: FailedListing[];
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
  const failed: FailedListing[] = [];

  for (const listing of listings) {
    const matchedIndices: number[] = [];
    const failedReasons: string[] = [];
    for (let i = 0; i < criteria.length; i++) {
      const [matches, reason] = matchesOrder(listing, criteria[i], reasons);
      if (matches) {
        matchedIndices.push(i);
      } else if (reason) {
        failedReasons.push(reason);
      }
    }
    if (matchedIndices.length > 0 || criteria.length === 0) {
      passed.push({ ...listing, matchedOrderIndices: matchedIndices });
    } else {
      failed.push({ ...listing, rejectionReason: failedReasons.join(", ") });
    }
  }

  const stats = { total: listings.length, passed: passed.length, failed: failed.length, reasons };

  logger.info("Hard filter results", { total: stats.total, passed: stats.passed, failed: stats.failed, rejectionReasons: reasons });

  return { passed, failed, stats };
}


/** Site labels vary (区分マンション, 中古マンション, 一棟アパート). Reduce to a canonical type. */
function canonicalPropertyType(raw: string): string {
  const t = raw.replace(/\s/g, "");
  if (/土地|宅地|用地/.test(t)) return "土地";
  if (/マンション/.test(t)) return "マンション";
  if (/アパート/.test(t)) return "アパート";
  if (/戸建|一戸建て/.test(t)) return "一戸建て";
  if (/ビル/.test(t)) return "ビル";
  if (/店舗|事務所/.test(t)) return "店舗";
  return t;
}

/**
 * Building types that can be bought as an income-producing asset. 土地 is
 * excluded deliberately: raw land generates no yield, so 収益物件 should not
 * silently pull in every plot of land.
 */
const INCOME_TYPES = new Set(["マンション", "アパート", "一戸建て", "ビル", "店舗"]);

export function propertyTypeMatches(listingType: string, wanted: string[]): boolean {
  const canon = canonicalPropertyType(listingType);
  for (const w of wanted) {
    const wc = canonicalPropertyType(w);
    if (wc === canon) return true;
    // 収益物件 is a category, so treat it as "any income-producing building type".
    if (w.includes("収益") && INCOME_TYPES.has(canon)) return true;
  }
  return false;
}

function matchesOrder(
  listing: PropertyListing,
  criteria: OrderCriteria,
  reasons: Record<string, number>
): [boolean, string | null] {
  // Location filter — supports both 23 Wards (区) and Cities/Towns/Villages (市/町/村)
  const targetLocations =
    criteria.wards && criteria.wards.length > 0
      ? criteria.wards
      : criteria.ward
        ? [criteria.ward]
        : [];

  if (targetLocations.length > 0) {
    const isMatched = targetLocations.some((target) => {
      if (
        listing.ward &&
        (listing.ward === target ||
          target.includes(listing.ward) ||
          listing.ward.includes(target))
      ) {
        return true;
      }
      if (listing.address && listing.address.includes(target)) {
        return true;
      }
      return false;
    });

    if (!isMatched) {
      incrementReason(reasons, "エリア不一致");
      return [false, "エリア不一致"];
    }
  }

  // Price range
  if (criteria.priceMin && listing.price < criteria.priceMin) {
    incrementReason(reasons, "価格下限未満");
    return [false, "価格下限未満"];
  }
  if (criteria.priceMax && listing.price > criteria.priceMax) {
    incrementReason(reasons, "価格上限超過");
    return [false, "価格上限超過"];
  }

  // Walk minutes.
  // Was `listing.walkMinutes ?? 99`, i.e. "unknown means 99 minutes", so any
  // listing whose walk time failed to parse was rejected outright. Every other
  // optional-attribute check here skips when the field is missing, and several
  // scrapers legitimately produce walk=undefined (homes' address parsing folds
  // the traffic line into the address). Treating unknown as a rejection quietly
  // discarded listings that may well be within range — 徒歩分数超過 was the
  // second-largest rejection reason in a real run. Skip when unknown instead, so
  // an unparsed field is a data gap rather than a silent disqualification.
  if (criteria.walkMinutes && listing.walkMinutes != null) {
    const walk = listing.walkMinutes;
    if (walk > criteria.walkMinutes) {
      incrementReason(reasons, "徒歩分数超過");
      return [false, "徒歩分数超過"];
    }
  }

  // Building coverage ratio — skip check if listing has no data
  if (criteria.minBuildingCoverageRatio && listing.buildingCoverageRatio != null) {
    if (listing.buildingCoverageRatio < criteria.minBuildingCoverageRatio) {
      incrementReason(reasons, "建ぺい率未満");
      return [false, "建ぺい率未満"];
    }
  }

  // Floor area ratio — skip check if listing has no data
  if (criteria.minFloorAreaRatio && listing.floorAreaRatio != null) {
    if (listing.floorAreaRatio < criteria.minFloorAreaRatio) {
      incrementReason(reasons, "容積率未満");
      return [false, "容積率未満"];
    }
  }

  // Property type filter.
  //
  // This used to be a bare `criteria.propertyTypes.includes(listing.propertyType)`
  // exact string match, which failed in two ways seen in real runs:
  //
  //  1. 収益物件 is an investment CATEGORY, not a building shape. No scraper emits
  //     that string (they emit 土地 / 一戸建て / マンション from their own category
  //     maps), so an order asking for 収益物件 matched literally nothing from any
  //     of the 19 sources — 131 マンション in 新宿区 were all rejected.
  //  2. Sites label the same thing differently: nomu_pro emits 区分マンション and
  //     一棟マンション, kenbiya emits ビル. Exact match rejects all of them even
  //     when the category is exactly what the buyer asked for.
  if (criteria.propertyTypes && criteria.propertyTypes.length > 0) {
    if (!listing.propertyType || !propertyTypeMatches(listing.propertyType, criteria.propertyTypes)) {
      incrementReason(reasons, "物件種別不一致");
      return [false, "物件種別不一致"];
    }
  }

  // Land size range
  if (criteria.landSizeMin && listing.landSize != null && listing.landSize < criteria.landSizeMin) {
    incrementReason(reasons, "土地面積下限未満");
    return [false, "土地面積下限未満"];
  }
  if (criteria.landSizeMax && listing.landSize != null && listing.landSize > criteria.landSizeMax) {
    incrementReason(reasons, "土地面積上限超過");
    return [false, "土地面積上限超過"];
  }

  // Building size range (using area field as proxy for building size)
  if (criteria.buildingSizeMin && listing.area != null && listing.area < criteria.buildingSizeMin) {
    incrementReason(reasons, "建物面積下限未満");
    return [false, "建物面積下限未満"];
  }
  if (criteria.buildingSizeMax && listing.area != null && listing.area > criteria.buildingSizeMax) {
    incrementReason(reasons, "建物面積上限超過");
    return [false, "建物面積上限超過"];
  }

  // --- NEW FILTERS ---

  // Build year / age
  if (criteria.maxBuildAge != null && listing.buildYear != null) {
    const currentYear = new Date().getFullYear();
    const buildAge = currentYear - listing.buildYear;
    if (buildAge > criteria.maxBuildAge) {
      incrementReason(reasons, "築年数超過");
      return [false, "築年数超過"];
    }
  }
  if (criteria.minBuildYear != null && listing.buildYear != null) {
    if (listing.buildYear < criteria.minBuildYear) {
      incrementReason(reasons, "築年下限未満");
      return [false, "築年下限未満"];
    }
  }

  // Yield (利回り) — skip check if listing has no yield data
  if (criteria.minYield != null && listing.yield != null) {
    if (listing.yield < criteria.minYield) {
      incrementReason(reasons, "利回り未満");
      return [false, "利回り未満"];
    }
  }
  if (criteria.maxYield != null && listing.yield != null) {
    if (listing.yield > criteria.maxYield) {
      incrementReason(reasons, "利回り超過");
      return [false, "利回り超過"];
    }
  }

  // Road width (道路幅員) — skip check if listing has no data
  if (criteria.minRoadWidth != null && listing.roadWidth != null) {
    if (listing.roadWidth < criteria.minRoadWidth) {
      incrementReason(reasons, "道路幅員未満");
      return [false, "道路幅員未満"];
    }
  }

  // Total units (総戸数) — skip check if listing has no data
  if (criteria.minTotalUnits != null && listing.totalUnits != null) {
    if (listing.totalUnits < criteria.minTotalUnits) {
      incrementReason(reasons, "総戸数未満");
      return [false, "総戸数未満"];
    }
  }

  // Max floor (最高階数)
  if (criteria.maxFloor != null && listing.floor != null) {
    if (listing.floor > criteria.maxFloor) {
      incrementReason(reasons, "階数超過");
      return [false, "階数超過"];
    }
  }

  // Exclude first floor (一階不可)
  if (criteria.excludeFirstFloor && listing.floor != null) {
    if (listing.floor <= 1) {
      incrementReason(reasons, "一階");
      return [false, "一階"];
    }
  }

  // Min elevators (最低エレベーター数)
  if (criteria.minElevators != null && listing.elevators != null) {
    if (listing.elevators < criteria.minElevators) {
      incrementReason(reasons, "エレベーター数未満");
      return [false, "エレベーター数未満"];
    }
  }

  // Structure types (構造種別)
  if (criteria.structureTypes && criteria.structureTypes.length > 0) {
    if (!listing.structureType || !criteria.structureTypes.includes(listing.structureType)) {
      incrementReason(reasons, "構造種別不一致");
      return [false, "構造種別不一致"];
    }
  }

  // Layout types (間取りタイプ)
  if (criteria.layoutTypes && criteria.layoutTypes.length > 0) {
    let layout = listing.layout ? toHalfWidth(listing.layout).toUpperCase().replace(/\s+/g, "") : "";
    layout = layout.replace(/\+\d*[A-Z]$/, ""); // normalize 2LDK+S -> 2LDK
    layout = layout.replace(/S(L?D?K)$/, "$1"); // normalize 2SLDK -> 2LDK
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
      return [false, "間取りタイプ不一致"];
    }
  }

  return [true, null];
}

function toHalfWidth(str: string): string {
  return str.replace(/[\uFF01-\uFF5E]/g, (ch) => {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  }).replace(/\u3000/g, " ");
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