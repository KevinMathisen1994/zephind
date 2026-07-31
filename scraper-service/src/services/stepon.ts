import puppeteer from "puppeteer";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


const CATEGORY_MAP: Record<string, string> = {
  "土地": "tochi",
  "一戸建て": "ikkodate",
  "マンション": "mansion",
  "収益物件": "mansion",
};

async function extractListings(page: any, propertyType: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", `
    // Sumitomo Step uses 'post_param blank_window' for the main property links
    var items = Array.from(document.querySelectorAll("a.post_param.blank_window")).map(function(a) {
      // Find the closest container that contains the dl lists
      var p = a.parentElement;
      while (p && p.tagName !== "BODY") {
        if (p.querySelector("dl") && p.textContent.includes("価格")) return p;
        p = p.parentElement;
      }
      return null;
    }).filter(Boolean);

    // Deduplicate
    items = items.filter(function(item, pos) { return items.indexOf(item) == pos; });
    var results = [];

    items.forEach(function(el) {
      if (!el) return;
      
      var linkEl = el.querySelector("a.post_param.blank_window");
      var url = linkEl ? linkEl.getAttribute("href") : null;
      if (url && !url.startsWith("http")) {
        url = "https://www.stepon.co.jp" + (url.startsWith("/") ? "" : "/") + url;
      }
      
      var price = 0;
      var address = "";
      var station = "";
      var area = 0;
      var walkMinutes = null;
      var landSize = null;
      var floorArea = null;
      var layout = "";
      var age = "";

      var dls = el.querySelectorAll("dl");
      dls.forEach(function(dl) {
        var dt = dl.querySelector("dt");
        var dd = dl.querySelector("dd");
        if (!dt || !dd) return;
        
        var label = dt.textContent.trim();
        var val = dd.textContent.trim();
        
        if (label === "価格") {
          var priceText = val.replace(/\\s+/g, "");
          var okuMatch = priceText.match(/([\\d,]+(?:\\.\\d+)?)億/);
          var manMatch = priceText.match(/([\\d,]+(?:\\.\\d+)?)万/);
          if (okuMatch || manMatch) {
            var oku = okuMatch ? parseFloat(okuMatch[1].replace(/,/g, "")) * 10000 : 0;
            var man = manMatch ? parseFloat(manMatch[1].replace(/,/g, "")) : 0;
            price = oku + man;
          } else {
            var numMatch = priceText.match(/([\\d,]+)/);
            if (numMatch) price = parseFloat(numMatch[1].replace(/,/g, ""));
          }
        } else if (label === "所在地") {
          address = val;
        } else if (label === "交通") {
          station = val.split(" ")[0];
          var wkM = val.match(/徒歩(\\d+)分/);
          if (wkM) walkMinutes = parseInt(wkM[1], 10);
        } else if (label === "土地面積") {
          var aM = val.match(/([\\d,.]+)/);
          if (aM) landSize = parseFloat(aM[1].replace(/,/g, ""));
        } else if (label === "専有面積" || label === "建物面積") {
          var fM = val.match(/([\\d,.]+)/);
          if (fM) floorArea = parseFloat(fM[1].replace(/,/g, ""));
        } else if (label === "間取り") {
          layout = val;
        } else if (label === "築年月") {
          age = val;
        }
      });
      
      var ward = "";
      // Strip the prefecture first: /(.{2,4}[区市])/ scanned over
      // "東京都杉並区…" matches "京都杉並区" — it is greedy from the left and
      // the 東 lands outside the capture. This is the source of the corrupt
      // ward values ("京都町田市") seen in the listings table.
      var wm = address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "").match(/^(.{1,4}?[区市])/);
      if (wm) ward = wm[1];

      area = propertyType === "tochi" ? (landSize || 0) : (floorArea || 0);

      if (address && price) {
        results.push({
          address: address,
          ward: ward,
          price: price,
          area: area,
          landSize: landSize || undefined,
          floorArea: floorArea || undefined,
          source: "stepon",
          url: url || undefined,
          station: station || undefined,
          walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
          propertyType: propertyType,
          layout: layout || undefined,
          age: age || undefined,
        });
      }
    });

    return JSON.stringify(results);
  `), propertyType);
  return JSON.parse(raw);
}

export async function scrapeStepon(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
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
    // For Stepon, Tokyo is area_13. The areaCode is already prefCode + cityCode, e.g. 13106
    const prefCode = areaCode.substring(0, 2); 
    const cityCode = areaCode.substring(2);

    for (const type of typesToScrape) {
      const typePath = CATEGORY_MAP[type];
      if (!typePath) continue;

      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        const url = currentPage === 1 ? `https://www.stepon.co.jp/${typePath}/area_${prefCode}/list_${prefCode}_${cityCode}/` : `https://www.stepon.co.jp/${typePath}/area_${prefCode}/list_${prefCode}_${cityCode}/?page=${currentPage}`;
        logger.info(`[Stepon Scraper] Fetching: ${url}`);
        
        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
        
        try {
          await page.waitForSelector("dl dt", { timeout: 8000 });
        } catch (e) {
          logger.info(`[Stepon Scraper] No listings or timed out on page ${currentPage}`);
          break;
        }

        const listings = await extractListings(page, type);
        logger.info(`[Stepon Scraper] Extracted ${listings.length} listings from page ${currentPage}`);

        if (listings.length === 0) {
          break;
        }

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
          const next = document.querySelector(".pager li.next a, a.next");
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
    logger.error(`[Stepon Scraper] Error during scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "stepon",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}
