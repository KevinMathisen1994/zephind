import puppeteer from "../puppeteerStealth";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


// Area code → ward name
const CODE_TO_WARD: Record<string, string> = {
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

/**
 * Ward/city label → URL slug used by homes.co.jp
 * (https://www.homes.co.jp/{path}/tokyo/{slug}/list/).
 *
 * Harvested from the site's own 東京都 area indexes — homes only links the
 * municipalities that currently have stock for that property type, so the list
 * is the union of several verticals:
 *   https://www.homes.co.jp/tochi/tokyo/city/          (23 wards + all 26 市, 瑞穂町, 日の出町, 大島町)
 *   https://www.homes.co.jp/kodate/chuko/tokyo/city/   (adds 檜原村, 奥多摩町)
 * 神津島村 and 三宅村 are not linked from any of those indexes; their slugs were
 * confirmed by loading /tochi/tokyo/{slug}/list/ directly, which returns HTTP
 * 200 with the titles 「神津島村の土地…」/「三宅島三宅村の土地…」 (an unknown
 * slug returns a hard 404).
 *
 * NOT mapped: 利島村, 新島村, 御蔵島村, 八丈町, 青ヶ島村, 小笠原村. They are not
 * linked from any homes area index and direct probing of candidate slugs could
 * not confirm one — homes answers repeated probes with an Akamai "Human
 * Verification" page, so the attempts were inconclusive rather than negative.
 * Nothing is entered for them on purpose: a guessed slug 404s and the scraper
 * reports that as "0 listings", indistinguishable from "no inventory".
 */
const WARD_TO_SLUG: Record<string, string> = {
  // 23 special wards
  "千代田区": "chiyoda-city",
  "中央区": "chuo-city",
  "港区": "minato-city",
  "新宿区": "shinjuku-city",
  "文京区": "bunkyo-city",
  "台東区": "taito-city",
  "墨田区": "sumida-city",
  "江東区": "koto-city",
  "品川区": "shinagawa-city",
  "目黒区": "meguro-city",
  "大田区": "ota-city",
  "世田谷区": "setagaya-city",
  "渋谷区": "shibuya-city",
  "中野区": "nakano-city",
  "杉並区": "suginami-city",
  "豊島区": "toshima-city",
  "北区": "kita-city",
  "荒川区": "arakawa-city",
  "板橋区": "itabashi-city",
  "練馬区": "nerima-city",
  "足立区": "adachi-city",
  "葛飾区": "katsushika-city",
  "江戸川区": "edogawa-city",
  // 26 市部 cities
  "八王子市": "hachioji-city",
  "立川市": "tachikawa-city",
  "武蔵野市": "musashino-city",
  "三鷹市": "mitaka-city",
  "青梅市": "ome-city",
  "府中市": "fuchu-city",
  "昭島市": "akishima-city",
  "調布市": "chofu-city",
  "町田市": "machida-city",
  "小金井市": "koganei-city",
  "小平市": "kodaira-city",
  "日野市": "hino-city",
  "東村山市": "higashimurayama-city",
  "国分寺市": "kokubunji-city",
  "国立市": "kunitachi-city",
  "福生市": "fussa-city",
  "狛江市": "komae-city",
  "東大和市": "higashiyamato-city",
  "清瀬市": "kiyose-city",
  "東久留米市": "higashikurume-city",
  "武蔵村山市": "musashimurayama-city",
  "多摩市": "tama-city",
  "稲城市": "inagi-city",
  "羽村市": "hamura-city",
  "あきる野市": "akiruno-city",
  "西東京市": "nishitokyo-city",
  // 郡部 (西多摩郡) — homes prefixes the county
  "瑞穂町": "nishitama_mizuho-city",
  "日の出町": "nishitama_hinode-city",
  "檜原村": "nishitama_hinohara-city",
  "奥多摩町": "nishitama_okutama-city",
  // 島嶼部 (only the ones whose slug could be confirmed)
  "大島町": "oshima-city",
  "神津島村": "kozushima-city",
  "三宅村": "miyake-city",
};

// Category map: label → URL path segment
const CATEGORY_MAP: Record<string, { path: string; label: string }> = {
  "土地": { path: "tochi", label: "土地" },
  "一戸建て": { path: "kodate/chuko", label: "一戸建て" },
  "マンション": { path: "mansion/chuko", label: "マンション" },
  "収益物件": { path: "mansion/chuko", label: "マンション" },
  // 事務所・オフィスの購入 (offices/buildings for sale) — confirmed live at
  // homes.co.jp/office/tokyo/{slug}/list/, same URL shape and card markup as
  // the other categories.
  "ビル": { path: "office", label: "ビル" },
};

// 賃貸 (chintai) category map. Confirmed live via homes.co.jp's own nav
// (links to /chintai/kodate/ and /chintai/office/ from the /chintai/ page):
// unlike the buy side's single mansion/tochi/kodate split, homes keeps
// マンション and アパート chintai together under the bare /chintai/ path — a
// 港区 sample returned only "賃貸マンション" bType cards there, so no separate
// アパート path is needed. 一戸建て and 事務所/店舗(ビル) each need their own path.
const CHINTAI_CATEGORY_MAP: Record<string, { path: string; label: string }> = {
  "マンション": { path: "chintai", label: "マンション" },
  "一戸建て": { path: "chintai/kodate", label: "一戸建て" },
  "ビル": { path: "chintai/office", label: "ビル" },
};

/**
 * 賃貸 cards are a building-with-units template, same shape as suumo's
 * chintai cards: `[class*="mod-mergeBuilding--rent"]` is one BUILDING,
 * `tr.prg-room` inside it is one rentable UNIT (data-href on the row itself).
 *
 * Two different sub-templates were confirmed live:
 *  - residential (マンション/一戸建て, table.unitResidenceSummary): one
 *    combined `td.price` holds "RENT万円/MGMT円<br>DEPOSIT/KEYMONEY/GUARANTEE/
 *    SHIKIBIKI" — in that order (敷金/礼金/保証/敷引・償却 per the header).
 *  - office (ビル, table.unitSummary): rent/mgmt and the deposit block are
 *    SEPARATE cells (`td.price` vs `td.cost`), and `td.cost`'s order is
 *    敷金/保証金/礼金/敷引・償却 — keyMoney is the THIRD slot here, not the
 *    second. Passing `isOffice` picks the right slot instead of assuming one
 *    fixed order for both templates.
 *
 * Each deposit/keyMoney slot is itself one of three real conventions seen
 * live: "無" (explicitly zero), "Xヶ月" (a multiple of the unit's own rent —
 * convert to an absolute amount), or a bare "X万円"/"X,XXX円" (already
 * absolute). "-" means not disclosed/not applicable, kept as undefined
 * rather than 0 so it doesn't read as "confirmed no deposit".
 */
async function extractChintaiListings(page: any, propertyType: string, isOffice: boolean): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", "isOffice", `
    var parseDepositSlot = function(text, rentMan) {
      if (!text) return undefined;
      var t = text.trim();
      if (!t || t === "-" || t === "ー" || t === "―") return undefined;
      if (t === "無") return 0;
      var monthM = t.match(/([\\d.]+)\\s*ヶ月/);
      if (monthM) return parseFloat(monthM[1]) * rentMan;
      var manM = t.match(/([\\d,.]+)\\s*万円/);
      if (manM) return parseFloat(manM[1].replace(/,/g, ""));
      var yenM = t.match(/([\\d,]+)\\s*円/);
      if (yenM) return parseFloat(yenM[1].replace(/,/g, "")) / 10000;
      return undefined;
    };

    var results = [];
    var buildings = document.querySelectorAll('[class*="mod-mergeBuilding--rent"]');

    buildings.forEach(function(building) {
      var specTable = building.querySelector(".bukkenSpec table");
      var address = "";
      var rows = specTable ? specTable.querySelectorAll("tr") : [];
      rows.forEach(function(row) {
        var th = row.querySelector("th");
        var td = row.querySelector("td");
        if (!th || !td) return;
        var label = th.textContent.trim();
        if (label === "所在地") address = td.textContent.trim();
      });
      if (!address) return;

      var ward = "";
      var wm = address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "")
        .replace(/^[^\\s]{1,4}郡/, "")
        .match(/^(.{1,6}?[市区])/)
        || address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "").replace(/^[^\\s]{1,4}郡/, "").match(/^(.{1,5}?[町村])/);
      if (wm) ward = wm[1];

      var station = "";
      var walkMinutes = null;
      rows.forEach(function(row) {
        var th = row.querySelector("th");
        var td = row.querySelector("td");
        if (!th || !td) return;
        if (th.textContent.trim() === "交通") {
          var lines = td.innerHTML.split(/<br\\s*\\/?>/i).map(function(s) { return s.replace(/<[^>]+>/g, "").trim(); }).filter(Boolean);
          if (lines.length > 0) {
            var stM = lines[0].match(/([^\\s]+駅)/);
            if (stM) station = stM[1];
            var wkM = lines[0].match(/徒歩\\s*(\\d+)\\s*分/);
            if (wkM) walkMinutes = parseInt(wkM[1], 10);
          }
        }
      });

      var buildYear = null;
      rows.forEach(function(row) {
        var th = row.querySelector("th");
        var td = row.querySelector("td");
        if (!th || !td) return;
        var label = th.textContent.trim();
        if (label.indexOf("築年数") === 0) {
          var ageM = td.textContent.match(/(\\d+)\\s*年/);
          if (ageM) buildYear = new Date().getFullYear() - parseInt(ageM[1], 10);
          else if (/新築/.test(td.textContent)) buildYear = new Date().getFullYear();
        }
      });

      var unitRows = building.querySelectorAll("tr.prg-room");
      unitRows.forEach(function(row) {
        var url = row.getAttribute("data-href") || "";
        if (!url) return;

        var floorEl = row.querySelector("td.floar");
        var floor = null;
        if (floorEl) {
          var floorM = floorEl.textContent.match(/(\\d+)\\s*階/);
          if (floorM) floor = parseInt(floorM[1], 10);
        }

        var priceEl = row.querySelector("td.price");
        var priceHtml = priceEl ? priceEl.innerHTML : "";
        var priceLines = priceHtml.split(/<br\\s*\\/?>/i).map(function(s) { return s.replace(/<[^>]+>/g, "").trim(); });
        var rentMgmtText = priceLines[0] || "";

        var rentM = rentMgmtText.match(/([\\d.]+)\\s*万円/);
        if (!rentM) return; // no rent = not a real listing row
        var rent = parseFloat(rentM[1]);
        var mgmtM = rentMgmtText.match(/\\/\\s*([\\d,]+)\\s*円/);
        var managementFee = mgmtM ? parseFloat(mgmtM[1].replace(/,/g, "")) / 10000 : undefined;

        var deposit, keyMoney;
        if (isOffice) {
          // office template: deposit block lives in its own td.cost, order
          // 敷金/保証金/礼金/敷引・償却 — keyMoney is slot index 2, not 1.
          var costEl = row.querySelector("td.cost");
          var costParts = (costEl ? costEl.textContent : "").split("/");
          deposit = parseDepositSlot(costParts[0], rent);
          keyMoney = parseDepositSlot(costParts[2], rent);
        } else {
          // residential template: deposit block is priceLines[1], order
          // 敷金/礼金/保証/敷引・償却.
          var depositParts = (priceLines[1] || "").split("/");
          deposit = parseDepositSlot(depositParts[0], rent);
          keyMoney = parseDepositSlot(depositParts[1], rent);
        }

        var layout = "";
        var area = null;
        var layoutEl = row.querySelector("td.layout");
        if (layoutEl) {
          var layoutHtml = layoutEl.innerHTML.split(/<br\\s*\\/?>/i).map(function(s) { return s.replace(/<[^>]+>/g, "").trim(); });
          layout = layoutHtml[0] || "";
          var areaM = (layoutHtml[1] || "").match(/([\\d.]+)\\s*m/);
          if (areaM) area = parseFloat(areaM[1]);
        } else {
          var spaceEl = row.querySelector("td.space");
          if (spaceEl) {
            var areaM2 = spaceEl.textContent.match(/([\\d.]+)\\s*m/);
            if (areaM2) area = parseFloat(areaM2[1]);
          }
        }

        results.push({
          address: address,
          ward: ward,
          price: rent,
          rent: rent,
          managementFee: managementFee,
          deposit: deposit,
          keyMoney: keyMoney,
          area: area != null ? area : undefined,
          floorArea: area != null ? area : undefined,
          buildYear: buildYear != null ? buildYear : undefined,
          floor: floor != null ? floor : undefined,
          layout: layout || undefined,
          station: station || undefined,
          walkMinutes: walkMinutes != null ? walkMinutes : undefined,
          url: url,
          source: "homes",
          propertyType: propertyType,
          dealType: "rent",
        });
      });
    });

    return JSON.stringify(results);
  `), propertyType, isOffice);
  return JSON.parse(raw);
}

async function scrapeHomesChintai(areaCode: string, wardName: string, slug: string, filterTypes?: string[]): Promise<ScrapeResult> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const allListings: PropertyListing[] = [];
  const scrapeErrors: string[] = [];
  const seenUrls = new Set<string>();
  // Confirmed live: homes.co.jp answers a burst of rapid requests with an
  // Akamai "Human Verification" block (see bot-check handling below), the
  // same behavior already fought on the buy side — so pages are paced with a
  // real wait between loads and the loop bails out the moment it's hit.
  const MAX_PAGES = 20;

  const catKeys = filterTypes && filterTypes.length > 0
    ? Object.entries(CHINTAI_CATEGORY_MAP).filter(([, { label }]) => filterTypes.includes(label)).map(([key]) => key)
    : Object.keys(CHINTAI_CATEGORY_MAP);
  if (catKeys.length === 0) {
    logger.info(`[Homes Scraper] No matching chintai categories for ${wardName}, skipping`);
    return { listings: [], source: "homes", areaCode, scrapedAt: Date.now(), count: 0 };
  }

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    categoryLoop:
    for (const catKey of catKeys) {
      const { path, label } = CHINTAI_CATEGORY_MAP[catKey];
      const isOffice = catKey === "ビル";
      logger.info(`[Homes Scraper] Chintai category ${label} for ${wardName}...`);

      for (let p = 1; p <= MAX_PAGES; p++) {
        const url = `https://www.homes.co.jp/${path}/tokyo/${slug}/list/?page=${p}`;
        logger.info(`[Homes Scraper] Loading chintai page ${p} (${label}) for ${wardName}...`);

        let response;
        try {
          response = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
        } catch (err) {
          logger.warn(`[Homes Scraper] Chintai page ${p} failed to load: ${(err as Error).message}`);
          scrapeErrors.push(`${label}/page${p}: ${(err as Error).message}`);
          break;
        }

        const status = response?.status();
        const title = await page.title().catch(() => "");
        if (status === 405 || status === 202 || title.includes("Human Verification") || title.includes("認証")) {
          const msg = `Blocked by bot-check (status=${status}, title="${title}") on chintai/${label}/page${p}`;
          logger.error(`[Homes Scraper] ${msg}`);
          scrapeErrors.push(msg);
          break categoryLoop;
        }

        const hasListings = await page.evaluate(() => {
          return document.querySelectorAll('[class*="mod-mergeBuilding--rent"]').length > 0;
        });
        if (!hasListings) {
          logger.info(`[Homes Scraper] No chintai listings on page ${p}, stopping`);
          break;
        }

        await new Promise((r) => setTimeout(r, 1500));

        const listings = await extractChintaiListings(page, label, isOffice);
        const newListings = listings.filter((l) => {
          if (!l.url || seenUrls.has(l.url)) return false;
          seenUrls.add(l.url);
          return true;
        });

        if (newListings.length === 0) {
          logger.info(`[Homes Scraper] Chintai page ${p}: no new listings, stopping`);
          break;
        }

        logger.info(`[Homes Scraper] Chintai page ${p}: ${newListings.length} new listings (total: ${allListings.length + newListings.length})`);
        allListings.push(...newListings);
      }
    }

    logger.info(`[Homes Scraper] Chintai scrape complete: ${allListings.length} listings for ${wardName}`);
    allListings.slice(0, 5).forEach((l, i) => {
      logger.info(
        `[Homes Scraper]   [${i}] ${l.ward} ${l.address} | rent=${l.rent}万円 | mgmt=${l.managementFee ?? "?"}万円 | deposit=${l.deposit ?? "?"} | keyMoney=${l.keyMoney ?? "?"} | type=${l.propertyType}`
      );
    });

    return {
      listings: allListings,
      source: "homes",
      areaCode,
      scrapedAt: Date.now(),
      count: allListings.length,
      errors: scrapeErrors.length > 0 ? scrapeErrors : undefined,
    };
  } finally {
    await browser.close();
    logger.info(`[Homes Scraper] Browser closed`);
  }
}

