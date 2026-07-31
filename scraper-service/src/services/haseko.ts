import puppeteer from "puppeteer";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


/**
 * Property-type path segment. The previous values ("tochi", "house", "mansion")
 * were wrong for two of three types: /syutoken-buy/tochi/... and
 * /syutoken-buy/kodate/... both return HTTP 404 (the site's own 404 page, which
 * has no listings, hence "loads in 9s and extracts nothing"). The real slugs,
 * taken from the site's own area navigation at
 * /syutoken-buy/{type}/areas/tokyoto/, are land / house / mansion.
 */
const CATEGORY_MAP: Record<string, string> = {
  "土地": "land",
  "一戸建て": "house",
  "マンション": "mansion",
  "収益物件": "mansion",
};

// Verified one-by-one against the anchors on
// https://www.haseko-chukai.com/syutoken-buy/mansion/areas/tokyoto/
const WARD_SLUG_MAP: Record<string, string> = {
  "13101": "chiyodaku", "13102": "chuoku", "13103": "minatoku",
  "13104": "shinjukuku", "13105": "bunkyoku", "13106": "taitoku",
  "13107": "sumidaku", "13108": "kotoku", "13109": "shinagawaku",
  "13110": "meguroku", "13111": "otaku", "13112": "setagayaku",
  "13113": "shibuyaku", "13114": "nakanoku", "13115": "suginamiku",
  "13116": "toshimaku", "13117": "kitaku", "13118": "arakawaku",
  "13119": "itabashiku", "13120": "nerimaku", "13121": "adachiku",
  "13122": "katsushikaku", "13123": "edogawaku",
};

