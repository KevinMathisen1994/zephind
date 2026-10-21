import puppeteer from "../puppeteerStealth";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


const TOKYO_WARD_MAP: Record<string, string> = {
  "13101": "千代田区", "13102": "中央区", "13103": "港区", "13104": "新宿区",
  "13105": "文京区", "13106": "台東区", "13107": "墨田区", "13108": "江東区",
  "13109": "品川区", "13110": "目黒区", "13111": "大田区", "13112": "世田谷区",
  "13113": "渋谷区", "13114": "中野区", "13115": "杉並区", "13116": "豊島区",
  "13117": "北区", "13118": "荒川区", "13119": "板橋区", "13120": "練馬区",
  "13121": "足立区", "13122": "葛飾区", "13123": "江戸川区",
  "13201": "八王子市", "13202": "立川市", "13203": "武蔵野市", "13204": "三鷹市",
  "13205": "青梅市", "13206": "府中市", "13207": "昭島市", "13208": "調布市",
  "13209": "町田市", "13210": "小金井市", "13211": "小平市", "13212": "日野市",
  "13213": "東村山市", "13214": "国分寺市", "13215": "国立市", "13218": "福生市",
  "13219": "狛江市", "13220": "東大和市", "13221": "清瀬市", "13222": "東久留米市",
  "13223": "武蔵村山市", "13224": "多摩市", "13225": "稲城市", "13227": "羽村市",
  "13228": "あきる野市", "13229": "西東京市",
};

const CODE_TO_CITY: Record<string, string> = {
  "13101": "chiyoda", "13102": "chuou", "13103": "minato", "13104": "shinjuku",
  "13105": "bunkyo", "13106": "taito", "13107": "sumida", "13108": "koutou",
  "13109": "shinagawa", "13110": "meguro", "13111": "oota", "13112": "setagaya",
  "13113": "shibuya", "13114": "nakano", "13115": "suginami", "13116": "toshima",
  "13117": "kita", "13118": "arakawa", "13119": "itabashi", "13120": "nerima",
  "13121": "adachi", "13122": "katsushika", "13123": "edogawa",
  "13201": "hachioji", "13202": "tachikawa", "13203": "musashino", "13204": "mitaka",
  "13205": "oume", "13206": "fuchu", "13207": "akishima", "13208": "chofu",
  "13209": "machida", "13210": "koganei", "13211": "kodaira", "13212": "hino",
  "13213": "higashimurayama", "13214": "kokubunji", "13215": "kunitachi", "13218": "fussa",
  "13219": "komae", "13220": "higashiyamato", "13221": "kiyose", "13222": "higashikurume",
  "13223": "musashimurayama", "13224": "tama", "13225": "inagi", "13227": "hamura",
  "13228": "akiruno", "13229": "nishitokyo",
};

