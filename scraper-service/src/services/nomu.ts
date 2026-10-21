import puppeteer from "../puppeteerStealth";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


// Area code → url path mapping for Nomu
// Format: https://www.nomu.com/{type}/area_{pref}/{code}/
// e.g. https://www.nomu.com/land/area_tokyo/13106/
const CODE_TO_PREF_URL: Record<string, string> = {
  "13101": "tokyo/13101", "13102": "tokyo/13102", "13103": "tokyo/13103",
  "13104": "tokyo/13104", "13105": "tokyo/13105", "13106": "tokyo/13106",
  "13107": "tokyo/13107", "13108": "tokyo/13108", "13109": "tokyo/13109",
  "13110": "tokyo/13110", "13111": "tokyo/13111", "13112": "tokyo/13112",
  "13113": "tokyo/13113", "13114": "tokyo/13114", "13115": "tokyo/13115",
  "13116": "tokyo/13116", "13117": "tokyo/13117", "13118": "tokyo/13118",
  "13119": "tokyo/13119", "13120": "tokyo/13120", "13121": "tokyo/13121",
  "13122": "tokyo/13122", "13123": "tokyo/13123", "13201": "tokyo/13201",
  "13202": "tokyo/13202", "13203": "tokyo/13203", "13204": "tokyo/13204",
  "13205": "tokyo/13205", "13206": "tokyo/13206", "13207": "tokyo/13207",
  "13208": "tokyo/13208", "13209": "tokyo/13209", "13210": "tokyo/13210",
  "13211": "tokyo/13211", "13212": "tokyo/13212", "13213": "tokyo/13213",
  "13214": "tokyo/13214", "13215": "tokyo/13215", "13218": "tokyo/13218",
  "13219": "tokyo/13219", "13220": "tokyo/13220", "13221": "tokyo/13221",
  "13222": "tokyo/13222", "13223": "tokyo/13223", "13224": "tokyo/13224",
  "13225": "tokyo/13225", "13227": "tokyo/13227", "13228": "tokyo/13228",
  "13229": "tokyo/13229", "13303": "tokyo/13303", "13305": "tokyo/13305",
  "13307": "tokyo/13307", "13308": "tokyo/13308", "13361": "tokyo/13361",
  "13362": "tokyo/13362", "13363": "tokyo/13363", "13364": "tokyo/13364",
  "13381": "tokyo/13381", "13382": "tokyo/13382", "13401": "tokyo/13401",
  "13402": "tokyo/13402", "13421": "tokyo/13421",
};

const CATEGORY_MAP: Record<string, string> = {
  "土地": "land",
  "一戸建て": "house",
  "マンション": "mansion",
  "収益物件": "mansion",
};

