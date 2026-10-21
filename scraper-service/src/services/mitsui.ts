import puppeteer from "../puppeteerStealth";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


const CATEGORY_MAP: Record<string, string> = {
  "土地": "tochi",
  // Not "ikkodate" — that slug 400s. Confirmed live: /buy/kodate/... returns
  // real /bkdetail/ listing links, /buy/ikkodate/... does not.
  "一戸建て": "kodate",
  "マンション": "mansion",
  "収益物件": "mansion",
  // "投資・事業用不動産" (investment/business real estate) — confirmed live at
  // rehouse.co.jp/buy/tohshi/... ; card structure and /bkdetail/ detail links
  // are identical to the other categories, so no extraction changes needed.
  "ビル": "tohshi",
};

/**
 * 賃貸 (chintai) lives at /rent/area/prefecture/13/city/{areaCode}/ — a
 * completely separate Vue app from /buy/ (confirmed live: rehouse.co.jp's own
 * "借りたい" nav goes there, and the page title reads "…の賃貸物件情報").
 * There is no per-type category param the way /buy/ has tochi/kodate/mansion:
 * one URL mixes 賃貸マンション/賃貸アパート/賃貸一戸建て together, each unit's
 * real type readable per-card (same pattern as suumo.ts/kenbiya.ts).
 *
 * DOM gotcha: each building's metadata (".property-index-lease-card": title,
 * type tag, address, station, build year) is NOT an ancestor of its units —
 * it is a PRECEDING SIBLING inside a shared, class-less wrapper div. Read
 * `card.parentElement.querySelectorAll(".property-section")` to reach that
 * building's units instead of walking up from a unit.
 */
async function extractChintaiListings(page: any): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function(`
    var results = [];
    var clean = function(el) { return ((el && el.textContent) || "").replace(/\\s+/g, " ").trim(); };
    var cards = document.querySelectorAll(".property-index-lease-card");

    cards.forEach(function(card) {
      var group = card.parentElement;
      if (!group) return;

      var contentPs = Array.prototype.slice.call(card.querySelectorAll(".description-section .content p"));
      var address = "", stationText = "", ageText = "";
      contentPs.forEach(function(p) {
        var t = clean(p);
        if (!t) return;
        if (!address && /[区市町村]/.test(t)) { address = t; return; }
        if (!stationText && t.indexOf("駅") >= 0) { stationText = t; return; }
        if (!ageText && /築/.test(t)) { ageText = t; }
      });
      if (!address) return;

      var station = "";
      var stM = stationText.match(/([^\\s]+駅)/);
      if (stM) station = stM[1];
      var walkMinutes = null;
      var wkM = stationText.match(/徒歩(\\d+)分/);
      if (wkM) walkMinutes = parseInt(wkM[1], 10);

      var buildYear = null;
      var byM = ageText.match(/(\\d{4})年/);
      if (byM) buildYear = parseInt(byM[1], 10);

      var typeTag = card.querySelector(".description-tag");
      var propertyType = typeTag ? clean(typeTag) : "";

      var ward = "";
      var wm = address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "")
        .replace(/^[^\\s]{1,4}郡/, "")
        .match(/^(.{1,6}?[市区])/)
        || address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "").replace(/^[^\\s]{1,4}郡/, "").match(/^(.{1,5}?[町村])/);
      if (wm) ward = wm[1];

      var units = group.querySelectorAll(".property-section");
      units.forEach(function(unit) {
        var priceEl = unit.querySelector(".rent-info-wrapper .price");
        var rent = priceEl ? parseFloat(clean(priceEl).replace(/,/g, "")) : NaN;
        if (isNaN(rent)) return;

        var mgmtText = clean(unit.querySelector(".management-fee"));
        var mgmtM = mgmtText.match(/([\\d,]+)\\s*円/);
        var managementFee = mgmtM ? parseFloat(mgmtM[1].replace(/,/g, "")) / 10000 : undefined;

        var propDesc = unit.querySelector(".property-description");
        var depositDiv = propDesc ? propDesc.querySelector("div") : null;
        var depositText = depositDiv ? clean(depositDiv) : "";
        // "敷金/礼金/保証金 2ヶ月/-/-" — confirmed live across every 港区/
        // 世田谷区 sample: all three slash-separated fields are a MULTIPLE of
        // this unit's own rent (never a bare 万円 figure), so each is
        // converted to an absolute amount by multiplying by rent.
        var depositParts = depositText.replace(/^敷金\\/礼金\\/保証金\\s*/, "").split("/");
        var parseMonths = function(s) {
          var m = (s || "").match(/([\\d.]+)\\s*ヶ月/);
          return m ? parseFloat(m[1]) : null;
        };
        var shikikinMonths = parseMonths(depositParts[0]);
        var reikinMonths = parseMonths(depositParts[1]);
        // 保証金 (guarantee money) is an alternative to 敷金 on some
        // corporate-style leases; fall back to it when 敷金 itself is "-".
        var hoshoukinMonths = parseMonths(depositParts[2]);
        var deposit = shikikinMonths != null ? shikikinMonths * rent
          : (hoshoukinMonths != null ? hoshoukinMonths * rent : undefined);
        var keyMoney = reikinMonths != null ? reikinMonths * rent : undefined;

        var descText = clean(propDesc ? propDesc.querySelector("p.paragraph-body") : null);
        var floor = null;
        var flM = descText.match(/(\\d+)階/);
        if (flM) floor = parseInt(flM[1], 10);
        var layout = "";
        var lM = descText.match(/(ワンルーム|1R|[1-9]\\d?[SLDK]+)/);
        if (lM) layout = lM[1];
        var area = null;
        var aM = descText.match(/([\\d.]+)\\s*㎡/);
        if (aM) area = parseFloat(aM[1]);

        var linkEl = unit.querySelector("a[href*='/rent/bkdetail/']");
        var url = linkEl ? linkEl.getAttribute("href") : null;
        if (url && !url.startsWith("http")) url = "https://www.rehouse.co.jp" + url;
        if (!url) return;

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
          source: "mitsui",
          propertyType: propertyType || undefined,
          dealType: "rent",
        });
      });
    });

    return JSON.stringify(results);
  `));
  return JSON.parse(raw);
}