async function extractListings(page: any, propertyType: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", `
    var items = document.querySelectorAll(".mod-mergeBuilding--sale");
    var results = [];

    items.forEach(function(el) {
      // --- Price ---
      // Two patterns: .priceLabel .num (full card) or .price .num (compact KK card)
      var priceEl = el.querySelector(".priceLabel .num") || el.querySelector("td.price .num") || el.querySelector("td.price");
      var priceText = priceEl ? priceEl.textContent.trim() : "";
      var parsePrice = function(text) {
        if (!text) return 0;
        var cleaned = text.replace(/[\\s,]/g, "");
        var firstPart = cleaned.split(/[~〜]/)[0];
        var okuMatch = firstPart.match(/([\\d,]+(?:\\.\\d+)?)億/);
        var manMatch = firstPart.match(/([\\d,]+(?:\\.\\d+)?)万/);
        if (okuMatch || manMatch) {
          var oku = okuMatch ? parseFloat(okuMatch[1].replace(/,/g, "")) * 10000 : 0;
          var man = manMatch ? parseFloat(manMatch[1].replace(/,/g, "")) : 0;
          return oku + man;
        }
        // Numeric-only (already in man-en, e.g. "19,500")
        var numMatch = firstPart.match(/([\\d,]+)/);
        return numMatch ? parseFloat(numMatch[1].replace(/,/g, "")) : 0;
      };
      var price = parsePrice(priceText);

      // --- Address + Station (verticalTable th/td pattern) ---
      var address = "";
      var station = "";
      var walkMinutes = null;

      // Try verticalTable style (most listings)
      var rows = el.querySelectorAll("table.verticalTable tbody tr");
      rows.forEach(function(row) {
        var th = row.querySelector("th");
        var td = row.querySelector("td");
        if (!th || !td) return;
        var label = th.textContent.replace(/\\s+/g, "");
        if (label.includes("交通") || label.includes("所在地")) {
          // Format: "路線 駅名駅 徒歩N分<br>東京都..." — a newer card template
          // combines 交通 and 所在地 into one th/td pair, separated by a <br>.
          // td.textContent drops <br> entirely (it contributes zero characters,
          // unlike innerText), so splitting textContent on "\\n" never found a
          // boundary here and the traffic+address text fell through as one
          // blob into the address branch — station/walkMinutes were never
          // extracted at all, and the ward regex saw a string that doesn't
          // start with "東京都" and produced no ward.
          var lines = td.innerHTML
            .split(/<br\\s*\\/?>/i)
            .map(function(s) { return s.replace(/<[^>]+>/g, "").trim(); })
            .filter(Boolean);
          lines.forEach(function(line) {
            if (line.includes("東京都") || line.match(/区/)) {
              address = address || line;
            } else if (line.match(/駅/)) {
              // Extract station name and walk minutes from this line
              var stM = line.match(/([^\\s]+駅)/);
              if (stM) station = station || stM[1];
              var wkM = line.match(/徒歩(\\d+)分/);
              if (wkM && walkMinutes === null) walkMinutes = parseInt(wkM[1], 10);
            }
          });
        }
      });

      // Fallback: compact KK-card layout (ad cards at the top of results)
      if (!address) {
        var addrEl = el.querySelector("td.address");
        if (addrEl) address = addrEl.textContent.trim();
        var trafficEl = el.querySelector("td.traffic");
        if (trafficEl) {
          var trafficText = trafficEl.textContent.trim();
          var stM2 = trafficText.match(/([^\\s]+駅)/);
          if (stM2) station = stM2[1];
          var wkM2 = trafficText.match(/徒歩(\\d+)分/);
          if (wkM2) walkMinutes = parseInt(wkM2[1], 10);
        }
      }

      // Skip if no address
      if (!address) return;

      // Ward extraction
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

      // --- Land size ---
      var landSize = null;
      // Look for 土地面積 th/td pair or .space td
      rows.forEach(function(row) {
        var th = row.querySelector("th");
        var td = row.querySelector("td");
        if (!th || !td) return;
        var label = th.textContent.replace(/\\s+/g, "");
        if (label.includes("土地面積") || label.includes("敷地面積")) {
          var aM = td.textContent.match(/([\\d,.]+)\\s*m/);
          if (aM) landSize = parseFloat(aM[1].replace(/,/g, ""));
        }
      });
      // Also try raSpecRow table .space cells (compact format)
      if (landSize === null) {
        var spaceEl = el.querySelector(".raSpecRow td.space");
        if (spaceEl) {
          var aM2 = spaceEl.textContent.match(/([\\d,.]+)\\s*m/);
          if (aM2) landSize = parseFloat(aM2[1].replace(/,/g, ""));
        }
      }
      // KK-card format
      if (landSize === null) {
        var spaceTd = el.querySelector("td.space");
        if (spaceTd) {
          var aM3 = spaceTd.textContent.match(/([\\d,.]+)\\s*m/);
          if (aM3) landSize = parseFloat(aM3[1].replace(/,/g, ""));
        }
      }

      // --- Building coverage / floor area ratio ---
      var bcr = null;
      var far = null;
      rows.forEach(function(row) {
        var th = row.querySelector("th");
        if (!th) return;
        var label = th.textContent.replace(/\\s+/g, "");
        if (label.includes("建ぺい率") || label.includes("容積率")) {
          // Could be in same th or different td
          var allTds = row.querySelectorAll("td");
          allTds.forEach(function(td) {
            var text = td.textContent.trim();
            // e.g. "建ぺい率80% / 容積率240%" or "80% / 240%"
            var bfM = text.match(/(\\d+)%\\s*[\\/／]\\s*(\\d+)%/);
            if (bfM) { bcr = parseFloat(bfM[1]); far = parseFloat(bfM[2]); }
            // e.g. "60% / 160%" in standalone td
            if (!bfM) {
              var pcts = text.match(/(\\d+)%/g);
              if (pcts && pcts.length >= 2) {
                bcr = parseFloat(pcts[0]);
                far = parseFloat(pcts[1]);
              }
            }
          });
          // Also check .space td siblings in raSpecRow
          if (bcr === null) {
            var spaceTd = row.querySelector("td.space");
            if (spaceTd) {
              var pcts2 = spaceTd.textContent.match(/(\\d+)%/g);
              if (pcts2 && pcts2.length >= 2) {
                bcr = parseFloat(pcts2[0]);
                far = parseFloat(pcts2[1]);
              }
            }
          }
        }
      });

      // --- Floor area, floor, structure, total units, road, build year, layout ---
      var floorArea = null;
      var floor = null;
      var structure = undefined;
      var structureType = undefined;
      var totalUnits = null;
      var roadWidth = null;
      var frontage = null;
      var buildYear = null;
      var layout = "";

      rows.forEach(function(row) {
        var th = row.querySelector("th");
        var td = row.querySelector("td");
        if (!th || !td) return;
        var label = th.textContent.replace(/\\s+/g, "");
        var val = td.textContent.trim().replace(/\\s+/g, " ");

        if (label.includes("専有面積") || label.includes("建物面積")) {
          var faM = val.match(/([\\d,.]+)\\s*m/);
          if (faM) floorArea = parseFloat(faM[1].replace(/,/g, ""));
        }
        if (label.includes("所在階") || label.includes("階数") || label === "階") {
          var bM = val.match(/(?:地下|B)(\\d+)階?/);
          if (bM) {
            floor = -parseInt(bM[1], 10);
          } else {
            var flM = val.match(/(\\d+)階/);
            if (flM) floor = parseInt(flM[1], 10);
          }
        }
        if (label.includes("建物構造") || label.includes("構造")) {
          structure = val;
          if (/SRC|鉄骨鉄筋/.test(val)) structureType = "SRC";
          else if (/RC|鉄筋コンクリート/.test(val)) structureType = "RC";
          else if (/軽量鉄骨/.test(val)) structureType = "軽量鉄骨";
          else if (/鉄骨|S造/.test(val)) structureType = "S";
          else if (/木造|W造/.test(val)) structureType = "木造";
        }
        if (label.includes("総戸数")) {
          var unM = val.match(/(\\d+)\\s*戸/);
          if (unM) totalUnits = parseInt(unM[1], 10);
        }
        if (label.includes("接道") || label.includes("前面道路")) {
          var rwM = val.match(/(?:幅員|幅)\\s*[:：]?\\s*([0-9.]+)\\s*m/) || val.match(/([0-9.]+)\\s*m/);
          if (rwM) roadWidth = parseFloat(rwM[1]);
          var frM = val.match(/(?:間口|接面)\\s*[:：]?\\s*([0-9.]+)\\s*m/);
          if (frM) frontage = parseFloat(frM[1]);
        }
        if (label.includes("築年月") || label.includes("完成時期")) {
          var byM = val.match(/(20\\d{2}|19\\d{2})年/);
          if (byM) buildYear = parseInt(byM[1], 10);
        }
        if (label.includes("間取り")) {
          layout = val;
        }
      });
      var area = floorArea != null ? floorArea : landSize;

      // --- Detail URL ---
      var linkEl = el.querySelector("a.prg-bukkenNameAnchor, a.prg-detailLink, a.detailLink");
      var url = linkEl ? linkEl.getAttribute("href") : null;
      if (url && !url.startsWith("http")) url = "https://www.homes.co.jp" + url;

      results.push({
        address: address,
        ward: ward,
        price: price || 0,
        // Was defaulting to 0 when unparsed (common for ビル/office cards,
        // which often show 建物面積 with no 土地面積 row at all). hardFilter's
        // landSizeMin/buildingSizeMin checks only skip on null/undefined,
        // not 0, so that read as "confirmed 0m²" and got hard-rejected.
        area: area || undefined,
        landSize: landSize || undefined,
        floorArea: floorArea || undefined,
        source: "homes",
        url: url || undefined,
        station: station || undefined,
        walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
        buildingCoverageRatio: bcr !== null ? bcr : undefined,
        floorAreaRatio: far !== null ? far : undefined,
        propertyType: propertyType,
        floor: floor !== null ? floor : undefined,
        structure: structure || undefined,
        structureType: structureType || undefined,
        totalUnits: totalUnits !== null ? totalUnits : undefined,
        roadWidth: roadWidth !== null ? roadWidth : undefined,
        frontage: frontage !== null ? frontage : undefined,
        buildYear: buildYear !== null ? buildYear : undefined,
        layout: layout || undefined,
      });
    });

    return JSON.stringify(results);
  `), propertyType);
  return JSON.parse(raw);
}

export async function scrapeHomes(areaCode: string, filterTypes?: string[], dealType?: "buy" | "rent"): Promise<ScrapeResult> {
  const wardName = CODE_TO_WARD[areaCode] || areaCode;
  const slug = WARD_TO_SLUG[wardName];
  if (!slug) {
    logger.warn(`[Homes Scraper] No slug for ward ${wardName}, skipping`);
    return { listings: [], source: "homes", areaCode, scrapedAt: Date.now(), count: 0 };
  }

  if (dealType === "rent") {
    return await scrapeHomesChintai(areaCode, wardName, slug, filterTypes);
  }

  logger.info(`[Homes Scraper] Starting scrape`, { ward: wardName, slug, areaCode });

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

    // Determine which categories to scrape. "マンション" and "収益物件" both
    // resolve to the same mansion/chuko path — dedupe by path so a caller
    // that wants both doesn't fetch (and pay the rate-limit cost for) the
    // identical URL twice.
    const seenPaths = new Set<string>();
    const catKeys = (
      filterTypes && filterTypes.length > 0
        ? Object.entries(CATEGORY_MAP).filter(([, { label }]) => filterTypes.includes(label))
        : Object.entries(CATEGORY_MAP)
    )
      .filter(([, { path }]) => (seenPaths.has(path) ? false : (seenPaths.add(path), true)))
      .map(([key]) => key);

    if (catKeys.length === 0) {
      logger.info(`[Homes Scraper] No matching categories for ${wardName}, skipping`);
      return { listings: [], source: "homes", areaCode, scrapedAt: Date.now(), count: 0 };
    }

    const MAX_PAGES = 10;

    categoryLoop:
    for (const catKey of catKeys) {
      const { path, label } = CATEGORY_MAP[catKey];
      logger.info(`[Homes Scraper] Category ${label} for ${wardName}...`);

      for (let p = 1; p <= MAX_PAGES; p++) {
        const url = `https://www.homes.co.jp/${path}/tokyo/${slug}/list/?page=${p}`;
        logger.info(`[Homes Scraper] Loading page ${p} (${label}) for ${wardName}...`);

        let response;
        try {
          response = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
        } catch (err) {
          logger.warn(`[Homes Scraper] Page ${p} failed to load: ${(err as Error).message}`);
          scrapeErrors.push(`${label}/page${p}: ${(err as Error).message}`);
          break;
        }

        // homes.co.jp answers repeated rapid requests with an Akamai
        // "Human Verification" challenge (HTTP 405, no listings in the DOM).
        // Without this check that reads exactly like "0 listings" — the
        // ward-count check below can't tell a bot-block from real empty
        // inventory, and a whole scrape night could silently record zero
        // stock for every remaining ward once the block kicks in.
        const status = response?.status();
        const title = await page.title().catch(() => "");
        if (status === 405 || title.includes("Human Verification") || title.includes("認証")) {
          const msg = `Blocked by bot-check (status=${status}, title="${title}") on ${label}/page${p}`;
          logger.error(`[Homes Scraper] ${msg}`);
          scrapeErrors.push(msg);
          break categoryLoop;
        }

        // Check for listing items
        const hasListings = await page.evaluate(() => {
          return document.querySelectorAll(".mod-mergeBuilding--sale").length > 0;
        });

        if (!hasListings) {
          logger.info(`[Homes Scraper] No listings on page ${p}, stopping`);
          break;
        }

        await new Promise((r) => setTimeout(r, 1500));

        const listings = await extractListings(page, label);

        const newListings = listings.filter((l) => {
          const sig = `${l.address}|${l.price}`;
          if (seenSignatures.has(sig)) return false;
          seenSignatures.add(sig);
          return true;
        });

        if (newListings.length === 0) {
          logger.info(`[Homes Scraper] Page ${p}: no new listings, stopping`);
          break;
        }

        logger.info(
          `[Homes Scraper] Page ${p}: ${newListings.length} new listings (total: ${allListings.length + newListings.length})`
        );
        allListings.push(...newListings);
      }
    }

    logger.info(`[Homes Scraper] Scrape complete: ${allListings.length} listings for ${wardName}`);
    allListings.slice(0, 3).forEach((l, i) => {
      logger.info(
        `[Homes Scraper]   [${i}] ${l.ward} ${l.address} | price=${l.price}万 | land=${l.landSize}㎡ | walk=${l.walkMinutes ?? "?"}min | bcr=${l.buildingCoverageRatio ?? "?"}%`
      );
    });

    return {
      listings: allListings,
      source: "homes",
      areaCode,
      scrapedAt: Date.now(),
      count: allListings.length,
      errors: scrapeErrors.length > 0 ? scrapeErrors : undefined,
    };
  } finally {
    await browser.close();
    logger.info(`[Homes Scraper] Browser closed`);
  }
}
