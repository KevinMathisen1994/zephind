import puppeteer from "puppeteer";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


async function extractListings(page: any, propertyType: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", `
    // Structured selectors, verified against the live PC layout. The previous
    // version walked up from any <a> until it hit a node containing "万円",
    // which grabbed oversized ancestors and produced garbage: addresses came out
    // as bare ward names because /(東京都[^\\s]*区[^\\s]*)/ stops at the space in
    // "東京都杉並区 成田東１丁目".
    // NOTE: this site serves a different (SP) layout without a desktop UA +
    // viewport, and .kokoku-list-data does not exist there.
    var rows = Array.prototype.slice.call(document.querySelectorAll(".kokoku-list-data"));
    var results = [];

    // This page is never filtered by type server-side — the same URL always
    // returns every genre mixed together (土地/戸建/マンション/...), and the old
    // code just stamped every row with whatever type the CALLER asked for.
    // Asking for one type meant every OTHER genre on the page got mislabelled
    // as it too. Each row carries its real genre in .genre span; read that
    // instead of trusting the request.
    var GENRE_MAP = { "戸建": "一戸建て", "土地": "土地", "マンション": "マンション" };

    rows.forEach(function(data) {
      if (!data) return;

      var genreEl = data.querySelector(".genre span");
      var genreText = genreEl ? genreEl.textContent.trim() : "";
      var realType = GENRE_MAP[genreText] || genreText || propertyType;

      // Price and the detail link live in a sibling .kokoku-list-condition
      // block; the nearest shared ancestor is <article class="data">.
      var priceTd = null, url = null, container = data.parentElement, hops = 0;
      while (container && container.tagName !== "BODY" && hops < 6) {
        var td = container.querySelector("td.kokoku-list-condition__price");
        if (td && td.textContent.indexOf("万") >= 0) {
          priceTd = td;
          var a = container.querySelector("a.abs_link, a[href*='/sale/2']");
          if (a) url = a.getAttribute("href");
          break;
        }
        container = container.parentElement; hops++;
      }
      if (!container) container = data;
      if (url && !url.startsWith("http")) url = "https://chukai.keiofudosan.co.jp" + (url.startsWith("/") ? "" : "/") + url;

      var price = 0;
      if (priceTd) {
        var priceText = priceTd.textContent.replace(/[\\s,]/g, "");
        var okuMatch = priceText.match(/([\\d,]+(?:\\.\\d+)?)億/);
        var manMatch = priceText.match(/([\\d,]+(?:\\.\\d+)?)万/);
        if (okuMatch || manMatch) {
          var oku = okuMatch ? parseFloat(okuMatch[1].replace(/,/g, "")) * 10000 : 0;
          var man = manMatch ? parseFloat(manMatch[1].replace(/,/g, "")) : 0;
          price = oku + man;
        }
      }

      // The address cell interleaves text with <a> filter links, so join its
      // text and drop the whitespace between segments rather than regexing.
      var address = "";
      var addrTd = data.querySelector("td.kokoku-list-data__address");
      if (addrTd) address = addrTd.textContent.replace(/\\s+/g, "").trim();

      var station = "", walkMinutes = null;
      var accessTd = data.querySelector("td.kokoku-list-data__access");
      if (accessTd) {
        var accessText = accessTd.textContent.replace(/\\s+/g, " ").trim();
        var stM = accessText.match(/([^\\s]+駅)/);
        if (stM) station = stM[1];
        var wkM = accessText.match(/徒歩(\\d+)分/);
        if (wkM) walkMinutes = parseInt(wkM[1], 10);
      }

      var buildYear = null;
      var ageTd = data.querySelector("td.kokoku-list-data__age");
      if (ageTd) {
        var byM = ageTd.textContent.match(/(\\d{4})年/);
        if (byM) buildYear = parseInt(byM[1], 10);
      }

      var landSize = null, floorArea = null;
      var landTd = container.querySelector("td.kokoku-list-condition__land_area");
      if (landTd) {
        var lM = landTd.textContent.match(/([\\d,.]+)\\s*(?:㎡|m)/);
        if (lM) landSize = parseFloat(lM[1].replace(/,/g, ""));
      }
      var layoutTd = container.querySelector("td.kokoku-list-condition__layout");
      var layout = "";
      if (layoutTd) {
        var lt = layoutTd.textContent.replace(/\\s+/g, " ").trim();
        layout = lt;
        var fM = lt.match(/([\\d,.]+)\\s*(?:㎡|m)/);
        if (fM) floorArea = parseFloat(fM[1].replace(/,/g, ""));
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

      // Was comparing against the literal string "mansion", which never
      // equals the Japanese labels actually passed in (or read as realType
      // above) — always fell through to the landSize/floorArea branch.
      var area = realType === "マンション" ? (floorArea || 0) : (landSize || floorArea || 0);

      if (address && price) {
        results.push({
          address: address,
          ward: ward,
          price: price,
          area: area,
          landSize: landSize || undefined,
          floorArea: floorArea || undefined,
          buildYear: buildYear || undefined,
          source: "keio",
          url: url || undefined,
          station: station || undefined,
          walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
          propertyType: realType,
          layout: layout || undefined,
        });
      }
    });

    return JSON.stringify(results);
  `), propertyType);
  return JSON.parse(raw);
}

export async function scrapeKeio(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
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

    {
      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        // e.g. https://chukai.keiofudosan.co.jp/sale/search/area/pref_13/city_106/
        const url = `https://chukai.keiofudosan.co.jp/sale/search/area/pref_13/city_${shortCityCode}/${currentPage > 1 ? '?page=' + currentPage : ''}`;
        logger.info(`[Keio Scraper] Fetching: ${url}`);

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await new Promise((r) => setTimeout(r, 1500));

        const isNoResult = await page.evaluate(() => {
          const text = document.body.textContent || "";
          return text.includes("該当する物件") || text.includes("条件に一致する物件は見つかりませんでした");
        });

        if (isNoResult) {
          logger.info(`[Keio Scraper] Explicit no result message on page ${currentPage}`);
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

        if (nextButtonVisible && currentPage < config.maxPagesPerSite) {
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
