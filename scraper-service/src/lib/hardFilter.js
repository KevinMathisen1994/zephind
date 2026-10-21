/**
 * Deterministic hard-filter matching, ported from
 * scraper-service/src/services/propertyMatcher.ts's matchesOrder().
 *
 * WHY A SEPARATE JS PORT (same reasoning as convex/lib/scoring.js)
 * ------------------------------------------------------------------
 * Scraped listings are matched by scraper-service (a Node/TS process that only
 * runs on someone's laptop or inside a GitHub Actions job) — fine for a scrape
 * that's triggered on demand. Emails arrive continuously and need to be matched
 * the moment they're synced, from a Convex scheduled function, with no laptop
 * or GitHub run involved. That means this logic has to live where the sync
 * runs: here.
 *
 * This is a TRIMMED port — it covers the checks that matter for a broker's
 * emailed listing (buy-side: ward, price, type, area, yield, build age,
 * structure, road width, walk time). Rental-specific criteria (rentMin/Max,
 * deposit/keyMoney/pets) and a few of the more niche buy fields
 * (ownerChange text-detection, layoutTypes normalization) are deliberately
 * left out — an emailed 物件紹介 is not going to be a room-by-room rental
 * listing, and if this needs to grow to cover more criteria later, mirror the
 * corresponding block in propertyMatcher.ts exactly rather than improvising.
 *
 * If propertyMatcher.ts's rules change, this needs the same change made here
 * by hand — there is no shared source between the TS scraper service and this
 * Convex deployment's JS runtime.
 */

function canonicalPropertyType(raw) {
  const t = (raw || "").replace(/\s/g, "");
  if (/土地|宅地|用地/.test(t)) return "土地";
  if (/アパート/.test(t)) return "アパート";
  if (/(一棟|1棟|１棟)/.test(t) && /マンション/.test(t)) return "一棟マンション";
  if (/マンション/.test(t)) return "マンション";
  if (/戸建|一戸建て|テラスハウス|タウンハウス|貸家/.test(t)) return "一戸建て";
  if (/ビル/.test(t)) return "ビル";
  if (/店舗|事務所/.test(t)) return "店舗";
  return t;
}

const WHOLE_BUILDING_RE = /(一棟|1棟|１棟)(売|マンション|アパート|ビル)|一棟売/;

function propertyTypeMatches(listingType, wantedTypes, context) {
  const canon = canonicalPropertyType(listingType);
  const haystack = `${listingType}${context || ""}`.replace(/\s/g, "");
  const isWholeBuilding = WHOLE_BUILDING_RE.test(haystack);

  for (const wanted of wantedTypes) {
    const wc = canonicalPropertyType(wanted);
    if (wc === canon) return true;
    const lt = canon.toLowerCase();
    const wl = wc.toLowerCase();
    if (lt.includes(wl) || wl.includes(lt)) return true;
    if (wc === "一棟マンション" && canon === "マンション" && isWholeBuilding) return true;
  }
  return false;
}

function incrementReason(reasons, reason) {
  reasons[reason] = (reasons[reason] || 0) + 1;
}

