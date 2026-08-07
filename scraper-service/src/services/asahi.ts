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

// asahi-jutaku.co.jp keys its area search by romanized ward/city slug, not by
// JIS code (e.g. .../tokyo/shinjuku-city, not .../tokyo/13104). The old code
// put the numeric areaCode straight into that path segment, which the site
// doesn't recognize — it silently falls back to a prefecture-wide generic
// page that also carries a "similar properties from anywhere in Japan"
// recommendation module. That module is where the previous garbage came from
// (e.g. a Kobe-area listing/alert() string surfacing as a fake Tokyo listing).
const CODE_TO_SLUG: Record<string, string> = {
  "13101": "chiyoda-city", "13102": "chuo-city", "13103": "minato-city",
  "13104": "shinjuku-city", "13105": "bunkyo-city", "13106": "taito-city",
  "13107": "sumida-city", "13108": "koto-city", "13109": "shinagawa-city",
  "13110": "meguro-city", "13111": "ota-city", "13112": "setagaya-city",
  "13113": "shibuya-city", "13114": "nakano-city", "13115": "suginami-city",
  "13116": "toshima-city", "13117": "kita-city", "13118": "arakawa-city",
  "13119": "itabashi-city", "13120": "nerima-city", "13121": "adachi-city",
  "13122": "katsushika-city", "13123": "edogawa-city",
};

async function extractListings(page: any, propertyType: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", `
    // Each listing renders as its own <table> of "cellNN" <td>s inside
    // .SearchResult — one <tr> per property, not a repeating card class.
    var items = Array.from(document.querySelectorAll(".SearchResult tr")).filter(function(tr) {
      return tr.querySelector(".cell03");
    });
    var results = [];

    items.forEach(function(el) {
      if (!el) return;
      var linkEl = el.querySelector('.cell03 a[href*="/buy/detail/"]');
      var url = linkEl ? linkEl.getAttribute("href") : null;
      if (url && !url.startsWith("http")) url = "https://www.asahi-jutaku.co.jp" + (url.startsWith("/") ? "" : "/") + url;

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

      var aM = text.match(/([\\d,.]+)\\s*(?:㎡|m2)/);
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

      area = propertyType === "mansion" ? (floorArea || 0) : (landSize || 0);

      if (address && price) {
        results.push({
          address: address,
          ward: ward,
          price: price,
          area: area,
          landSize: landSize || undefined,
          floorArea: floorArea || undefined,
          source: "asahi",
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

export async function scrapeAsahi(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
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

    const slug = CODE_TO_SLUG[areaCode];
    if (!slug) {
      logger.info(`[Asahi Scraper] No known area slug for code ${areaCode}, skipping (asahi only covers Tokyo's 23 wards)`);
      return { listings: [], source: "asahi", areaCode, scrapedAt: Date.now(), count: 0 };
    }

    const typesToScrape = filterTypes?.length ? filterTypes : ["土地"];

    for (const type of typesToScrape) {
      const typePath = CATEGORY_MAP[type];
      if (!typePath) continue;

      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        // Path-based pagination (.../{slug}/2, .../{slug}/3, ...), not a query
        // string — and limit=100 covers every ward we've seen (well under 100
        // listings per type), so this loop rarely needs to go past page 1.
        const pagePart = currentPage > 1 ? `/${currentPage}` : "";
        const url = `https://www.asahi-jutaku.co.jp/buy/search_area/${typePath}/tokyo/${slug}${pagePart}?limit=100`;
        logger.info(`[Asahi Scraper] Fetching: ${url}`);

        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
        await new Promise((r) => setTimeout(r, 1500));

        const rowCount = await page.evaluate(() => document.querySelectorAll(".SearchResult tr").length);
        if (rowCount === 0) {
          logger.info(`[Asahi Scraper] No listings on page ${currentPage}`);
          break;
        }

        const listings = await extractListings(page, type);
        logger.info(`[Asahi Scraper] Extracted ${listings.length} listings from page ${currentPage}`);

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

        // The "次へ" control is a JS-driven <input type="button">, not an
        // <a> — a text search over anchors (the old check) never matched it.
        // The numbered pager links are real anchors, so look for one
        // pointing at the next page instead.
        const hasNextPageLink = await page.evaluate((next) => {
          return Array.from(document.querySelectorAll(".pager_view a")).some((a) => a.textContent?.trim() === String(next));
        }, currentPage + 1);

        if (hasNextPageLink && currentPage < config.maxPagesPerSite) {
          currentPage++;
        } else {
          hasNextPage = false;
        }
      }
    }
  } catch (error: any) {
    logger.error(`[Asahi Scraper] Error during scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "asahi",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}
