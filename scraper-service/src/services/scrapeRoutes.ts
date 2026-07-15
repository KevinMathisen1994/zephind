import { Router, Request, Response } from "express";
import { logger } from "../logger";
import { scrapeAtHome } from "./athome";
import { scrapeRakuten } from "./rakuten";
import { scrapeHatomark } from "./hatomark";
import { scrapeKenbiya } from "./kenbiya";
import { scrapeSuumo } from "./suumo";
import { hardFilter } from "./propertyMatcher";
import type { OrderCriteria } from "../types";

export const scrapeRoutes = Router();

scrapeRoutes.get("/", async (req: Request, res: Response) => {
  const { areaCodes, source = "athome", orders: ordersJson } = req.query;

  if (!areaCodes) {
    res.status(400).json({ error: "areaCodes parameter required" });
    return;
  }

  const codes = (areaCodes as string).split(",").map((s) => s.trim());

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
    source,
    areas: codes,
    orderCount: criteria.length,
    orders: criteria.map((c) => ({
      ward: c.ward,
      wards: c.wards,
      priceRange: c.priceMin != null || c.priceMax != null ? `${c.priceMin ?? ""}~${c.priceMax ?? ""}` : null,
      walkMinutes: c.walkMinutes,
      bcr: c.minBuildingCoverageRatio,
      far: c.minFloorAreaRatio,
      maxBuildAge: c.maxBuildAge,
      minBuildYear: c.minBuildYear,
      minYield: c.minYield,
      maxYield: c.maxYield,
      minRoadWidth: c.minRoadWidth,
      minTotalUnits: c.minTotalUnits,
      maxFloor: c.maxFloor,
      excludeFirstFloor: c.excludeFirstFloor,
      minElevators: c.minElevators,
      structureTypes: c.structureTypes,
      layoutTypes: c.layoutTypes,
    })),
  });

  try {
    const allListings: any[] = [];
    const areaResults: { areaCode: string; total: number }[] = [];

    for (const code of codes) {
      logger.info(`Starting scrape for area code ${code}...`);
      // Determine which property types to scrape from order criteria
      const requestedTypes = criteria.length > 0 ? criteria[0].propertyTypes : undefined;
      let result;
      if (source === "athome") {
        result = await scrapeAtHome(code, requestedTypes);
      } else if (source === "rakuten") {
        result = await scrapeRakuten(code, requestedTypes);
      } else if (source === "hatomark") {
        result = await scrapeHatomark(code, requestedTypes);
      } else if (source === "kenbiya") {
        result = await scrapeKenbiya(code, requestedTypes);
      } else if (source === "suumo") {
        result = await scrapeSuumo(code, requestedTypes);
      } else {
        res.status(400).json({ error: `Unknown source: ${source}` });
        return;
      }

      logger.info(`Area ${code} raw result: ${result.listings.length} listings found`);
      areaResults.push({ areaCode: code, total: result.listings.length });
      allListings.push(...result.listings);
    }

    // Apply hard filters against order criteria
    logger.info(`Applying hard filters against ${criteria.length} order(s)...`);
    const { passed, failed, stats } = hardFilter(allListings, criteria);

    // Log each listing with match/fail status
    const logPassed = passed.slice(0, 10);
    for (const l of logPassed) {
      const orderLabels = (l.matchedOrderIndices as number[])
        .map((idx: number) => criteria[idx]?.ward || `Order#${idx}`)
        .join(",");
      logger.info(
        `[MATCH ✓] ${l.ward} ${l.address || ""} | price=${l.price}万 | area=${l.landSize ?? l.area ?? "?"}㎡ | walk=${l.walkMinutes ?? "?"}min | station=${l.station ?? "?"} | matches=${orderLabels || "all"}`
      );
    }
    const logFailed = failed.slice(0, 5);
    for (const l of logFailed) {
      logger.info(
        `[MATCH ✗] ${l.ward} ${l.address || ""} | price=${l.price}万 | area=${l.landSize ?? l.area ?? "?"}㎡ | FAILED filters`
      );
    }
    if (passed.length > 10) logger.info(`  ... and ${passed.length - 10} more passed listings`);
    if (failed.length > 5) logger.info(`  ... and ${failed.length - 5} more failed listings`);

    logger.info("Scrape complete", {
      rawTotal: allListings.length,
      passedFilters: passed.length,
      rejectedByFilters: failed.length,
      rejectionBreakdown: stats.reasons,
    });

    // Attach matched order indices for frontend to save match records
    const listingsWithMatches = passed.map((l: any) => ({
      ...l,
      matchedOrderIndices: l.matchedOrderIndices,
    }));

    res.json({
      ok: true,
      source,
      areas: codes,
      rawTotal: allListings.length,
      listings: listingsWithMatches,
      filterStats: stats,
      orderCriteria: criteria,
      areaResults,
    });
  } catch (error) {
    logger.error("Scrape error", { error });
    res.status(500).json({ error: String(error) });
  }
});