/** @returns {[boolean, string|null]} */
function matchesOrder(listing, criteria, reasons) {
  const orderDealType = criteria.dealType || "buy";
  const listingDealType = listing.dealType || "buy";
  if (orderDealType !== listingDealType) {
    incrementReason(reasons, "取引種別不一致（買う/借りる）");
    return [false, "取引種別不一致（買う/借りる）"];
  }

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
        (listing.ward === target || target.includes(listing.ward) || listing.ward.includes(target))
      ) {
        return true;
      }
      if (listing.address && listing.address.includes(target)) return true;
      return false;
    });
    if (!isMatched) {
      incrementReason(reasons, "エリア不一致");
      return [false, "エリア不一致"];
    }
  }

  if (criteria.priceMin && listing.price != null && listing.price < criteria.priceMin) {
    incrementReason(reasons, "価格下限未満");
    return [false, "価格下限未満"];
  }
  if (criteria.priceMax && listing.price != null && listing.price > criteria.priceMax) {
    incrementReason(reasons, "価格上限超過");
    return [false, "価格上限超過"];
  }

  if (criteria.walkMinutes && listing.walkMinutes != null) {
    if (listing.walkMinutes > criteria.walkMinutes) {
      incrementReason(reasons, "徒歩分数超過");
      return [false, "徒歩分数超過"];
    }
  }

  if (criteria.minBuildingCoverageRatio && listing.buildingCoverageRatio != null) {
    if (listing.buildingCoverageRatio < criteria.minBuildingCoverageRatio) {
      incrementReason(reasons, "建ぺい率未満");
      return [false, "建ぺい率未満"];
    }
  }
  if (criteria.minFloorAreaRatio && listing.floorAreaRatio != null) {
    if (listing.floorAreaRatio < criteria.minFloorAreaRatio) {
      incrementReason(reasons, "容積率未満");
      return [false, "容積率未満"];
    }
  }

  if (criteria.propertyTypes && criteria.propertyTypes.length > 0) {
    if (
      !listing.propertyType ||
      !propertyTypeMatches(listing.propertyType, criteria.propertyTypes, `${listing.title || ""}${listing.description || ""}`)
    ) {
      incrementReason(reasons, "物件種別不一致");
      return [false, "物件種別不一致"];
    }
  }

  if (criteria.landSizeMin && listing.landSize != null && listing.landSize < criteria.landSizeMin) {
    incrementReason(reasons, "土地面積下限未満");
    return [false, "土地面積下限未満"];
  }
  if (criteria.landSizeMax && listing.landSize != null && listing.landSize > criteria.landSizeMax) {
    incrementReason(reasons, "土地面積上限超過");
    return [false, "土地面積上限超過"];
  }

  if (criteria.buildingSizeMin && listing.area != null && listing.area < criteria.buildingSizeMin) {
    incrementReason(reasons, "建物面積下限未満");
    return [false, "建物面積下限未満"];
  }
  if (criteria.buildingSizeMax && listing.area != null && listing.area > criteria.buildingSizeMax) {
    incrementReason(reasons, "建物面積上限超過");
    return [false, "建物面積上限超過"];
  }

  if (criteria.maxBuildAge != null && listing.buildYear != null) {
    const age = new Date().getFullYear() - listing.buildYear;
    if (age > criteria.maxBuildAge) {
      incrementReason(reasons, "築年数超過");
      return [false, "築年数超過"];
    }
  }
  if (criteria.minBuildYear != null && listing.buildYear != null && listing.buildYear < criteria.minBuildYear) {
    incrementReason(reasons, "築年下限未満");
    return [false, "築年下限未満"];
  }

  if (criteria.minYield != null && listing.yield != null && listing.yield < criteria.minYield) {
    incrementReason(reasons, "利回り未満");
    return [false, "利回り未満"];
  }
  if (criteria.maxYield != null && listing.yield != null && listing.yield > criteria.maxYield) {
    incrementReason(reasons, "利回り超過");
    return [false, "利回り超過"];
  }

  if (criteria.minRoadWidth != null && listing.roadWidth != null && listing.roadWidth < criteria.minRoadWidth) {
    incrementReason(reasons, "道路幅員未満");
    return [false, "道路幅員未満"];
  }

  if (criteria.minTotalUnits != null && listing.totalUnits != null && listing.totalUnits < criteria.minTotalUnits) {
    incrementReason(reasons, "総戸数未満");
    return [false, "総戸数未満"];
  }
  if (criteria.maxFloor != null && listing.floor != null && listing.floor > criteria.maxFloor) {
    incrementReason(reasons, "階数超過");
    return [false, "階数超過"];
  }
  if (criteria.excludeFirstFloor && listing.floor != null && listing.floor <= 1) {
    incrementReason(reasons, "一階");
    return [false, "一階"];
  }
  if (criteria.minElevators != null && listing.elevators != null && listing.elevators < criteria.minElevators) {
    incrementReason(reasons, "エレベーター数未満");
    return [false, "エレベーター数未満"];
  }

  if (criteria.structureTypes && criteria.structureTypes.length > 0) {
    if (!listing.structureType || !criteria.structureTypes.includes(listing.structureType)) {
      incrementReason(reasons, "構造種別不一致");
      return [false, "構造種別不一致"];
    }
  }

  return [true, null];
}

/**
 * @param {object} listing
 * @param {object[]} criteriaList one per order, in the SAME order as the
 *   orders array the caller passed — the returned indices index into it.
 * @returns {{matchedOrderIndices: number[], reasons: Record<string, number>}}
 */
export function matchOrders(listing, criteriaList) {
  const reasons = {};
  const matchedOrderIndices = [];
  for (let i = 0; i < criteriaList.length; i++) {
    const [matched] = matchesOrder(listing, criteriaList[i] || {}, reasons);
    if (matched) matchedOrderIndices.push(i);
  }
  return { matchedOrderIndices, reasons };
}