async function extractListings(page: any, propertyType: string, typePath: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", "typePath", `
    // Structured selectors, verified against the live PC layout of
    // /syutoken-buy/{land|house|mansion}/tokyoto/{slug}-city/.
    //
    // The previous version collected every <a> whose text contained "詳細" and
    // then walked up until an ancestor mentioned "万円". That grabbed oversized
    // ancestors and, worse, the list rows carry NO visible street address at
    // all — only 交通 (access). So the address regex fell through to
    // /(.*区[^\\s]+)/ over the whole blob and produced junk.
    //
    // The real address is an attribute: <input class="inquiry" address="東京都杉並区井草２丁目">
    // inside .box_check. That is the only place the full address appears on the
    // list page.
    var rows = Array.prototype.slice.call(document.querySelectorAll("#box_main > ul > li"));
    var results = [];
    var txt = function(e) { return ((e && e.textContent) || "").replace(/\\s+/g, " ").trim(); };
    var num = function(s) {
      if (!s) return null;
      var m = String(s).match(/([\\d,]+(?:\\.\\d+)?)/);
      if (!m) return null;
      var v = parseFloat(m[1].replace(/,/g, ""));
      return isNaN(v) ? null : v;
    };

    rows.forEach(function(row) {
      // Non-property <li> (banners, etc.) have no price block.
      var priceEl = row.querySelector("ul.box_price_main li.price");
      if (!priceEl) return;

      // "8,999万円" / "1億979万円"
      var price = 0;
      var priceText = txt(priceEl).replace(/\\s/g, "");
      var okuMatch = priceText.match(/([\\d,]+(?:\\.\\d+)?)億/);
      var manMatch = priceText.match(/([\\d,]+(?:\\.\\d+)?)万/);
      if (okuMatch || manMatch) {
        var oku = okuMatch ? parseFloat(okuMatch[1].replace(/,/g, "")) * 10000 : 0;
        var man = manMatch ? parseFloat(manMatch[1].replace(/,/g, "")) : 0;
        price = oku + man;
      }

      var titleLink = row.querySelector(".box_name h3 a[href]");
      var url = titleLink ? titleLink.getAttribute("href") : null;
      if (url && url.indexOf("http") !== 0) {
        url = "https://www.haseko-chukai.com" + (url.charAt(0) === "/" ? "" : "/") + url;
      }

      // Full address lives only in this attribute. For 土地 rows the <h3> title
      // happens to be the address too, so use it as a fallback.
      var address = "";
      var inq = row.querySelector(".box_check input.inquiry[address]");
      if (inq) address = (inq.getAttribute("address") || "").replace(/\\s+/g, "").trim();
      if (!address && titleLink) {
        var t = txt(titleLink).replace(/^(?:土地|戸建て|中古マンション|新築[^\\s]*)/, "").replace(/\\s+/g, "");
        if (/^東京都/.test(t) || /[都道府県].*[区市]/.test(t)) address = t;
      }

      // .table_spec is a flat <dl> of dt/dd pairs: 間取り / 専有面積 / 建物面積 /
      // 土地面積 / 建ぺい率 / 容積率 / 完成時期.
      var spec = {};
      var dl = row.querySelector(".table_spec dl");
      if (dl) {
        var kids = Array.prototype.slice.call(dl.children);
        var key = null;
        for (var i = 0; i < kids.length; i++) {
          if (kids[i].tagName === "DT") key = txt(kids[i]);
          else if (kids[i].tagName === "DD" && key) { spec[key] = txt(kids[i]); key = null; }
        }
      }

      var landSize = num(spec["土地面積"]);
      if (landSize === null) landSize = num(txt(row.querySelector("li.square_land")).replace("土地面積", ""));
      var exclusive = num(spec["専有面積"]);
      var building = num(spec["建物面積"]);
      var isMansion = typePath === "mansion";
      // For a mansion the useful figure is 専有面積; 建物面積 is blank and
      // 土地面積 is the whole site (30,395㎡), which must not become "area".
      var floorArea = isMansion ? exclusive : (building || exclusive);

      var buildYear = null;
      var byM = (spec["完成時期"] || "").match(/(\\d{4})年/);
      if (byM) buildYear = parseInt(byM[1], 10);

      var bcr = num(spec["建ぺい率"]);
      var far = num(spec["容積率"]);

      var layout = spec["間取り"] || txt(row.querySelector("li.rooms"));
      if (layout === "-") layout = "";

      var yieldPct = null;
      var rateText = txt(row.querySelector("li.rate")).replace("利回り", "");
      var yM = rateText.match(/([\\d.]+)\\s*%/);
      if (yM) yieldPct = parseFloat(yM[1]);

      // "西武鉄道新宿線「井荻駅」徒歩11分"
      var station = "", walkMinutes = null;
      var accessText = txt(row.querySelector("dl.typo_access_address dd"));
      if (accessText) {
        var stM = accessText.match(/「([^」]+)」/) || accessText.match(/([^\\s]+駅)/);
        if (stM) station = stM[1];
        var wkM = accessText.match(/徒歩(\\d+)分/);
        if (wkM) walkMinutes = parseInt(wkM[1], 10);
      }

      // Strip the prefecture first: /(.{2,4}[区市])/ over "東京都杉並区..." is
      // greedy from the left and yielded "京都杉並区".
      var ward = "";
      var wm = address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "").match(/^(.{1,4}?[区市])/);
      if (wm) ward = wm[1];

      var area = isMansion ? (floorArea || 0) : (landSize || floorArea || 0);

      if (address && price) {
        results.push({
          address: address,
          ward: ward,
          price: price,
          area: area,
          landSize: landSize || undefined,
          floorArea: floorArea || undefined,
          buildYear: buildYear || undefined,
          buildingCoverageRatio: bcr || undefined,
          floorAreaRatio: far || undefined,
          source: "haseko",
          url: url || undefined,
          station: station || undefined,
          walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
          propertyType: propertyType,
          layout: layout || undefined,
          yield: yieldPct !== null ? yieldPct : undefined,
        });
      }
    });

    return JSON.stringify(results);
  `), propertyType, typePath);
  return JSON.parse(raw);
}

export async function scrapeHaseko(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const allListings: PropertyListing[] = [];
  const scrapeErrors: string[] = [];
  const seenSignatures = new Set<string>();

  try {
    const page = await browser.newPage();
    // Required: without a desktop UA + viewport the site serves an SP layout
    // that does not carry .table_spec / .box_check.
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    const typesToScrape = filterTypes?.length ? filterTypes : ["土地"];
    const slug = WARD_SLUG_MAP[areaCode];

    if (!slug) {
      logger.warn(`[Haseko Scraper] No ward mapping for code ${areaCode}`);
      return { listings: [], source: "haseko", areaCode, scrapedAt: Date.now(), count: 0 };
    }

    for (const type of typesToScrape) {
      const typePath = CATEGORY_MAP[type];
      if (!typePath) continue;

      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        // e.g. https://www.haseko-chukai.com/syutoken-buy/land/tokyoto/suginamiku-city/?page=2
        // The paging widget uses javascript:void(0), but ?page=N is honoured
        // server-side (verified: page 2 returns a different first detail id).
        const url = `https://www.haseko-chukai.com/syutoken-buy/${typePath}/tokyoto/${slug}-city/${currentPage > 1 ? '?page=' + currentPage : ''}`;
        logger.info(`[Haseko Scraper] Fetching: ${url}`);

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await new Promise((r) => setTimeout(r, 1500));

        // NOTE: do NOT gate on bodyText.includes("該当する物件"). Haseko ships a
        // hidden "該当する物件がありません" template on EVERY result page, so
        // that check was true even on the fully populated 杉並区 pages and
        // aborted the scrape before extraction. Count real rows instead.
        const rowCount = await page.evaluate(
          new Function(`return document.querySelectorAll("#box_main > ul > li ul.box_price_main").length;`) as any,
        );
        if (!rowCount) {
          logger.info(`[Haseko Scraper] No property rows on page ${currentPage}`);
          break;
        }

        const listings = await extractListings(page, type, typePath);
        logger.info(`[Haseko Scraper] Extracted ${listings.length} listings from page ${currentPage}`);

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

        // The pager renders <li class="next" data-page="2"> only when another
        // page exists; there is no "次へ" text anywhere on this site.
        const hasNext = await page.evaluate(
          new Function(`return !!document.querySelector(".list_paging li.next");`) as any,
        );

        if (hasNext && currentPage < config.maxPagesPerSite) {
          currentPage++;
        } else {
          hasNextPage = false;
        }
      }
    }
  } catch (error: any) {
    logger.error(`[Haseko Scraper] Error during scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "haseko",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}
