import puppeteer from "puppeteer";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";

const BASE = "https://www.sumai1.com";

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
    // /buyers/{tochi|kodate|mansion}/tod_13/shik_{nnn}/.
    //
    // Row: <article class="mod-estate-expansion">
    //   .heading h2 a[href]              -> detail href + title (building name
    //                                       for マンション, address otherwise)
    //   table tr.price td                -> "<strong>7,160</strong><span>万円</span>"
    //   table tr.place td                -> "東京都杉並区下高井戸３丁目"
    //   table tr.access td span.block-data -> "京王電鉄井の頭線 「西永福」駅 徒歩12分"
    //   second table                     -> th/td pairs, TWO pairs per <tr>:
    //       土地面積 / 建物面積 / 専有面積 / 築年月 / 間取り / 所在階 / 構造 /
    //       建ぺい率／容積率
    //
    // The previous version walked up from any <a> until an ancestor contained
    // "万円"; on top of the wrong URL (see the note in scrapeSumai1) that had
    // nothing to grab at all.
    var txt = function(e) { return ((e && e.textContent) || "").replace(/\\s+/g, " ").trim(); };
    var num = function(s) {
      if (!s) return null;
      var m = String(s).match(/([\\d,]+(?:\\.\\d+)?)/);
      if (!m) return null;
      var v = parseFloat(m[1].replace(/,/g, ""));
      return isNaN(v) ? null : v;
    };

    var rows = Array.prototype.slice.call(document.querySelectorAll("article.mod-estate-expansion"));
    var results = [];
    var isMansion = typePath === "mansion";

    rows.forEach(function(row) {
      var priceTd = row.querySelector("tr.price td");
      if (!priceTd) return;

      // On this site the price is always rendered in 万円 ("11,490万円"), but
      // parse 億 too so a "1億979万円" variant cannot silently truncate.
      var price = 0;
      var priceText = txt(priceTd).replace(/\\s/g, "");
      var okuMatch = priceText.match(/([\\d,]+(?:\\.\\d+)?)億/);
      var manMatch = priceText.match(/([\\d,]+(?:\\.\\d+)?)万/);
      if (okuMatch || manMatch) {
        var oku = okuMatch ? parseFloat(okuMatch[1].replace(/,/g, "")) * 10000 : 0;
        var man = manMatch ? parseFloat(manMatch[1].replace(/,/g, "")) : 0;
        price = oku + man;
      }

      var titleLink = row.querySelector(".heading h2 a[href]") || row.querySelector("a.info[href]");
      var url = titleLink ? titleLink.getAttribute("href") : null;
      if (url && url.indexOf("http") !== 0) {
        url = "${BASE}" + (url.charAt(0) === "/" ? "" : "/") + url;
      }

      // 所在地 is already the full "東京都杉並区..." form. The <h2> is only the
      // ward + chome (no prefecture) and for マンション it is the building name,
      // so it is never a usable address substitute.
      var address = txt(row.querySelector("tr.place td")).replace(/\\s+/g, "");
      var buildingName = isMansion && titleLink ? txt(titleLink) : "";

      // Flat th -> td map across both spec tables; a <tr> holds up to two pairs,
      // so pair each <th> with its own next <td> sibling rather than by index.
      var spec = {};
      Array.prototype.slice.call(row.querySelectorAll("table th")).forEach(function(th) {
        var key = txt(th);
        if (!key) return;
        var sib = th.nextElementSibling;
        while (sib && sib.tagName !== "TD") sib = sib.nextElementSibling;
        if (sib && !(key in spec)) spec[key] = txt(sib);
      });

      // "143.27m² (43.33坪)" — take the ㎡ figure, not the 坪 one.
      var landSize = num(spec["土地面積"]);
      var building = num(spec["建物面積"]);
      var exclusive = num(spec["専有面積"]);
      var floorArea = isMansion ? exclusive : (building || exclusive);

      // "2005年6月"
      var buildYear = null;
      var byM = (spec["築年月"] || "").match(/(\\d{4})年/);
      if (byM) buildYear = parseInt(byM[1], 10);

      // "40%／80%"
      var bcr = null, far = null;
      var ratio = spec["建ぺい率／容積率"] || spec["建ぺい率/容積率"] || "";
      var rM = ratio.match(/([\\d.]+)\\s*%[／\\/]\\s*([\\d.]+)\\s*%/);
      if (rM) { bcr = parseFloat(rM[1]); far = parseFloat(rM[2]); }

      var layout = spec["間取り"] || "";

      // 所在階 "3階／8階建" — the unit's floor is the first figure.
      var floor = null;
      var flM = (spec["所在階"] || "").match(/(\\d+)\\s*階/);
      if (flM) floor = parseInt(flM[1], 10);

      // 構造 "木造 地上2階建"
      var structureType = "";
      var stru = spec["構造"] || "";
      var sM = stru.match(/(鉄骨鉄筋コンクリート|鉄筋コンクリート|軽量鉄骨|鉄骨|木造|SRC|RC|ALC|プレキャストコンクリート)/);
      if (sM) structureType = sM[1];

      // "京王電鉄井の頭線 「西永福」駅 徒歩12分": the station name is bracketed
      // and 駅 sits outside the brackets, so rebuild it. Use the first
      // .block-data (the nearest station) only.
      var station = "", walkMinutes = null;
      var accessText = txt(row.querySelector("tr.access td span.block-data")) || txt(row.querySelector("tr.access td"));
      if (accessText) {
        var stM = accessText.match(/「([^」]+)」\\s*駅/);
        if (stM) station = stM[1] + "駅";
        else {
          var stM2 = accessText.match(/([^\\s「」]+駅)/);
          if (stM2) station = stM2[1];
        }
        var wkM = accessText.match(/徒歩\\s*(\\d+)\\s*分/);
        if (wkM) walkMinutes = parseInt(wkM[1], 10);
      }

      // Strip the prefecture before matching the ward: a left-anchored
      // /(.{2,4}[区市])/ over "東京都杉並区..." yields "京都杉並区".
      var ward = "";
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
          source: "mitsubishi_ufj",
          url: url || undefined,
          station: station || undefined,
          walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
          propertyType: propertyType,
          layout: layout || undefined,
          floor: floor !== null ? floor : undefined,
          structureType: structureType || undefined,
          description: buildingName || undefined,
        });
      }
    });

    return JSON.stringify(results);
  `), propertyType, typePath);
  return JSON.parse(raw);
}

export async function scrapeSumai1(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
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
    // The old URL was /buyers/{type}/area/tod_13/shik_13115/, which was wrong
    // twice over: the /area/ segment serves the ward-PICKER page (an empty
    // ~41 kB shell whose <h1> is "の土地・売地をエリアから探す" with no ward name),
    // and shik_ takes the 3-digit city code, not the full 5-digit JIS code. The
    // site's own ward navigation links to /buyers/tochi/tod_13/shik_115/.
    const prefCode = areaCode.length === 5 ? areaCode.substring(0, 2) : "13";
    const shortCityCode = areaCode.length === 5 ? areaCode.substring(2) : areaCode;

    for (const type of typesToScrape) {
      const typePath = CATEGORY_MAP[type];
      if (!typePath) continue;

      let nextUrl: string | null = `${BASE}/buyers/${typePath}/tod_${prefCode}/shik_${shortCityCode}/`;
      let currentPage = 1;

      while (nextUrl) {
        const url: string = nextUrl;
        logger.info(`[Sumai1 Scraper] Fetching: ${url}`);

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await new Promise((r) => setTimeout(r, 1500));

        // No body-text "no properties" guard here on purpose: this site never
        // prints 該当する物件 on a populated page, and a hidden variant of that
        // phrase is exactly what made daikyo.ts report 0 on good pages. An empty
        // result set is detected by the row count instead.
        const listings = await extractListings(page, type, typePath);
        logger.info(`[Sumai1 Scraper] Extracted ${listings.length} listings from page ${currentPage}`);

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

        // Pager: <ul class="mod-pagination-nav"> ... <a rel="next" href=".../page/2?">次へ</a>.
        // Do NOT search for a "次へ" anchor page-wide — every row's image slider
        // carries its own 次へ control.
        const rawNext: string | null = await page.evaluate(
          new Function(`
            var a = document.querySelector(".mod-pagination-nav a[rel='next']");
            if (!a) {
              a = Array.prototype.slice.call(document.querySelectorAll(".mod-pagination-nav a")).filter(function(x) {
                return /次へ/.test(x.textContent || "");
              })[0];
            }
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
    logger.error(`[Sumai1 Scraper] Error during scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "mitsubishi_ufj",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}