async function scrapeMitsuiChintai(areaCode: string): Promise<ScrapeResult> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const allListings: PropertyListing[] = [];
  const seenUrls = new Set<string>();
  // Confirmed live: 港区 alone reports 107件 (~4 pages of 30/building-card),
  // but that count is per-building, not per-unit, and denser wards go higher
  // — give this real headroom rather than reusing the buy side's small cap.
  const MAX_PAGES = 15;

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    for (let p = 1; p <= MAX_PAGES; p++) {
      const url = `https://www.rehouse.co.jp/rent/area/prefecture/13/city/${areaCode}/?page=${p}`;
      logger.info(`[Mitsui Scraper] Loading chintai page ${p} for ${areaCode}...`);

      try {
        // networkidle2 here reproducibly timed out on page 2+ even though curl
        // fetches the same URL instantly — same intermittent-stall behavior
        // the buy side already worked around below. domcontentloaded plus the
        // waitForSelector right after is the same fix, applied here too.
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      } catch {
        logger.warn(`[Mitsui Scraper] Chintai page ${p} failed to load`);
        break;
      }

      try {
        await page.waitForSelector(".property-index-lease-card", { timeout: 15000 });
      } catch {
        logger.info(`[Mitsui Scraper] No chintai listings on page ${p}, stopping`);
        break;
      }

      const listings = await extractChintaiListings(page);
      const newListings = listings.filter((l) => {
        if (!l.url || seenUrls.has(l.url)) return false;
        seenUrls.add(l.url);
        return true;
      });

      if (newListings.length === 0) {
        logger.info(`[Mitsui Scraper] Chintai page ${p}: no new listings, stopping`);
        break;
      }

      logger.info(`[Mitsui Scraper] Chintai page ${p}: ${newListings.length} new listings (total: ${allListings.length + newListings.length})`);
      allListings.push(...newListings);
    }

    logger.info(`[Mitsui Scraper] Chintai scrape complete: ${allListings.length} listings for ${areaCode}`);
    return {
      listings: allListings,
      source: "mitsui",
      areaCode,
      scrapedAt: Date.now(),
      count: allListings.length,
    };
  } finally {
    await browser.close();
  }
}

