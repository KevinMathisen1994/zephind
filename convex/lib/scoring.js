/**
 * Deterministic, investment-return-focused match scoring.
 *
 * Pure module: no Convex/network imports, so it can be unit-tested directly
 * with `node`. `convex/evaluate.js` imports `computeMatchScore` and treats its
 * output as the AUTHORITATIVE score. The LLM writes prose only — it no longer
 * reports the number. (Previously the saved score was parsed out of the model's
 * own text, which made this whole file dead code and produced a score that
 * drifted 10+ points between identical runs.)
 *
 * THE SCORE ANSWERS "how much can the client earn on this", not "how well does
 * this match stated preferences" — the two are related but not the same thing,
 * and conflating them used to mean a listing that ticked every box but was
 * priced 35% over real market comps could still outscore a genuine bargain.
 * Requirement fit still matters, but only as a small tie-breaker (see
 * `fitShare` below) among listings that are otherwise similarly profitable —
 * deal-breaking preferences (wrong ward/type/over budget/etc) are handled
 * separately as hard disqualifiers, since a listing the client can't or won't
 * buy earns nothing regardless of its paper return.
 *
 * Layers, in the order a broker actually applies them:
 *   1. Hard disqualifiers  -> cap the final score, cannot be compensated for
 *   2. Requirement fit     -> small, secondary weight — a tie-breaker, not the driver
 *   3. Investment return    -> DOMINANT layer: undervaluation vs MLIT comps and
 *                              yield are the direct earning signals; walk time,
 *                              amenities, road width and ward prestige are
 *                              modifiers on whether that return is realizable
 *                              (vacancy risk, rebuildability, exit liquidity),
 *                              not earning signals themselves, so they weigh less
 *   4. Unverifiable fields -> moderate sub-score + explicit flags + a top-end cap
 */

export const WARD_CODE_MAP = {
  千代田区: "13101",
  中央区: "13102",
  港区: "13103",
  新宿区: "13104",
  文京区: "13105",
  台東区: "13106",
  墨田区: "13107",
  江東区: "13108",
  品川区: "13109",
  目黒区: "13110",
  大田区: "13111",
  世田谷区: "13112",
  渋谷区: "13113",
  中野区: "13114",
  杉並区: "13115",
  豊島区: "13116",
  北区: "13117",
  荒川区: "13118",
  板橋区: "13119",
  練馬区: "13120",
  足立区: "13121",
  葛飾区: "13122",
  江戸川区: "13123",
  八王子市: "13201",
  立川市: "13202",
  武蔵野市: "13203",
  三鷹市: "13204",
  青梅市: "13205",
  府中市: "13206",
  昭島市: "13207",
  調布市: "13208",
  町田市: "13209",
  小金井市: "13210",
  小平市: "13211",
  日野市: "13212",
  東村山市: "13213",
  国分寺市: "13214",
  国立市: "13215",
  福生市: "13218",
  狛江市: "13219",
  東大和市: "13220",
  清瀬市: "13221",
  東久留米市: "13222",
  武蔵村山市: "13223",
  多摩市: "13224",
  稲城市: "13225",
  羽村市: "13227",
  あきる野市: "13228",
  西東京市: "13229",
  // 郡部（西多摩郡）— the frontend's ward picker offers these, so an order can
  // target them; without the codes here the MLIT comps lookup silently returns
  // null and those listings lose their market-quality signal entirely.
  瑞穂町: "13303",
  日の出町: "13305",
  檜原村: "13307",
  奥多摩町: "13308",
  // 島嶼部（伊豆諸島・小笠原諸島）
  大島町: "13361",
  利島村: "13362",
  新島村: "13363",
  神津島村: "13364",
  三宅村: "13381",
  御蔵島村: "13382",
  八丈町: "13401",
  青ヶ島村: "13402",
  小笠原村: "13421",
};

const CODE_TO_WARD = Object.fromEntries(
  Object.entries(WARD_CODE_MAP).map(([name, code]) => [code, name]),
);

const WARD_NAMES = Object.keys(WARD_CODE_MAP);

export const PREMIUM_WARDS = [
  "港区",
  "千代田区",
  "中央区",
  "渋谷区",
  "新宿区",
  "文京区",
];

export function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