async function extractListings(page: any, propertyType: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", `
    var items = Array.from(document.querySelectorAll("a.click_R_link")).map(function(a) {
      var d = a.closest("div");
      if (d && d.querySelector("table")) return d;
      var p = a.parentElement;
      while (p && p.tagName !== "BODY") {
        if (p.querySelector("table")) return p;
        p = p.parentElement;
      }
      return null;
    }).filter(Boolean);

    // Deduplicate
    items = items.filter(function(item, pos) { return items.indexOf(item) == pos; });
    var results = [];

    items.forEach(function(el) {
      if (!el) return;
      var linkEl = el.querySelector("a.click_R_link");
      if (!linkEl) return;
      
      var url = linkEl.getAttribute("href");
      if (url && !url.startsWith("http")) url = "https://www.nomu.com" + url;
      
      var tr = el.querySelector("table tbody tr");
      if (!tr) return;
      
      var tds = tr.querySelectorAll("td");
      if (tds.length < 5) return;
      
      var addressTd = tds[1];
      var address = "";
      var station = "";
      var walkMinutes = null;
      if (addressTd) {
        var ps = addressTd.querySelectorAll("p");
        if (ps.length >= 2) {
          address = ps[0].textContent.trim();
          var stationText = ps[1].textContent.trim();
          var stM = stationText.match(/([^\\s]+駅)/);
          if (stM) station = stM[1];
          var wkM = stationText.match(/徒歩(\\d+)分/);
          if (wkM) walkMinutes = parseInt(wkM[1], 10);
        } else {
          address = addressTd.textContent.trim();
        }
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

      var priceTd = tds[2];
      var price = 0;
      if (priceTd) {
        var priceText = priceTd.textContent.replace(/\\s+/g, "");
        var okuMatch = priceText.match(/([\\d,]+(?:\\.\\d+)?)億/);
        var manMatch = priceText.match(/([\\d,]+(?:\\.\\d+)?)万/);
        if (okuMatch || manMatch) {
          var oku = okuMatch ? parseFloat(okuMatch[1].replace(/,/g, "")) * 10000 : 0;
          var man = manMatch ? parseFloat(manMatch[1].replace(/,/g, "")) : 0;
          price = oku + man;
        } else {
          var numMatch = priceText.match(/([\\d,]+)/);
          if (numMatch) price = parseFloat(numMatch[1].replace(/,/g, ""));
        }
      }

      // propertyType here is always the caller's Japanese label ("マンション" /
      // "一戸建て" / ...), never the English CATEGORY_MAP value ("mansion" /
      // "kodate") — those bare comparisons never matched, so floor area for
      // every actual mansion listing was silently stored as landSize instead
      // of floorArea, and the age/layout parsing below never ran for house
      // listings either.
      var isMansion = propertyType === "マンション" || propertyType === "mansion" || propertyType === "収益物件";
      var isKodate = propertyType === "一戸建て" || propertyType === "kodate";

      var areaTd = tds[3];
      var landSize = 0;
      var floorArea = 0;
      if (areaTd) {
        var areaText = areaTd.textContent.trim();
        var aM = areaText.match(/([\\d,.]+)\\s*m/);
        if (aM) {
          if (isMansion) floorArea = parseFloat(aM[1].replace(/,/g, ""));
          else landSize = parseFloat(aM[1].replace(/,/g, ""));
        }
      }

      var statsTd = tds[4];
      var bcr = null;
      var far = null;
      var layout = "";
      var age = "";
      
      if (statsTd) {
        var statsText = statsTd.textContent.replace(/\\s+/g, " ");
        var pcts = statsText.match(/(\\d+)%/g);
        if (pcts && pcts.length >= 2) {
          bcr = parseFloat(pcts[0]);
          far = parseFloat(pcts[1]);
        }
        
        if (isMansion || isKodate) {
           var ageMatch = statsText.match(/(\\d{4}年\\d+月)/);
           if (ageMatch) age = ageMatch[1];
           var layoutMatch = areaTd.textContent.match(/([\\d]+[LDKS]+)/);
           if (layoutMatch) layout = layoutMatch[1];
        }
      }

      results.push({
        address: address,
        ward: ward,
        price: price || 0,
        area: isMansion ? floorArea : landSize,
        landSize: landSize || undefined,
        floorArea: floorArea || undefined,
        source: "nomu",
        url: url || undefined,
        station: station || undefined,
        walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
        buildingCoverageRatio: bcr !== null ? bcr : undefined,
        floorAreaRatio: far !== null ? far : undefined,
        propertyType: propertyType,
        layout: layout || undefined,
        age: age || undefined,
      });
    });

    return JSON.stringify(results);
  `), propertyType);
  return JSON.parse(raw);
}

/**
 * nomu.com's own 賃貸 nav (footer link "賃貸") doesn't lead to a listing
 * search on nomu.com at all — it goes to a SEPARATE domain,
 * nom-rent.com (野村不動産パートナーズの賃貸), Nomu's managed-rental brand
 * (プラウドフラット etc.). Confirmed live: that domain's area picker
 * (nom-rent.com/area/) uses the exact same ward/city numeric codes as this
 * scraper's areaCode ("13103" = 港区, checkbox value="13103"), so no separate
 * slug table is needed — areaCode is passed straight through as
 * address[]=<areaCode>. class[]=c1 is a fixed hidden form field on that
 * site (there is no other class value anywhere in its search form) — the
 * whole catalog is one managed-rental-apartment product line, confirmed live
 * (every sample building was a マンション brand, e.g. "プラウドフラット"), so
 * every listing here is tagged propertyType "マンション" and there's no
 * filterTypes-driven category split to mirror.
 *
 * Cards are a building-with-units template (`ul.mansionList > li` is one
 * BUILDING, `table.aboutTable tbody tr` inside `.vacancyWrap` is one
 * rentable UNIT, both confirmed live), with a stable 10-column layout: 階 /
 * 部屋番号 / 賃料 / 管理費 / 敷金・礼金 / 間取り / 面積 / 入居 / 詳細 / お気に入り.
 * Unlike suumo/homes/rakuten, 敷金・礼金 here was ALWAYS seen live as
 * "Xヶ月 / Yヶ月" (a rent multiple for both slots, never an absolute yen
 * amount or "無") — still run it through the same absolute/month/none
 * parser as the other sites for safety, in case a ward this wasn't sampled
 * against uses a different convention.
 */
async function extractChintaiListings(page: any): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function(`
    var toHalfWidth = function(s) {
      return s.replace(/[\\uFF01-\\uFF5E]/g, function(ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
      });
    };
    var parseDepositSlot = function(text, rentMan) {
      if (!text) return undefined;
      var t = text.trim();
      if (!t || t === "－" || t === "-" || t === "ー" || t === "―") return undefined;
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
    var buildings = document.querySelectorAll("ul.mansionList > li");

    buildings.forEach(function(building) {
      var gaiyouTables = building.querySelectorAll("table.gaiyou");
      var address = "";
      var station = "";
      var walkMinutes = null;
      var buildYear = null;
      var petsAllowed = undefined;

      gaiyouTables.forEach(function(table) {
        table.querySelectorAll("tr").forEach(function(row) {
          var th = row.querySelector("th");
          var td = row.querySelector("td");
          if (!th || !td) return;
          var label = th.textContent.trim();
          var val = td.textContent.trim();
          if (label === "住所") address = val;
          else if (label === "交通") {
            var stM = val.match(/「([^」]+)」\\s*駅/);
            if (stM) station = stM[1] + "駅";
            var wkM = val.match(/徒歩\\s*(\\d+)\\s*分/);
            if (wkM) walkMinutes = parseInt(wkM[1], 10);
          } else if (label === "築年") {
            var ageM = val.match(/築(\\d+)年/);
            if (ageM) buildYear = new Date().getFullYear() - parseInt(ageM[1], 10);
            else if (/新築/.test(val)) buildYear = new Date().getFullYear();
          } else if (label === "ペット") {
            if (val.indexOf("可") !== -1) petsAllowed = true;
            else if (val.indexOf("不可") !== -1) petsAllowed = false;
          }
        });
      });
      if (!address) return;

      var ward = "";
      var wm = address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "")
        .replace(/^[^\\s]{1,4}郡/, "")
        .match(/^(.{1,6}?[市区])/)
        || address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "").replace(/^[^\\s]{1,4}郡/, "").match(/^(.{1,5}?[町村])/);
      if (wm) ward = wm[1];

      var unitRows = building.querySelectorAll(".vacancyWrap table.aboutTable tbody tr");
      unitRows.forEach(function(row) {
        var tds = row.querySelectorAll("td");
        if (tds.length < 9) return;

        var floorM = tds[0].textContent.match(/(\\d+)\\s*階/);
        var floor = floorM ? parseInt(floorM[1], 10) : null;

        var rentM = tds[2].textContent.replace(/[\\s,]/g, "").match(/([\\d]+)円/);
        if (!rentM) return; // no rent = not a real listing row
        var rent = parseFloat(rentM[1]) / 10000;

        var mgmtM = tds[3].textContent.replace(/[\\s,]/g, "").match(/([\\d]+)円/);
        var managementFee = mgmtM ? parseFloat(mgmtM[1]) / 10000 : undefined;

        var depositParts = tds[4].textContent.split("/").map(function(s) { return s.trim(); });
        var deposit = parseDepositSlot(depositParts[0], rent);
        var keyMoney = parseDepositSlot(depositParts[1], rent);

        var layout = toHalfWidth(tds[5].textContent.trim());

        var areaM = tds[6].textContent.match(/([\\d.]+)\\s*m/);
        var area = areaM ? parseFloat(areaM[1]) : null;

        // Column order: 階/部屋番号/賃料/管理費/敷金・礼金/間取り/面積/入居/詳細/お気に入り
        // — the detail link lives in the 詳細 cell at index 8, not 7.
        var linkEl = tds.length > 8 ? tds[8].querySelector("a.viewBtn") : null;
        var url = linkEl ? linkEl.getAttribute("href") || "" : "";
        if (url && !url.startsWith("http")) url = "https://www.nom-rent.com" + url;
        if (!url) return; // no detail link = can't dedupe/match reliably

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
          petsAllowed: petsAllowed,
          url: url,
          source: "nomu",
          propertyType: "マンション",
          dealType: "rent",
        });
      });
    });

    return JSON.stringify(results);
  `));
  return JSON.parse(raw);
}

async function scrapeNomuChintai(areaCode: string): Promise<ScrapeResult> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const allListings: PropertyListing[] = [];
  const seenUrls = new Set<string>();
  // Confirmed live: nom-rent.com is a small managed-rental catalog (港区
  // alone paginated out at 2 pages / ~11 buildings), nothing like suumo's
  // dense multi-thousand-listing chintai vertical — a modest page cap is
  // enough to exhaust it and the empty-page break below stops earlier anyway.
  const MAX_PAGES = 10;

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    for (let p = 1; p <= MAX_PAGES; p++) {
      const url = `https://www.nom-rent.com/area/result${areaCode}/?address%5B%5D=${areaCode}&class%5B%5D=c1&pg=${p}`;
      logger.info(`[Nomu Scraper] Loading chintai page ${p} for area ${areaCode}...`);

      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
      } catch {
        logger.warn(`[Nomu Scraper] Chintai page ${p} failed to load`);
        break;
      }

      try {
        await page.waitForSelector("ul.mansionList > li", { timeout: 15000 });
      } catch {
        logger.info(`[Nomu Scraper] No chintai listings on page ${p}, stopping`);
        break;
      }

      await new Promise((r) => setTimeout(r, 1500));

      const listings = await extractChintaiListings(page);
      const newListings = listings.filter((l) => {
        if (!l.url || seenUrls.has(l.url)) return false;
        seenUrls.add(l.url);
        return true;
      });

      if (newListings.length === 0) {
        logger.info(`[Nomu Scraper] Chintai page ${p}: no new listings, stopping`);
        break;
      }

      logger.info(`[Nomu Scraper] Chintai page ${p}: ${newListings.length} new listings (total: ${allListings.length + newListings.length})`);
      allListings.push(...newListings);
    }

    logger.info(`[Nomu Scraper] Chintai scrape complete: ${allListings.length} listings for area ${areaCode}`);
    allListings.slice(0, 5).forEach((l, i) => {
      logger.info(
        `[Nomu Scraper]   [${i}] ${l.ward} ${l.address} | rent=${l.rent}万円 | mgmt=${l.managementFee ?? "?"}万円 | deposit=${l.deposit ?? "?"} | keyMoney=${l.keyMoney ?? "?"} | pets=${l.petsAllowed ?? "?"}`
      );
    });

    return {
      listings: allListings,
      source: "nomu",
      areaCode,
      scrapedAt: Date.now(),
      count: allListings.length,
    };
  } finally {
    await browser.close();
  }
}