async function extractListingsFromPage(page: any, wardName: string, pType?: string): Promise<{ listings: any[], detailUrls: string[] }> {
  const raw = await page.evaluate(new Function("ward", "pt", `
    var results = [];
    var urls = [];
    // "買う > 事業用" (/buy_other/, ビル・一棟売マンション・他) renders a
    // slightly different template — .card-box instead of .card-box-inner.
    // Everything below already falls back to regex-over-text when a specific
    // sub-selector is missing, so no other changes were needed for it.
    var cardEls = document.querySelectorAll(".card-box-inner");
    if (cardEls.length === 0) cardEls = document.querySelectorAll(".card-box");
    cardEls.forEach(function(card) {
      var cardText = card.textContent || "";

      var titleEl = card.querySelector(".title-wrap__title-text");
      var address = titleEl ? titleEl.textContent?.trim() || "" : "";
      if (!address) { var m = cardText.match(/(東京都[^\\s]{1,40}?[区市])/); if (m) address = m[1]; }

      var price = null;
      var priceEl = card.querySelector(".property-price");
      var priceText = priceEl ? priceEl.textContent?.trim() || "" : "";
      if (!priceText) {
        var m = cardText.match(/([\\d,億万〜~]+万円)/);
        if (m) priceText = m[1];
      }
      if (priceText) {
        var cleaned = priceText.replace(/[\\s,]/g, "");
        var firstPart = cleaned.split(/[~〜-]/)[0];
        var okuMatch = firstPart.match(/([\\d,]+(?:\\.\\d+)?)億/);
        var manMatch = firstPart.match(/([\\d,]+(?:\\.\\d+)?)万/);
        if (okuMatch || manMatch) {
          var oku = okuMatch ? parseFloat(okuMatch[1].replace(/,/g, "")) * 10000 : 0;
          var man = manMatch ? parseFloat(manMatch[1].replace(/,/g, "")) : 0;
          price = oku + man;
        } else {
          var simpleMatch = firstPart.match(/(\\d+(?:\\.\\d+)?)/);
          if (simpleMatch) price = parseFloat(simpleMatch[1]);
        }
      }
      if (!address || !price) return;

      var table = card.querySelector(".property-detail-table");
      var text = table ? table.textContent || "" : cardText;

      var area = null;
      var am2 = text.match(/土地面積[：:]*\\s*([\\d,.]+)\\s*m²/);
      if (am2) area = parseFloat(am2[1].replace(/,/g, ""));
      if (!area) { var ts = text.match(/([\\d,.]+)\\s*坪/); if (ts) area = parseFloat(ts[1].replace(/,/g, "")) * 3.30578; }

      var station = "";
      var walkMinutes = null;
      var stM = cardText.match(/「([^」]+)」\\s*駅/);
      if (stM) station = stM[1] + "駅";
      else { var sm = cardText.match(/([^\\s]+駅)/); if (sm) station = sm[1]; }
      var wkM = cardText.match(/徒歩\\s*(\\d+)\\s*分/);
      if (wkM) walkMinutes = parseInt(wkM[1]);

      var bcr = null;
      var far = null;
      var bf = text.match(/建ぺい率[／/]容積率[：:]*\\s*([\\d.]+)%[／/]\\s*([\\d.]+)%/);
      if (bf) { bcr = parseFloat(bf[1]); far = parseFloat(bf[2]); }
      else {
        var bm = text.match(/建ぺい率[：:]?\\s*([\\d.]+)\\s*%/); if (bm) bcr = parseFloat(bm[1]);
        var fm2 = text.match(/容積率[：:]?\\s*([\\d.]+)\\s*%/); if (fm2) far = parseFloat(fm2[1]);
      }

      var layout = "";
      var lM = cardText.match(/間取り\\s*([^\\s\\u3000,，|｜（(]+)/);
      if (lM) {
        layout = lM[1].replace(/[\\uFF01-\\uFF5E]/g, function(ch) {
          return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
        }).replace(/\\u3000/g, " ");
      }

      var detailUrl = "";
      var linkEl = card.closest("a") || card.querySelector("a[href*='/tochi/'], a[href*='/kodate/'], a[href*='/mansion/'], a");
      if (linkEl) {
        var href = linkEl.getAttribute("href") || "";
        detailUrl = href.startsWith("http") ? href : "https://www.athome.co.jp" + href;
      }

      // area/landSize used to default to 0 when unparsed. hardFilter's
      // landSizeMin/buildingSizeMin checks only skip on null/undefined, not
      // 0, so an unparsed size (common for buy_other/ビル cards, which often
      // have no 土地面積 row) read as "confirmed 0m²" and got hard-rejected
      // by any such filter instead of being treated as unknown.
      results.push({ address: address, ward: ward, price: price, area: area || undefined, landSize: area || undefined, source: "athome", station: station || undefined, walkMinutes: walkMinutes ?? undefined, buildingCoverageRatio: bcr ?? undefined, floorAreaRatio: far ?? undefined, url: detailUrl || undefined, detailUrl: detailUrl || undefined, propertyType: pt || undefined, layout: layout || undefined });
      if (detailUrl) urls.push(detailUrl);
    });
    return JSON.stringify({ listings: results, detailUrls: urls });
  `), wardName, pType || "");
  return JSON.parse(raw);
}


