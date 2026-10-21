import puppeteer from "../puppeteerStealth";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";

// This one URL returns every genre mixed together (see the comment above
// extractListings) — no per-genre filter exists. The shared
// config.maxPagesPerSite budget is sized for scrapers that page through ONE
// type per request, so it would only cover a fraction of a single type's real
// listings here. Give this file its own, higher cap instead of raising the
// shared default for every other (type-scoped) scraper.
const KEIO_MAX_PAGES = 20;

const TOKYO_WARD_MAP: Record<string, string> = {
  "13101": "千代田区", "13102": "中央区", "13103": "港区",
  "13104": "新宿区", "13105": "文京区", "13106": "台東区",
  "13107": "墨田区", "13108": "江東区", "13109": "品川区",
  "13110": "目黒区", "13111": "大田区", "13112": "世田谷区",
  "13113": "渋谷区", "13114": "中野区", "13115": "杉並区",
  "13116": "豊島区", "13117": "北区", "13118": "荒川区",
  "13119": "板橋区", "13120": "練馬区", "13121": "足立区",
  "13122": "葛飾区", "13123": "江戸川区", "13201": "八王子市",
  "13202": "立川市", "13203": "武蔵野市", "13204": "三鷹市",
  "13205": "青梅市", "13206": "府中市", "13207": "昭島市",
  "13208": "調布市", "13209": "町田市", "13210": "小金井市",
  "13211": "小平市", "13212": "日野市", "13213": "東村山市",
  "13214": "国分寺市", "13215": "国立市", "13218": "福生市",
  "13219": "狛江市", "13220": "東大和市", "13221": "清瀬市",
  "13222": "東久留米市", "13223": "武蔵村山市", "13224": "多摩市",
  "13225": "稲城市", "13227": "羽村市", "13228": "あきる野市",
  "13229": "西東京市",
};


