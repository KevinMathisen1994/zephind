/**
 * Cron entrypoint for the scraper (`npm run scrape:cron`).
 *
 * The HTTP endpoint in scrapeRoutes.ts returns JSON and lets the browser decide
 * what to persist. This entrypoint has no browser, so it does the whole job:
 * fetch orders -> scrape -> hardFilter -> write to Convex via convex/ingest.js.
 *
 * Usage:
 *   npm run scrape:cron
 *   npm run scrape:cron -- --areas=13115,13109 --sources=stepon,suumo
 *   SCRAPE_AREA_CODES=13115 SCRAPE_SOURCES=stepon npm run scrape:cron
 */
import dotenv from "dotenv";
dotenv.config();

import { KNOWN_SOURCES, SOURCE_LABELS, runScraper } from "./services/scraperRegistry";
import { hardFilter } from "./services/propertyMatcher";
import { createIngestClient, type IngestMatch, type IngestOrder, type IngestSummary } from "./convexIngest";
import { logger } from "./logger";
import type { OrderCriteria, PropertyListing } from "./types";

/**
 * Area label -> JIS municipality code, for deriving "what should we scrape
 * tonight" from the wards named on existing orders.
 *
 * Duplicated from src/lib/tokyoWards.ts in the FRONTEND. scraper-service has no
 * shared map (each scraper carries its own partial code->label map for address
 * parsing, none of them label->code), and the frontend file lives outside this
 * package's tsconfig rootDir, so importing it would break `npm run build`.
 */
const AREA_LABEL_TO_CODE: Record<string, string> = {
  // 23区
  "千代田区": "13101", "中央区": "13102", "港区": "13103", "新宿区": "13104",
  "文京区": "13105", "台東区": "13106", "墨田区": "13107", "江東区": "13108",
  "品川区": "13109", "目黒区": "13110", "大田区": "13111", "世田谷区": "13112",
  "渋谷区": "13113", "中野区": "13114", "杉並区": "13115", "豊島区": "13116",
  "北区": "13117", "荒川区": "13118", "板橋区": "13119", "練馬区": "13120",
  "足立区": "13121", "葛飾区": "13122", "江戸川区": "13123",
  // 市部
  "八王子市": "13201", "立川市": "13202", "武蔵野市": "13203", "三鷹市": "13204",
  "青梅市": "13205", "府中市": "13206", "昭島市": "13207", "調布市": "13208",
  "町田市": "13209", "小金井市": "13210", "小平市": "13211", "日野市": "13212",
  "東村山市": "13213", "国分寺市": "13214", "国立市": "13215", "福生市": "13218",
  "狛江市": "13219", "東大和市": "13220", "清瀬市": "13221", "東久留米市": "13222",
  "武蔵村山市": "13223", "多摩市": "13224", "稲城市": "13225", "羽村市": "13227",
  "あきる野市": "13228", "西東京市": "13229",
  // 郡部・島嶼
  "檜原村": "13307", "奥多摩町": "13308", "大島町": "13361", "利島村": "13362",
  "新島村": "13363", "神津島村": "13364", "三宅村": "13381", "御蔵島村": "13382",
  "八丈町": "13401", "青ヶ島村": "13402", "小笠原村": "13421",
};

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Order document -> OrderCriteria for hardFilter.
 * Mirrors the mapping Orders.tsx builds before calling the scrape endpoint,
 * including the `order.criteria` fallback for older rows.
 */
function toCriteria(order: IngestOrder): OrderCriteria {
  const nested = (order.criteria ?? {}) as Record<string, any>;
  const pick = <T,>(key: string): T | undefined => {
    const direct = (order as Record<string, any>)[key];
    if (direct !== undefined && direct !== null) return direct as T;
    const fallback = nested[key];
    return fallback === null ? undefined : (fallback as T | undefined);
  };
  return {
    ward: pick<string>("ward"),
    wards: pick<string[]>("wards"),
    priceMin: pick<number>("priceMin"),
    priceMax: pick<number>("priceMax"),
    walkMinutes: pick<number>("walkMinutes"),
    minBuildingCoverageRatio: pick<number>("minBuildingCoverageRatio"),
    minFloorAreaRatio: pick<number>("minFloorAreaRatio"),
    propertyTypes: pick<string[]>("propertyTypes"),
    landSizeMin: pick<number>("landSizeMin"),
    landSizeMax: pick<number>("landSizeMax"),
    buildingSizeMin: pick<number>("buildingSizeMin"),
    buildingSizeMax: pick<number>("buildingSizeMax"),
    maxBuildAge: pick<number>("maxBuildAge"),
    minBuildYear: pick<number>("minBuildYear"),
    minYield: pick<number>("minYield"),
    maxYield: pick<number>("maxYield"),
    minRoadWidth: pick<number>("minRoadWidth"),
    minTotalUnits: pick<number>("minTotalUnits"),
    maxFloor: pick<number>("maxFloor"),
    excludeFirstFloor: pick<boolean>("excludeFirstFloor"),
    minElevators: pick<number>("minElevators"),
    structureTypes: pick<string[]>("structureTypes"),
    layoutTypes: pick<string[]>("layoutTypes"),
  };
}

