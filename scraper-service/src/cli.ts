/**
 * Cron entrypoint for the scraper (`npm run scrape:cron`).
 *
 * The HTTP endpoint in scrapeRoutes.ts returns JSON and lets the browser decide
 * what to persist. This entrypoint has no browser, so it does the whole job:
 * fetch orders -> scrape -> hardFilter -> write to the backend via /api/ingest.
 *
 * Usage:
 *   npm run scrape:cron
 *   npm run scrape:cron -- --areas=13115,13109 --sources=stepon,suumo
 *   SCRAPE_AREA_CODES=13115 SCRAPE_SOURCES=stepon npm run scrape:cron
 */
import dotenv from "dotenv";
dotenv.config();

import puppeteer from "./puppeteerStealth";
import type { Browser, Page } from "puppeteer";
import { KNOWN_SOURCES, SOURCE_LABELS, runScraper } from "./services/scraperRegistry";
import { hardFilter } from "./services/propertyMatcher";
import {
  DETAIL_DATE_SOURCES,
  fetchPostedDates,
} from "./services/postedDate";
import { createIngestClient, type IngestMatch, type IngestOrder, type IngestSummary } from "./ingestClient";
import { logger } from "./logger";
import { config } from "./config";
import type { OrderCriteria, PropertyListing } from "./types";

/**
 * 掲載日 fetching budget.
 *
 * Only ONE of the 19 portals prints a date on its list card (大京穴吹); for the
 * rest it is on the detail page, so a date costs one extra page load. Two caps
 * keep that honest:
 *
 *   PER JOB   — how many detail pages one (source, area) may open.
 *   PER RUN   — the whole sweep's budget, so a first run over 23 wards x 19
 *               sources cannot turn a 20-minute job into a 9-hour one and blow
 *               the GitHub Actions limit.
 *
 * Only listings the database has never seen are candidates (a posted date does
 * not change), so in steady state this is a handful of loads a night and the
 * caps never bind. Whatever a capped run skips stays a candidate for the next
 * one, and every truncation is logged — never silent.
 */
/**
 * 実行者 recorded for a run nobody pressed a button for. A user-initiated scrape
 * is attributed to that account by src/api/scrapeTrigger.ts (from the verified
 * JWT); this label is what the scheduled sweep writes instead, so the card can
 * never leave "who searched" blank.
 */
const AUTOMATIC_TRIGGER_LABEL = "自動取得（定期実行）";

const POSTED_DATES_ENABLED = (process.env.SCRAPE_POSTED_DATES ?? "1") !== "0";
const POSTED_DATE_LIMIT_PER_JOB = Number(process.env.SCRAPE_POSTED_DATE_LIMIT || 30);
const POSTED_DATE_RUN_BUDGET = Number(process.env.SCRAPE_POSTED_DATE_RUN_LIMIT || 400);

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
    dealType: pick<"buy" | "rent">("dealType"),
    priceMin: pick<number>("priceMin"),
    priceMax: pick<number>("priceMax"),
    rentMin: pick<number>("rentMin"),
    rentMax: pick<number>("rentMax"),
    maxDeposit: pick<number>("maxDeposit"),
    maxKeyMoney: pick<number>("maxKeyMoney"),
    petsRequired: pick<boolean>("petsRequired"),
    walkMinutes: pick<number>("walkMinutes"),
    minBuildingCoverageRatio: pick<number>("minBuildingCoverageRatio"),
    minFloorAreaRatio: pick<number>("minFloorAreaRatio"),
    propertyTypes: pick<string[]>("propertyTypes"),
    ownerChange: pick<boolean>("ownerChange"),
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

/**
 * Fill in 掲載日 for the listings of one (source, area) that the database has
 * never seen, by reading their detail pages.
 *
 * Shares ONE browser across the whole run (lazily opened) rather than per job:
 * launching Chrome costs seconds and memory, and the scrapers already each open
 * their own — a third concurrent one per job is how CI runners run out of RAM.
 *
 * Failure here is never fatal: a missing 掲載日 is a missing field, and the UI
 * falls back to 取得日時 (when we found the listing) with a label that says so.
 */