/**
 * 賃貸 cards are a building-with-units template, same shape as suumo's/
 * homes' chintai cards: `.p-property--building` is one BUILDING,
 * `.p-property__room--detailbox[data-bukken-no]` inside it is one rentable
 * UNIT. Confirmed live at /chintai/tokyo/{city}-city/list/ — this single
 * unfiltered URL already mixes 賃貸マンション/アパート/一戸建て together (a
 * sampled 港区 building card was labeled "賃貸一戸建て" on the same page as
 * plain マンション cards), same pattern as suumo/kenbiya: read the real type
 * off each building's own "家" info line rather than forcing a category split
 * that doesn't exist here.
 *
 * The chintai template is a completely different CSS build from the buy
 * side's readable "card-box-inner" classes (obfuscated names like
 * "C0Z4D_list_icon" everywhere) — none of the buy-side selectors below apply
 * here, this extraction was written from scratch off the real chintai markup.
 *
 * 敷金/礼金 live in one cell (`.p-property__room-keymoney`): a `<p>` for 敷金
 * (deposit) and a sibling `<span class="shikirei_text_free|_paid">` for 礼金
 * (keyMoney). Both were confirmed live in three different forms: "なし" (an
 * explicit zero — always paired with the "_free" class), "Xヶ月" (a multiple
 * of THIS unit's own rent, converted to an absolute amount), or a bare
 * "X万円" (already absolute, e.g. "45万円" alongside a matching "22.5万円"
 * deposit) — never a raw yen amount here, unlike homes/rakuten/suumo.
 */