/** Distinct area codes named by the given orders. */
function deriveAreaCodes(orders: IngestOrder[]): string[] {
  const codes = new Set<string>();
  const unknown = new Set<string>();
  for (const order of orders) {
    const criteria = toCriteria(order);
    const labels = [
      ...(criteria.wards ?? []),
      ...(criteria.ward ? [criteria.ward] : []),
    ];
    for (const label of labels) {
      const trimmed = String(label).trim();
      if (!trimmed) continue;
      // Some orders may already store a code.
      if (/^\d{5}$/.test(trimmed)) {
        codes.add(trimmed);
        continue;
      }
      const code = AREA_LABEL_TO_CODE[trimmed];
      if (code) codes.add(code);
      else unknown.add(trimmed);
    }
  }
  if (unknown.size > 0) {
    logger.warn(`No area code for order location(s): ${[...unknown].join(", ")} — skipped`);
  }
  return [...codes].sort();
}

function urlOf(listing: PropertyListing & { detailUrl?: string }): string {
  return listing.url || listing.detailUrl || "";
}

async function main(): Promise<number> {
  const startedAt = Date.now();
  const client = createIngestClient();
  logger.info(`Cron scrape starting — convex=${client.convexUrl}`);

  let orders = await client.listOrdersForMatching();
  // listOrdersForMatching returns EVERY account's orders, which is right for the
  // nightly sweep but wrong for a user-initiated run: without this filter one
  // person's dispatch matched against strangers' orders, and their criteria
  // widened this sweep (e.g. an order with no type filter forced "all types").
  const onlyOrderId = (process.env.SCRAPE_ORDER_ID || "").trim();
  if (onlyOrderId) {
    const before = orders.length;
    orders = orders.filter((o) => o._id === onlyOrderId);
    logger.info(
      `Scoped to order ${onlyOrderId}: ${orders.length} of ${before} order(s)`,
    );
    if (orders.length === 0) {
      logger.error(`Order ${onlyOrderId} not found — nothing to match against.`);
      process.exit(1);
    }
  }
  const criteria = orders.map(toCriteria);
  logger.info(`Fetched ${orders.length} order(s) for matching`);

  // Default target: only the wards someone is actually looking for.
  let areaSource = "--areas";
  let areaCodes = splitList(argValue("areas"));
  if (areaCodes.length === 0) {
    areaSource = "SCRAPE_AREA_CODES";
    areaCodes = splitList(process.env.SCRAPE_AREA_CODES);
  }
  if (areaCodes.length === 0) {
    areaSource = "orders";
    areaCodes = deriveAreaCodes(orders);
  }
  logger.info(`Target areas (from ${areaSource}): ${areaCodes.join(", ") || "(none)"}`);

  const requestedSources =
    splitList(argValue("sources")).length > 0
      ? splitList(argValue("sources"))
      : splitList(process.env.SCRAPE_SOURCES).length > 0
        ? splitList(process.env.SCRAPE_SOURCES)
        : KNOWN_SOURCES;

  const sources = requestedSources.filter((s) => KNOWN_SOURCES.includes(s));
  const rejected = requestedSources.filter((s) => !KNOWN_SOURCES.includes(s));
  if (rejected.length > 0) {
    logger.error(`Unknown source(s) ignored: ${rejected.join(", ")}`);
  }

  if (areaCodes.length === 0) {
    // Not a failure: no orders means nobody is looking for anything. Exiting
    // non-zero here would page someone every night over an empty database.
    logger.warn("No area codes to scrape (no --areas, no SCRAPE_AREA_CODES, and no orders name a known ward). Nothing to do.");
    return 0;
  }
  if (sources.length === 0) {
    logger.error("No valid sources selected — nothing to do.");
    return 1;
  }

  logger.info(`Scraping ${sources.length} source(s) x ${areaCodes.length} area(s): [${sources.join(", ")}] x [${areaCodes.join(", ")}]`);

  // UNION of every order's property types, not just the first one's.
  //
  // This used to be `criteria[0].propertyTypes`, so one order silently governed
  // the whole sweep: if order #1 wanted only マンション, then athome and hatomark
  // (which expose 土地/一戸建て categories) logged "No matching categories" and
  // scraped NOTHING — for every area, including areas belonging to other orders
  // that did want 土地. An entire run could come back empty because of one
  // unrelated order.
  //
  // Scraping the union is safe: hardFilter still enforces each order's own
  // propertyTypes afterwards, so a listing only matches orders that asked for
  // its type. An order with no propertyTypes means "any", which must widen the
  // sweep to everything rather than narrow it.
  const anyOrderWantsEverything = criteria.some(
    (c) => !c.propertyTypes || c.propertyTypes.length === 0,
  );
  const unionTypes = Array.from(
    new Set(criteria.flatMap((c) => c.propertyTypes ?? [])),
  );
  const requestedTypes =
    anyOrderWantsEverything || unionTypes.length === 0 ? undefined : unionTypes;
  logger.info(
    `Property types for this sweep: ${requestedTypes ? requestedTypes.join(", ") : "(all — at least one order has no type filter)"}`,
  );

  const total: IngestSummary = {
    listingsInserted: 0,
    listingsSkipped: 0,
    matchesCreated: 0,
    matchesSkipped: 0,
  };
  let jobsOk = 0;
  let jobsFailed = 0;
  const failedSources: string[] = [];
  const okSources: string[] = [];

  for (const source of sources) {
    const label = SOURCE_LABELS[source] || source;
    let sourceOk = 0;
    let sourceFailed = 0;

    // SEQUENTIAL, deliberately. Concurrent Chrome launches exhaust memory on
    // this machine and on constrained CI runners; do not "optimise" this into
    // Promise.all.
    for (const areaCode of areaCodes) {
      const jobStart = Date.now();
      try {
        const result = await runScraper(source, areaCode, requestedTypes);
        const scraped = result.listings ?? [];

        // Reuse the existing matcher — do not reimplement matching here.
        const { passed, stats } = hardFilter(scraped, criteria);

        // Only listings that satisfy at least one order are persisted, which is
        // what the browser flow stored too. With zero orders hardFilter passes
        // everything, but then areaCodes would be empty and we never get here.
        const matches: IngestMatch[] = [];
        let matchesWithoutUrl = 0;
        for (const listing of passed) {
          const url = urlOf(listing);
          for (const idx of listing.matchedOrderIndices ?? []) {
            const order = orders[idx];
            if (!order) continue;
            if (!url) {
              matchesWithoutUrl++;
              continue;
            }
            matches.push({ listingUrl: url, orderId: order._id });
          }
        }
        if (matchesWithoutUrl > 0) {
          logger.warn(`${source}/${areaCode}: ${matchesWithoutUrl} match(es) dropped — listing has no url to key on`);
        }

        // Ingest per source+area rather than accumulating the whole run: a crash
        // 15 minutes in must not throw away everything scraped so far.
        const summary = await client.ingestScrape({
          source,
          areaCode,
          listings: passed,
          matches,
        });
        total.listingsInserted += summary.listingsInserted;
        total.listingsSkipped += summary.listingsSkipped;
        total.matchesCreated += summary.matchesCreated;
        total.matchesSkipped += summary.matchesSkipped;
        sourceOk++;
        jobsOk++;

        // Surface WHY listings were dropped. hardFilter already tallies reasons,
        // but without them a line like "scraped=208 passed=1" looks like a broken
        // scraper when it is usually a narrow order (budget, walk time, ward).
        // Sorted desc and capped so a wide sweep stays readable.
        const topReasons = Object.entries(stats.reasons || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([reason, n]) => `${reason}=${n}`)
          .join(" ");

        logger.info(
          `[${label}/${areaCode}] scraped=${scraped.length} passed=${stats.passed} ` +
            `inserted=${summary.listingsInserted} skipped=${summary.listingsSkipped} ` +
            `matches=${summary.matchesCreated} matchesSkipped=${summary.matchesSkipped}` +
            (summary.matchesSkipped > 0 && summary.matchSkipReasons
              ? `[dup=${summary.matchSkipReasons.duplicate ?? 0} ` +
                `noOwner=${summary.matchSkipReasons.noOwner ?? 0} ` +
                `listingRejected=${summary.matchSkipReasons.listingRejected ?? 0}]`
              : "") +
            ` ` +
            `(${Math.round((Date.now() - jobStart) / 1000)}s)` +
            (stats.failed > 0 ? `\n    rejected ${stats.failed} listings — reason tallies below count ` +
              `(listing x order) pairs across all ${criteria.length} orders, so they ` +
              `exceed the listing count: ${topReasons || "(no reason recorded)"}` : ""),
        );
      } catch (err) {
        sourceFailed++;
        jobsFailed++;
        logger.error(`[${label}/${areaCode}] FAILED: ${(err as Error).message}`);
      }
    }

    if (sourceOk > 0) okSources.push(source);
    else if (sourceFailed > 0) failedSources.push(source);
  }

  const mins = Math.round((Date.now() - startedAt) / 6000) / 10;
  logger.info(
    `Cron scrape finished in ${mins}min — jobs ok=${jobsOk} failed=${jobsFailed} | ` +
      `listings inserted=${total.listingsInserted} skipped=${total.listingsSkipped} | ` +
      `matches created=${total.matchesCreated} skipped=${total.matchesSkipped}`,
  );
  if (failedSources.length > 0) {
    logger.warn(`Sources with no successful job: ${failedSources.join(", ")}`);
  }

  // Individual portals break all the time (selector changes, blocks, timeouts);
  // that must not fail the run. Only a total wipeout is worth a red build.
  if (okSources.length === 0) {
    logger.error("Every source failed — exiting non-zero.");
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error(`Cron scrape aborted: ${(err as Error).stack || err}`);
    process.exit(1);
  });
