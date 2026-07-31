import puppeteer from "puppeteer";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


const CODE_TO_WARD: Record<string, string> = {
  "13101": "千代田区", "13102": "中央区", "13103": "港区",
  "13104": "新宿区", "13105": "文京区", "13106": "台東区",
  "13107": "墨田区", "13108": "江東区", "13109": "品川区",
  "13110": "目黒区", "13111": "大田区", "13112": "世田谷区",
  "13113": "渋谷区", "13114": "中野区", "13115": "杉並区",
  "13116": "豊島区", "13117": "北区", "13118": "荒川区",
  "13119": "板橋区", "13120": "練馬区", "13121": "足立区",
  "13122": "葛飾区", "13123": "江戸川区",
};


async function extractListings(page: any): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function(`

    var items = document.querySelectorAll(".dottable--cassette");
    var results = [];

    items.forEach(function(el) {
      var getVal = function(label) {
        var dls = el.querySelectorAll(".dottable-line dl");
        for (var i = 0; i < dls.length; i++) {
          var dt = dls[i].querySelector("dt");
          if (dt && dt.textContent.trim() === label) {
            return dls[i].querySelector("dd")?.textContent?.trim() || "";
          }
        }
        return "";
      };

      var priceText = getVal("販売価格");
      var parsePrice = function(text) {
        if (!text) return 0;
        var cleaned = text.replace(/[\\s,]/g, "");
        var firstPart = cleaned.split(/[~〜-]/)[0];
        var okuMatch = firstPart.match(/([\\d,]+(?:\\.\\d+)?)億/);
        var manMatch = firstPart.match(/([\\d,]+(?:\\.\\d+)?)万/);
        if (okuMatch || manMatch) {
          var oku = okuMatch ? parseFloat(okuMatch[1].replace(/,/g, "")) * 10000 : 0;
          var man = manMatch ? parseFloat(manMatch[1].replace(/,/g, "")) : 0;
          return oku + man;
        }
        var simpleMatch = firstPart.match(/(\\d+(?:\\.\\d+)?)/);
        return simpleMatch ? parseFloat(simpleMatch[1]) : 0;
      };
      var price = parsePrice(priceText);

      var address = getVal("所在地") || "";

      var stationText = getVal("沿線・駅");
      var station = "";
      var walkMinutes = null;
      var stM = stationText.match(/([^\\s]+駅)/);
      if (stM) station = stM[1];
      var wkM = stationText.match(/徒歩(\\d+)分/);
      if (wkM) walkMinutes = parseInt(wkM[1], 10);

      var areaText = getVal("土地面積");
      var area = null;
      var aM = areaText.match(/([\\d,.]+)\\s*m[²2]/);
      if (aM) area = parseFloat(aM[1].replace(/,/g, ""));

      var bcrFarText = getVal("建ぺい率・容積率");
      var bcr = null;
      var far = null;
      var bfM = bcrFarText.match(/([\\d.]+)％[\\s・/]*([\\d.]+)％/);
      if (bfM) { bcr = parseFloat(bfM[1]); far = parseFloat(bfM[2]); }

      var layout = getVal("間取り");

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

      if (!address) return;

      // The detail link is NOT inside .dottable--cassette (it has no anchors at
      // all) — it lives on the enclosing .property_unit card. Walk up to find
      // it, otherwise every listing comes back with no URL.
      var url = "";
      var card = el.closest(".property_unit");
      var link = card ? card.querySelector('a[href*="/nc_"]') : null;
      if (link) {
        var href = link.getAttribute("href") || "";
        url = href.indexOf("http") === 0 ? href : "https://suumo.jp" + href;
      }

      results.push({
        address: address,
        ward: ward,
        price: price || 0,
        area: area || 0,
        landSize: area || 0,
        url: url || undefined,
        source: "suumo",
        station: station || undefined,
        walkMinutes: walkMinutes != null ? walkMinutes : undefined,
        buildingCoverageRatio: bcr != null ? bcr : undefined,
        floorAreaRatio: far != null ? far : undefined,
        layout: layout || undefined,
      });
    });

    return JSON.stringify(results);
  `));
  return JSON.parse(raw);
}

export async function scrapeSuumo(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
  const wardName = CODE_TO_WARD[areaCode] || areaCode;
  logger.info(`[Suumo Scraper] Starting scrape`, { ward: wardName, areaCode });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const allListings: PropertyListing[] = [];
  const seenSignatures = new Set<string>();

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    const MAX_PAGES = 10;
    const catMap: Record<string, string> = { "030": "土地", "020": "一戸建て", "010": "マンション" };
    const categories = filterTypes && filterTypes.length > 0
      ? Object.entries(catMap).filter(([, label]) => filterTypes.includes(label)).map(([key]) => key)
      : Object.keys(catMap);
    if (categories.length === 0) {
      logger.info(`[Suumo Scraper] No matching categories for ${wardName}, skipping`);
      return { listings: [], source: "suumo", areaCode, scrapedAt: Date.now(), count: 0 };
    }

    for (const bs of categories) {
      logger.info(`[Suumo Scraper] Category bs=${bs} for ${wardName}...`);

      for (let p = 1; p <= MAX_PAGES; p++) {
        const url = `https://suumo.jp/jj/bukken/ichiran/JJ010FJ001/?ar=030&bs=${bs}&ta=13&sc=${areaCode}&kb=1&kt=9999999&km=1&page=${p}`;
        logger.info(`[Suumo Scraper] Loading page ${p} (bs=${bs}) for ${wardName}...`);

        try {
          await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
        } catch {
          logger.warn(`[Suumo Scraper] Page ${p} failed to load`);
          break;
        }

        try {
          await page.waitForSelector(".dottable--cassette", { timeout: 15000 });
        } catch {
          logger.info(`[Suumo Scraper] No listings on page ${p}, stopping`);
          break;
        }

        await new Promise((r) => setTimeout(r, 2000));

        const listings = await extractListings(page);
        // Tag with property type based on category
        const typeLabel = bs === "030" ? "土地" : bs === "020" ? "一戸建て" : "マンション";
        for (const l of listings) {
          l.propertyType = typeLabel;
        }

        const newListings = listings.filter((l) => {
          const sig = `${l.address}|${l.price}`;
          if (seenSignatures.has(sig)) return false;
          seenSignatures.add(sig);
          return true;
        });

        if (newListings.length === 0) {
          logger.info(`[Suumo Scraper] Page ${p}: no new listings, stopping`);
          break;
        }

        logger.info(`[Suumo Scraper] Page ${p}: ${newListings.length} new listings (total: ${allListings.length + newListings.length})`);
        allListings.push(...newListings);
      }
    }

    logger.info(`[Suumo Scraper] Scrape complete: ${allListings.length} listings for ${wardName}`);
    allListings.slice(0, 5).forEach((l, i) => {
      logger.info(
        `[Suumo Scraper]   [${i}] ${l.ward} ${l.address} | price=${l.price}万 | land=${l.landSize}㎡ | walk=${l.walkMinutes ?? "?"}min | station=${l.station ?? "?"} | bcr=${l.buildingCoverageRatio ?? "?"}%`
      );
    });

    return {
      listings: allListings,
      source: "suumo",
      areaCode,
      scrapedAt: Date.now(),
      count: allListings.length,
    };
  } finally {
    await browser.close();
    logger.info(`[Suumo Scraper] Browser closed`);
  }
}