async function extractChintaiListings(page: any): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function(`
    var parseDepositSlot = function(text, rentMan) {
      if (!text) return undefined;
      var t = text.trim();
      if (!t || t === "－" || t === "-" || t === "ー" || t === "―") return undefined;
      if (t === "なし" || t === "無") return 0;
      var monthM = t.match(/([\\d.]+)\\s*ヶ月/);
      if (monthM) return parseFloat(monthM[1]) * rentMan;
      var manM = t.match(/([\\d,.]+)\\s*万円/);
      if (manM) return parseFloat(manM[1].replace(/,/g, ""));
      return undefined;
    };

    var results = [];
    var buildings = document.querySelectorAll(".p-property--building");

    buildings.forEach(function(building) {
      var address = "";
      var station = "";
      var walkMinutes = null;
      var propertyType = "";
      var buildYear = null;

      building.querySelectorAll(".p-property__information-hint").forEach(function(dl) {
        var icon = dl.querySelector("i");
        var title = icon ? icon.getAttribute("title") : "";
        var dd = dl.querySelector("dd");
        if (!dd) return;
        if (title === "所在地") {
          address = dd.textContent.trim();
        } else if (title === "交通") {
          var text = dd.textContent.trim();
          var stM = text.match(/「([^」]+)」\\s*駅/);
          if (stM) station = stM[1] + "駅";
          else { var sm = text.match(/([^\\s]+駅)/); if (sm) station = sm[1]; }
          var wkM = text.match(/徒歩\\s*(\\d+)\\s*分/);
          if (wkM) walkMinutes = parseInt(wkM[1], 10);
        } else if (title === "家") {
          var lines = dd.innerHTML.split(/<br\\s*\\/?>/i).map(function(s) { return s.replace(/<[^>]+>/g, "").trim(); }).filter(Boolean);
          if (lines.length > 0) propertyType = lines[0].replace(/^賃貸/, "");
          lines.forEach(function(line) {
            var yearM = line.match(/(\\d{4})年/);
            var ageM = line.match(/築(\\d+)年/);
            if (yearM) buildYear = parseInt(yearM[1], 10);
            else if (ageM) buildYear = new Date().getFullYear() - parseInt(ageM[1], 10);
            else if (/新築/.test(line)) buildYear = buildYear == null ? new Date().getFullYear() : buildYear;
          });
        }
      });
      if (!address) return;

      var ward = "";
      var wm = address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "")
        .replace(/^[^\\s]{1,4}郡/, "")
        .match(/^(.{1,6}?[市区])/)
        || address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "").replace(/^[^\\s]{1,4}郡/, "").match(/^(.{1,5}?[町村])/);
      if (wm) ward = wm[1];

      var units = building.querySelectorAll(".p-property__room--detailbox[data-bukken-no]");
      units.forEach(function(unit) {
        var linkEl = unit.querySelector("a[href^='/chintai/']");
        var url = "";
        if (linkEl) {
          var href = linkEl.getAttribute("href") || "";
          url = href.startsWith("http") ? href : "https://www.athome.co.jp" + href;
        }
        if (!url) return; // no detail link = can't dedupe/match reliably

        var rentEl = unit.querySelector(".p-property__information-rent");
        if (!rentEl) return;
        var rent = parseFloat(rentEl.textContent.trim());
        if (!rent) return; // no rent = not a real listing row

        var mgmtSpan = rentEl.closest(".p-property__information-price")?.querySelector("span");
        var mgmtText = mgmtSpan ? mgmtSpan.textContent.trim() : "";
        var mgmtM = mgmtText.match(/([\\d,]+)\\s*円/);
        var managementFee = mgmtM ? parseFloat(mgmtM[1].replace(/,/g, "")) / 10000 : undefined;

        var keymoneyLi = unit.querySelector(".p-property__room-keymoney");
        var deposit, keyMoney;
        if (keymoneyLi) {
          var depositText = keymoneyLi.querySelector("p") ? keymoneyLi.querySelector("p").textContent.trim() : "";
          var keyMoneyText = keymoneyLi.querySelector("span") ? keymoneyLi.querySelector("span").textContent.trim() : "";
          deposit = parseDepositSlot(depositText, rent);
          keyMoney = parseDepositSlot(keyMoneyText, rent);
        }

        var floor = null;
        var roomEl = unit.querySelector(".p-property__room-number");
        if (roomEl) {
          var floorM = roomEl.textContent.match(/(\\d+)\\s*階/);
          if (floorM) floor = parseInt(floorM[1], 10);
        }

        var layout = "";
        var area = null;
        var floorplanEl = unit.querySelector(".p-property__room-floorplan");
        if (floorplanEl) {
          var floorDiv = floorplanEl.querySelector(".p-property__floor");
          layout = floorDiv ? floorDiv.textContent.trim() : "";
          var areaSpan = floorplanEl.querySelector("span");
          if (areaSpan) {
            var areaM = areaSpan.textContent.match(/([\\d.]+)\\s*m/);
            if (areaM) area = parseFloat(areaM[1]);
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
          source: "athome",
          propertyType: propertyType || undefined,
          dealType: "rent",
        });
      });
    });

    return JSON.stringify(results);
  `));
  return JSON.parse(raw);
}

