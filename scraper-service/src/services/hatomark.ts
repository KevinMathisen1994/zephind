import puppeteer from "puppeteer";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


const TOKYO_WARD_MAP: Record<string, string> = {
  "13101": "千代田区", "13102": "中央区", "13103": "港区",
  "13104": "新宿区", "13105": "文京区", "13106": "台東区",
  "13107": "墨田区", "13108": "江東区", "13109": "品川区",
  "13110": "目黒区", "13111": "大田区", "13112": "世田谷区",
  "13113": "渋谷区", "13114": "中野区", "13115": "杉並区",
  "13116": "豊島区", "13117": "北区", "13118": "荒川区",
  "13119": "板橋区", "13120": "練馬区", "13121": "足立区",
  "13122": "葛飾区", "13123": "江戸川区",
};

async function extractListings(page: any, pType: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("wardMap", "pt", `
    var results = [];
    var items = document.querySelectorAll(".search-result-box.detail-link");

    items.forEach(function(el) {
      // Address
      var addrEl = el.querySelector(".address");
      var address = addrEl ? addrEl.textContent?.trim() || "" : "";
      if (!address) return;

      // Determine ward from address
      var ward = "";
      for (var key in wardMap) {
        var name = wardMap[key];
        if (address.indexOf(name) !== -1) { ward = name; break; }
      }
      if (!ward) {
        var wm = address.match(/(東京都)?(.{2,4}区)/);
        if (wm) ward = wm[2];
      }

      // Price: find row with "価格" title
      var price = null;
      var detailRows = el.querySelectorAll(".room-detail-title");
      detailRows.forEach(function(titleEl) {
        if (titleEl.textContent?.trim() === "価格") {
          var valEl = titleEl.closest(".col")?.querySelector(".room-detail-value");
          if (valEl) {
            var text = valEl.textContent?.trim() || "";
            var cleaned = text.replace(/[\\s,]/g, "");
            var firstPart = cleaned.split(/[~〜-]/)[0];
            var okuMatch = firstPart.match(/([\\d,]+(?:\\.\\d+)?)億/);
            var manMatch = firstPart.match(/([\\d,]+(?:\\.\\d+)?)万/);
            if (okuMatch || manMatch) {
              var oku = okuMatch ? parseFloat(okuMatch[1].replace(/,/g, "")) * 10000 : 0;
              var man = manMatch ? parseFloat(manMatch[1].replace(/,/g, "")) : 0;
              price = oku + man;
            } else {
              var simpleMatch = firstPart.match(/(\\d+(?:\\.\\d+)?)/);
              if (simpleMatch) price = parseFloat(simpleMatch[1]);
            }
          }
        }
      });

      // Land area
      var area = null;
      detailRows.forEach(function(titleEl) {
        if (titleEl.textContent?.trim() === "土地面積") {
          var valEl = titleEl.closest(".col")?.querySelector(".room-detail-value");
          if (valEl) {
            var m = valEl.textContent?.trim().match(/([\\d,.]+)㎡/);
            if (m) area = parseFloat(m[1].replace(/,/g, ""));
          }
        }
      });

      // Building floor area (ビル listings show this instead of/alongside 土地面積)
      var floorArea = null;
      detailRows.forEach(function(titleEl) {
        if (titleEl.textContent?.trim() === "建物延面積") {
          var valEl = titleEl.closest(".col")?.querySelector(".room-detail-value");
          if (valEl) {
            var m = valEl.textContent?.trim().match(/([\\d,.]+)㎡/);
            if (m) floorArea = parseFloat(m[1].replace(/,/g, ""));
          }
        }
      });

      // BCR / FAR from "建・容率"
      var bcr = null;
      var far = null;
      detailRows.forEach(function(titleEl) {
        if (titleEl.textContent?.trim() === "建・容率") {
          var valEl = titleEl.closest(".col")?.querySelector(".room-detail-value");
          if (valEl) {
            var m = valEl.textContent?.trim().match(/([\\d.]+)％[・\\s]*([\\d.]+)％/);
            if (m) { bcr = parseFloat(m[1]); far = parseFloat(m[2]); }
          }
        }
      });

      // Station / walk from traffic section
      var station = "";
      var walkMinutes = null;
      var trafficEl = el.querySelector(".traffic");
      if (trafficEl) {
        var firstLine = trafficEl.querySelector("div");
        if (firstLine) {
          var text = firstLine.textContent?.trim() || "";
          var stM = text.match(/([^\\s]+駅)/);
          if (stM) station = stM[1];
          var wkM = text.match(/徒歩\\s*(\\d+)\\s*分/);
          if (wkM) walkMinutes = parseInt(wkM[1]);
        }
      }

      // Detail URL
      var detailBtn = el.querySelector("a.detail-btn");
      var url = "";
      if (detailBtn) {
        var href = detailBtn.getAttribute("href") || "";
        url = href.startsWith("http") ? href : "https://www.hatomarksite.com" + href;
      }

      results.push({
        address: address,
        ward: ward,
        price: price || 0,
        area: area || floorArea || 0,
        landSize: area || 0,
        floorArea: floorArea || undefined,
        source: "hatomark",
        station: station || undefined,
        walkMinutes: walkMinutes ?? undefined,
        buildingCoverageRatio: bcr ?? undefined,
        floorAreaRatio: far ?? undefined,
        url: url || undefined,
        propertyType: pt,
      });
    });

    return JSON.stringify(results);
  `), TOKYO_WARD_MAP, pType);
  return JSON.parse(raw);
}

