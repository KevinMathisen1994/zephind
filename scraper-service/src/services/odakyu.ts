import puppeteer from "../puppeteerStealth";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


const CATEGORY_MAP: Record<string, string> = {
  "土地": "land",
  "一戸建て": "house",
  "マンション": "mansion",
  "収益物件": "mansion",
};

// ビル (投資・事業用) is not on odakyu-chukai.com at all — its own
// "事業用物件検索" nav link (/rent/biz/) is RENTAL, not buy. The real buy-side
// coverage lives on a wholly separate branded site, LIFESCAPE1
// (https://ls1.odakyu-chukai.com), linked from this site's own top nav
// ("投資・事業用物件を探す"). It has its own domain, its own card markup, and
// its own search-filter scheme (biz_kinds / m_prefecture_id) with no relation
// to the /land/list/a={code}/ URLs used above — same shape of special case as
// mizuho.ts's separate /investors/ namespace.
const LIFESCAPE_BASE = "https://ls1.odakyu-chukai.com";
// The site's own filter UI groups 5 category codes under a single "その他"
// checkbox (its other checkboxes are 区分マンション/一棟マンション/アパート,
// none of them ビル). Individually verified live: 101 = ビル（一棟）,
// 107 = 売店舗（マンション）; the other 3 (102, 106, 108) had zero Tokyo
// inventory at verification time so their labels could not be confirmed
// live, but they belong to the same "その他" bucket in the site's own form.
// The search is not filterable any finer than this, and pages are not
// filterable by ward at all (whole-Tokyo-prefecture bucket, like
// sumai1.ts's /buyers/business/) — each card carries its own real type in
// .box-label, read below instead of trusting a single requested type.
const LIFESCAPE_BIZ_KINDS = "101,102,106,107,108";
const LIFESCAPE_TOKYO_PREF_ID = "13";

async function extractLifescapeListings(page: any): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function(`
    // Card markup, verified live against
    // ${LIFESCAPE_BASE}/properties?...biz_kinds=${LIFESCAPE_BIZ_KINDS}...:
    //   <li><a href="/properties/12345">
    //     <div class="detail"><dl class="spec"> dt/dd pairs: 販売価格 / 築年数 /
    //       所在地 / 想定利回り / 専有面積 / 土地面積 / 建物構造
    //       <div class="box-label"><span class="cat cat-border ..."><span>ビル（一棟）</span></span></div>
    //     </dl></div>
    //   </a></li>
    // A member-gated ("限定公開物件は無料会員登録で閲覧が可能です") listing
    // renders as a SIBLING <li> whose only "link" is href="javascript:void(0)"
    // and carries no dl.spec at all — restricting to a real numeric
    // /properties/<id> href already excludes those, no separate check needed.
    var anchors = Array.prototype.slice.call(document.querySelectorAll('li > a[href^="/properties/"]'))
      .filter(function(a) { return /^\\/properties\\/\\d+$/.test(a.getAttribute("href") || ""); });
    var results = [];
    var txt = function(e) { return ((e && e.textContent) || "").replace(/\\s+/g, " ").trim(); };
    var num = function(s) {
      var m = (s || "").match(/([\\d,.]+)/);
      return m ? parseFloat(m[1].replace(/,/g, "")) : null;
    };

    anchors.forEach(function(a) {
      var dl = a.querySelector("dl.spec");
      if (!dl) return;

      var spec = {};
      var kids = Array.prototype.slice.call(dl.children).filter(function(k) {
        return k.tagName === "DT" || k.tagName === "DD";
      });
      var key = null;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].tagName === "DT") key = txt(kids[i]);
        else if (kids[i].tagName === "DD" && key) { spec[key] = txt(kids[i]); key = null; }
      }

      // Always printed in 万円 here, even for a 4億-yen listing ("40,000万円"),
      // but parse 億 too in case a pricier one ever switches notation.
      var priceText = (spec["販売価格"] || "").replace(/,/g, "");
      var price = 0;
      var okuMatch = priceText.match(/([\\d.]+)億/);
      var manMatch = priceText.match(/([\\d.]+)万/);
      if (okuMatch || manMatch) {
        var oku = okuMatch ? parseFloat(okuMatch[1]) * 10000 : 0;
        var man = manMatch ? parseFloat(manMatch[1]) : 0;
        price = oku + man;
      }

      var address = (spec["所在地"] || "").replace(/\\s+/g, "");

      var buildYear = null;
      var byM = (spec["築年数"] || "").match(/(\\d{4})年/);
      if (byM) buildYear = parseInt(byM[1], 10);

      var yieldPct = null;
      var yM = (spec["想定利回り"] || "").match(/([\\d.]+)/);
      if (yM) yieldPct = parseFloat(yM[1]);

      var floorArea = num(spec["専有面積"]);
      var landSize = num(spec["土地面積"]);
      var structureType = spec["建物構造"] || "";

      // The search is not URL-filtered by type at all (see the comment above
      // scrapeOdakyu's LIFESCAPE_BIZ_KINDS) — each card's own label is the
      // only reliable type, same fix sumai1.ts needed for its business page.
      var catLabel = txt(a.querySelector(".box-label .cat-border"));
      var realType = catLabel || "ビル";
      var isNew = !!a.querySelector(".box-label .iconNew");

      var ward = "";
      var wm = address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "")
        .replace(/^[^\\s]{1,4}郡/, "")
        .match(/^(.{1,6}?[市区])/)
        || address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "").replace(/^[^\\s]{1,4}郡/, "").match(/^(.{1,5}?[町村])/);
      if (wm) ward = wm[1];

      // 専有面積 is the building's own floor area here (total for a 一棟 building,
      // unit area for a 区分 unit) — the more useful "size" for a building
      // purchase, same priority マンション cards get elsewhere in this file.
      var area = floorArea || landSize || 0;

      var url = "${LIFESCAPE_BASE}" + a.getAttribute("href");

      if (address && price) {
        results.push({
          address: address,
          ward: ward,
          price: price,
          area: area,
          landSize: landSize || undefined,
          floorArea: floorArea || undefined,
          buildYear: buildYear || undefined,
          structureType: structureType || undefined,
          source: "odakyu",
          url: url,
          propertyType: realType,
          yield: yieldPct !== null ? yieldPct : undefined,
          isNew: isNew || undefined,
        });
      }
    });

    return JSON.stringify(results);
  `));
  return JSON.parse(raw);
}