/**
 * Listing `ward` values in this dataset are inconsistent: some are proper names
 * ("港区"), ~28% are raw MLIT city codes ("13212"), some are blank, and some are
 * truncated ("京都町田市" — a dropped 東). Everything downstream (ward matching AND
 * the MLIT comps lookup) keys off this field, so normalize once, here.
 * Returns a canonical ward name or null.
 */
export function normalizeWard(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  if (CODE_TO_WARD[s]) return CODE_TO_WARD[s]; // "13212" -> "日野市"
  if (WARD_CODE_MAP[s]) return s; // already canonical

  const stripped = s.replace(/^東京都/, "");
  if (WARD_CODE_MAP[stripped]) return stripped;

  // Truncated/prefixed forms: "京都町田市" -> "町田市". Prefer the longest match
  // so "東大和市" wins over "大和市"-style partials.
  const hit = WARD_NAMES.filter((w) => s.includes(w)).sort(
    (a, b) => b.length - a.length,
  )[0];
  return hit || null;
}

/** MLIT city code for a listing's ward, tolerating codes/blank/truncated input. */
export function wardCityCode(rawWard) {
  const name = normalizeWard(rawWard);
  return name ? WARD_CODE_MAP[name] : null;
}

/**
 * Maps a listing's free-text propertyType to the MLIT XIT001 "Type" bucket it
 * should be compared against. Averaging land trades in with condo trades (the
 * old behavior) produced a market price meaningless for either.
 */
export function mlitTypeForListing(propertyType) {
  const t = propertyType || "";
  if (t.includes("マンション")) return "中古マンション等";
  if (["土地", "用地", "宅地"].some((x) => t.includes(x)) && !t.includes("戸建")) {
    return "宅地(土地)";
  }
  return "宅地(土地と建物)";
}

// A specified-but-unconfirmable requirement is a risk, not a pass and not a
// failure. It lands mid-scale and is reported separately in `unverified`.
const UNVERIFIED = 0.5;

// Requirement weights. Price and location dominate; "こだわり" preferences trail.
const W = {
  ward: 22,
  price: 25,
  propertyType: 12,
  yield: 14,
  area: 10,
  landSize: 10,
  walk: 10,
  roadWidth: 10,
  structure: 6,
  buildAge: 6,
  floor: 4,
  elevators: 4,
  totalUnits: 4,
  // Rental-only (mutually exclusive with price/yield/landSize/roadWidth above
  // — a listing is never both, see the schema comment on orders.dealType).
  rent: 25, // mirrors price's weight — the equivalent budget fit for 借りる
  deposit: 4,
  keyMoney: 4,
};

/**
 * @param {object} listing  raw listing fields (all optional)
 * @param {object} criteria buyer orderCriteria (all optional)
 * @param {object} ctx      { marketAvgPrice, marketAvgPricePerSqm, amenityCount }
 */
