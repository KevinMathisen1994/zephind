import puppeteer from "../puppeteerStealth";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";

const BASE = "https://sumikae.ttfuhan.co.jp";

const CATEGORY_MAP: Record<string, string> = {
  "土地": "tochi",
  "一戸建て": "kodate",
  "マンション": "mansion",
  "収益物件": "mansion",
  // /biz/ is a single nationwide landing page (no per-ward URL, no pagination)
  // that server-renders every current 事業用不動産 listing (一棟マンション,
  // アパート, 店舗, 事務所・ビル, 倉庫・工場, ホテル・寮, 売地, その他) and
  // filters them client-side via checkboxes. All cards are in the initial DOM
  // regardless of checkbox state, confirmed live (curl without JS returned the
  // full 115-item set), so one fetch + ward-name filtering covers every ward.
  "ビル": "biz",
};

// office-building.ttfuhan.co.jp (東京建物's separate subdomain) was checked
// live: title is "オフィス・店舗を借りたい 貸したい" and every nav link is
// rent-biz/property-list, property-details, to-owner — a 賃貸 (rental) portal
// with no 売買 (buy/sell) section anywhere in its markup. Confirmed rental-only,
// not a source for a purchase search.

// Same 62-entry JIS code table used by hatomark.ts/athome.ts/rakuten.ts, needed
// here only to turn a caller's areaCode into the ward name the /biz/ page's
// own address text carries (that page has no per-ward URL to filter by).
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
  "13229": "西東京市", "13303": "瑞穂町", "13305": "日の出町",
  "13307": "檜原村", "13308": "奥多摩町", "13361": "大島町",
  "13362": "利島村", "13363": "新島村", "13364": "神津島村",
  "13381": "三宅村", "13382": "御蔵島村", "13401": "八丈町",
  "13402": "青ヶ島村", "13421": "小笠原村",
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
      // 東京建物 shows a "new" badge whose tooltip reads 「14日以内に登録された新着
      // 物件」 — a two-week window, not a date. The date itself is on the detail
      // page (fetched centrally by cli.ts), so record only the flag here.
      var rowText = ((row.textContent) || "").replace(/\\s+/g, "");
      var isNew = /14日以内に登録された新着物件/.test(rowText);

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
          source: "tokyotatemono",
          url: url || undefined,
          station: station || undefined,
          walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
          propertyType: propertyType,
          layout: layout || undefined,
          floor: floor !== null ? floor : undefined,
          totalUnits: totalUnits !== null ? totalUnits : undefined,
          description: buildingName || undefined,
          isNew: isNew || undefined,
        });
      }
    });

    return JSON.stringify(results);
  `), propertyType, typePath);
  return JSON.parse(raw);
}

// /biz/ cards use entirely different markup from the tochi/kodate/mansion
// .item rows above: .article-one-wrap li, each with its own type label in
// .condition .icon (一棟マンション / アパート / 店舗 / ビル / 事務所 / 倉庫 /
// 工場 / ホテル / 店舗付住宅 / 売地 / その他 — confirmed against a live fetch).
// 売地 (land) cards are excluded: they're plain land, not a business/income
// building, and land is already covered by the separate 土地 typePath.
async function extractBizListings(page: any, propertyType: string, wardName: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", "wardName", `
    var txt = function(e) { return ((e && e.textContent) || "").replace(/\\s+/g, " ").trim(); };
    var num = function(s) {
      if (!s) return null;
      var m = String(s).match(/([\\d,]+(?:\\.\\d+)?)/);
      if (!m) return null;
      var v = parseFloat(m[1].replace(/,/g, ""));
      return isNaN(v) ? null : v;
    };

    var rows = Array.prototype.slice.call(document.querySelectorAll(".article-one-wrap.js_biz_bukken_item"));
    var results = [];

    rows.forEach(function(row) {
      var address = txt(row.querySelector("span.add"));
      // The page is nationwide; only match this ward inside a real Tokyo
      // address, or a same-named ward in another prefecture (e.g. 名古屋市
      // 港区) would be picked up for a Tokyo areaCode.
      if (!address || address.indexOf("東京都") !== 0 || address.indexOf(wardName) === -1) return;

      var icon = txt(row.querySelector(".condition .icon"));
      if (/土地|宅地|用地|売地/.test(icon)) return;

      var titleLink = row.querySelector("a.main-info-block[href]");
      var url = titleLink ? titleLink.getAttribute("href") : null;
      if (url && url.indexOf("http") !== 0) {
        url = "${BASE}" + (url.charAt(0) === "/" ? "" : "/") + url;
      }

      var buildingName = txt(row.querySelector(".name .name-txt"));

      var priceText = txt(row.querySelector("span.kakaku")).replace(/\\s/g, "");
      var price = 0;
      var okuMatch = priceText.match(/([\\d,]+(?:\\.\\d+)?)億/);
      var manMatch = priceText.match(/([\\d,]+(?:\\.\\d+)?)万/);
      if (okuMatch || manMatch) {
        var oku = okuMatch ? parseFloat(okuMatch[1].replace(/,/g, "")) * 10000 : 0;
        var man = manMatch ? parseFloat(manMatch[1].replace(/,/g, "")) : 0;
        price = oku + man;
      }

      // senyu is always a single "建物面積：NNN㎡" or "専有面積：NNN㎡" span for
      // every non-land icon (confirmed live across all categories) — no split
      // land/building fields like the residential rows have.
      var floorArea = num(txt(row.querySelector("span.senyu")));

      var station = "", walkMinutes = null;
      var stationEl = row.querySelector(".transport .kotsu-set .station");
      if (stationEl) {
        var stM = txt(stationEl).match(/「([^」]+)」\\s*駅/);
        station = stM ? stM[1] + "駅" : txt(stationEl).replace(/まで$/, "").trim();
      }
      var kotsuEl = row.querySelector(".transport .kotsu-set .kotsu");
      if (kotsuEl) {
        var wkM = txt(kotsuEl).match(/徒歩\\s*(\\d+)\\s*分/);
        if (wkM) walkMinutes = parseInt(wkM[1], 10);
      }

      var ward = wardName;

      if (address && price) {
        results.push({
          address: address,
          ward: ward,
          price: price,
          area: floorArea || 0,
          floorArea: floorArea || undefined,
          source: "tokyotatemono",
          url: url || undefined,
          station: station || undefined,
          walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
          propertyType: propertyType,
          description: [icon, buildingName].filter(Boolean).join(" ") || undefined,
        });
      }
    });

    return JSON.stringify(results);
  `), propertyType, wardName);
  return JSON.parse(raw);
}

/**
 * 賃貸 (rent) reuses the exact same .item card template as the 中古 cards
 * above (same h4.name/info-head/add/madori/kai classes), confirmed live at
 * /rent/area-tokyo/{areaCode}/ — one unfiltered URL per ward, no per-type
 * land/house/mansion split. The price span carries an extra .chinryou
 * modifier and prints an absolute 円/月 amount (not 万円 like the buy side),
 * and a .admin-cost block adds 管理費 (absolute yen) plus 敷金/礼金 as a
 * combined "Xヶ月/Yヶ月" label — a multiple of THIS listing's own rent, the
 * same convention keio.ts uses (NOT daikyo.ts's absolute-amount one). No 種別
 * field was found on any live card — every example was a Brillia-brand
 * apartment unit (東京建物's rental arm only runs its own condo towers, no
 * house rentals) — so propertyType is set statically to マンション.
 * <office-building.ttfuhan.co.jp> was already ruled out for this task
 * (confirmed rental-only, but for COMMERCIAL space, not residential — see
 * the comment near the top of this file).
 */
async function extractChintaiListings(page: any): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function(`
    var txt = function(e) { return ((e && e.textContent) || "").replace(/\\s+/g, " ").trim(); };
    var num = function(s) {
      if (!s) return null;
      var m = String(s).match(/([\\d,]+(?:\\.\\d+)?)/);
      if (!m) return null;
      var v = parseFloat(m[1].replace(/,/g, ""));
      return isNaN(v) ? null : v;
    };
    var parseYen = function(t) {
      var m = (t || "").replace(/[\\s,]/g, "").match(/([\\d.]+)円/);
      return m ? parseFloat(m[1]) / 10000 : null;
    };

    var rows = Array.prototype.slice.call(document.querySelectorAll(".item")).filter(function(el) {
      return el.querySelector("span.kakaku.chinryou") && el.querySelector("h4.name a[href]");
    });
    var results = [];

    rows.forEach(function(row) {
      var rent = parseYen(txt(row.querySelector("span.kakaku.chinryou")));
      if (rent == null) return;

      var titleLink = row.querySelector("h4.name a[href]");
      var url = titleLink ? titleLink.getAttribute("href") : null;
      if (url && url.indexOf("http") !== 0) {
        url = "${BASE}" + (url.charAt(0) === "/" ? "" : "/") + url;
      }
      if (!url) return;

      var address = txt(row.querySelector(".info-area p.add")).replace(/\\s+/g, "");
      if (!address) return;

      var managementFee = null;
      var mgmtM = txt(row.querySelector(".admin-cost span.cost1")).match(/管理費[：:]\\s*([\\d,]+)円/);
      if (mgmtM) managementFee = parseFloat(mgmtM[1].replace(/,/g, "")) / 10000;

      // "敷金/礼金：1ヶ月/1ヶ月" is ONE combined label with two "Xヶ月" values in
      // source order (敷金 first, 礼金 second) — pull every "Xヶ月" number out
      // rather than matching each label separately, since there's no per-label
      // text to anchor on (the labels themselves are joined by a "/").
      var monthNums = (txt(row.querySelector(".admin-cost span.cost2")).match(/([\\d.]+)\\s*ヶ月/g) || [])
        .map(function(s) { return parseFloat(s); });
      var deposit = monthNums.length > 0 ? monthNums[0] * rent : null;
      var keyMoney = monthNums.length > 1 ? monthNums[1] * rent : null;

      var senyu = num(txt(row.querySelector("span.senyu")));
      var layout = txt(row.querySelector("span.madori"));
      if (layout === "-") layout = "";

      var buildYear = null;
      var byM = txt(row.querySelector(".info-area p.chiku")).match(/(\\d{4})年/);
      if (byM) buildYear = parseInt(byM[1], 10);

      var floor = null;
      var fM = txt(row.querySelector("span.kai")).match(/(\\d+)\\s*階/);
      if (fM) floor = parseInt(fM[1], 10);

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

      var ward = "";
      var wm = address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "")
        .replace(/^[^\\s]{1,4}郡/, "")
        .match(/^(.{1,6}?[市区])/)
        || address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "").replace(/^[^\\s]{1,4}郡/, "").match(/^(.{1,5}?[町村])/);
      if (wm) ward = wm[1];

      results.push({
        address: address,
        ward: ward,
        price: rent,
        rent: rent,
        managementFee: managementFee != null ? managementFee : undefined,
        deposit: deposit != null ? deposit : undefined,
        keyMoney: keyMoney != null ? keyMoney : undefined,
        area: senyu != null ? senyu : undefined,
        floorArea: senyu != null ? senyu : undefined,
        buildYear: buildYear != null ? buildYear : undefined,
        floor: floor != null ? floor : undefined,
        source: "tokyotatemono",
        url: url,
        station: station || undefined,
        walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
        propertyType: "マンション",
        layout: layout || undefined,
        dealType: "rent",
      });
    });

    return JSON.stringify(results);
  `));
  return JSON.parse(raw);
}

async function scrapeTokyoTatemonoChintai(areaCode: string): Promise<ScrapeResult> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const allListings: PropertyListing[] = [];
  const scrapeErrors: string[] = [];
  const seenUrls = new Set<string>();

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    // No per-type land/house/mansion split on the rent side — one URL per
    // ward, paginated the same "{code}_{n}" way as the buy side.
    let nextUrl: string | null = `${BASE}/rent/area-tokyo/${areaCode}/`;
    let currentPage = 1;

    while (nextUrl) {
      const url: string = nextUrl;
      logger.info(`[Tokyo Tatemono Scraper] Fetching (賃貸): ${url}`);

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 1500));

      const listings = await extractChintaiListings(page);
      logger.info(`[Tokyo Tatemono Scraper] Extracted ${listings.length} 賃貸 listings from page ${currentPage}`);

      if (listings.length === 0) break;

      const newListings = listings.filter((l) => {
        if (!l.url || seenUrls.has(l.url)) return false;
        seenUrls.add(l.url);
        return true;
      });
      if (newListings.length === 0) break;
      allListings.push(...newListings);

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
  } catch (error: any) {
    logger.error(`[Tokyo Tatemono Scraper] Error during 賃貸 scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  logger.info(`[Tokyo Tatemono Scraper] 賃貸 scrape complete: ${allListings.length} listings for ${areaCode}`);
  return {
    errors: scrapeErrors,
    source: "tokyotatemono",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}

