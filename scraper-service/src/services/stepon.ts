import puppeteer from "../puppeteerStealth";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


const CATEGORY_MAP: Record<string, string> = {
  "土地": "tochi",
  // Not "ikkodate" — that slug 500s ("サーバーが混み合っています"). Confirmed
  // live: /kodate/... returns real post_param listing links.
  "一戸建て": "kodate",
  "マンション": "mansion",
  "収益物件": "mansion",
};

// 賃貸 (chintai) has no 土地 category (confirmed live: /chintai/search/list/
// ?type=tochi... 500s — "サーバーが混み合っています", same failure buy-side's
// wrong "ikkodate" slug hit) — land isn't offered as a rental type on this
// site at all, so only these two are real.
const CHINTAI_CATEGORY_MAP: Record<string, string> = {
  "一戸建て": "kodate",
  "マンション": "mansion",
  "収益物件": "mansion",
};

/**
 * 賃貸 lives at /chintai/search/list/?type={mansion|kodate}&prefCd=13&
 * searchType=area&prefCityCd=13_{cityCode} — confirmed live via the site's own
 * "貸したい"/area-picker nav, real card count and title ("港区（東京都）｜賃貸｜…").
 * Reuses the exact same resultItem/dl/dt/dd card template as /buy/ (same
 * design system, different vertical), so most of extractListings' shape
 * carries over — but rent/fees are printed in 円, not 万円, and the
 * combined "間取り/専有面積" label appears here too. 敷金/礼金/保証金/権利金
 * are NOT on this list card at all (confirmed on the detail page instead,
 * where they read as an absolute 円 amount, e.g. "1,380,000円／2ヶ月") — no
 * other scraper in this codebase fetches a detail page per listing, so
 * deposit/keyMoney are left unset here rather than adding N detail-page
 * round trips per ward.
 */
