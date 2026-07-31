import puppeteer from "puppeteer";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


// Area code → url path mapping for Nomu
// Format: https://www.nomu.com/{type}/area_{pref}/{code}/
// e.g. https://www.nomu.com/land/area_tokyo/13106/
const CODE_TO_PREF_URL: Record<string, string> = {
  "13101": "tokyo/13101", "13102": "tokyo/13102", "13103": "tokyo/13103",
  "13104": "tokyo/13104", "13105": "tokyo/13105", "13106": "tokyo/13106",
  "13107": "tokyo/13107", "13108": "tokyo/13108", "13109": "tokyo/13109",
  "13110": "tokyo/13110", "13111": "tokyo/13111", "13112": "tokyo/13112",
  "13113": "tokyo/13113", "13114": "tokyo/13114", "13115": "tokyo/13115",
  "13116": "tokyo/13116", "13117": "tokyo/13117", "13118": "tokyo/13118",
  "13119": "tokyo/13119", "13120": "tokyo/13120", "13121": "tokyo/13121",
  "13122": "tokyo/13122", "13123": "tokyo/13123",
};

const CATEGORY_MAP: Record<string, string> = {
  "土地": "land",
  "一戸建て": "house",
  "マンション": "mansion",
  "収益物件": "mansion",
};

async function extractListings(page: any, propertyType: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", `
    var items = Array.from(document.querySelectorAll("a.click_R_link")).map(function(a) {
      var d = a.closest("div");
      if (d && d.querySelector("table")) return d;
      var p = a.parentElement;
      while (p && p.tagName !== "BODY") {
        if (p.querySelector("table")) return p;
        p = p.parentElement;
      }
      return null;
    }).filter(Boolean);

    // Deduplicate
    items = items.filter(function(item, pos) { return items.indexOf(item) == pos; });
    var results = [];

    items.forEach(function(el) {
      if (!el) return;
      var linkEl = el.querySelector("a.click_R_link");
      if (!linkEl) return;
      
      var url = linkEl.getAttribute("href");
      if (url && !url.startsWith("http")) url = "https://www.nomu.com" + url;
      
      var tr = el.querySelector("table tbody tr");
      if (!tr) return;
      
      var tds = tr.querySelectorAll("td");
      if (tds.length < 5) return;
      
      var addressTd = tds[1];
      var address = "";
      var station = "";
      var walkMinutes = null;
      if (addressTd) {
        var ps = addressTd.querySelectorAll("p");
        if (ps.length >= 2) {
          address = ps[0].textContent.trim();
          var stationText = ps[1].textContent.trim();
          var stM = stationText.match(/([^\\s]+駅)/);
          if (stM) station = stM[1];
          var wkM = stationText.match(/徒歩(\\d+)分/);
          if (wkM) walkMinutes = parseInt(wkM[1], 10);
        } else {
          address = addressTd.textContent.trim();
        }
      }
      
      var ward = "";
      // Strip the prefecture first: /(.{2,4}[区市])/ scanned over
      // "東京都杉並区…" matches "京都杉並区" — it is greedy from the left and
      // the 東 lands outside the capture. This is the source of the corrupt
      // ward values ("京都町田市") seen in the listings table.
      var wm = address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "")
        // Drop a 郡 (county) prefix — the municipality follows it,
        // e.g. 西多摩郡瑞穂町 -> 瑞穂町.
        .replace(/^[^\\s]{1,4}郡/, "")
        // 市/区 BEFORE 町/村: one combined [区市町村] class matches 武蔵村
        // inside 武蔵村山市. The 町/村 fallback covers 島嶼部 (大島町, 八丈町,
        // 檜原村, 小笠原村) and 郡部, which previously extracted no ward at all.
        .match(/^(.{1,6}?[市区])/)
        || address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "").replace(/^[^\\s]{1,4}郡/, "").match(/^(.{1,5}?[町村])/);
      if (wm) ward = wm[1];

      var priceTd = tds[2];
      var price = 0;
      if (priceTd) {
        var priceText = priceTd.textContent.replace(/\\s+/g, "");
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

      var areaTd = tds[3];
      var landSize = 0;
      var floorArea = 0;
      if (areaTd) {
        var areaText = areaTd.textContent.trim();
        var aM = areaText.match(/([\\d,.]+)\\s*m/);
        if (aM) {
          if (propertyType === "mansion") floorArea = parseFloat(aM[1].replace(/,/g, ""));
          else landSize = parseFloat(aM[1].replace(/,/g, ""));
        }
      }

      var statsTd = tds[4];
      var bcr = null;
      var far = null;
      var layout = "";
      var age = "";
      
      if (statsTd) {
        var statsText = statsTd.textContent.replace(/\\s+/g, " ");
        var pcts = statsText.match(/(\\d+)%/g);
        if (pcts && pcts.length >= 2) {
          bcr = parseFloat(pcts[0]);
          far = parseFloat(pcts[1]);
        }
        
        if (propertyType === "mansion" || propertyType === "kodate") {
           var ageMatch = statsText.match(/(\\d{4}年\\d+月)/);
           if (ageMatch) age = ageMatch[1];
           var layoutMatch = areaTd.textContent.match(/([\\d]+[LDKS]+)/);
           if (layoutMatch) layout = layoutMatch[1];
        }
      }

      results.push({
        address: address,
        ward: ward,
        price: price || 0,
        area: propertyType === "mansion" ? floorArea : landSize,
        landSize: landSize || undefined,
        floorArea: floorArea || undefined,
        source: "nomu",
        url: url || undefined,
        station: station || undefined,
        walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
        buildingCoverageRatio: bcr !== null ? bcr : undefined,
        floorAreaRatio: far !== null ? far : undefined,
        propertyType: propertyType,
        layout: layout || undefined,
        age: age || undefined,
      });
    });

    return JSON.stringify(results);
  `), propertyType);
  return JSON.parse(raw);
}

export async function scrapeNomu(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
  const prefAndCode = CODE_TO_PREF_URL[areaCode];
  if (!prefAndCode) {
    logger.warn(`[Nomu Scraper] No mapping for ward code ${areaCode}, skipping`);
    return { listings: [], source: "nomu", areaCode, scrapedAt: Date.now(), count: 0 };
  }

  logger.info(`[Nomu Scraper] Starting scrape`, { areaCode, prefAndCode });

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
        const url = `https://www.nomu.com/${typePath}/area_${prefAndCode}/?p=${currentPage}`;
        logger.info(`[Nomu Scraper] Fetching: ${url}`);
        
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await new Promise((r) => setTimeout(r, 1500));
        
        const isNoResult = await page.evaluate(() => {
          const text = document.body.textContent || "";
          return text.includes("該当する物件") || text.includes("お探しの条件に一致する物件は見つかりませんでした");
        });

        if (isNoResult) {
          logger.info(`[Nomu Scraper] Explicit no result message on page ${currentPage}`);
          break;
        }

        const listings = await extractListings(page, type);
        logger.info(`[Nomu Scraper] Extracted ${listings.length} listings from page ${currentPage}`);

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
          const next = document.querySelector(".pager_next a, .next a");
          if (next) return true;
          const as = document.querySelectorAll("a");
          for (let i = 0; i < as.length; i++) {
            if (as[i].textContent?.includes("次へ")) return true;
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
    logger.error(`[Nomu Scraper] Error during scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "nomu",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}