async function extractListings(page: any, propertyType: string): Promise<PropertyListing[]> {
  return await page.evaluate((propertyType: string) => {
    const articles = Array.from(document.querySelectorAll("article.data"));
    const results: any[] = [];
    const GENRE_MAP: Record<string, string> = {
      "戸建": "一戸建て",
      "土地": "土地",
      "マンション": "マンション",
      "マンション（一棟）": "マンション",
    };

    articles.forEach((article) => {
      const genreEl = article.querySelector(".genre span");
      const genreText = genreEl ? genreEl.textContent?.trim() || "" : "";
      const realType = GENRE_MAP[genreText] || genreText || propertyType;

      const addrTd = article.querySelector("td.kokoku-list-data__address");
      const address = addrTd ? addrTd.textContent?.replace(/\s+/g, " ").trim() || "" : "";
      let ward = "";
      const wm = address.match(/([^都道府県\s]{2,4}[区市])/);
      if (wm) ward = wm[1];

      const accTd = article.querySelector("td.kokoku-list-data__access");
      const accText = accTd ? accTd.textContent?.trim() || "" : "";
      let station = "";
      let walkMinutes: number | undefined = undefined;
      if (accText) {
        const stM = accText.match(/([^\s]+駅)/);
        if (stM) station = stM[1];
        const wkM = accText.match(/徒歩\s*(\d+)\s*分/);
        if (wkM) walkMinutes = parseInt(wkM[1], 10);
      }

      const ageTd = article.querySelector("td.kokoku-list-data__age");
      const age = ageTd ? ageTd.textContent?.trim() : undefined;
      let buildYear: number | undefined = undefined;
      if (age) {
        const yM = age.match(/(\d{4})年/);
        if (yM) buildYear = parseInt(yM[1], 10);
      }

      // Find room detail rows or fall back to the article container
      const roomRows = Array.from(article.querySelectorAll("table.room_data tr.room-detail")).filter(
        (r) => r.querySelector("td.kokoku-list-condition__price")
      );
      const rowsToProcess = roomRows.length > 0 ? roomRows : [article];

      rowsToProcess.forEach((row) => {
        const fav = row.querySelector(".fav") || article.querySelector(".fav");
        const priceTd = row.querySelector("td.kokoku-list-condition__price");
        const priceText = priceTd
          ? priceTd.textContent?.replace(/[\s,]/g, "") || ""
          : (fav ? fav.getAttribute("data-price")?.replace(/[\s,]/g, "") || "" : "");

        let price = 0;
        const okuMatch = priceText.match(/([\d.]+)億/);
        const manMatch = priceText.match(/([\d.]+)万/);
        if (okuMatch || manMatch) {
          const oku = okuMatch ? parseFloat(okuMatch[1]) * 10000 : 0;
          const man = manMatch ? parseFloat(manMatch[1]) : 0;
          price = oku + man;
        } else {
          const numMatch = priceText.match(/([\d.]+)/);
          if (numMatch) price = parseFloat(numMatch[1]);
        }

        const linkEl = row.querySelector("a.abs_link, td.kokoku-list-condition__others2 a, a[href*='/sale/2']");
        let url = linkEl ? linkEl.getAttribute("href") : null;
        if (url && !url.startsWith("http")) {
          url = "https://chukai.keiofudosan.co.jp" + (url.startsWith("/") ? "" : "/") + url;
        }

        const landTd = row.querySelector("td.kokoku-list-condition__land_area");
        let landSize: number | undefined = undefined;
        if (landTd) {
          const lM = landTd.textContent?.match(/([\d,.]+)\s*(?:m|㎡)/);
          if (lM) landSize = parseFloat(lM[1].replace(/,/g, ""));
        }

        const layoutTd = row.querySelector("td.kokoku-list-condition__layout");
        let floorArea: number | undefined = undefined;
        let layout = "";
        if (layoutTd) {
          const layText = layoutTd.textContent?.trim() || "";
          const fM = layText.match(/([\d,.]+)\s*(?:m|㎡)/);
          if (fM) floorArea = parseFloat(fM[1].replace(/,/g, ""));
          const lMatch = layText.match(/^([1-9]\d?[SLDK]+|ワンルーム|1R)/i);
          if (lMatch) layout = lMatch[1];
        }

        const area = realType === "マンション" ? (floorArea || 0) : (landSize || floorArea || 0);

        if (address && price > 0) {
          results.push({
            address,
            ward,
            price,
            area,
            landSize,
            floorArea,
            buildYear,
            age,
            layout: layout || undefined,
            station: station || undefined,
            walkMinutes,
            url: url || undefined,
            source: "keio",
            propertyType: realType,
          });
        }
      });
    });

    return results;
  }, propertyType);
}

/**
 * 賃貸 (chintai) uses a completely different template from the 中古 cassette
 * above: one <article class="data"> per BUILDING (with the same
 * td.kokoku-list-data__* address/access/age cells as the buy side's card),
 * and inside it one <tr> per rentable UNIT in table.room_data — the same
 * "one building, many units" shape as suumo.ts's cassetteitem/tbody split.
 * Confirmed live per-ward via /rent/search/area/pref_13/city_{code}/: same
 * city_NNN codes as the buy side (areaCode.substring(2)) — and the
 * ?address[]= param the site's own nav decorates that URL with turned out to
 * be cosmetic; dropping it returns identical results.
 */
const KEIO_RENT_MAX_PAGES = 20;