export async function scrapeHatomark(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
  const wardName = TOKYO_WARD_MAP[areaCode] || areaCode;
  logger.info(`[Hatomark Scraper] Starting scrape`, { ward: wardName, areaCode });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const allListings: PropertyListing[] = [];

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    // "office" is hatomark's for-sale building category (事務所・店舗・ビル) —
    // confirmed against the site's own nav, which uses "office" under buy/ and
    // reserves "biz/office" for the separate rent/ section. Its search results
    // title reads "〜の売事務所の検索結果".
    const catMap: Record<string, string> = {
      land: "土地",
      house: "一戸建て",
      mansion: "マンション",
      office: "ビル",
    };
    const categories = filterTypes && filterTypes.length > 0
      ? Object.entries(catMap).filter(([, label]) => filterTypes.includes(label)).map(([key]) => key)
      : Object.keys(catMap);

    if (categories.length === 0) {
      logger.info(`[Hatomark Scraper] No matching categories for ${wardName}, skipping`);
      return { listings: [], source: "hatomark", areaCode, scrapedAt: Date.now(), count: 0 };
    }

    const MAX_PAGES = 20;
    const seenUrls = new Set<string>();

    for (const cat of categories) {
      logger.info(`[Hatomark Scraper] Category ${cat} for ${wardName}...`);
      let totalExpected = 0;

      for (let p = 1; p <= MAX_PAGES; p++) {
        const url = `https://www.hatomarksite.com/search/zentaku/buy/${cat}/area/13/list?m_adr[]=${areaCode}&page=${p}`;
        logger.info(`[Hatomark Scraper] Loading page ${p} (${cat}) for ${wardName}...`);

        try {
          await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
        } catch {
          // Some categories (e.g. office/ビル) keep a network connection open
          // past networkidle2's quiet window — the navigation call reports a
          // timeout, but the DOM has already rendered by then. Don't bail
          // here; fall through to the selector wait below, which is the real
          // signal for "did content actually show up".
          logger.warn(`[Hatomark Scraper] goto reported timeout on page ${p}, checking DOM anyway`);
        }

        try {
          await page.waitForSelector(".search-result-box.detail-link", { timeout: 15000 });
        } catch {
          logger.warn(`[Hatomark Scraper] No listings on page ${p}, stopping`);
          break;
        }

        await new Promise((r) => setTimeout(r, 2000));

        // Get total expected count from page 1
        if (p === 1) {
          totalExpected = await page.evaluate(() => {
            const m = document.body?.textContent?.match(/(\d+)\s*件/);
            return m ? parseInt(m[1]) : 0;
          });
          logger.info(`[Hatomark Scraper] Total expected: ${totalExpected}`);
        }

        const listings = await extractListings(page, catMap[cat]);

        // Dedup against previously seen URLs
        const newListings = listings.filter((l) => {
          if (!l.url) return true;
          if (seenUrls.has(l.url)) return false;
          seenUrls.add(l.url);
          return true;
        });

        if (newListings.length === 0) {
          logger.info(`[Hatomark Scraper] Page ${p}: no new listings, stopping`);
          break;
        }

        logger.info(`[Hatomark Scraper] Page ${p}: ${newListings.length} new listings (total: ${allListings.length + newListings.length})`);
        allListings.push(...newListings);

        // Stop if we've collected all expected listings
        if (totalExpected > 0 && allListings.length >= totalExpected) {
          logger.info(`[Hatomark Scraper] Reached expected total (${totalExpected}), stopping`);
          break;
        }
      }
    }

    logger.info(
      `[Hatomark Scraper] Scrape complete: ${allListings.length} properties`,
      { ward: wardName, pages: Math.min(allListings.length, 20) }
    );
    allListings.slice(0, 5).forEach((l, i) => {
      logger.info(
        `[Hatomark Scraper]   [${i}] ${l.ward} ${l.address} | price=${l.price}万 | land=${l.landSize}㎡ | walk=${l.walkMinutes ?? "?"}min | station=${l.station ?? "?"} | bcr=${l.buildingCoverageRatio ?? "?"}% | far=${l.floorAreaRatio ?? "?"}%`
      );
    });

    return {
      listings: allListings,
      source: "hatomark",
      areaCode,
      scrapedAt: Date.now(),
      count: allListings.length,
    };
  } finally {
    await browser.close();
    logger.info(`[Hatomark Scraper] Browser closed`);
  }
}