/**
 * 賃貸 (own-managed rentals only, "小田急不動産の自社管理物件") — a genuinely
 * separate, much smaller inventory from LIFESCAPE1's investment listings
 * above. Confirmed live: the ward nav at /rent/area/ only links wards that
 * CURRENTLY have stock (13113 渋谷区, 13209 町田市 inside Tokyo; the rest are
 * Kanagawa) — 港区 (13103) genuinely returns 0 listings right now, not a
 * scraper bug. Card is li.estate-block, a completely different template from
 * both the /land/ buy cards and the LIFESCAPE ones above: every field (price,
 * address, access, layout, area, floor, build date) is a dt/dd pair, just
 * spread across 3 different <dl>s, so they're all read into one flat map
 * rather than special-cased per <dl>. Neither 敷金 nor 礼金 ever appeared on
 * a live card in the (tiny) sample available — this site's own list view
 * just doesn't expose them — but they're parsed defensively in case a future
 * listing does.
 */
async function extractChintaiListings(page: any): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function(`
    var txt = function(e) { return ((e && e.textContent) || "").replace(/\\s+/g, " ").trim(); };
    var parseYen = function(text) {
      if (!text) return null;
      var t = text.replace(/[\\s,]/g, "");
      var m = t.match(/([\\d.]+)円/);
      return m ? parseFloat(m[1]) / 10000 : null;
    };

    var cards = Array.prototype.slice.call(document.querySelectorAll("li.estate-block"));
    var results = [];

    cards.forEach(function(card) {
      var titleLink = card.querySelector(".estate-block-name a[href]");
      var url = titleLink ? titleLink.getAttribute("href") : null;
      if (url && url.indexOf("http") !== 0) {
        url = "https://www.odakyu-chukai.com" + (url.charAt(0) === "/" ? "" : "/") + url;
      }
      if (!url) return;

      var spec = {};
      // .estate-price-inn is the <dl> itself (not a wrapper) — unlike
      // .estate-info-list, which wraps its dl.address/dl.status children.
      var dls = card.querySelectorAll("dl.estate-price-inn, .estate-info-list dl");
      dls.forEach(function(dl) {
        var kids = Array.prototype.slice.call(dl.children);
        var key = null;
        for (var i = 0; i < kids.length; i++) {
          if (kids[i].tagName === "DT") key = txt(kids[i]);
          else if (kids[i].tagName === "DD" && key) { spec[key] = txt(kids[i]); key = null; }
        }
      });

      var rent = parseYen(spec["賃料"]);
      if (rent == null) return;
      var managementFee = parseYen(spec["管理費"]);

      // Absolute 万円/円 amount if ever present, else a "Xヶ月" multiple of
      // rent (the convention suumo.ts/keio.ts/tokyotatemono.ts use).
      var parseDepositLike = function(text) {
        if (!text) return null;
        var monthM = text.match(/([\\d.]+)\\s*ヶ月/);
        if (monthM) return parseFloat(monthM[1]) * rent;
        return parseYen(text);
      };
      var deposit = parseDepositLike(spec["敷金"]);
      var keyMoney = parseDepositLike(spec["礼金"]);

      var address = (spec["所在地"] || "").replace(/\\s+/g, "");
      if (!address) return;

      var station = "", walkMinutes = null;
      var accessText = spec["交通"] || "";
      var stM = accessText.match(/([^\\s]+駅)/);
      if (stM) station = stM[1];
      var wkM = accessText.match(/徒歩(\\d+)分/);
      if (wkM) walkMinutes = parseInt(wkM[1], 10);

      var layout = spec["間取り"] || "";
      var areaM = (spec["面積"] || "").match(/([\\d.]+)\\s*m/);
      var area = areaM ? parseFloat(areaM[1]) : null;

      var floor = null;
      var floorM = (spec["階数"] || "").match(/(\\d+)\\s*階/);
      if (floorM) floor = parseInt(floorM[1], 10);

      var buildYear = null;
      var byM = (spec["築年月"] || "").match(/(\\d{4})年/);
      if (byM) buildYear = parseInt(byM[1], 10);

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
        area: area != null ? area : undefined,
        floorArea: area != null ? area : undefined,
        buildYear: buildYear != null ? buildYear : undefined,
        floor: floor != null ? floor : undefined,
        layout: layout || undefined,
        station: station || undefined,
        walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
        url: url,
        source: "odakyu",
        // Every live example so far is an apartment unit off the site's own
        // managed-building portfolio; the card carries no type field to read
        // instead (unlike the LIFESCAPE ビル cards above).
        propertyType: "マンション",
        dealType: "rent",
      });
    });

    return JSON.stringify(results);
  `));
  return JSON.parse(raw);
}