export function computeMatchScore(listing = {}, criteria = {}, ctx = {}) {
  const { marketAvgPrice = null, marketAvgPricePerSqm = null, amenityCount = null } = ctx;

  const fit = []; // {key, weight, score}
  const market = []; // {key, weight, score}
  const unverified = []; // human-readable "needs verification" list
  const disqualifiers = []; // {reason, cap}
  const caps = [];

  const disqualify = (reason, cap) => {
    disqualifiers.push({ reason, cap });
    caps.push(cap);
  };
  const need = (key, weight, score) => fit.push({ key, weight, score });
  const cannotVerify = (key, weight, label) => {
    fit.push({ key, weight, score: UNVERIFIED });
    unverified.push(label);
  };

  const listingWard = normalizeWard(listing.ward);
  const hasCriteria = criteria && Object.keys(criteria).length > 0;

  // ---------------------------------------------------------------- LAYER 1+2
  // --- Location -------------------------------------------------------------
  if (criteria.wards?.length) {
    const wanted = criteria.wards.map(normalizeWard).filter(Boolean);
    if (listingWard || listing.address) {
      const match = wanted.some(
        (w) => w === listingWard || (listing.address || "").includes(w),
      );
      need("ward", W.ward, match ? 1 : 0);
      if (!match) {
        // Wrong area with a defined target area: nothing else compensates.
        disqualify(`所在エリア（${listingWard || listing.address}）が希望エリア外`, 18);
      }
    } else {
      cannotVerify("ward", W.ward, "所在地（区市町村）が未記載");
    }
  }

  // --- Price ----------------------------------------------------------------
  if (criteria.priceMax || criteria.priceMin) {
    if (listing.price != null) {
      let s = 1;
      if (criteria.priceMax) {
        const r = listing.price / criteria.priceMax;
        s = r <= 1 ? 1 : clamp01(1 - (r - 1) * 3);
        // Graduated overshoot: a 5% stretch is negotiable, 50% is a different listing.
        if (r > 1.5) disqualify(`予算を50%超過（${listing.price}万円 / 上限${criteria.priceMax}万円）`, 25);
        else if (r > 1.25) disqualify(`予算を25%超過（${listing.price}万円 / 上限${criteria.priceMax}万円）`, 48);
      }
      if (criteria.priceMin && listing.price < criteria.priceMin) {
        // Well under budget usually means a different tier, not a bargain.
        s = Math.min(s, clamp01(0.4 + 0.6 * (listing.price / criteria.priceMin)));
      }
      need("price", W.price, s);
    } else {
      cannotVerify("price", W.price, "価格が未記載");
    }
  }

  // --- Rent (借りる — mutually exclusive with price/yield above) -----------
  if (criteria.rentMax || criteria.rentMin) {
    if (listing.rent != null) {
      let s = 1;
      if (criteria.rentMax) {
        const r = listing.rent / criteria.rentMax;
        s = r <= 1 ? 1 : clamp01(1 - (r - 1) * 3);
        if (r > 1.5) disqualify(`予算を50%超過（${listing.rent}万円/月 / 上限${criteria.rentMax}万円/月）`, 25);
        else if (r > 1.25) disqualify(`予算を25%超過（${listing.rent}万円/月 / 上限${criteria.rentMax}万円/月）`, 48);
      }
      if (criteria.rentMin && listing.rent < criteria.rentMin) {
        s = Math.min(s, clamp01(0.4 + 0.6 * (listing.rent / criteria.rentMin)));
      }
      need("rent", W.rent, s);
    } else {
      cannotVerify("rent", W.rent, "賃料が未記載");
    }
  }
  // 敷金/礼金: hardFilter (propertyMatcher.ts) already hard-rejects anything
  // over the buyer's ceiling before a listing ever reaches scoring, so this is
  // purely a soft tie-breaker among listings that already passed — lower is
  // still nicer even when both are under the cap.
  if (criteria.maxDeposit != null && listing.deposit != null) {
    need("deposit", W.deposit, clamp01(1 - listing.deposit / (criteria.maxDeposit || 1) * 0.5));
  }
  if (criteria.maxKeyMoney != null && listing.keyMoney != null) {
    need("keyMoney", W.keyMoney, clamp01(1 - listing.keyMoney / (criteria.maxKeyMoney || 1) * 0.5));
  }
  if (criteria.petsRequired) {
    if (listing.petsAllowed != null) need("pets", 6, listing.petsAllowed ? 1 : 0);
    else cannotVerify("pets", 6, "ペット可否が未記載");
  }

  // --- Property type --------------------------------------------------------
  if (criteria.propertyTypes?.length) {
    if (listing.propertyType) {
      const lt = listing.propertyType.toLowerCase();
      const landOrder = criteria.propertyTypes.some(
        (t) => t.includes("土地") || t.includes("用地"),
      );
      const landListing = ["土地", "用地", "宅地"].some((t) =>
        listing.propertyType.includes(t),
      );
      // Substring match in BOTH directions. Portals label the same product at
      // different granularity — a 一棟売マンション is often listed as plain
      // "マンション" — so a one-way `listing.includes(wanted)` test dropped a
      // 28-point disqualification on listings the buyer would happily look at.
      // The scraper's hardFilter is where the strict type decision belongs; this
      // score is a ranking signal on listings that already passed it.
      const match =
        criteria.propertyTypes.some((t) => {
          const wanted = t.toLowerCase();
          return lt.includes(wanted) || wanted.includes(lt);
        }) ||
        (landOrder && landListing);
      need("propertyType", W.propertyType, match ? 1 : 0);
      if (!match)
        disqualify(`物件種別が不一致（${listing.propertyType} / 希望: ${criteria.propertyTypes.join("・")}）`, 28);
    } else {
      cannotVerify("propertyType", W.propertyType, "物件種別が未記載");
    }
  }

  // --- Yield ----------------------------------------------------------------
  if (criteria.minYield) {
    if (listing.yield != null) {
      const r = listing.yield / criteria.minYield;
      need("yield", W.yield, r >= 1 ? 1 : clamp01(r * r)); // falls off fast below target
    } else {
      cannotVerify("yield", W.yield, "利回りが未記載（要確認）");
    }
  }
  if (criteria.maxYield && listing.yield != null && listing.yield > criteria.maxYield) {
    need("yieldCeiling", 4, clamp01(1 - (listing.yield - criteria.maxYield) / criteria.maxYield));
  }

  // --- Floor / unit area (not meaningful for raw land) ----------------------
  const isLand = ["土地", "用地", "宅地"].some((t) =>
    (listing.propertyType || "").includes(t),
  );
  if ((criteria.areaMin || criteria.areaMax) && !isLand) {
    if (listing.area != null) {
      need("area", W.area, rangeScore(listing.area, criteria.areaMin, criteria.areaMax));
    } else {
      cannotVerify("area", W.area, "専有/延床面積が未記載");
    }
  }

  // --- Land size (scrapers often park plot size in `area` for 土地/戸建て) ----
  if (criteria.landSizeMin || criteria.landSizeMax) {
    const size = listing.landSize ?? (isLand ? listing.area : null);
    if (size != null) {
      need("landSize", W.landSize, rangeScore(size, criteria.landSizeMin, criteria.landSizeMax));
    } else {
      cannotVerify("landSize", W.landSize, "土地面積が未記載");
    }
  }

  // --- Walk time ------------------------------------------------------------
  if (criteria.walkMinutesMax) {
    if (listing.walkMinutes != null) {
      const over = listing.walkMinutes - criteria.walkMinutesMax;
      need("walk", W.walk, over <= 0 ? 1 : clamp01(1 - over / 10));
    } else {
      cannotVerify("walk", W.walk, "駅徒歩分数が未記載");
    }
  }

  // --- Road width (a genuine dealbreaker for many intended uses) ------------
  if (criteria.minRoadWidth) {
    if (listing.roadWidth != null) {
      const pass = listing.roadWidth >= criteria.minRoadWidth;
      need("roadWidth", W.roadWidth, pass ? 1 : clamp01(listing.roadWidth / criteria.minRoadWidth - 0.2));
      if (!pass)
        disqualify(`前面道路幅員が不足（${listing.roadWidth}m / 必要${criteria.minRoadWidth}m）`, 32);
    } else {
      cannotVerify("roadWidth", W.roadWidth, "前面道路幅員が未記載（現地・役所調査要）");
    }
  }

  // --- Structure ------------------------------------------------------------
  if (criteria.structureTypes?.length) {
    if (listing.structure) {
      const ls = listing.structure.toLowerCase();
      need("structure", W.structure, criteria.structureTypes.some((s) => ls.includes(s.toLowerCase())) ? 1 : 0);
    } else {
      cannotVerify("structure", W.structure, "構造が未記載");
    }
  }

  // --- Build age ------------------------------------------------------------
  if (criteria.maxBuildAge) {
    if (listing.buildYear) {
      const age = (ctx.currentYear ?? new Date().getFullYear()) - listing.buildYear;
      need("buildAge", W.buildAge, age <= criteria.maxBuildAge ? 1 : clamp01(1 - (age - criteria.maxBuildAge) / criteria.maxBuildAge));
    } else if (!isLand) {
      cannotVerify("buildAge", W.buildAge, "築年が未記載");
    }
  }
  if (criteria.minBuildYear && listing.buildYear && listing.buildYear < criteria.minBuildYear) {
    need("buildYear", 4, clamp01(1 - (criteria.minBuildYear - listing.buildYear) / 10));
  }

  // --- こだわり条件 ----------------------------------------------------------
  if (criteria.excludeFirstFloor) {
    if (listing.floor != null) need("floor", W.floor, listing.floor === 1 ? 0 : 1);
    else cannotVerify("floor", W.floor, "所在階が未記載");
  }
  if (criteria.maxFloor) {
    if (listing.floor != null) need("maxFloor", 3, listing.floor <= criteria.maxFloor ? 1 : 0);
    else cannotVerify("maxFloor", 3, "所在階が未記載");
  }
  if (criteria.minElevators) {
    if (listing.elevators != null) need("elevators", W.elevators, listing.elevators >= criteria.minElevators ? 1 : 0.3);
    else cannotVerify("elevators", W.elevators, "エレベーター基数が未記載");
  }
  if (criteria.minTotalUnits) {
    if (listing.totalUnits != null)
      need("totalUnits", W.totalUnits, listing.totalUnits >= criteria.minTotalUnits ? 1 : clamp01(listing.totalUnits / criteria.minTotalUnits));
    else cannotVerify("totalUnits", W.totalUnits, "総戸数が未記載");
  }

  // ------------------------------------------------------------------ LAYER 3
  // Investment-return signal, independent of what the buyer asked for. This is
  // now the DOMINANT layer (see fitShare below): the score is meant to answer
  // "how much can the client earn on this", not just "does it match their
  // stated preferences". The two heaviest weights below (vsMarket, yieldQuality)
  // are the direct earning signals — undervaluation is realizable profit on
  // resale/refinance, yield is realizable income. The rest are modifiers on
  // whether that paper return is actually realizable (rentability/vacancy risk,
  // exit liquidity), not earning signals in themselves, so they carry less.

  // Price vs real MLIT ward comps. Buying below comps IS the return: it is
  // either instant resale/refinance equity or a lower cost basis under the same
  // rent roll, i.e. a straightforwardly higher effective yield.
  // When unit area and average price per ㎡ are available, comparing price per ㎡
  // prevents small units from falsely scoring as bargains and prevents large units
  // from being unfairly disqualified as overpriced.
  const listingArea = isLand
    ? (listing.landSize ?? listing.area)
    : (listing.area ?? listing.landSize);
  const usePpsm =
    marketAvgPricePerSqm != null &&
    listingArea != null &&
    listingArea > 0 &&
    listing.price != null;

  if (usePpsm) {
    const listingPpsm = listing.price / listingArea;
    const r = listingPpsm / marketAvgPricePerSqm;
    const ppsmRound = Math.round(listingPpsm * 10) / 10;
    const expectedPrice = Math.round(marketAvgPricePerSqm * listingArea);

    const suspicious = r < 0.25;
    const s = suspicious
      ? 0.55
      : r <= 0.7 ? 1 : r <= 0.85 ? 0.88 : r <= 1.0 ? 0.72 : r <= 1.1 ? 0.55
      : r <= 1.25 ? 0.35 : r <= 1.5 ? 0.18 : 0.05;
    market.push({
      key: "vsMarket",
      weight: 40,
      score: s,
      mode: "ppsm",
      pricePerSqm: ppsmRound,
      marketAvgPricePerSqm,
      expectedPrice,
      ratio: +r.toFixed(2),
    });
    if (suspicious) {
      unverified.push(
        `平米単価が区相場単価（${marketAvgPricePerSqm}万円/㎡）の25%未満（当物件: ${ppsmRound}万円/㎡） — 借地権・再建築不可・持分等の可能性、要確認`,
      );
    }
    if (r > 1.5) {
      disqualify(
        `相場単価比+50%超の割高（単価${ppsmRound}万円/㎡・総額${listing.price}万円 / 相場単価${marketAvgPricePerSqm}万円/㎡・想定相場${expectedPrice}万円）`,
        58,
      );
    } else if (r > 1.3) {
      disqualify(
        `相場単価比+30%超の割高（単価${ppsmRound}万円/㎡・総額${listing.price}万円 / 相場単価${marketAvgPricePerSqm}万円/㎡・想定相場${expectedPrice}万円）`,
        72,
      );
    }
  } else if (marketAvgPrice && listing.price != null) {
    const r = listing.price / marketAvgPrice;
    // A price far below ward comps is far more often bad data or an encumbrance
    // (借地権, 再建築不可, 持分売買) than a genuine bargain. Don't hand it a
    // top market score — treat it as something to verify. This showed up in the
    // real batch as a 980万円 渋谷区 house outranking sound listings.
    const suspicious = r < 0.25;
    const s = suspicious
      ? 0.55
      : r <= 0.7 ? 1 : r <= 0.85 ? 0.88 : r <= 1.0 ? 0.72 : r <= 1.1 ? 0.55
      : r <= 1.25 ? 0.35 : r <= 1.5 ? 0.18 : 0.05;
    market.push({
      key: "vsMarket",
      weight: 40,
      score: s,
      mode: "gross",
      listingPrice: listing.price,
      marketAvgPrice,
      ratio: +r.toFixed(2),
    });
    if (suspicious) {
      unverified.push(
        `価格が区平均（${marketAvgPrice}万円）の25%未満 — 借地権・再建築不可・持分等の可能性、要確認`,
      );
    }
    // Being well above real recent comps is its own problem, independent of the
    // buyer's ceiling: a broker won't call an overpriced listing a strong buy
    // just because the client could technically afford it.
    if (r > 1.5) disqualify(`相場比+50%超の割高（${listing.price}万円 / 区平均${marketAvgPrice}万円）`, 58);
    else if (r > 1.3) disqualify(`相場比+30%超の割高（${listing.price}万円 / 区平均${marketAvgPrice}万円）`, 72);
  }

  // 表面利回り — the direct annual income return. Absent for owner-occupier
  // product (plain マンション/一戸建て listings rarely publish one), which is
  // fine: it simply drops out of the weighted average below rather than
  // scoring as zero.
  if (listing.yield != null) {
    const y = listing.yield;
    const s = y >= 9 ? 1 : y >= 7 ? 0.85 : y >= 5.5 ? 0.65 : y >= 4 ? 0.45 : clamp01(y / 10);
    market.push({ key: "yieldQuality", weight: 30, score: s });
  }

  // Walk time is a REALIZATION modifier on the return above, not a return
  // itself: a far walk means higher vacancy risk / lower achievable rent, which
  // is exactly how it eats into a paper yield. Weighted well below the two
  // direct-earning signals.
  if (listing.walkMinutes != null) {
    const m = listing.walkMinutes;
    const s = m <= 3 ? 1 : m <= 5 ? 0.9 : m <= 7 ? 0.8 : m <= 10 ? 0.65 : m <= 15 ? 0.45 : clamp01(0.45 - (m - 15) / 25);
    market.push({ key: "walkQuality", weight: 15, score: s });
  }

  // Amenity density is the same kind of modifier: it supports occupancy/rent,
  // it doesn't generate return on its own.
  if (amenityCount != null) {
    const n = amenityCount;
    const s = n >= 40 ? 1 : n >= 25 ? 0.85 : n >= 12 ? 0.7 : n >= 5 ? 0.5 : 0.3;
    market.push({ key: "amenities", weight: 8, score: s });
  }

  // A premium ward is a proxy for capital preservation / exit liquidity — an
  // investment property is only as good as its resale market.
  if (listingWard && PREMIUM_WARDS.includes(listingWard)) {
    market.push({ key: "premiumWard", weight: 12, score: 1 });
  }

  // Road width mostly matters for land/house rebuildability (資産性), a minor
  // modifier here rather than a return signal.
  if (listing.roadWidth != null) {
    const w = listing.roadWidth;
    market.push({ key: "roadQuality", weight: 5, score: w >= 6 ? 1 : w >= 4 ? 0.7 : w >= 2.7 ? 0.4 : 0.15 });
  }

  // Price drop signal: strong indicator of seller motivation and discount opportunity
  const hasPriceDrop = listing.priceDropped || (listing.previousPrice != null && listing.price != null && listing.price < listing.previousPrice);
  if (hasPriceDrop) {
    const prev = listing.previousPrice;
    const dropPct = listing.priceDropPct ?? (prev && listing.price ? +(((prev - listing.price) / prev) * 100).toFixed(1) : 0);
    if (dropPct > 0) {
      const s = dropPct >= 10 ? 1.0 : dropPct >= 5 ? 0.85 : 0.7;
      market.push({
        key: "priceDrop",
        weight: 12,
        score: s,
        previousPrice: prev,
        currentPrice: listing.price,
        dropPct,
      });
    }
  }

  // Disaster / Hazard Safety modifier:
  // Flood inundation depth and ground stability directly affect asset preservation,
  // insurance premiums, building longevity, and vacancy risk during extreme weather.
  if (listing.hazardRisk) {
    if (listing.hazardRisk === "safe") {
      market.push({
        key: "hazardSafety",
        weight: 10,
        score: 1.0,
        label: listing.hazardLabel || "良好地盤・低水害リスク",
      });
    } else if (listing.hazardRisk === "medium") {
      market.push({
        key: "hazardSafety",
        weight: 10,
        score: 0.6,
        label: listing.hazardLabel || "浸水・地盤要確認",
      });
    } else if (listing.hazardRisk === "high") {
      market.push({
        key: "hazardSafety",
        weight: 10,
        score: 0.2,
        label: listing.hazardLabel || "高浸水・土砂災害警戒",
      });
      unverified.push(
        `【ハザード高警戒】${listing.hazardLabel || "浸水想定区域"} — 1階住戸浸水・受変電設備位置・避難経路の事前確認必須`,
      );
      // High hazard property caps the maximum score so severe flood zone
      // properties cannot score above 84 without buyer awareness
      caps.push(84);
    }
  }

  // Cross-reference buyer preference for excludeFirstFloor with hazard flood risk
  if (criteria.excludeFirstFloor && listing.hazardRisk === "high" && (listing.floor === 1 || listing.floor == null)) {
    unverified.push("【高浸水警戒・1階リスク】高浸水想定エリアかつ1階（または所在階未確認）のため浸水・資産性リスク要精査");
  }

  // ------------------------------------------------------------------ COMBINE
  const fitPct = weighted(fit);
  const marketPct = weighted(market);

  // The score is primarily an earning-potential score (marketPct above), not a
  // buyer-preference-fit score. Requirement fit still gets a SMALL, secondary
  // say (a tie-breaker among similarly-profitable listings) — deal-breaking
  // preferences (wrong ward/type/budget/road width) are handled separately as
  // hard disqualifiers above and already cap the score regardless of this
  // share, since a listing the client can't/won't buy earns nothing.
  const specifiedWeight = fit.reduce((a, c) => a + c.weight, 0);
  const specDepth = clamp01(specifiedWeight / 100);
  const fitShare = 0.1 + 0.15 * specDepth;

  let pct;
  if (fitPct != null && marketPct != null) pct = fitShare * fitPct + (1 - fitShare) * marketPct;
  else if (fitPct != null) pct = fitPct;
  else if (marketPct != null) pct = marketPct;
  else pct = 0.4; // nothing at all to judge on

  // How much do we actually know about this listing? Confidence is not merit:
  // a mostly-blank listing regresses toward the middle rather than riding the
  // few fields that happen to look good.
  // Rent listings never carry price/yield/roadWidth (they're buy-only
  // fields) — using the buy CORE list here would unfairly read every rental
  // as "mostly blank" regardless of how complete its own listing actually is.
  const CORE = listing.dealType === "rent"
    ? ["rent", "ward", "propertyType", "walkMinutes", "managementFee", "buildYear", "structure", "deposit"]
    : ["price", "ward", "propertyType", "walkMinutes", "yield", "roadWidth", "buildYear", "structure"];
  let known = CORE.filter((k) => listing[k] != null && listing[k] !== "").length;
  if (listing.area != null || listing.landSize != null) known += 1;
  const completeness = known / (CORE.length + 1);
  // Smooth, not a cap: a hard ceiling here piled listings onto one exact value
  // (the very clustering this rewrite exists to remove).
  const trust = 0.3 + 0.7 * completeness;
  pct = pct * trust + 0.5 * (1 - trust);

  let score = Math.round(8 + pct * 88);

  // ------------------------------------------------------------------ LAYER 4
  // Hard disqualifiers cap, they do not subtract — strengths must not buy back
  // a wrong-area or wrong-type listing.
  for (const cap of caps) score = Math.min(score, cap);

  // Unverified requirements keep a listing out of the top band: a broker will
  // not call something a 95 when the buyer's hard requirement is unconfirmed.
  if (unverified.length > 0) score = Math.min(score, 84);
  if (unverified.length >= 4) score = Math.min(score, 72);

  score = Math.max(5, Math.min(97, score));

  return {
    score,
    fitPct,
    marketPct,
    completeness: +completeness.toFixed(2),
    unverified,
    disqualifiers,
    breakdown: {
      requirement: fit.map((f) => ({ ...f, contribution: +(f.weight * f.score).toFixed(1) })),
      market: market.map((m) => ({ ...m, contribution: +(m.weight * m.score).toFixed(1) })),
    },
    hasCriteria,
    listingWard,
  };
}

function rangeScore(value, min, max) {
  let s = 1;
  if (max && value > max) s = clamp01(1 - (value - max) / max);
  if (min && value < min) s = Math.min(s, clamp01(value / min));
  return s;
}

function weighted(list) {
  if (!list.length) return null;
  const tw = list.reduce((a, c) => a + c.weight, 0);
  if (!tw) return null;
  return list.reduce((a, c) => a + c.weight * c.score, 0) / tw;
}