async function enrichPostedDates(
  client: { unknownListingUrls(urls: string[]): Promise<string[]> },
  source: string,
  listings: PropertyListing[],
  state: { browser: Browser | null; page: Page | null; budgetLeft: number },
): Promise<{ filled: number }> {
  if (!POSTED_DATES_ENABLED || state.budgetLeft <= 0) return { filled: 0 };
  // Sites verified to publish nothing (ステップ, 東急, 朝日) or to answer detail
  // requests with a bot check (At Home) are skipped outright — see
  // DETAIL_DATE_SOURCES for the per-site evidence.
  if (!DETAIL_DATE_SOURCES.has(source)) return { filled: 0 };

  const byUrl = new Map<string, PropertyListing[]>();
  for (const listing of listings) {
    if (listing.postedAt != null) continue; // list card already gave us one
    const url = urlOf(listing);
    if (!url) continue;
    const bucket = byUrl.get(url);
    if (bucket) bucket.push(listing);
    else byUrl.set(url, [listing]);
  }
  if (byUrl.size === 0) return { filled: 0 };

  let candidates: string[];
  try {
    candidates = await client.unknownListingUrls([...byUrl.keys()]);
  } catch (err) {
    logger.warn(
      `[${source}] 掲載日: could not check which listings are new (${(err as Error).message}) — skipping dates for this batch`,
    );
    return { filled: 0 };
  }
  if (candidates.length === 0) return { filled: 0 };

  if (!state.browser) {
    state.browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    state.page = await state.browser.newPage();
    await state.page.setUserAgent(config.userAgent);
    await state.page.setViewport({ width: 1280, height: 900 });
  }

  const limit = Math.min(POSTED_DATE_LIMIT_PER_JOB, state.budgetLeft);
  const { dates, attempted } = await fetchPostedDates(state.page, candidates, {
    source,
    limit,
    delayMs: 1200,
  });
  state.budgetLeft -= attempted;

  let filled = 0;
  for (const [url, result] of dates) {
    const r = result as any;
    for (const listing of byUrl.get(url) ?? []) {
      if (r.postedAt != null) {
        listing.postedAt = r.postedAt;
        listing.postedDateKind = r.postedDateKind;
      }
      if (listing.floor == null && r.floor != null) listing.floor = r.floor;
      if (listing.elevators == null && r.elevators != null) listing.elevators = r.elevators;
      if (!listing.structure && r.structure) listing.structure = r.structure;
      if (!listing.structureType && r.structureType) listing.structureType = r.structureType;
      if (listing.totalUnits == null && r.totalUnits != null) listing.totalUnits = r.totalUnits;
      if (listing.roadWidth == null && r.roadWidth != null) listing.roadWidth = r.roadWidth;
      if (listing.frontage == null && r.frontage != null) listing.frontage = r.frontage;
      if (listing.buildYear == null && r.buildYear != null) listing.buildYear = r.buildYear;
      if (listing.buildingCoverageRatio == null && r.buildingCoverageRatio != null) {
        listing.buildingCoverageRatio = r.buildingCoverageRatio;
      }
      if (listing.floorAreaRatio == null && r.floorAreaRatio != null) {
        listing.floorAreaRatio = r.floorAreaRatio;
      }
      filled++;
    }
  }
  if (state.budgetLeft <= 0) {
    logger.warn(
      `掲載日: run budget of ${POSTED_DATE_RUN_BUDGET} detail page(s) is used up — ` +
        `remaining new listings keep 取得日時 only until the next run`,
    );
  }
  return { filled };
}

/**
 * Fill in 掲載日 for listings ALREADY stored without one.
 *
 * The normal path only looks up dates for URLs the database has never seen, so
 * everything found before 掲載日 scraping existed would stay blank forever. This
 * walks those rows (indexed, see src/api/ingest.ts) and reads their detail pages,
 * spending the same capped budget as the main pass.
 *
 * Sources that publish no date are excluded, so a row belonging to one of them is
 * never re-attempted — it is not a gap that can be filled.
 */
