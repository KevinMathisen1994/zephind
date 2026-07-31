/**
 * Deterministic broker-style match scoring.
 *
 * Pure module: no Convex/network imports, so it can be unit-tested directly
 * with `node`. `convex/evaluate.js` imports `computeMatchScore` and treats its
 * output as the AUTHORITATIVE score. The LLM writes prose only — it no longer
 * reports the number. (Previously the saved score was parsed out of the model's
 * own text, which made this whole file dead code and produced a score that
 * drifted 10+ points between identical runs.)
 *
 * Layers, in the order a broker actually applies them:
 *   1. Hard disqualifiers  -> cap the final score, cannot be compensated for
 *   2. Requirement fit     -> weighted over ONLY what the buyer specified
 *   3. Market quality      -> objective merit vs MLIT comps, walk, yield, amenities
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
};

/**
 * @param {object} listing  raw listing fields (all optional)
 * @param {object} criteria buyer orderCriteria (all optional)
 * @param {object} ctx      { marketAvgPrice, amenityCount }
 */
export function computeMatchScore(listing = {}, criteria = {}, ctx = {}) {
  const { marketAvgPrice = null, amenityCount = null } = ctx;

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
      const match =
        criteria.propertyTypes.some((t) => lt.includes(t.toLowerCase())) ||
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
  // Objective merit, independent of what the buyer asked for. This is what
  // differentiates listings that a pre-filter already guaranteed will pass the
  // stated criteria.

  // Price vs real MLIT ward comps — the single strongest objective signal.
  if (marketAvgPrice && listing.price != null) {
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
    market.push({ key: "vsMarket", weight: 35, score: s });
    if (suspicious)
      unverified.push(
        `価格が区平均（${marketAvgPrice}万円）の25%未満 — 借地権・再建築不可・持分等の可能性、要確認`,
      );
    // Being well above real recent comps is its own problem, independent of the
    // buyer's ceiling: a broker won't call an overpriced listing a strong buy
    // just because the client could technically afford it.
    if (r > 1.5) disqualify(`相場比+50%超の割高（${listing.price}万円 / 区平均${marketAvgPrice}万円）`, 58);
    else if (r > 1.3) disqualify(`相場比+30%超の割高（${listing.price}万円 / 区平均${marketAvgPrice}万円）`, 72);
  }

  if (listing.walkMinutes != null) {
    const m = listing.walkMinutes;
    const s = m <= 3 ? 1 : m <= 5 ? 0.9 : m <= 7 ? 0.8 : m <= 10 ? 0.65 : m <= 15 ? 0.45 : clamp01(0.45 - (m - 15) / 25);
    market.push({ key: "walkQuality", weight: 25, score: s });
  }

  if (listing.yield != null) {
    const y = listing.yield;
    const s = y >= 9 ? 1 : y >= 7 ? 0.85 : y >= 5.5 ? 0.65 : y >= 4 ? 0.45 : clamp01(y / 10);
    market.push({ key: "yieldQuality", weight: 20, score: s });
  }

  if (amenityCount != null) {
    const n = amenityCount;
    const s = n >= 40 ? 1 : n >= 25 ? 0.85 : n >= 12 ? 0.7 : n >= 5 ? 0.5 : 0.3;
    market.push({ key: "amenities", weight: 12, score: s });
  }

  if (listing.roadWidth != null) {
    const w = listing.roadWidth;
    market.push({ key: "roadQuality", weight: 8, score: w >= 6 ? 1 : w >= 4 ? 0.7 : w >= 2.7 ? 0.4 : 0.15 });
  }

  if (listingWard && PREMIUM_WARDS.includes(listingWard)) {
    market.push({ key: "premiumWard", weight: 10, score: 1 });
  }

  // ------------------------------------------------------------------ COMBINE
  const fitPct = weighted(fit);
  const marketPct = weighted(market);

  // How much did the buyer actually specify? A listing that satisfies a
  // two-field order is NOT as proven as one that satisfies a full spec — and
  // when an upstream pre-filter already guarantees those two fields pass,
  // fitPct is 1.0 for every candidate and carries no information at all.
  // Let objective market quality carry more of the score when criteria are thin.
  const specifiedWeight = fit.reduce((a, c) => a + c.weight, 0);
  const specDepth = clamp01(specifiedWeight / 100);
  const fitShare = 0.35 + 0.35 * specDepth;

  let pct;
  if (fitPct != null && marketPct != null) pct = fitShare * fitPct + (1 - fitShare) * marketPct;
  else if (fitPct != null) pct = fitPct;
  else if (marketPct != null) pct = marketPct;
  else pct = 0.4; // nothing at all to judge on

  // How much do we actually know about this listing? Confidence is not merit:
  // a mostly-blank listing regresses toward the middle rather than riding the
  // few fields that happen to look good.
  const CORE = ["price", "ward", "propertyType", "walkMinutes", "yield", "roadWidth", "buildYear", "structure"];
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
