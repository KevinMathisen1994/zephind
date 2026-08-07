import puppeteer from "puppeteer";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


const CATEGORY_MAP: Record<string, string> = {
  "土地": "tochi",
  "一戸建て": "ikkodate",
  "マンション": "mansion",
  "収益物件": "mansion",
  // "投資・事業用不動産" (investment/business real estate) — confirmed live at
  // rehouse.co.jp/buy/tohshi/... ; card structure and /bkdetail/ detail links
  // are identical to the other categories, so no extraction changes needed.
  "ビル": "tohshi",
};

async function extractListings(page: any, propertyType: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", `
    // Mitsui Rehouse search results are typically in a list of property cards
    // The "詳細を見る" (See Details) link is a good anchor for a property card
    var items = Array.from(document.querySelectorAll("a")).filter(function(a) { return (a.textContent && a.textContent.includes("詳細を見る")) || (a.href && a.href.includes("/bkdetail/")); }).map(function(a) {
      // Go up until we find a container that has an h2 (the title)
      var p = a.parentElement;
      while (p && p.tagName !== "BODY") {
        if (p.querySelector("h2")) return p;
        p = p.parentElement;
      }
      return null;
    }).filter(Boolean);

    // Deduplicate array
    items = items.filter(function(item, pos) { return items.indexOf(item) == pos; });
    var results = [];

    items.forEach(function(el) {
      if (!el) return;
      
      var linkEl = Array.from(el.querySelectorAll("a")).find(function(a) { return (a.textContent && a.textContent.includes("詳細を見る")) || (a.href && a.href.includes("/bkdetail/")); });
      var url = linkEl ? linkEl.getAttribute("href") : null;
      if (url && !url.startsWith("http")) url = "https://www.rehouse.co.jp" + url;
      
      var h2 = el.querySelector("h2");
      if (!h2) return;
      var title = h2.textContent.trim();
      
      var ward = "";
      // Strip the prefecture first: /(.{2,4}[区市])/ scanned over
      // "東京都杉並区…" matches "京都杉並区" — it is greedy from the left and
      // the 東 lands outside the capture. This is the source of the corrupt
      // ward values ("京都町田市") seen in the listings table.
      var wm = title.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "")
        // Drop a 郡 (county) prefix — the municipality follows it,
        // e.g. 西多摩郡瑞穂町 -> 瑞穂町.
        .replace(/^[^\\s]{1,4}郡/, "")
        // 市/区 BEFORE 町/村: one combined [区市町村] class matches 武蔵村
        // inside 武蔵村山市. The 町/村 fallback covers 島嶼部 (大島町, 八丈町,
        // 檜原村, 小笠原村) and 郡部, which previously extracted no ward at all.
        .match(/^(.{1,6}?[市区])/)
        || title.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "").replace(/^[^\\s]{1,4}郡/, "").match(/^(.{1,5}?[町村])/);
      if (wm) ward = wm[1];

      // Price: usually a span inside a p tag or div, looking for "万円"
      var price = 0;
      var priceElements = Array.from(el.querySelectorAll("p, div, span")).filter(function(node) {
        return node.textContent.includes("万円") || node.textContent.includes("億");
      });
      
      if (priceElements.length > 0) {
        // Take the most specific one containing price
        var priceText = priceElements[priceElements.length - 1].textContent.replace(/\\s+/g, "");
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
      }

      // Address, Area, Station, BCR, FAR are usually in adjacent <p> tags
      var address = "";
      var station = "";
      var walkMinutes = null;
      var area = 0;
      var landSize = null;
      var floorArea = null;
      var bcr = null;
      var far = null;
      var layout = "";
      var age = "";

      var ps = Array.from(el.querySelectorAll("p"));
      ps.forEach(function(p) {
        var text = p.textContent.trim();
        
        // Match address / station
        if (text.match(/区/) && text.match(/駅/) && text.includes("/")) {
          var parts = text.split("/");
          address = parts[0].trim();
          var stationPart = parts[1] || "";
          
          var stM = stationPart.match(/([^\\s]+駅)/);
          if (stM) station = stM[1];
          var wkM = stationPart.match(/徒歩(\\d+)分/);
          if (wkM) walkMinutes = parseInt(wkM[1], 10);
        }
        else if (text.match(/区/) && address === "") {
          address = text; // Fallback
        }
        
        // Match area / coverage
        if (text.match(/㎡/) || text.match(/建ぺい率/) || text.match(/容積率/)) {
          var aM = text.match(/([\\d,.]+)\\s*(?:㎡|m)/);
          if (aM) {
            var parsed = parseFloat(aM[1].replace(/,/g, ""));
            if (propertyType === "mansion") floorArea = parsed;
            else landSize = parsed;
          }
          var bM = text.match(/建ぺい率(\\d+)%/);
          if (bM) bcr = parseFloat(bM[1]);
          var fM = text.match(/容積率(\\d+)%/);
          if (fM) far = parseFloat(fM[1]);
        }
        
        // Layout
        if (text.match(/^\\d[LDKS]+$/)) {
          layout = text;
        }
        
        // Age
        if (text.match(/築年月/)) {
          var ageMatch = text.match(/(\\d{4}年\\d+月)/);
          if (ageMatch) age = ageMatch[1];
        }
      });
      
      // Secondary fallback for layout and age inside layout strings like "3LDK / 1999年10月"
      ps.forEach(function(p) {
        var text = p.textContent.trim();
        if (text.includes("LDK") && text.includes("年")) {
          var lM = text.match(/([\\d]+[LDKS]+)/);
          if (lM && !layout) layout = lM[1];
          var aM = text.match(/(\\d{4}年\\d+月)/);
          if (aM && !age) age = aM[1];
        }
      });
      
      if (!address) {
        var w = title.match(/(.*区[^\\s]+)/);
        if (w) address = w[1];
      }

      area = propertyType === "mansion" ? (floorArea || 0) : (landSize || 0);

      if (address && price) {
        results.push({
          address: address,
          ward: ward,
          price: price,
          area: area,
          landSize: landSize || undefined,
          floorArea: floorArea || undefined,
          source: "mitsui",
          url: url || undefined,
          station: station || undefined,
          walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
          buildingCoverageRatio: bcr !== null ? bcr : undefined,
          floorAreaRatio: far !== null ? far : undefined,
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

export async function scrapeMitsui(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
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
    const prefCode = "13"; // Tokyo is 13

    for (const type of typesToScrape) {
      const typePath = CATEGORY_MAP[type];
      if (!typePath) continue;

      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        // e.g. https://www.rehouse.co.jp/buy/tochi/prefecture/13/city/13106/?page=1
        const url = `https://www.rehouse.co.jp/buy/${typePath}/prefecture/${prefCode}/city/${areaCode}/?page=${currentPage}`;
        logger.info(`[Mitsui Scraper] Fetching: ${url}`);
        
        // This site is slow and intermittently stalls a page load. The goto used
        // to be unguarded, so a single timeout threw straight out of BOTH loops
        // and abandoned every remaining category — the scrape returned partial
        // results with no indication that most of it never ran. Treat a failed
        // page as the end of THIS category and carry on with the next.
        try {
          // Kept deliberately short: domcontentloaded on a healthy page here is
          // a few seconds, so a 45s wait already means the page has stalled.
          // A longer limit just multiplies dead time across categories — at 90s
          // the whole scrape blew past 4 minutes.
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        } catch (navErr: any) {
          logger.warn(`[Mitsui Scraper] Page ${currentPage} (${type}) failed to load: ${navErr?.message}`);
          break;
        }

        try {
          await page.waitForSelector("a[href*='/bkdetail/']", { timeout: 8000 });
        } catch (e) {
          logger.info(`[Mitsui Scraper] No listings or timed out on page ${currentPage}`);
          break;
        }

        const listings = await extractListings(page, type);
        logger.info(`[Mitsui Scraper] Extracted ${listings.length} listings from page ${currentPage}`);

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
          const as = document.querySelectorAll("a");
          for (let i = 0; i < as.length; i++) {
            if (as[i].textContent?.includes("次の") || as[i].textContent?.trim() === ">") return true;
          }
          return false;
        });

        if (nextButtonVisible && currentPage < config.maxPagesPerSite) {
          currentPage++;
        } else {
          hasNextPage = false;
        }
      }
    }
  } catch (error: any) {
    logger.error(`[Mitsui Scraper] Error during scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "mitsui",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}