async function backfillPostedDates(
  client: Awaited<ReturnType<typeof createIngestClient>>,
  state: { browser: Browser | null; page: Page | null; budgetLeft: number },
): Promise<number> {
  if (!POSTED_DATES_ENABLED || state.budgetLeft <= 0) return 0;

  // The query caps a batch, so one call cannot drain a large table. Loop until the
  // budget is gone or a batch stops making progress, tracking what has already
  // been attempted: a listing whose detail page yields no date stays "pending"
  // forever, and without this the loop would keep re-fetching the same rows.
  const attemptedUrls = new Set<string>();
  let pending: { listingId: string; url: string; source: string }[] = [];
  const nextBatch = async () => {
    const batch = await client.listingsMissingPostedDate({
      limit: Math.min(state.budgetLeft, 200),
      sources: [...DETAIL_DATE_SOURCES],
    });
    return batch.filter((row) => !attemptedUrls.has(row.url));
  };

  pending = await nextBatch();
  if (pending.length === 0) {
    logger.info("掲載日 backfill: nothing pending");
    return 0;
  }

  if (!state.browser) {
    state.browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    state.page = await state.browser.newPage();
    await state.page.setUserAgent(config.userAgent);
    await state.page.setViewport({ width: 1280, height: 900 });
  }

  let saved = 0;
  let considered = 0;
  while (pending.length > 0 && state.budgetLeft > 0) {
    considered += pending.length;
    // Group by source so the per-request delay is not spent hopping between
    // hosts, and so one blocked portal cannot starve the others of the budget.
    const bySource = new Map<string, typeof pending>();
    for (const row of pending) {
      const bucket = bySource.get(row.source);
      if (bucket) bucket.push(row);
      else bySource.set(row.source, [row]);
    }

    for (const [source, rows] of bySource) {
      if (state.budgetLeft <= 0) break;
      const limit = Math.min(rows.length, state.budgetLeft);
      const targets = rows.slice(0, limit);
      for (const row of targets) attemptedUrls.add(row.url);

      const { dates, attempted } = await fetchPostedDates(
        state.page,
        targets.map((r) => r.url),
        { source: `${source} backfill`, limit, delayMs: 1200 },
      );
      state.budgetLeft -= attempted;

      const updates = targets
        .filter((r) => dates.has(r.url))
        .map((r) => ({
          listingId: r.listingId,
          postedAt: dates.get(r.url)!.postedAt!,
          postedDateKind: dates.get(r.url)!.postedDateKind,
        }));
      if (updates.length > 0) saved += await client.savePostedDates(updates);
    }

    pending = state.budgetLeft > 0 ? await nextBatch() : [];
  }

  logger.info(
    `掲載日 backfill: filled ${saved} of ${considered} listing(s) examined` +
      (state.budgetLeft <= 0
        ? " (budget exhausted — the rest wait for the next run)"
        : " (nothing further pending)"),
  );
  return saved;
}