export async function scrapeNomu(areaCode: string, filterTypes?: string[], dealType?: "buy" | "rent"): Promise<ScrapeResult> {
  if (dealType === "rent") {
    return await scrapeNomuChintai(areaCode);
  }

  const prefAndCode = CODE_TO_PREF_URL[areaCode];
  if (!prefAndCode) {
    logger.warn(`[Nomu Scraper] No mapping for ward code ${areaCode}, skipping`);
    return { listings: [], source: "nomu", areaCode, scrapedAt: Date.now(), count: 0 };
  }

  logger.info(`[Nomu Scraper] Starting scrape`, { areaCode, prefAndCode });

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

      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        const url = `https://www.nomu.com/${typePath}/area_${prefAndCode}/?p=${currentPage}`;
        logger.info(`[Nomu Scraper] Fetching: ${url}`);
        
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await new Promise((r) => setTimeout(r, 1500));
        
        const isNoResult = await page.evaluate(() => {
          const text = document.body.textContent || "";
          return text.includes("該当する物件") || text.includes("お探しの条件に一致する物件は見つかりませんでした");
        });

        if (isNoResult) {
          logger.info(`[Nomu Scraper] Explicit no result message on page ${currentPage}`);
          break;
        }

        const listings = await extractListings(page, type);
        logger.info(`[Nomu Scraper] Extracted ${listings.length} listings from page ${currentPage}`);

        if (listings.length === 0) {
          break;
        }

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
          const next = document.querySelector(".pager_next a, .next a");
          if (next) return true;
          const as = document.querySelectorAll("a");
          for (let i = 0; i < as.length; i++) {
            if (as[i].textContent?.includes("次へ")) return true;
          }
          return false;
        });

        if (nextButtonVisible && currentPage < config.maxPagesPerSite) {
          currentPage++;
        } else {
          hasNextPage = false;
        }
      }
    }
  } catch (error: any) {
    logger.error(`[Nomu Scraper] Error during scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "nomu",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}
