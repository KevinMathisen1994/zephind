import puppeteer from "puppeteer";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


// Area code -> pref/ward code for nomu-pro
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

async function extractListings(page: any): Promise<PropertyListing[]> {
  const raw = await page.evaluate(() => {
    // The main container for each property seems to be an element containing .c_bldg_box__foot
    var items = Array.from(document.querySelectorAll(".c_bldg_box__foot")).map(function(foot) {
      return foot.parentElement || foot;
    });

    var results: any[] = [];

    items.forEach(function(el) {
      if (!el) return;
      
      // The canonical detail link is /pro/bukken_local_id/<code>/ and sits
      // directly on the card. The old code grabbed the 資料請求 (inquiry form)
      // button instead and tried to rebuild a /pro/detail/<id>/ URL from its
      // query string — that id is an inquiry id, not a property id, and when the
      // regex missed it left the raw relative inquiry path as the listing URL.
      var linkEl = el.querySelector("a[href*='/pro/bukken_local_id/']");
      var url = linkEl ? linkEl.getAttribute("href") : null;
      if (!url && el.id) url = "/pro/bukken_local_id/" + el.id + "/";
      if (url && !/^https?:/.test(url)) url = "https://www.nomu.com" + url;
      
      var col2 = el.querySelector(".col_2");
      if (!col2) return;
      
      var propertyType = "";
      var categoryTag = el.querySelector(".tag__category");
      if (categoryTag) {
        propertyType = categoryTag.textContent.trim();
      }

      var address = "";
      var station = "";
      var walkMinutes = null;
      var price = 0;
      var yieldRate = null;
      var area = 0;
      var landSize = null;
      var floorArea = null;
      var age = "";
      var layout = "";

      // Address
      var addrDl = col2.querySelector("dl.address");
      if (addrDl) {
        var dd = addrDl.querySelector("dd");
        if (dd) address = dd.textContent.trim();
      }
      
      // Transport
      var transDl = col2.querySelector("dl.transport");
      if (transDl) {
        var tdd = transDl.querySelector("dd");
        if (tdd) {
          station = tdd.textContent.trim();
          var wkM = station.match(/徒歩(\d+)分/);
          if (wkM) walkMinutes = parseInt(wkM[1], 10);
        }
      }

      var ward = "";
      // Strip the prefecture first: /(.{2,4}[区市])/ scanned over
      // "東京都杉並区…" matches "京都杉並区" — it is greedy from the left and
      // the 東 lands outside the capture. This is the source of the corrupt
      // ward values ("京都町田市") seen in the listings table.
      var wm = address.replace(/^東京都|^北海道|^[^\s]{2,3}[府県]/, "")
        // Drop a 郡 (county) prefix — the municipality follows it,
        // e.g. 西多摩郡瑞穂町 -> 瑞穂町.
        .replace(/^[^\s]{1,4}郡/, "")
        // 市/区 BEFORE 町/村: one combined [区市町村] class matches 武蔵村
        // inside 武蔵村山市. The 町/村 fallback covers 島嶼部 (大島町, 八丈町,
        // 檜原村, 小笠原村) and 郡部, which previously extracted no ward at all.
        .match(/^(.{1,6}?[市区])/)
        || address.replace(/^東京都|^北海道|^[^\s]{2,3}[府県]/, "").replace(/^[^\s]{1,4}郡/, "").match(/^(.{1,5}?[町村])/);
      if (wm) ward = wm[1];

      // Price
      var priceWrap = col2.querySelector(".price_wrap .price");
      if (priceWrap) {
        var priceText = priceWrap.textContent.replace(/\s+/g, "");
        var okuMatch = priceText.match(/([\d,]+(?:\.\d+)?)億/);
        var manMatch = priceText.match(/([\d,]+(?:\.\d+)?)万/);
        if (okuMatch || manMatch) {
          var oku = okuMatch ? parseFloat(okuMatch[1].replace(/,/g, "")) * 10000 : 0;
          var man = manMatch ? parseFloat(manMatch[1].replace(/,/g, "")) : 0;
          price = oku + man;
        } else {
          var numMatch = priceText.match(/([\d,]+)/);
          if (numMatch) price = parseFloat(numMatch[1].replace(/,/g, ""));
        }
      }

      // Yield
      var yieldWrap = col2.querySelector(".yield_wrap .yield");
      if (yieldWrap) {
        var yText = yieldWrap.textContent.trim();
        var yM = yText.match(/([\d.]+)/);
        if (yM) yieldRate = parseFloat(yM[1]);
      }

      // Other info blocks
      var infos = col2.querySelectorAll("dl.info");
      infos.forEach(function(dl) {
        var dt = dl.querySelector("dt");
        var dd = dl.querySelector("dd");
        if (!dt || !dd) return;
        var label = dt.textContent.trim();
        var val = dd.textContent.trim();
        
        if (label.includes("面積")) {
          var aM = val.match(/([\d,.]+)\s*m/);
          if (aM) {
            var parsed = parseFloat(aM[1].replace(/,/g, ""));
            if (label.includes("土地")) landSize = parsed;
            else floorArea = parsed;
          }
        } else if (label.includes("築年月")) {
          age = val;
        } else if (label.includes("間取り")) {
          layout = val;
        }
      });
      
      // Determine primary area
      area = landSize || floorArea || 0;

      results.push({
        address: address,
        ward: ward,
        price: price || 0,
        area: area,
        landSize: landSize || undefined,
        floorArea: floorArea || undefined,
        source: "nomu_pro",
        url: url || undefined,
        station: station || undefined,
        walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
        propertyType: propertyType || "収益物件",
        layout: layout || undefined,
        age: age || undefined,
        // PropertyListing DOES have `yield` — the old comment was wrong and the
        // value was being stringified into `description`, so buyer criteria like
        // minYield could never match against it. This is the investment-property
        // source, so yield is one of the most valuable fields it provides.
        yield: yieldRate != null ? yieldRate : undefined,
        description: yieldRate ? "表面利回り: " + yieldRate + "%" : undefined,
      });
    });

    return JSON.stringify(results);
  });
  return JSON.parse(raw);
}

export async function scrapeNomuPro(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
  const prefAndCode = CODE_TO_PREF_URL[areaCode];
  if (!prefAndCode) {
      logger.warn(`[Nomu Pro Scraper] No mapping for ward code ${areaCode}, skipping`);
    return { listings: [], source: "nomu_pro", areaCode, scrapedAt: Date.now(), count: 0 };
  }

  logger.info(`[Nomu Pro Scraper] Starting scrape`, { areaCode, prefAndCode });

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

    let currentPage = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      // nomu.com/pro/all/area/13106/?p=1
      const url = `https://www.nomu.com/pro/all/area/${areaCode}/?p=${currentPage}`;
      logger.info(`[Nomu Pro Scraper] Fetching: ${url}`);
      
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 1500));
      
      const isNoResult = await page.evaluate(() => {
        const text = document.body.textContent || "";
        return text.includes("該当する物件") || text.includes("お探しの条件に一致する物件は見つかりませんでした");
      });

      if (isNoResult) {
        logger.info(`[Nomu Pro Scraper] Explicit no result message on page ${currentPage}`);
        break;
      }

      const listings = await extractListings(page);
      logger.info(`[Nomu Pro Scraper] Extracted ${listings.length} listings from page ${currentPage}`);

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
        const next = Array.from(document.querySelectorAll(".c_pager__next a, a")).find(a => a.textContent && a.textContent.includes("次へ"));
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
  } catch (error: any) {
    logger.error(`[Nomu Pro Scraper] Error during scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "nomu_pro",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}
