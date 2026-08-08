import puppeteer from "puppeteer";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


const CATEGORY_MAP: Record<string, string> = {
  "土地": "Tochi",
  "一戸建て": "Kodate",
  "マンション": "Mansion",
  "収益物件": "Mansion",
};

// ビル (投資用・事業用) lives on a SEPARATE URL namespace, /investors/ instead
// of /buyers/, with its own area code scheme that has NO relation to the JIS
// municipality codes used everywhere else in this codebase (including this
// file's own /buyers/ URLs two lines below) — e.g. area_13 here is 港区, not
// "all Tokyo" the way JIS code 13 (the Tokyo prefecture code) would suggest.
// Every one of these 23 codes was verified individually against the live
// site's own page title (not guessed/pattern-matched) before being wired up.
const INVESTORS_WARD_CODE: Record<string, string> = {
  "13101": "11", "13102": "12", "13103": "13", "13104": "18",
  "13105": "19", "13106": "1a", "13107": "2b", "13108": "2c",
  "13109": "14", "13110": "16", "13111": "15", "13112": "26",
  "13113": "17", "13114": "24", "13115": "25", "13116": "1b",
  "13117": "21", "13118": "28", "13119": "22", "13120": "23",
  "13121": "27", "13122": "29", "13123": "2a",
};

async function extractListings(page: any, propertyType: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", `
    // The site renders one <div class="bukkenItemBox"> per listing on the
    // final /list/ results page. Earlier this walked up from any "詳細"/
    // "/buyers/" anchor looking for an ancestor containing "万円" — but the
    // ward-level URL (without the trailing /list/) is actually an
    // intermediate "choose a town" filter page, not results, so that walk
    // matched nav/breadcrumb links instead and returned garbage (e.g. the
    // "エリアから探す" link text as a fake address, "#main" as the url).
    var items = Array.from(document.querySelectorAll(".bukkenItemBox"));
    var results = [];

    items.forEach(function(el) {
      if (!el) return;
      // /buyers/property/... for the residential categories, but
      // /investors/property/... for ビル (see scrapeMizuho's investors/
      // branch) — same card template, different section prefix.
      var linkEl = el.querySelector('a[href^="/buyers/property/"]') || el.querySelector('a[href^="/investors/property/"]');
      var url = linkEl ? linkEl.getAttribute("href") : null;
      if (url && !url.startsWith("http")) url = "https://www.mizuho-re.co.jp" + (url.startsWith("/") ? "" : "/") + url;

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
        if (propertyType === "Mansion") floorArea = parsed;
        else landSize = parsed;
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

      area = propertyType === "Mansion" ? (floorArea || 0) : (landSize || 0);

      if (address && price) {
        results.push({
          address: address,
          ward: ward,
          price: price,
          area: area,
          landSize: landSize || undefined,
          floorArea: floorArea || undefined,
          source: "mizuho",
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

export async function scrapeMizuho(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
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

    if (typesToScrape.includes("ビル")) {
      const investorsCode = INVESTORS_WARD_CODE[areaCode];
      if (!investorsCode) {
        logger.info(`[Mizuho Scraper] No /investors/ area mapping for ${areaCode} (only the 23 special wards are covered), skipping ビル`);
      } else {
        let currentPage = 1;
        let hasNextPage = true;

        while (hasNextPage) {
          const url = `https://www.mizuho-re.co.jp/investors/search/area/all_building/area_${investorsCode}/list/?page=${currentPage}&limit_value=60`;
          logger.info(`[Mizuho Scraper] Fetching (investors/ビル): ${url}`);

          await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
          await new Promise((r) => setTimeout(r, 1500));

          const itemCount = await page.evaluate(() => document.querySelectorAll(".bukkenItemBox").length);
          if (itemCount === 0) {
            logger.info(`[Mizuho Scraper] No ビル listings on page ${currentPage}`);
            break;
          }

          const listings = await extractListings(page, "ビル");
          logger.info(`[Mizuho Scraper] Extracted ${listings.length} ビル listings from page ${currentPage}`);

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

          const hasNextHref = await page.evaluate(() => {
            const next = Array.from(document.querySelectorAll("a")).find(
              (a) => a.textContent && a.textContent.includes("次へ")
            );
            return !!(next && next.getAttribute("href"));
          });

          if (hasNextHref && currentPage < config.maxPagesPerSite) {
            currentPage++;
          } else {
            hasNextPage = false;
          }
        }
      }
    }

    for (const type of typesToScrape) {
      const typePath = CATEGORY_MAP[type];
      if (!typePath) continue;

      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        // The bare .../city_<code>/ URL is an intermediate "choose a town"
        // filter page (title says the right ward, but it's a chooser, not
        // results — it always carries a hidden "no listings" template in the
        // DOM, and the real detail links live behind a client-side form
        // submit). The actual results page needs a trailing /list/, and
        // limit_value=60 asks for the max page size so most wards resolve in
        // one request instead of walking a JS-only "次へ" control.
        const url = `https://www.mizuho-re.co.jp/buyers/search/area/type_${typePath}/pref_13/city_${areaCode}/list/?page=${currentPage}&limit_value=60`;
        logger.info(`[Mizuho Scraper] Fetching: ${url}`);

        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
        await new Promise((r) => setTimeout(r, 1500));

        const itemCount = await page.evaluate(() => document.querySelectorAll(".bukkenItemBox").length);
        if (itemCount === 0) {
          logger.info(`[Mizuho Scraper] No listings on page ${currentPage}`);
          break;
        }

        const listings = await extractListings(page, type);
        logger.info(`[Mizuho Scraper] Extracted ${listings.length} listings from page ${currentPage}`);

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

        // The "次へ" link is always present in the paging markup, even on the
        // last page — there it renders with no href (just a style attribute)
        // so a real next page must have one to follow.
        const hasNextHref = await page.evaluate(() => {
          const next = Array.from(document.querySelectorAll("a")).find(
            (a) => a.textContent && a.textContent.includes("次へ")
          );
          return !!(next && next.getAttribute("href"));
        });

        if (hasNextHref && currentPage < config.maxPagesPerSite) {
          currentPage++;
        } else {
          hasNextPage = false;
        }
      }
    }
  } catch (error: any) {
    logger.error(`[Mizuho Scraper] Error during scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "mizuho",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}
