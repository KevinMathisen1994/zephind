import puppeteer from "puppeteer";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


const CATEGORY_MAP: Record<string, string> = {
  "土地": "land",
  "一戸建て": "house",
  "マンション": "mansion",
  "収益物件": "mansion",
};

async function extractListings(page: any, propertyType: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", `
    var items = Array.from(document.querySelectorAll("a")).filter(function(a) {
      return (a.textContent && a.textContent.includes("詳細")) || (a.href && (a.href.includes("/detail/") || a.href.includes("/bk/")));
    }).map(function(a) {
      var p = a.parentElement;
      while (p && p.tagName !== "BODY") {
        if (p.textContent.includes("万円") || p.textContent.includes("億")) return p;
        p = p.parentElement;
      }
      return null;
    }).filter(Boolean);

    items = items.filter(function(item, pos) { return items.indexOf(item) === pos; });
    var results = [];

    items.forEach(function(el) {
      if (!el) return;
      var linkEl = Array.from(el.querySelectorAll("a")).find(function(a) {
        return (a.textContent && a.textContent.includes("詳細")) || (a.href && (a.href.includes("/detail/") || a.href.includes("/bk/")));
      });
      var url = linkEl ? linkEl.getAttribute("href") : null;
      if (url && !url.startsWith("http")) url = "https://www.odakyu-chukai.com" + (url.startsWith("/") ? "" : "/") + url;

      var text = el.textContent || "";
      var price = 0;
      var okuMatch = text.match(/([\\d,]+(?:\\.\\d+)?)億/);
      var manMatch = text.match(/([\\d,]+(?:\\.\\d+)?)万/);
      if (okuMatch || manMatch) {
        var oku = okuMatch ? parseFloat(okuMatch[1].replace(/,/g, "")) * 10000 : 0;
        var man = manMatch ? parseFloat(manMatch[1].replace(/,/g, "")) : 0;
        price = oku + man;
      } else {
        var numMatch = text.match(/([\\d,]+)\\s*万円/);
        if (numMatch) price = parseFloat(numMatch[1].replace(/,/g, ""));
      }

      var address = "";
      var station = "";
      var walkMinutes = null;
      var area = 0;
      var landSize = null;
      var floorArea = null;

      var addrMatch = text.match(/(東京都[^\\s]*区[^\\s]*)/) || text.match(/(.*区[^\\s]+)/);
      if (addrMatch) address = addrMatch[1].trim();

      var stM = text.match(/([^\\s]+駅)/);
      if (stM) station = stM[1];
      var wkM = text.match(/徒歩(\\d+)分/);
      if (wkM) walkMinutes = parseInt(wkM[1], 10);

      var aM = text.match(/([\\d,.]+)\\s*(?:㎡|m)/);
      if (aM) {
        var parsed = parseFloat(aM[1].replace(/,/g, ""));
        if (propertyType === "mansion") floorArea = parsed;
        else landSize = parsed;
      }

      var ward = "";
      // Strip the prefecture first: /(.{2,4}[区市])/ scanned over
      // "東京都杉並区…" matches "京都杉並区" — it is greedy from the left and
      // the 東 lands outside the capture. This is the source of the corrupt
      // ward values ("京都町田市") seen in the listings table.
      var wm = address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "").match(/^(.{1,4}?[区市])/);
      if (wm) ward = wm[1];

      area = propertyType === "mansion" ? (floorArea || 0) : (landSize || 0);

      if (address && price) {
        results.push({
          address: address,
          ward: ward,
          price: price,
          area: area,
          landSize: landSize || undefined,
          floorArea: floorArea || undefined,
          source: "odakyu",
          url: url || undefined,
          station: station || undefined,
          walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
          propertyType: propertyType,
        });
      }
    });

    return JSON.stringify(results);
  `), propertyType);
  return JSON.parse(raw);
}

export async function scrapeOdakyu(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const allListings: PropertyListing[] = [];
  const scrapeErrors: string[] = [];
  const seenSignatures = new Set<string>();

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    const typesToScrape = filterTypes?.length ? filterTypes : ["土地"];

    for (const type of typesToScrape) {
      const typePath = CATEGORY_MAP[type];
      if (!typePath) continue;

      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        // e.g. https://www.odakyu-chukai.com/land/list/a=13106/
        const url = `https://www.odakyu-chukai.com/${typePath}/list/a=${areaCode}/${currentPage > 1 ? '?page=' + currentPage : ''}`;
        logger.info(`[Odakyu Scraper] Fetching: ${url}`);

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await new Promise((r) => setTimeout(r, 1500));

        const isNoResult = await page.evaluate(() => {
          const text = document.body.textContent || "";
          return text.includes("該当する物件") || text.includes("条件に一致する物件は見つかりませんでした");
        });

        if (isNoResult) {
          logger.info(`[Odakyu Scraper] Explicit no result message on page ${currentPage}`);
          break;
        }

        const listings = await extractListings(page, type);
        logger.info(`[Odakyu Scraper] Extracted ${listings.length} listings from page ${currentPage}`);

        if (listings.length === 0) break;

        let addedCount = 0;
        for (const item of listings) {
          const sig = `${item.address}-${item.price}-${item.area}`;
          if (!seenSignatures.has(sig)) {
            seenSignatures.add(sig);
            allListings.push(item);
            addedCount++;
          }
        }

        if (addedCount === 0) break;

        const nextButtonVisible = await page.evaluate(() => {
          const next = Array.from(document.querySelectorAll("a")).find(
            (a) => a.textContent && a.textContent.includes("次へ")
          );
          return !!next;
        });

        if (nextButtonVisible && currentPage < config.maxPagesPerSite) {
          currentPage++;
        } else {
          hasNextPage = false;
        }
      }
    }
  } catch (error: any) {
    logger.error(`[Odakyu Scraper] Error during scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "odakyu",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}