async function scrapeOdakyuChintai(areaCode: string): Promise<ScrapeResult> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const allListings: PropertyListing[] = [];
  const seenUrls = new Set<string>();

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    let currentPage = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      // per=100 (the site's own largest page-size option) to grab everything
      // in one request — current stock per ward is tiny (0 to a few dozen,
      // confirmed live) — but still follow a "次へ" link if one ever appears.
      const url = `https://www.odakyu-chukai.com/rent/area/list/a=${areaCode}/?a%5B0%5D=${areaCode}&per=100${currentPage > 1 ? `&page=${currentPage}` : ""}`;
      logger.info(`[Odakyu Scraper] Fetching (賃貸): ${url}`);

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 1500));

      const cardCount = await page.evaluate(() => document.querySelectorAll("li.estate-block").length);
      if (cardCount === 0) {
        logger.info(`[Odakyu Scraper] No 賃貸 listings on page ${currentPage}`);
        break;
      }

      const listings = await extractChintaiListings(page);
      logger.info(`[Odakyu Scraper] Extracted ${listings.length} 賃貸 listings from page ${currentPage}`);

      const newListings = listings.filter((l) => {
        if (!l.url || seenUrls.has(l.url)) return false;
        seenUrls.add(l.url);
        return true;
      });
      if (newListings.length === 0) {
        logger.info(`[Odakyu Scraper] 賃貸 page ${currentPage}: no new listings, stopping`);
        break;
      }
      allListings.push(...newListings);

      const hasNextHref = await page.evaluate(() => {
        var a = Array.prototype.slice.call(document.querySelectorAll("a")).filter(function (x: any) {
          return /次へ/.test(x.textContent || "");
        })[0];
        return !!a;
      });

      if (hasNextHref && currentPage < config.maxPagesPerSite) {
        currentPage++;
      } else {
        hasNextPage = false;
      }
    }

    logger.info(`[Odakyu Scraper] 賃貸 scrape complete: ${allListings.length} listings for ${areaCode}`);
    return { listings: allListings, source: "odakyu", areaCode, scrapedAt: Date.now(), count: allListings.length };
  } finally {
    await browser.close();
    logger.info(`[Odakyu Scraper] Browser closed`);
  }
}

