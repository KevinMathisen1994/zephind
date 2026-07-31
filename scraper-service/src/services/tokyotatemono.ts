import puppeteer from "puppeteer";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";

const BASE = "https://sumikae.ttfuhan.co.jp";

const CATEGORY_MAP: Record<string, string> = {
  "土地": "tochi",
  "一戸建て": "kodate",
  "マンション": "mansion",
  "収益物件": "mansion",
};

async function extractListings(
  page: any,
  propertyType: string,
  typePath: string,
): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", "typePath", `
    // Structured selectors, verified against the live PC layout of
    // /{tochi|kodate|mansion}/area-tokyo/{cityCode}/.
    //
    // The previous version collected every <a> and walked up until an ancestor
    // mentioned "万円". Combined with the wrong URL (?cities=13115, which is the
    // area-SEARCH FORM, not a result list) it matched the ward-navigation
    // checkbox labels, so addresses came out as "東京23区(122)" — a nav label
    // plus its result count — and no detail URL existed to pick up.
    //
    // Real row: <div class="item"> with
    //   h4.name > label > a.sbtn2_this   -> detail href + title
    //   .info-head span.kakaku           -> "1億7,000万円" / "9,480万円"
    //   .info-head span.senyu            -> 専有面積 (mansion) / 土地面積 (tochi)
    //   .info-head span.madori / span.kai
    //   .info-area p.add                 -> full address
    //   .info-area p.chiku               -> "2000年4月"
    //   .info-area p.tatemono / p.tochi  -> 建物面積 / 土地面積 (kodate)
    //   .info-area p.kotsu span          -> "「中野」駅 まで徒歩8分"
    var txt = function(e) { return ((e && e.textContent) || "").replace(/\\s+/g, " ").trim(); };
    var num = function(s) {
      if (!s) return null;
      var m = String(s).match(/([\\d,]+(?:\\.\\d+)?)/);
      if (!m) return null;
      var v = parseFloat(m[1].replace(/,/g, ""));
      return isNaN(v) ? null : v;
    };

    // .item is also used by unrelated widgets on this page; a property row is
    // exactly the one that carries both a price and a titled detail link.
    var rows = Array.prototype.slice.call(document.querySelectorAll(".item")).filter(function(el) {
      return el.querySelector("span.kakaku") && el.querySelector("h4.name a[href]");
    });
    var results = [];
    var isMansion = typePath === "mansion";

    rows.forEach(function(row) {
      // "1億7,000万円" and "9,480万円" both have to parse.
      var price = 0;
      var priceText = txt(row.querySelector("span.kakaku")).replace(/\\s/g, "");
      var okuMatch = priceText.match(/([\\d,]+(?:\\.\\d+)?)億/);
      var manMatch = priceText.match(/([\\d,]+(?:\\.\\d+)?)万/);
      if (okuMatch || manMatch) {
        var oku = okuMatch ? parseFloat(okuMatch[1].replace(/,/g, "")) * 10000 : 0;
        var man = manMatch ? parseFloat(manMatch[1].replace(/,/g, "")) : 0;
        price = oku + man;
      }

      var titleLink = row.querySelector("h4.name a[href]");
      var url = titleLink ? titleLink.getAttribute("href") : null;
      if (url && url.indexOf("http") !== 0) {
        url = "${BASE}" + (url.charAt(0) === "/" ? "" : "/") + url;
      }

      // p.add is the full address ("東京都杉並区西荻南３丁目"). For 土地/戸建て the
      // <a> title happens to repeat it; for マンション the title is the building
      // name, so never fall back to the title there.
      var address = txt(row.querySelector(".info-area p.add")).replace(/\\s+/g, "");
      if (!address && !isMansion && titleLink) {
        var t = txt(titleLink).replace(/\\s+/g, "");
        if (/^東京都/.test(t)) address = t;
      }
      var buildingName = isMansion ? txt(titleLink) : "";

      // 専有面積 (mansion) / 土地面積 (tochi) both live in span.senyu; 戸建て
      // splits them into p.tatemono (building) and p.tochi (land).
      var senyu = num(txt(row.querySelector("span.senyu")));
      var tatemono = num(txt(row.querySelector(".info-area p.tatemono")));
      var tochi = num(txt(row.querySelector(".info-area p.tochi")));

      var landSize = null, floorArea = null;
      if (isMansion) {
        floorArea = senyu;
      } else if (typePath === "kodate") {
        floorArea = tatemono;
        landSize = tochi !== null ? tochi : senyu;
      } else {
        landSize = senyu !== null ? senyu : tochi;
      }

      var layout = txt(row.querySelector("span.madori"));
      if (layout === "-") layout = "";

      // 築年月 "2000年4月"
      var buildYear = null;
      var byM = txt(row.querySelector(".info-area p.chiku")).match(/(\\d{4})年/);
      if (byM) buildYear = parseInt(byM[1], 10);

      // span.kai is "2階" for a mansion unit but "地上2階建" for a house, which
      // is a building height, not the unit's floor — only trust it for mansions.
      var floor = null;
      if (isMansion) {
        var fM = txt(row.querySelector("span.kai")).match(/(\\d+)\\s*階/);
        if (fM) floor = parseInt(fM[1], 10);
      }

      var totalUnits = null;
      var tuM = txt(row.querySelector(".info-area p.ko")).match(/(\\d+)\\s*戸/);
      if (tuM) totalUnits = parseInt(tuM[1], 10);

      // "「中野」駅 まで徒歩8分" — the station name sits inside the brackets and
      // 駅 is outside them, so rebuild it.
      var station = "", walkMinutes = null;
      var kotsu = txt(row.querySelector(".info-area p.kotsu span")) || txt(row.querySelector("p.kotsu"));
      if (kotsu) {
        var stM = kotsu.match(/「([^」]+)」\\s*駅/);
        if (stM) station = stM[1] + "駅";
        else {
          var stM2 = kotsu.match(/([^\\s「」]+駅)/);
          if (stM2) station = stM2[1];
        }
        var wkM = kotsu.match(/徒歩\\s*(\\d+)\\s*分/);
        if (wkM) walkMinutes = parseInt(wkM[1], 10);
      }

      // Strip the prefecture before matching the ward: a left-anchored
      // /(.{2,4}[区市])/ over "東京都杉並区..." yields "京都杉並区".
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
          source: "tokyotatemono",
          url: url || undefined,
          station: station || undefined,
          walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
          propertyType: propertyType,
          layout: layout || undefined,
          floor: floor !== null ? floor : undefined,
          totalUnits: totalUnits !== null ? totalUnits : undefined,
          description: buildingName || undefined,
        });
      }
    });

    return JSON.stringify(results);
  `), propertyType, typePath);
  return JSON.parse(raw);
}

export async function scrapeTokyoTatemono(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
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

      // The old URL was /{type}/area-tokyo/?cities={code}, which is the area
      // SEARCH FORM (a page of ward checkboxes with zero .item rows), not a
      // result list. The site's own ward navigation links to
      // /{type}/area-tokyo/{cityCode}/ and paginates as .../{cityCode}_{n}/.
      let nextUrl: string | null = `${BASE}/${typePath}/area-tokyo/${areaCode}/`;
      let currentPage = 1;

      while (nextUrl) {
        const url: string = nextUrl;
        logger.info(`[Tokyo Tatemono Scraper] Fetching: ${url}`);

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await new Promise((r) => setTimeout(r, 1500));

        // Count real rows rather than testing body text for a "no properties"
        // phrase: wards with no inventory (e.g. 13101 for 土地) still return
        // HTTP 200 with the full search chrome and no explicit message, and a
        // body-text guard is exactly what made daikyo.ts return 0 on good pages.
        const listings = await extractListings(page, type, typePath);
        logger.info(`[Tokyo Tatemono Scraper] Extracted ${listings.length} listings from page ${currentPage}`);

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

        // Follow the pager's own "次の20件" link instead of guessing a query
        // param; on page 2 the site renders a self-referential href for "1", so
        // only the 次の anchor can be trusted.
        const rawNext: string | null = await page.evaluate(
          new Function(`
            var a = Array.prototype.slice.call(document.querySelectorAll(".pager .paging a")).filter(function(x) {
              return /次の/.test(x.textContent || "");
            })[0];
            return a ? a.getAttribute("href") : null;
          `) as any,
        );

        if (rawNext && currentPage < config.maxPagesPerSite) {
          nextUrl = rawNext.indexOf("http") === 0 ? rawNext : BASE + (rawNext.charAt(0) === "/" ? "" : "/") + rawNext;
          if (nextUrl === url) nextUrl = null;
          currentPage++;
        } else {
          nextUrl = null;
        }
      }
    }
  } catch (error: any) {
    logger.error(`[Tokyo Tatemono Scraper] Error during scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "tokyotatemono",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}