async function extractChintaiListings(page: any, propertyType: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", `
    var items = Array.from(document.querySelectorAll("a.post_param.blank_window")).map(function(a) {
      var p = a.parentElement;
      while (p && p.tagName !== "BODY") {
        if (p.querySelector("dl") && p.textContent.includes("賃料")) return p;
        p = p.parentElement;
      }
      return null;
    }).filter(Boolean);
    items = items.filter(function(item, pos) { return items.indexOf(item) == pos; });

    var results = [];

    items.forEach(function(el) {
      var linkEl = el.querySelector("a.post_param.blank_window[href*='/chintai/detail/']") || el.querySelector("a.post_param.blank_window");
      var url = linkEl ? linkEl.getAttribute("href") : null;
      if (url && !url.startsWith("http")) {
        url = "https://www.stepon.co.jp" + (url.startsWith("/") ? "" : "/") + url;
      }
      if (!url) return;

      var rent = null;
      var managementFee = undefined;
      var address = "";
      var stationText = "";
      var layout = "";
      var area = null;
      var buildYear = null;

      var dls = el.querySelectorAll("dl");
      dls.forEach(function(dl) {
        var dt = dl.querySelector("dt");
        var dd = dl.querySelector("dd");
        if (!dt || !dd) return;
        var label = dt.textContent.trim();

        if (label === "賃料") {
          var m = dd.textContent.replace(/[\\s,]/g, "").match(/([\\d.]+)円/);
          if (m) rent = parseFloat(m[1]) / 10000;
        } else if (label === "共益費等") {
          var mm = dd.textContent.replace(/[\\s,]/g, "").match(/([\\d.]+)円/);
          if (mm) managementFee = parseFloat(mm[1]) / 10000;
        } else if (label === "所在地") {
          address = dd.textContent.trim();
        } else if (label === "交通") {
          var firstP = dd.querySelector("p");
          stationText = (firstP ? firstP.textContent : dd.textContent).trim();
        } else if (label === "間取り/専有面積" || label === "間取り") {
          var val = dd.textContent.trim();
          var parts = val.split("/");
          if (parts[0]) layout = parts[0].trim();
          var am = val.match(/([\\d.]+)\\s*(?:m|㎡)/);
          if (am) area = parseFloat(am[1]);
        } else if (label === "築年月") {
          var ym = dd.textContent.match(/(\\d{4})年/);
          if (ym) buildYear = parseInt(ym[1], 10);
        }
      });

      if (rent == null || !address) return;

      var station = "";
      var stM = stationText.match(/「([^」]+)」\\s*駅/) || stationText.match(/([^\\s「」]+駅)/);
      if (stM) station = stM[1].indexOf("駅") >= 0 ? stM[1] : stM[1] + "駅";
      var walkMinutes = null;
      var wkM = stationText.match(/徒歩\\s*(\\d+)\\s*分/);
      if (wkM) walkMinutes = parseInt(wkM[1], 10);

      // No structured ペット可 field on this card — the site prints it as a
      // result icon (alt="ペット相談") or inline in the free-text lead
      // instead, so read both rather than relying on one.
      var petsAllowed = undefined;
      var petHit = Array.prototype.slice.call(el.querySelectorAll("img[alt]")).some(function(img) {
        return (img.getAttribute("alt") || "").indexOf("ペット") >= 0;
      }) || el.textContent.indexOf("ペット") >= 0;
      if (petHit) petsAllowed = true;

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
        managementFee: managementFee,
        area: area != null ? area : undefined,
        floorArea: area != null ? area : undefined,
        buildYear: buildYear != null ? buildYear : undefined,
        source: "stepon",
        url: url,
        station: station || undefined,
        walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
        propertyType: propertyType,
        layout: layout || undefined,
        petsAllowed: petsAllowed,
        dealType: "rent",
      });
    });

    return JSON.stringify(results);
  `), propertyType);
  return JSON.parse(raw);
}

async function scrapeSteponChintai(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const allListings: PropertyListing[] = [];
  const scrapeErrors: string[] = [];
  const seenSignatures = new Set<string>();
  // Confirmed live: a single ward+type page with limit=50 already returns
  // its whole result set in one page for every ward checked (34件 for 港区
  // マンション) — this cap is headroom for denser wards, not a routine need.
  const MAX_PAGES = 10;

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    const prefCode = areaCode.substring(0, 2);
    const cityCode = areaCode.substring(2);
    const requestedTypes = filterTypes?.length ? filterTypes : Object.keys(CHINTAI_CATEGORY_MAP);
    const typesToScrape = requestedTypes.filter((t) => CHINTAI_CATEGORY_MAP[t]);

    for (const type of typesToScrape) {
      const typePath = CHINTAI_CATEGORY_MAP[type];

      for (let currentPage = 1; currentPage <= MAX_PAGES; currentPage++) {
        const url = `https://www.stepon.co.jp/chintai/search/list/?type=${typePath}&prefCd=${prefCode}&searchType=area&prefCityCd=${prefCode}_${cityCode}&limit=50&pageNo=${currentPage}`;
        logger.info(`[Stepon Scraper] Fetching (chintai): ${url}`);

        try {
          await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
        } catch (navErr: any) {
          logger.warn(`[Stepon Scraper] Chintai page ${currentPage} (${type}) failed to load: ${navErr?.message}`);
          break;
        }

        try {
          await page.waitForSelector("dl dt", { timeout: 8000 });
        } catch {
          logger.info(`[Stepon Scraper] No chintai listings or timed out on page ${currentPage} (${type})`);
          break;
        }

        const listings = await extractChintaiListings(page, type);
        logger.info(`[Stepon Scraper] Extracted ${listings.length} chintai listings from page ${currentPage} (${type})`);

        if (listings.length === 0) break;

        let addedCount = 0;
        for (const item of listings) {
          const sig = `${item.url}`;
          if (!seenSignatures.has(sig)) {
            seenSignatures.add(sig);
            allListings.push(item);
            addedCount++;
          }
        }

        if (addedCount === 0) break;
      }
    }
  } catch (error: any) {
    logger.error(`[Stepon Scraper] Error during chintai scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "stepon",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}

async function extractListings(page: any, propertyType: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", `
    var results = [];

    // Modern Step layout uses .sr-card
    var cards = Array.from(document.querySelectorAll(".sr-card"));
    if (cards.length > 0) {
      cards.forEach(function(card) {
        var linkEl = card.querySelector("a.sr-card__name") || card.querySelector("a[href*='detail_']");
        var url = linkEl ? linkEl.getAttribute("href") : null;
        if (url && !url.startsWith("http")) {
          url = "https://www.stepon.co.jp" + (url.startsWith("/") ? "" : "/") + url;
        }
        if (!url) return;

        var head = card.querySelector("#label_price_head")?.textContent?.trim() || "";
        var tail = card.querySelector("#label_price_tail")?.textContent?.trim() || "";
        var price = (parseFloat(head.replace(/,/g, "")) || 0) * 10000 + (parseFloat(tail.replace(/,/g, "")) || 0);
        if (!price) {
          var pText = (card.querySelector(".sr-card__price")?.textContent || "").replace(/\\s+/g, "");
          var okuMatch = pText.match(/([\\d,]+(?:\\.\\d+)?)億/);
          var manMatch = pText.match(/([\\d,]+(?:\\.\\d+)?)万/);
          if (okuMatch || manMatch) {
            var oku = okuMatch ? parseFloat(okuMatch[1].replace(/,/g, "")) * 10000 : 0;
            var man = manMatch ? parseFloat(manMatch[1].replace(/,/g, "")) : 0;
            price = oku + man;
          }
        }

        var textEl = card.querySelector(".sr-card__text");
        var address = "";
        if (textEl) {
          var textLines = textEl.innerText.split("\\n").map(function(s) { return s.trim(); }).filter(Boolean);
          for (var i = 0; i < textLines.length; i++) {
            if (/^.{2,3}[都道府県].{1,8}[市区郡]/.test(textLines[i])) {
              address = textLines[i];
              break;
            }
          }
        }
        if (!address) {
          var adM = (card.textContent || "").match(/(東京都[^\\s\\n\\r]+[市区町村][^\\s\\n\\r]+)/);
          if (adM) address = adM[1];
        }

        var station = "";
        var walkMinutes = null;
        var p1 = card.querySelector("#railStation1") || card.querySelector("p[id*='railStation']");
        var stText = p1 ? p1.textContent.trim() : "";
        if (stText) {
          var ekiSpan = card.querySelector("#station1, #eki1");
          station = ekiSpan ? ekiSpan.textContent.replace(/[「」]/g, "").trim() + "駅" : "";
          var wkM = stText.match(/徒歩(\\d+)分/);
          if (wkM) walkMinutes = parseInt(wkM[1], 10);
        }

        var cardAllText = card.textContent || "";
        var area = 0;
        var aM = cardAllText.match(/([\\d,.]+)\\s*(?:㎡|m2|m²|平米)/);
        if (aM) area = parseFloat(aM[1].replace(/,/g, ""));

        var ward = "";
        var wm = address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "")
          .replace(/^[^\\s]{1,4}郡/, "")
          .match(/^(.{1,6}?[市区])/) ||
          address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "").replace(/^[^\\s]{1,4}郡/, "").match(/^(.{1,5}?[町村])/);
        if (wm) ward = wm[1];

        var pType = card.querySelector("#type_label")?.textContent?.trim() || propertyType;

        if (address && price) {
          results.push({
            address: address,
            ward: ward,
            price: price,
            area: area,
            landSize: pType === "マンション" ? undefined : area,
            floorArea: pType === "マンション" ? area : undefined,
            source: "stepon",
            url: url,
            station: station || undefined,
            walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
            propertyType: pType,
          });
        }
      });
      if (results.length > 0) return JSON.stringify(results);
    }

    // Fallback: Legacy Sumitomo Step uses 'post_param blank_window'
    var items = Array.from(document.querySelectorAll("a.post_param.blank_window")).map(function(a) {
      // Find the closest container that contains the dl lists
      var p = a.parentElement;
      while (p && p.tagName !== "BODY") {
        if (p.querySelector("dl") && p.textContent.includes("価格")) return p;
        p = p.parentElement;
      }
      return null;
    }).filter(Boolean);

    // Deduplicate
    items = items.filter(function(item, pos) { return items.indexOf(item) == pos; });
    var results = [];

    items.forEach(function(el) {
      if (!el) return;
      
      var linkEl = el.querySelector("a.post_param.blank_window");
      var url = linkEl ? linkEl.getAttribute("href") : null;
      if (url && !url.startsWith("http")) {
        url = "https://www.stepon.co.jp" + (url.startsWith("/") ? "" : "/") + url;
      }
      
      var price = 0;
      var address = "";
      var station = "";
      var area = 0;
      var walkMinutes = null;
      var landSize = null;
      var floorArea = null;
      var layout = "";
      var age = "";

      var dls = el.querySelectorAll("dl");
      dls.forEach(function(dl) {
        var dt = dl.querySelector("dt");
        var dd = dl.querySelector("dd");
        if (!dt || !dd) return;
        
        var label = dt.textContent.trim();
        var val = dd.textContent.trim();
        
        if (label === "価格") {
          var priceText = val.replace(/\\s+/g, "");
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
        } else if (label === "所在地") {
          address = val;
        } else if (label === "交通") {
          station = val.split(" ")[0];
          var wkM = val.match(/徒歩(\\d+)分/);
          if (wkM) walkMinutes = parseInt(wkM[1], 10);
        } else if (label === "土地面積") {
          var aM = val.match(/([\\d,.]+)/);
          if (aM) landSize = parseFloat(aM[1].replace(/,/g, ""));
        } else if (label === "専有面積" || label === "建物面積") {
          var fM = val.match(/([\\d,.]+)/);
          if (fM) floorArea = parseFloat(fM[1].replace(/,/g, ""));
        } else if (label === "間取り/専有面積") {
          // Site now packs both into one dl (e.g. "2LDK / 56.87m²") instead of
          // separate 間取り/専有面積 rows — confirmed live, every マンション
          // listing was coming back with area=0 because neither old label
          // matched anymore.
          var comboParts = val.split("/");
          if (comboParts[0]) layout = comboParts[0].trim();
          var fM2 = val.match(/([\\d,.]+)\\s*(?:m|㎡)/);
          if (fM2) floorArea = parseFloat(fM2[1].replace(/,/g, ""));
        } else if (label === "間取り") {
          layout = val;
        } else if (label === "築年月") {
          age = val;
        }
      });
      
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

      // propertyType here is always the caller's Japanese label ("土地"),
      // never the English "tochi" CATEGORY_MAP value — that comparison never
      // matched, so area for every 土地/一戸建て listing fell to floorArea
      // (always null here, so area silently came out 0). That 0 fails the
      // "!listing.area" benchmark-scoring guard in propertyMatcher.ts outright.
      // マンション area is its 専有面積 (floorArea); everything else (土地,
      // 一戸建て) uses 土地面積 (landSize) with floorArea as a fallback — a
      // 一戸建て listing whose 建物面積 label wasn't matched still has a real
      // landSize and should not come out area=0 (confirmed live: some houses
      // only expose 土地面積 on the list card).
      area = propertyType === "マンション" ? (floorArea || 0) : (landSize || floorArea || 0);

      if (address && price) {
        results.push({
          address: address,
          ward: ward,
          price: price,
          area: area,
          landSize: landSize || undefined,
          floorArea: floorArea || undefined,
          source: "stepon",
          url: url || undefined,
          station: station || undefined,
          walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
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

export async function scrapeStepon(areaCode: string, filterTypes?: string[], dealType?: "buy" | "rent"): Promise<ScrapeResult> {
  if (dealType === "rent") {
    return await scrapeSteponChintai(areaCode, filterTypes);
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
    // For Stepon, Tokyo is area_13. The areaCode is already prefCode + cityCode, e.g. 13106
    const prefCode = areaCode.substring(0, 2); 
    const cityCode = areaCode.substring(2);

    for (const type of typesToScrape) {
      const typePath = CATEGORY_MAP[type];
      if (!typePath) continue;

      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        const url = currentPage === 1 ? `https://www.stepon.co.jp/${typePath}/area_${prefCode}/list_${prefCode}_${cityCode}/` : `https://www.stepon.co.jp/${typePath}/area_${prefCode}/list_${prefCode}_${cityCode}/?page=${currentPage}`;
        logger.info(`[Stepon Scraper] Fetching: ${url}`);
        
        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
        
        try {
          await page.waitForSelector(".sr-card, dl dt", { timeout: 10000 });
        } catch (e) {
          logger.info(`[Stepon Scraper] No listings or timed out on page ${currentPage}`);
          break;
        }

        const listings = await extractListings(page, type);
        logger.info(`[Stepon Scraper] Extracted ${listings.length} listings from page ${currentPage}`);

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
          const next = document.querySelector(".pager li.next a, a.next");
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
    logger.error(`[Stepon Scraper] Error during scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "stepon",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}