async function extractListings(page: any, propertyType: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", `
    var items = Array.from(document.querySelectorAll("a")).filter(function(a) {
      return (a.textContent && a.textContent.includes("詳細")) || (a.href && (a.href.includes("/detail/") || a.href.includes("/bk/")));
    }).map(function(a) {
      var p = a.parentElement;
      while (p && p.tagName !== "BODY") {
        if (p.textContent.includes("万円") || p.textContent.includes("億")) return p;
        p = p.parentElement;
      }
      return null;
    }).filter(Boolean);

    items = items.filter(function(item, pos) { return items.indexOf(item) === pos; });
    var results = [];

    items.forEach(function(el) {
      if (!el) return;
      var linkEl = Array.from(el.querySelectorAll("a")).find(function(a) {
        return (a.textContent && a.textContent.includes("詳細")) || (a.href && (a.href.includes("/detail/") || a.href.includes("/bk/")));
      });
      var url = linkEl ? linkEl.getAttribute("href") : null;
      if (url && !url.startsWith("http")) url = "https://www.odakyu-chukai.com" + (url.startsWith("/") ? "" : "/") + url;

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

      // propertyType here is always the caller's Japanese label ("マンション"),
      // never the English "mansion" CATEGORY_MAP value — that comparison
      // never matched, so floor area for every actual mansion listing was
      // silently stored as landSize instead of floorArea.
      var isMansion = propertyType === "マンション" || propertyType === "mansion" || propertyType === "収益物件";
      var aM = text.match(/([\\d,.]+)\\s*(?:㎡|m)/);
      if (aM) {
        var parsed = parseFloat(aM[1].replace(/,/g, ""));
        if (isMansion) floorArea = parsed;
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

      area = isMansion ? (floorArea || 0) : (landSize || 0);

      if (address && price) {
        results.push({
          address: address,
          ward: ward,
          price: price,
          area: area,
          landSize: landSize || undefined,
          floorArea: floorArea || undefined,
          source: "odakyu",
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

export async function scrapeOdakyu(areaCode: string, filterTypes?: string[], dealType?: "buy" | "rent"): Promise<ScrapeResult> {
  if (dealType === "rent") {
    return await scrapeOdakyuChintai(areaCode);
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

    if (typesToScrape.includes("ビル")) {
      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        // No ward-level filter exists on this site (see LIFESCAPE_BIZ_KINDS
        // comment above) — every page is the same whole-Tokyo-prefecture
        // query, narrowed only by `page`.
        const params =
          `rest_record_filter%5Bmatching_attributes%5D%5B0%5D%5Bkey%5D=biz_kinds` +
          `&rest_record_filter%5Bmatching_attributes%5D%5B0%5D%5Bpattern%5D=in` +
          `&rest_record_filter%5Bmatching_attributes%5D%5B0%5D%5Bvalue%5D%5B%5D=${LIFESCAPE_BIZ_KINDS}` +
          `&rest_record_filter%5Bmatching_attributes%5D%5B1%5D%5Bkey%5D=m_prefecture_id` +
          `&rest_record_filter%5Bmatching_attributes%5D%5B1%5D%5Bpattern%5D=in` +
          `&rest_record_filter%5Bmatching_attributes%5D%5B1%5D%5Bvalue%5D%5B%5D=${LIFESCAPE_TOKYO_PREF_ID}` +
          `&submit=`;
        const url = `${LIFESCAPE_BASE}/properties?${currentPage > 1 ? `page=${currentPage}&` : ""}${params}`;
        logger.info(`[Odakyu Scraper] Fetching (LIFESCAPE1/ビル): ${url}`);

        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
        await new Promise((r) => setTimeout(r, 1500));

        const itemCount = await page.evaluate(
          () => document.querySelectorAll('li > a[href^="/properties/"]').length,
        );
        if (itemCount === 0) {
          logger.info(`[Odakyu Scraper] No ビル listings on page ${currentPage}`);
          break;
        }

        const listings = await extractLifescapeListings(page);
        logger.info(`[Odakyu Scraper] Extracted ${listings.length} ビル listings from page ${currentPage}`);

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

        // No <nav class="pager"> renders at all when the whole result set
        // fits on one page; on a real last page the "next" arrow is simply
        // absent too (verified: the .pager .next element is not there in
        // either case) — a single selector check covers both.
        const hasNextHref = await page.evaluate(
          () => !!document.querySelector(".pager .next a[href]"),
        );

        if (hasNextHref && currentPage < config.maxPagesPerSite) {
          currentPage++;
        } else {
          hasNextPage = false;
        }
      }
    }

    for (const type of typesToScrape) {
      const typePath = CATEGORY_MAP[type];
      if (!typePath) continue;

      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        // e.g. https://www.odakyu-chukai.com/land/list/a=13106/
        const url = `https://www.odakyu-chukai.com/${typePath}/list/a=${areaCode}/${currentPage > 1 ? '?page=' + currentPage : ''}`;
        logger.info(`[Odakyu Scraper] Fetching: ${url}`);

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await new Promise((r) => setTimeout(r, 1500));

        const isNoResult = await page.evaluate(() => {
          const text = document.body.textContent || "";
          return text.includes("該当する物件") || text.includes("条件に一致する物件は見つかりませんでした");
        });

        if (isNoResult) {
          logger.info(`[Odakyu Scraper] Explicit no result message on page ${currentPage}`);
          break;
        }

        const listings = await extractListings(page, type);
        logger.info(`[Odakyu Scraper] Extracted ${listings.length} listings from page ${currentPage}`);

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

        const nextButtonVisible = await page.evaluate(() => {
          const next = Array.from(document.querySelectorAll("a")).find(
            (a) => a.textContent && a.textContent.includes("次へ")
          );
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
    logger.error(`[Odakyu Scraper] Error during scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "odakyu",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}