export async function scrapeTokyoTatemono(areaCode: string, filterTypes?: string[], dealType?: "buy" | "rent"): Promise<ScrapeResult> {
  if (dealType === "rent") {
    return await scrapeTokyoTatemonoChintai(areaCode);
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

    const typesToScrape = filterTypes?.length ? filterTypes : ["土地"];

    for (const type of typesToScrape) {
      const typePath = CATEGORY_MAP[type];
      if (!typePath) continue;

      if (typePath === "biz") {
        const wardName = TOKYO_WARD_MAP[areaCode];
        if (!wardName) {
          logger.info(`[Tokyo Tatemono Scraper] No known ward name for code ${areaCode}, skipping ビル`);
          continue;
        }

        const url = `${BASE}/biz/`;
        logger.info(`[Tokyo Tatemono Scraper] Fetching: ${url}`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await new Promise((r) => setTimeout(r, 1500));

        const listings = await extractBizListings(page, type, wardName);
        logger.info(`[Tokyo Tatemono Scraper] Extracted ${listings.length} ビル listings for ${wardName}`);

        for (const item of listings) {
          const sig = `${item.address}-${item.price}-${item.area}`;
          if (!seenSignatures.has(sig)) {
            seenSignatures.add(sig);
            allListings.push(item);
          }
        }
        continue;
      }

      // The old URL was /{type}/area-tokyo/?cities={code}, which is the area
      // SEARCH FORM (a page of ward checkboxes with zero .item rows), not a
      // result list. The site's own ward navigation links to
      // /{type}/area-tokyo/{cityCode}/ and paginates as .../{cityCode}_{n}/.
      let nextUrl: string | null = `${BASE}/${typePath}/area-tokyo/${areaCode}/`;
      let currentPage = 1;

      while (nextUrl) {
        const url: string = nextUrl;
        logger.info(`[Tokyo Tatemono Scraper] Fetching: ${url}`);

        const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        if (resp && resp.status() >= 500) {
          const msg = `サーバー側障害/メンテナンス中 (HTTP ${resp.status()}): ${url}`;
          logger.warn(`[Tokyo Tatemono Scraper] ${msg}`);
          scrapeErrors.push(msg);
          break;
        }
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
