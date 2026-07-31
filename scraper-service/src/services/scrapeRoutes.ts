import { Router, Request, Response } from "express";
import { logger } from "../logger";
import { hardFilter } from "./propertyMatcher";
import { KNOWN_SOURCES, runScraper } from "./scraperRegistry";
import { checkAllScrapers, checkScraper } from "./healthCheck";
import type { OrderCriteria, ScrapeResult } from "../types";

export const scrapeRoutes = Router();

// Concurrency limiter — prevents more than N browsers running simultaneously
function makeSemaphore(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const release = () => {
    active--;
    if (queue.length > 0) {
      active++;
      const next = queue.shift()!;
      next();
    }
  };
  return function acquire<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => fn().then(resolve, reject).finally(release);
      if (active < limit) {
        active++;
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

scrapeRoutes.get("/", async (req: Request, res: Response) => {
  const { areaCodes, source, sources: sourcesParam, orders: ordersJson } = req.query;

  if (!areaCodes) {
    res.status(400).json({ error: "areaCodes parameter required" });
    return;
  }

  const codes = (areaCodes as string).split(",").map((s) => s.trim());

  // Support both ?source=athome (legacy) and ?sources=athome,suumo,homes (multi)
  let selectedSources: string[];
  if (sourcesParam) {
    selectedSources = (sourcesParam as string).split(",").map((s) => s.trim()).filter((s) => KNOWN_SOURCES.includes(s));
  } else if (source) {
    selectedSources = [(source as string).trim()];
  } else {
    selectedSources = ["athome"];
  }

  if (selectedSources.length === 0) {
    res.status(400).json({ error: "No valid sources specified" });
    return;
  }

  // Parse order criteria from query param
  let criteria: OrderCriteria[] = [];
  if (ordersJson) {
    try {
      criteria = JSON.parse(ordersJson as string);
    } catch {
      logger.warn("Failed to parse order criteria JSON");
    }
  }

  logger.info("Scrape request received", {
    sources: selectedSources,
    areas: codes,
    orderCount: criteria.length,
    orders: criteria.map((c) => ({
      ward: c.ward,
      wards: c.wards,
      priceRange: c.priceMin != null || c.priceMax != null ? `${c.priceMin ?? ""}~${c.priceMax ?? ""}` : null,
      walkMinutes: c.walkMinutes,
      maxBuildAge: c.maxBuildAge,
      layoutTypes: c.layoutTypes,
    })),
  });

  try {
    const allListings: any[] = [];
    const areaResults: { areaCode: string; source: string; total: number }[] = [];

    // Determine requested property types from first order
    const requestedTypes = criteria.length > 0 ? criteria[0].propertyTypes : undefined;

    // Build all (source, areaCode) job pairs
    const jobs: Array<{ source: string; code: string }> = [];
    for (const src of selectedSources) {
      for (const code of codes) {
        jobs.push({ source: src, code });
      }
    }

    logger.info(`Running ${jobs.length} scrape job(s) in parallel (max 3 concurrent browsers)...`);

    // Max 3 concurrent browsers to stay within RAM limits
    const acquire = makeSemaphore(3);

    const results = await Promise.all(
      jobs.map(({ source: src, code }) =>
        acquire(async () => {
          logger.info(`Starting scrape: source=${src} areaCode=${code}`);
          try {
            const result = await runScraper(src, code, requestedTypes);
            logger.info(`Area ${code} (${src}) raw result: ${result.listings.length} listings found`);
            areaResults.push({ areaCode: code, source: src, total: result.listings.length });
            return result.listings;
          } catch (err) {
            logger.error(`Scrape job failed source=${src} areaCode=${code}: ${(err as Error).message}`);
            areaResults.push({ areaCode: code, source: src, total: 0 });
            return [];
          }
        })
      )
    );

    for (const listings of results) {
      allListings.push(...listings);
    }

    // Apply hard filters against order criteria
    logger.info(`Applying hard filters against ${criteria.length} order(s)...`);
    const { passed, failed, stats } = hardFilter(allListings, criteria);

    // Log match results
    const logPassed = passed.slice(0, 10);
    for (const l of logPassed) {
      const orderLabels = (l.matchedOrderIndices as number[])
        .map((idx: number) => criteria[idx]?.ward || `Order#${idx}`)
        .join(",");
      logger.info(
        `[MATCH ✓] ${l.ward} ${l.address || ""} | price=${l.price}万 | area=${l.landSize ?? l.area ?? "?"}㎡ | walk=${l.walkMinutes ?? "?"}min | station=${l.station ?? "?"} | matches=${orderLabels || "all"}`
      );
    }
    const logFailed = failed.slice(0, 10);
    for (const l of logFailed) {
      logger.info(
        `[MATCH ✗] ${l.ward} ${l.address || ""} | price=${l.price}万 | area=${l.landSize ?? l.area ?? "?"}㎡ | walk=${l.walkMinutes ?? "?"}min | FAILED filters: ${(l as any).rejectionReason}`
      );
    }
    if (passed.length > 10) logger.info(`  ... and ${passed.length - 10} more passed listings`);
    if (failed.length > 10) logger.info(`  ... and ${failed.length - 10} more failed listings`);

    logger.info("Scrape complete", {
      rawTotal: allListings.length,
      passedFilters: passed.length,
      rejectedByFilters: failed.length,
      rejectionBreakdown: stats.reasons,
    });

    const listingsWithMatches = passed.map((l: any) => ({
      ...l,
      matchedOrderIndices: l.matchedOrderIndices,
    }));

    res.json({
      ok: true,
      sources: selectedSources,
      source: selectedSources[0], // legacy compat
      areas: codes,
      rawTotal: allListings.length,
      listings: listingsWithMatches,
      filterStats: stats,
      orderCriteria: criteria,
      areaResults,
    });
  } catch (error) {
    logger.error("Scrape error: " + ((error as Error).stack || error));
    res.status(500).json({ error: (error as Error).stack || String(error) });
  }
});