async function scrapeAtHomeChintai(areaCode: string, wardName: string, cityName: string): Promise<ScrapeResult> {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const allListings: PropertyListing[] = [];
  const scrapeErrors: string[] = [];
  const seenUrls = new Set<string>();
  // Confirmed live: a single ward's chintai listing showed a "page100" link,
  // similar order of magnitude to suumo's dense chintai vertical — sized
  // like suumo's chintai cap rather than this file's own (much smaller)
  // buy-side MAX_PAGES of 20.
  const MAX_PAGES = 30;

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    for (let p = 1; p <= MAX_PAGES; p++) {
      const url = p === 1
        ? `https://www.athome.co.jp/chintai/tokyo/${cityName}-city/list/`
        : `https://www.athome.co.jp/chintai/tokyo/${cityName}-city/list/page${p}/`;
      logger.info(`[At Home Scraper] Loading chintai page ${p} for ${wardName}...`);

      let response;
      try {
        response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      } catch (err) {
        logger.warn(`[At Home Scraper] Chintai page ${p} failed to load`);
        scrapeErrors.push(`chintai/page${p}: ${(err as Error).message}`);
        break;
      }

      // Same Akamai "Human Verification" block already fought on the buy side.
      const status = response?.status();
      const title = await page.title().catch(() => "");
      if (status === 405 || title.includes("Human Verification") || title.includes("認証")) {
        const msg = `Blocked by bot-check (status=${status}, title="${title}") on chintai/page${p}`;
        logger.error(`[At Home Scraper] ${msg}`);
        scrapeErrors.push(msg);
        break;
      }

      try {
        await page.waitForSelector(".p-property--building", { timeout: 15000 });
      } catch {
        logger.info(`[At Home Scraper] No chintai listings on page ${p}, stopping`);
        break;
      }

      await new Promise((r) => setTimeout(r, 2000));

      const listings = await extractChintaiListings(page);
      const newListings = listings.filter((l) => {
        if (!l.url || seenUrls.has(l.url)) return false;
        seenUrls.add(l.url);
        return true;
      });

      if (newListings.length === 0) {
        logger.info(`[At Home Scraper] Chintai page ${p}: no new listings, stopping`);
        break;
      }

      logger.info(`[At Home Scraper] Chintai page ${p}: ${newListings.length} new listings (total: ${allListings.length + newListings.length})`);
      allListings.push(...newListings);
    }

    logger.info(`[At Home Scraper] Chintai scrape complete: ${allListings.length} listings for ${wardName}`);
    allListings.slice(0, 5).forEach((l, i) => {
      logger.info(
        `[At Home Scraper]   [${i}] ${l.ward} ${l.address} | rent=${l.rent}万円 | mgmt=${l.managementFee ?? "?"}万円 | deposit=${l.deposit ?? "?"} | keyMoney=${l.keyMoney ?? "?"} | type=${l.propertyType}`
      );
    });

    return {
      listings: allListings,
      source: "athome",
      areaCode,
      scrapedAt: Date.now(),
      count: allListings.length,
      errors: scrapeErrors.length > 0 ? scrapeErrors : undefined,
    };
  } finally {
    await browser.close();
    logger.info(`[At Home Scraper] Browser closed`);
  }
}

