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


/**
 * Site labels vary (区分マンション, 中古マンション, 一棟アパート). Reduce to a
 * canonical type.
 *
 * 一棟マンション is canonicalised SEPARATELY from マンション: buying a whole
 * building and buying one unit in it are different products at different price
 * points, and the order form now has a button for each. アパート is checked
 * before マンション so a site's 一棟アパート lands on アパート, not マンション.
 */
export function canonicalPropertyType(raw: string): string {
  const t = raw.replace(/\s/g, "");
  if (/土地|宅地|用地/.test(t)) return "土地";
  if (/アパート/.test(t)) return "アパート";
  if (/(一棟|1棟|１棟)/.test(t) && /マンション/.test(t)) return "一棟マンション";
  if (/マンション/.test(t)) return "マンション";
  // テラスハウス/タウンハウス (terrace/row/town house) and 貸家 (house-for-rent)
  // are rental-market terms for a low-rise, ground-level house — confirmed
  // live: rakuten emits タウンハウス, suumo emits "賃貸テラス・タウンハウス" (which
  // does NOT contain the substring "テラスハウス" itself, hence タウンハウス being
  // matched separately rather than folded into one longer literal), daikyo
  // emits 貸家 for genuine detached houses. Closer to 一戸建て than any
  // apartment product for a renter's purposes; without this each fell through
  // to `return t` and silently missed every 一戸建て order (neither string is
  // a substring of the other in propertyTypeMatches()'s comparison below).
  // シェアハウス (share house / dorm-style room rental) is deliberately NOT
  // included here — it isn't equivalent to renting a standalone house.
  if (/戸建|一戸建て|テラスハウス|タウンハウス|貸家/.test(t)) return "一戸建て";
  if (/ビル/.test(t)) return "ビル";
  if (/店舗|事務所/.test(t)) return "店舗";
  return t;
}

/** Text on the listing that can reveal 一棟 / オーナーチェンジ when the site's own
 *  category label is only as specific as "マンション". */
function listingText(listing: PropertyListing): string {
  return `${listing.propertyType ?? ""} ${listing.title ?? ""} ${listing.description ?? ""}`.replace(
    /\s+/g,
    "",
  );
}

/** 一棟売り (whole-building sale) hints used by the portals. */
const WHOLE_BUILDING_RE = /(一棟|1棟|１棟)(売|マンション|アパート|ビル)|一棟売/;

/**
 * オーナーチェンジ = the unit is tenanted and the lease transfers with the sale.
 * Portals express it as オーナーチェンジ, 賃貸中, 入居中, or 現況賃貸.
 */
const OWNER_CHANGE_RE =
  /(オーナーチェンジ|オーナーチェンジ物件|賃貸中|入居中|現況賃貸|賃借人有)/;

export function looksOwnerChange(listing: PropertyListing): boolean {
  return OWNER_CHANGE_RE.test(listingText(listing));
}

/**
 * Building types that can be bought as an income-producing asset. 土地 is
 * excluded deliberately: raw land generates no yield, so 収益物件 should not
 * silently pull in every plot of land.
 */
const INCOME_TYPES = new Set([
  "マンション",
  "一棟マンション",
  "アパート",
  "一戸建て",
  "ビル",
  "店舗",
]);

/**
 * @param context Extra listing text (title/description). Portals frequently
 *   label a whole-building sale as plain "マンション" and only say 一棟 in the
 *   title, so without this an order for 一棟マンション would match almost nothing.
 */
export function propertyTypeMatches(
  listingType: string,
  wanted: string[],
  context = "",
): boolean {
  const canon = canonicalPropertyType(listingType);
  const haystack = `${listingType}${context}`.replace(/\s/g, "");
  const isWholeBuilding = WHOLE_BUILDING_RE.test(haystack);

  for (const w of wanted) {
    const wc = canonicalPropertyType(w);
    if (wc === canon) return true;
    // 収益物件 is a category, so treat it as "any income-producing building type".
    if (w.includes("収益") && INCOME_TYPES.has(canon)) return true;
    // Wanted 一棟マンション, site said only マンション — accept if the listing
    // text betrays a whole-building sale.
    if (wc === "一棟マンション" && canon === "マンション" && isWholeBuilding) {
      return true;
    }
    // The reverse is deliberately NOT allowed: someone shopping for a 区分
    // マンション (one unit) is not in the market for the whole building.
  }
  return false;
}

function matchesOrder(
  listing: PropertyListing,
  criteria: OrderCriteria,
  reasons: Record<string, number>
): [boolean, string | null] {
  // 買う/借りる is a hard, absolute gate — never a scored preference. A rental
  // listing can never satisfy a buy order and vice versa, regardless of how
  // well everything else fits (see the schema comment on orders.dealType for
  // why these are kept as entirely separate criteria rather than reusing
  // price/priceMin/Max for rent). An order with no dealType set (every order
  // created before this existed) is treated as "buy", matching its historical
  // behavior; a listing with no dealType set (every pre-existing for-sale
  // scraper) is likewise treated as "buy".
  const orderDealType = criteria.dealType ?? "buy";
  const listingDealType = listing.dealType ?? "buy";
  if (orderDealType !== listingDealType) {
    incrementReason(reasons, "取引種別不一致（買う/借りる）");
    return [false, "取引種別不一致（買う/借りる）"];
  }

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

  // Rental budget/terms — only ever populated on a "rent" order, so these are
  // no-ops on every buy order (kept separate from price for the reasons noted
  // on the dealType gate above).
  if (criteria.rentMin && listing.rent != null && listing.rent < criteria.rentMin) {
    incrementReason(reasons, "賃料下限未満");
    return [false, "賃料下限未満"];
  }
  if (criteria.rentMax && listing.rent != null && listing.rent > criteria.rentMax) {
    incrementReason(reasons, "賃料上限超過");
    return [false, "賃料上限超過"];
  }
  if (
    criteria.maxDeposit != null &&
    listing.deposit != null &&
    listing.deposit > criteria.maxDeposit
  ) {
    incrementReason(reasons, "敷金上限超過");
    return [false, "敷金上限超過"];
  }
  if (
    criteria.maxKeyMoney != null &&
    listing.keyMoney != null &&
    listing.keyMoney > criteria.maxKeyMoney
  ) {
    incrementReason(reasons, "礼金上限超過");
    return [false, "礼金上限超過"];
  }
  if (criteria.petsRequired && listing.petsAllowed === false) {
    incrementReason(reasons, "ペット不可");
    return [false, "ペット不可"];
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
    if (
      !listing.propertyType ||
      !propertyTypeMatches(
        listing.propertyType,
        criteria.propertyTypes,
        `${listing.title ?? ""}${listing.description ?? ""}`,
      )
    ) {
      incrementReason(reasons, "物件種別不一致");
      return [false, "物件種別不一致"];
    }
  }

  // オーナーチェンジ (賃貸中のまま売却). Only applied when the buyer explicitly
  // asked for it — it is a hard requirement then, since a vacant unit is simply
  // not the product they want. Detection is text-based (see OWNER_CHANGE_RE), so
  // it only finds listings whose title/description actually say so; portals that
  // bury the tenancy in a detail page will be missed rather than guessed at.
  if (criteria.ownerChange) {
    if (!looksOwnerChange(listing)) {
      incrementReason(reasons, "オーナーチェンジ物件でない");
      return [false, "オーナーチェンジ物件でない"];
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