async function extractListings(page: any, propertyType: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", `
    // Mitsui Rehouse search results are typically in a list of property cards
    // The "詳細を見る" (See Details) link is a good anchor for a property card
    var items = Array.from(document.querySelectorAll("a")).filter(function(a) { return (a.textContent && a.textContent.includes("詳細を見る")) || (a.href && a.href.includes("/bkdetail/")); }).map(function(a) {
      // Go up until we find a container that has an h2 (the title)
      var p = a.parentElement;
      while (p && p.tagName !== "BODY") {
        if (p.querySelector("h2")) return p;
        p = p.parentElement;
      }
      return null;
    }).filter(Boolean);

    // Deduplicate array
    items = items.filter(function(item, pos) { return items.indexOf(item) == pos; });
    var results = [];

    items.forEach(function(el) {
      if (!el) return;
      
      var linkEl = Array.from(el.querySelectorAll("a")).find(function(a) { return (a.textContent && a.textContent.includes("詳細を見る")) || (a.href && a.href.includes("/bkdetail/")); });
      var url = linkEl ? linkEl.getAttribute("href") : null;
      if (url && !url.startsWith("http")) url = "https://www.rehouse.co.jp" + url;
      
      var h2 = el.querySelector("h2");
      if (!h2) return;
      var title = h2.textContent.trim();
      
      var ward = "";
      // Strip the prefecture first: /(.{2,4}[区市])/ scanned over
      // "東京都杉並区…" matches "京都杉並区" — it is greedy from the left and
      // the 東 lands outside the capture. This is the source of the corrupt
      // ward values ("京都町田市") seen in the listings table.
      var wm = title.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "")
        // Drop a 郡 (county) prefix — the municipality follows it,
        // e.g. 西多摩郡瑞穂町 -> 瑞穂町.
        .replace(/^[^\\s]{1,4}郡/, "")
        // 市/区 BEFORE 町/村: one combined [区市町村] class matches 武蔵村
        // inside 武蔵村山市. The 町/村 fallback covers 島嶼部 (大島町, 八丈町,
        // 檜原村, 小笠原村) and 郡部, which previously extracted no ward at all.
        .match(/^(.{1,6}?[市区])/)
        || title.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "").replace(/^[^\\s]{1,4}郡/, "").match(/^(.{1,5}?[町村])/);
      if (wm) ward = wm[1];

      // Price: usually a span inside a p tag or div, looking for "万円"
      var price = 0;
      var priceElements = Array.from(el.querySelectorAll("p, div, span")).filter(function(node) {
        return node.textContent.includes("万円") || node.textContent.includes("億");
      });
      
      if (priceElements.length > 0) {
        // Take the most specific one containing price
        var priceText = priceElements[priceElements.length - 1].textContent.replace(/\\s+/g, "");
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

      // Address, Area, Station, BCR, FAR are usually in adjacent <p> tags
      var address = "";
      var station = "";
      var walkMinutes = null;
      var area = 0;
      var landSize = null;
      var floorArea = null;
      // propertyType here is always the caller's Japanese label ("マンション"),
      // never the English "mansion" CATEGORY_MAP value — that comparison
      // never matched, so floor area for every actual mansion listing was
      // silently stored as landSize instead of floorArea.
      var isMansion = propertyType === "マンション" || propertyType === "mansion" || propertyType === "収益物件";
      var bcr = null;
      var far = null;
      var layout = "";
      var age = "";

      var ps = Array.from(el.querySelectorAll("p"));
      ps.forEach(function(p) {
        var text = p.textContent.trim();
        
        // Match address / station. Was /区/ only, so every Tama-area
        // municipality (立川市, etc. — 市 not 区) never matched at all and the
        // address stayed "" — confirmed live: 31 real cards in the DOM at
        // 立川市, 0 extracted, because the final address-and-price check
        // below silently drops every listing with no address.
        if (text.match(/[区市町村]/) && text.match(/駅/) && text.includes("/")) {
          var parts = text.split("/");
          address = parts[0].trim();
          var stationPart = parts[1] || "";

          var stM = stationPart.match(/([^\\s]+駅)/);
          if (stM) station = stM[1];
          var wkM = stationPart.match(/徒歩(\\d+)分/);
          if (wkM) walkMinutes = parseInt(wkM[1], 10);
        }
        else if (text.match(/[区市町村]/) && address === "") {
          address = text; // Fallback
        }
        
        // Match area / coverage
        if (text.match(/㎡/) || text.match(/建ぺい率/) || text.match(/容積率/)) {
          var aM = text.match(/([\\d,.]+)\\s*(?:㎡|m)/);
          if (aM) {
            var parsed = parseFloat(aM[1].replace(/,/g, ""));
            if (isMansion) floorArea = parsed;
            else landSize = parsed;
          }
          var bM = text.match(/建ぺい率(\\d+)%/);
          if (bM) bcr = parseFloat(bM[1]);
          var fM = text.match(/容積率(\\d+)%/);
          if (fM) far = parseFloat(fM[1]);
        }
        
        // Layout
        if (text.match(/^\\d[LDKS]+$/)) {
          layout = text;
        }
        
        // Age
        if (text.match(/築年月/)) {
          var ageMatch = text.match(/(\\d{4}年\\d+月)/);
          if (ageMatch) age = ageMatch[1];
        }
      });
      
      // Secondary fallback for layout and age inside layout strings like "3LDK / 1999年10月"
      ps.forEach(function(p) {
        var text = p.textContent.trim();
        if (text.includes("LDK") && text.includes("年")) {
          var lM = text.match(/([\\d]+[LDKS]+)/);
          if (lM && !layout) layout = lM[1];
          var aM = text.match(/(\\d{4}年\\d+月)/);
          if (aM && !age) age = aM[1];
        }
      });
      
      if (!address) {
        var w = title.match(/(.*区[^\\s]+)/);
        if (w) address = w[1];
      }

      area = isMansion ? (floorArea || 0) : (landSize || 0);

      if (address && price) {
        results.push({
          address: address,
          ward: ward,
          price: price,
          area: area,
          landSize: landSize || undefined,
          floorArea: floorArea || undefined,
          source: "mitsui",
          url: url || undefined,
          station: station || undefined,
          walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
          buildingCoverageRatio: bcr !== null ? bcr : undefined,
          floorAreaRatio: far !== null ? far : undefined,
          propertyType: propertyType,
          layout: layout || undefined,
          age: age || undefined,
        });
      }
    });

    return JSON.stringify(results);
  `), propertyType);
  return JSON.parse(raw);
}

export async function scrapeMitsui(areaCode: string, filterTypes?: string[], dealType?: "buy" | "rent"): Promise<ScrapeResult> {
  if (dealType === "rent") {
    return await scrapeMitsuiChintai(areaCode);
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
    const prefCode = "13"; // Tokyo is 13

    for (const type of typesToScrape) {
      const typePath = CATEGORY_MAP[type];
      if (!typePath) continue;

      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        // e.g. https://www.rehouse.co.jp/buy/tochi/prefecture/13/city/13106/?page=1
        const url = `https://www.rehouse.co.jp/buy/${typePath}/prefecture/${prefCode}/city/${areaCode}/?page=${currentPage}`;
        logger.info(`[Mitsui Scraper] Fetching: ${url}`);
        
        // This site is slow and intermittently stalls a page load. The goto used
        // to be unguarded, so a single timeout threw straight out of BOTH loops
        // and abandoned every remaining category — the scrape returned partial
        // results with no indication that most of it never ran. Treat a failed
        // page as the end of THIS category and carry on with the next.
        try {
          // Kept deliberately short: domcontentloaded on a healthy page here is
          // a few seconds, so a 45s wait already means the page has stalled.
          // A longer limit just multiplies dead time across categories — at 90s
          // the whole scrape blew past 4 minutes.
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        } catch (navErr: any) {
          logger.warn(`[Mitsui Scraper] Page ${currentPage} (${type}) failed to load: ${navErr?.message}`);
          break;
        }

        try {
          await page.waitForSelector("a[href*='/bkdetail/']", { timeout: 8000 });
        } catch (e) {
          logger.info(`[Mitsui Scraper] No listings or timed out on page ${currentPage}`);
          break;
        }

        const listings = await extractListings(page, type);
        logger.info(`[Mitsui Scraper] Extracted ${listings.length} listings from page ${currentPage}`);

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
          const as = document.querySelectorAll("a");
          for (let i = 0; i < as.length; i++) {
            if (as[i].textContent?.includes("次の") || as[i].textContent?.trim() === ">") return true;
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
    logger.error(`[Mitsui Scraper] Error during scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "mitsui",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}