export async function scrapeAtHome(areaCode: string, filterTypes?: string[], dealType?: "buy" | "rent"): Promise<ScrapeResult> {
  const wardName = TOKYO_WARD_MAP[areaCode] || areaCode;
  const cityName = CODE_TO_CITY[areaCode] || areaCode;

  if (dealType === "rent") {
    return await scrapeAtHomeChintai(areaCode, wardName, cityName);
  }
  logger.info(`[At Home Scraper] Starting scrape`, { ward: wardName, areaCode });

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const allListings: PropertyListing[] = [];
  const scrapeErrors: string[] = [];
  const seenSignatures = new Set<string>();

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    // buy_other = 売ビル・一棟売マンション・他 (事業用の不動産購入), confirmed live.
    const allCategories: Record<string, string> = { tochi: "土地", kodate: "一戸建て", mansion: "マンション", buy_other: "ビル" };
    const categories = filterTypes && filterTypes.length > 0
      ? Object.entries(allCategories).filter(([, label]) => filterTypes.includes(label)).map(([key]) => key)
      : Object.keys(allCategories);
    if (categories.length === 0) {
      logger.info(`[At Home Scraper] No matching categories for ${wardName}, skipping`);
      return { listings: [], source: "athome", areaCode, scrapedAt: Date.now(), count: 0 };
    }
    const MAX_PAGES = 20;

    categoryLoop:
    for (const cat of categories) {
      logger.info(`[At Home Scraper] Category ${cat} for ${wardName}...`);
      const baseUrl = `https://www.athome.co.jp/${cat}/tokyo/list/?pref=13&cities=${cityName}&basic=kp299,kp120,kp001,kf001,ke001,kj001&kod=&q=1`;

      for (let p = 1; p <= MAX_PAGES; p++) {
        const url = p === 1
          ? baseUrl
          : `https://www.athome.co.jp/${cat}/tokyo/list/page${p}/?pref=13&cities=${cityName}&basic=kp299,kp120,kp001,kf001,ke001,kj001&kod=&q=1`;

        logger.info(`[At Home Scraper] Loading page ${p} (${cat}) for ${wardName}...`);
      let response;
      try {
        response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      } catch (err) {
        logger.warn(`[At Home Scraper] Page ${p} failed to load, stopping`);
        scrapeErrors.push(`${cat}/page${p}: ${(err as Error).message}`);
        break;
      }

      // athome.co.jp answers a burst of rapid requests with an Akamai
      // "Human Verification" challenge (HTTP 405, no cards in the DOM) — same
      // block homes.co.jp hits. Without this check it reads identically to
      // "this ward has no listings", so record it as a real error instead.
      const status = response?.status();
      const title = await page.title().catch(() => "");
      if (status === 405 || title.includes("Human Verification") || title.includes("認証")) {
        const msg = `Blocked by bot-check (status=${status}, title="${title}") on ${cat}/page${p}`;
        logger.error(`[At Home Scraper] ${msg}`);
        scrapeErrors.push(msg);
        break categoryLoop;
      }

      const cardSelector = ".card-box-inner, .card-box";
      if (p === 1) {
        try { await page.waitForSelector(cardSelector, { timeout: 20000 }); } catch { logger.warn(`[At Home Scraper] No card found on page 1`); }
      } else {
        try { await page.waitForSelector(cardSelector, { timeout: 15000 }); } catch { logger.warn(`[At Home Scraper] No card found on page ${p}, assuming end`); break; }
      }
      await new Promise(r => setTimeout(r, 2000));

      const { listings, detailUrls } = await extractListingsFromPage(page, wardName, allCategories[cat]);
      if (listings.length === 0) { logger.info(`[At Home Scraper] Page ${p}: empty, stopping`); break; }

      logger.info(`[At Home Scraper] Page ${p}: ${listings.length} listings (total: ${allListings.length + listings.length})`);

      allListings.push(...listings);
      }
    }

    let stationCount = 0, walkCount = 0, roadCount = 0, frontageCount = 0;
    for (const l of allListings) {
      if (l.station) stationCount++;
      if (l.walkMinutes !== undefined) walkCount++;
      if (l.roadWidth !== undefined) roadCount++;
      if (l.frontage !== undefined) frontageCount++;
    }

    logger.info(`[At Home Scraper] Scrape complete: ${allListings.length} properties`, { ward: wardName, stationParsed: `${stationCount}/${allListings.length}`, walkParsed: `${walkCount}/${allListings.length}` });
    allListings.slice(0, 5).forEach((l, i) => { logger.info(`[At Home Scraper]   [${i}] ${l.ward} ${l.address} | price=${l.price}万 | land=${l.landSize}㎡ | walk=${l.walkMinutes ?? "?"}min | bcr=${l.buildingCoverageRatio ?? "?"}% | far=${l.floorAreaRatio ?? "?"}%`); });
    if (allListings.length === 0) logger.warn(`[At Home Scraper] No listings found for ${wardName}`);

    return {
      listings: allListings,
      source: "athome",
      areaCode,
      scrapedAt: Date.now(),
      count: allListings.length,
      errors: scrapeErrors.length > 0 ? scrapeErrors : undefined,
    };
  } finally {
    await browser.close();
    logger.info(`[At Home Scraper] Browser closed`);
  }
}