async function extractChintaiListings(page: any): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function(`
    var GENRE_MAP = { "戸建": "一戸建て", "土地": "土地", "マンション": "マンション" };
    var txt = function(e) { return ((e && e.textContent) || "").replace(/\\s+/g, " ").trim(); };

    // "27万5000" or "11" (with a bare "万円" AFTER the </strong> tag when
    // there's no remainder) both have to parse — the caller reads the
    // <strong> text plus whatever text node immediately follows it, not the
    // <strong> alone.
    var parseManYen = function(text) {
      if (!text) return null;
      var t = text.replace(/[\\s,]/g, "");
      var m = t.match(/([\\d.]+)万([\\d.]+)?/);
      if (m) return parseFloat(m[1]) + (m[2] ? parseFloat(m[2]) / 10000 : 0);
      var y = t.match(/([\\d.]+)円/);
      return y ? parseFloat(y[1]) / 10000 : null;
    };

    var articles = Array.prototype.slice.call(document.querySelectorAll("article.data"));
    var results = [];

    articles.forEach(function(article) {
      var genreEl = article.querySelector(".genre span");
      var genreText = genreEl ? genreEl.textContent.trim() : "";
      var realType = GENRE_MAP[genreText] || genreText || undefined;

      var address = txt(article.querySelector("td.kokoku-list-data__address"));
      if (!address) return;

      var station = "", walkMinutes = null;
      var accessText = txt(article.querySelector("td.kokoku-list-data__access"));
      if (accessText) {
        var stM = accessText.match(/([^\\s]+駅)/);
        if (stM) station = stM[1];
        var wkM = accessText.match(/徒歩(\\d+)分/);
        if (wkM) walkMinutes = parseInt(wkM[1], 10);
      }

      var buildYear = null;
      var byM = txt(article.querySelector("td.kokoku-list-data__age")).match(/(\\d{4})年/);
      if (byM) buildYear = parseInt(byM[1], 10);

      var ward = "";
      var wm = address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "")
        .replace(/^[^\\s]{1,4}郡/, "")
        .match(/^(.{1,6}?[市区])/)
        || address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "").replace(/^[^\\s]{1,4}郡/, "").match(/^(.{1,5}?[町村])/);
      if (wm) ward = wm[1];

      var others1Cells = article.querySelectorAll("table.room_data td.kokoku-list-condition__others1");
      Array.prototype.slice.call(others1Cells).forEach(function(othersTd) {
        var row = othersTd.closest("tr");
        if (!row) return;

        var priceTd = row.querySelector(".kokoku-list-condition__price");
        var strongEl = priceTd ? priceTd.querySelector("strong.color_em") : null;
        var priceLine = strongEl ? (strongEl.textContent + ((strongEl.nextSibling && strongEl.nextSibling.textContent) || "")) : "";
        var rent = parseManYen(priceLine);
        if (rent == null) return;

        var managementFee = parseManYen(txt(priceTd ? priceTd.querySelector("span.pc") : null));

        // "敷金 1ヶ月 / 礼金 0ヶ月" — always a multiple of THIS unit's rent
        // here (confirmed live), never an absolute amount — unlike daikyo.ts.
        var depText = txt(row.querySelector(".kokoku-list-condition__deposit"));
        var depM = depText.match(/敷金\\s*([\\d.]+)\\s*ヶ月/);
        var reiM = depText.match(/礼金\\s*([\\d.]+)\\s*ヶ月/);
        var deposit = depM ? parseFloat(depM[1]) * rent : null;
        var keyMoney = reiM ? parseFloat(reiM[1]) * rent : null;

        var layoutText = txt(row.querySelector(".kokoku-list-condition__layout"));
        var layout = (layoutText.split("/")[0] || "").trim();
        var areaM = layoutText.match(/([\\d.]+)\\s*(?:㎡|m)/);
        var area = areaM ? parseFloat(areaM[1]) : null;

        var floor = null;
        var floorM = txt(row.querySelector(".kokoku-list-condition__floor")).match(/(\\d+)\\s*階/);
        if (floorM) floor = parseInt(floorM[1], 10);

        var linkEl = row.querySelector(".kokoku-list-condition__others1 a.abs_link");
        var url = linkEl ? linkEl.getAttribute("href") : null;
        if (url && url.indexOf("http") !== 0) url = "https://chukai.keiofudosan.co.jp" + (url.charAt(0) === "/" ? "" : "/") + url;
        if (!url) return;

        results.push({
          address: address,
          ward: ward,
          price: rent,
          rent: rent,
          managementFee: managementFee != null ? managementFee : undefined,
          deposit: deposit != null ? deposit : undefined,
          keyMoney: keyMoney != null ? keyMoney : undefined,
          area: area != null ? area : undefined,
          floorArea: area != null ? area : undefined,
          buildYear: buildYear != null ? buildYear : undefined,
          floor: floor != null ? floor : undefined,
          layout: layout || undefined,
          station: station || undefined,
          walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
          url: url,
          source: "keio",
          propertyType: realType,
          dealType: "rent",
        });
      });
    });

    return JSON.stringify(results);
  `));
  return JSON.parse(raw);
}