async function main(): Promise<number> {
  const startedAt = Date.now();
  const client = await createIngestClient();
  logger.info(`Cron scrape starting — backend=${client.backendUrl}`);

  // --backfill-dates: fill in 掲載日 for stored listings and exit, without
  // scraping. Useful to catch up the whole table in one go after adding date
  // support, instead of waiting for nightly runs to trickle through it.
  if (process.argv.slice(2).includes("--backfill-dates")) {
    const state: { browser: Browser | null; page: Page | null; budgetLeft: number } = {
      browser: null,
      page: null,
      budgetLeft: POSTED_DATE_RUN_BUDGET,
    };
    let filled = 0;
    try {
      filled = await backfillPostedDates(client, state);
    } finally {
      if (state.browser) {
        try {
          await state.browser.close();
        } catch {
          /* already gone */
        }
      }
    }
    logger.info(`掲載日 backfill only: ${filled} listing(s) updated`);
    return 0;
  }

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
  // Buyer-facing type -> the category LABELS the individual scrapers understand.
  //
  // Every scraper filters its own URL categories by EXACT label match against
  // this list (athome's 売ビル・一棟売マンション page is labelled ビル; suumo has no
  // アパート category at all). So handing a new order-form label such as
  // 一棟マンション straight to them makes each one log "No matching categories"
  // and scrape nothing at all. Widen to the pages that actually carry the stock;
  // hardFilter still enforces each order's precise type afterwards, so widening
  // here costs crawl time, never accuracy.
  const SITE_CATEGORY_LABELS: Record<string, string[]> = {
    一棟マンション: ["マンション", "ビル"],
    アパート: ["マンション", "ビル"],
  };
  const siteTypes = Array.from(
    new Set(unionTypes.flatMap((t) => SITE_CATEGORY_LABELS[t] ?? [t])),
  );
  const requestedTypes =
    anyOrderWantsEverything || siteTypes.length === 0 ? undefined : siteTypes;

  // Same union logic for 買う vs 借りる: an order is one or the other (never
  // both — see the schema comment on orders.dealType), but a SWEEP covers
  // every order, so if any order in this run wants "rent" the sweep must
  // fetch that vertical too, alongside "buy" if any order wants that. Each
  // is a separate runScraper call per (source, area) below — hardFilter then
  // routes every scraped listing to only the orders whose dealType it matches.
  const dealTypesNeeded: Array<"buy" | "rent"> =
    criteria.length === 0
      ? ["buy"]
      : Array.from(new Set(criteria.map((c) => c.dealType ?? "buy")));
  logger.info(`Deal type(s) for this sweep: ${dealTypesNeeded.join(", ")}`);

  logger.info(
    `Property types for this sweep: ${requestedTypes ? requestedTypes.join(", ") : "(all — at least one order has no type filter)"}` +
      (requestedTypes && siteTypes.length !== unionTypes.length
        ? ` (widened from 希望: ${unionTypes.join(", ")})`
        : ""),
  );

  const total: IngestSummary = {
    listingsInserted: 0,
    listingsSkipped: 0,
    matchesCreated: 0,
    matchesSkipped: 0,
  };
  let jobsOk = 0;
  let jobsFailed = 0;
  // Shared browser + remaining budget for 掲載日 lookups (see enrichPostedDates).
  const dateState: { browser: Browser | null; page: Page | null; budgetLeft: number } = {
    browser: null,
    page: null,
    budgetLeft: POSTED_DATES_ENABLED ? POSTED_DATE_RUN_BUDGET : 0,
  };
  let datesFilled = 0;
  const failedSources: string[] = [];
  const okSources: string[] = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const label = SOURCE_LABELS[source] || source;
    let sourceOk = 0;
    let sourceFailed = 0;

    const progressTag = sources.length > 1 ? `[${i + 1}/${sources.length}] ` : "";
    const statusText = `${progressTag}${label} を検索中...`;

    await client.updateProgress({
      source,
      orderId: onlyOrderId || undefined,
      statusText,
    });

    // SEQUENTIAL, deliberately. Concurrent Chrome launches exhaust memory on
    // this machine and on constrained CI runners; do not "optimise" this into
    // Promise.all.
    for (const areaCode of areaCodes) {
      const jobStart = Date.now();
      try {
        // One runScraper call per needed dealType (almost always just ["buy"]
        // today) — a single call only ever fetches one vertical. SEQUENTIAL,
        // like the areaCode loop around this one: concurrent Chrome launches
        // exhaust memory on this machine and on constrained CI runners.
        const results = [];
        for (const dt of dealTypesNeeded) {
          results.push(await runScraper(source, areaCode, requestedTypes, dt));
        }
        const scraped = results.flatMap((r) => r.listings ?? []);

        // Reuse the existing matcher — do not reimplement matching here.
        const { passed, stats } = hardFilter(scraped, criteria);

        // 掲載日 only for listings that survived matching: fetching a detail page
        // for a listing nobody asked for would be the most wasteful thing in the
        // whole run.
        const dateResult = await enrichPostedDates(client, source, passed, dateState);
        datesFilled += dateResult.filled;

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
            `matches=${summary.matchesCreated} matchesSkipped=${summary.matchesSkipped} ` +
            `掲載日=${dateResult.filled}` +
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

  // Spend whatever detail-page budget the sweep left over on listings already
  // stored without a 掲載日. Runs after the sweep so fresh inventory always gets
  // first claim on the budget.
  try {
    datesFilled += await backfillPostedDates(client, dateState);
  } catch (err) {
    logger.warn(`掲載日 backfill failed: ${(err as Error).message}`);
  }

  // Attribute the run. A run scoped to one order (SCRAPE_ORDER_ID) was dispatched
  // by a signed-in user and is already stamped with their name by
  // src/api/scrapeTrigger.ts — overwriting that with "自動" would be a lie. Only
  // the unscoped nightly sweep needs the automatic label.
  if (!onlyOrderId && jobsOk > 0 && orders.length > 0) {
    try {
      await client.markScrapeRun({
        orderIds: orders.map((o) => o._id),
        triggeredBy: AUTOMATIC_TRIGGER_LABEL,
      });
      logger.info(
        `Marked ${orders.length} order(s) as searched by ${AUTOMATIC_TRIGGER_LABEL}`,
      );
    } catch (err) {
      // Bookkeeping only — never fail a successful scrape over it.
      logger.warn(`Could not record scrape attribution: ${(err as Error).message}`);
    }
  }

  // Close the shared 掲載日 browser before reporting, so a leaked Chrome cannot
  // keep the process alive after the summary is printed.
  if (dateState.browser) {
    try {
      await dateState.browser.close();
    } catch {
      /* already gone */
    }
  }

  const mins = Math.round((Date.now() - startedAt) / 6000) / 10;
  logger.info(
    `Cron scrape finished in ${mins}min — jobs ok=${jobsOk} failed=${jobsFailed} | ` +
      `listings inserted=${total.listingsInserted} skipped=${total.listingsSkipped} | ` +
      `matches created=${total.matchesCreated} skipped=${total.matchesSkipped} | ` +
      `掲載日 resolved=${datesFilled}` +
      (POSTED_DATES_ENABLED
        ? ` (detail budget used ${POSTED_DATE_RUN_BUDGET - dateState.budgetLeft}/${POSTED_DATE_RUN_BUDGET})`
        : " (disabled via SCRAPE_POSTED_DATES=0)"),
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