async function scrapeKeioChintai(areaCode: string): Promise<ScrapeResult> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const allListings: PropertyListing[] = [];
  const seenUrls = new Set<string>();

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    const shortCityCode = areaCode.length === 5 ? areaCode.substring(2) : areaCode;

    let currentPage = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      const url = `https://chukai.keiofudosan.co.jp/rent/search/area/pref_13/city_${shortCityCode}/${currentPage > 1 ? "?page=" + currentPage : ""}`;
      logger.info(`[Keio Scraper] Fetching (賃貸): ${url}`);

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 2000));

      const articleCount = await page.evaluate(() => document.querySelectorAll("article.data").length);
      if (articleCount === 0) {
        logger.info(`[Keio Scraper] No 賃貸 listings on page ${currentPage}`);
        break;
      }

      const listings = await extractChintaiListings(page);
      logger.info(`[Keio Scraper] Extracted ${listings.length} 賃貸 listings from page ${currentPage}`);

      const newListings = listings.filter((l) => {
        if (!l.url || seenUrls.has(l.url)) return false;
        seenUrls.add(l.url);
        return true;
      });
      if (newListings.length === 0) {
        logger.info(`[Keio Scraper] 賃貸 page ${currentPage}: no new listings, stopping`);
        break;
      }
      allListings.push(...newListings);

      const nextButtonVisible = await page.evaluate(() => {
        const next = Array.from(document.querySelectorAll("a")).find(
          (a) => a.textContent && a.textContent.includes("次へ")
        );
        return !!next;
      });

      if (nextButtonVisible && currentPage < KEIO_RENT_MAX_PAGES) {
        currentPage++;
      } else {
        hasNextPage = false;
      }
    }

    logger.info(`[Keio Scraper] 賃貸 scrape complete: ${allListings.length} listings for ${areaCode}`);
    return { listings: allListings, source: "keio", areaCode, scrapedAt: Date.now(), count: allListings.length };
  } finally {
    await browser.close();
  }
}

export async function scrapeKeio(areaCode: string, filterTypes?: string[], dealType?: "buy" | "rent"): Promise<ScrapeResult> {
  if (dealType === "rent") {
    return await scrapeKeioChintai(areaCode);
  }

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

    // The URL below carries no type filter at all — one request always
    // returns every genre mixed together, and extractListings now reads each
    // row's real genre off the page (see GENRE_MAP) rather than trusting
    // whatever was requested. So there is exactly one page to walk here,
    // regardless of how many types were asked for.
    const shortCityCode = areaCode.length === 5 ? areaCode.substring(2) : areaCode;
    const wardName = TOKYO_WARD_MAP[areaCode] ? `東京都${TOKYO_WARD_MAP[areaCode]}` : "東京都";

    {
      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        const pageParam = currentPage > 1 ? `&page=${currentPage}` : '';
        const url = `https://chukai.keiofudosan.co.jp/sale/search/area/pref_13/city_${shortCityCode}/?address[]=${encodeURIComponent(wardName)}&ftlsflg=1${pageParam}`;
        logger.info(`[Keio Scraper] Fetching: ${url}`);

        await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
        try {
          await page.waitForSelector(".kokoku-list-data:not(.skeleton_table_wrap), article.data", { timeout: 15000 });
        } catch {
          logger.info(`[Keio Scraper] No listings or timed out on page ${currentPage}`);
          break;
        }

        // Fallback label only, for the rare row whose .genre text doesn't
        // match GENRE_MAP — real rows get their propertyType from the page.
        const listings = await extractListings(page, "土地");
        logger.info(`[Keio Scraper] Extracted ${listings.length} listings from page ${currentPage}`);

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

        if (nextButtonVisible && currentPage < KEIO_MAX_PAGES) {
          currentPage++;
        } else {
          hasNextPage = false;
        }
      }
    }
  } catch (error: any) {
    logger.error(`[Keio Scraper] Error during scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "keio",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}
