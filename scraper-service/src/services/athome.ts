import puppeteer from "puppeteer";
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

async function scrapeDetailPage(page: any, url: string): Promise<{ roadWidth?: number; frontage?: number }> {
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 1000));
    const raw = await page.evaluate(new Function(`
      var text = document.body ? document.body.textContent || "" : "";
      var roadWidth;
      var frontage;
      var rp = [/道路幅[：:]\\s*([\\d.]+)\\s*m/, /前面道路[：:]\\s*([\\d.]+)\\s*m/, /幅員[：:]\\s*([\\d.]+)\\s*m/];
      for (var i = 0; i < rp.length; i++) { 
        var m = text.match(rp[i]); 
        if (m) { roadWidth = parseFloat(m[1]); break; } 
      }
      var fp = [/間口[：:]\\s*([\\d.]+)\\s*m/, /間口[：:]\\s*約?\\s*([\\d.]+)/];
      for (var j = 0; j < fp.length; j++) { 
        var m2 = text.match(fp[j]); 
        if (m2) { frontage = parseFloat(m2[1]); break; } 
      }
      return JSON.stringify({ roadWidth: roadWidth, frontage: frontage });
    `));
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function scrapeAtHome(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
  const wardName = TOKYO_WARD_MAP[areaCode] || areaCode;
  const cityName = CODE_TO_CITY[areaCode] || areaCode;
  logger.info(`[At Home Scraper] Starting scrape`, { ward: wardName, areaCode });

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const allListings: PropertyListing[] = [];
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

    for (const cat of categories) {
      logger.info(`[At Home Scraper] Category ${cat} for ${wardName}...`);
      const baseUrl = `https://www.athome.co.jp/${cat}/tokyo/list/?pref=13&cities=${cityName}&basic=kp299,kp120,kp001,kf001,ke001,kj001&kod=&q=1`;

      for (let p = 1; p <= MAX_PAGES; p++) {
        const url = p === 1
          ? baseUrl
          : `https://www.athome.co.jp/${cat}/tokyo/list/page${p}/?pref=13&cities=${cityName}&basic=kp299,kp120,kp001,kf001,ke001,kj001&kod=&q=1`;

        logger.info(`[At Home Scraper] Loading page ${p} (${cat}) for ${wardName}...`);
      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
      } catch {
        logger.warn(`[At Home Scraper] Page ${p} failed to load, stopping`);
        break;
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

      // Scrape detail pages for first few to get road width/frontage
      const sampleUrls = detailUrls.slice(0, 3);
      for (const du of sampleUrls) {
        const details = await scrapeDetailPage(page, du);
        if (details.roadWidth || details.frontage) {
          logger.info(`[At Home Scraper] Detail: road=${details.roadWidth ?? "?"}m frontage=${details.frontage ?? "?"}m`);
        }
      }

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

    return { listings: allListings, source: "athome", areaCode, scrapedAt: Date.now(), count: allListings.length };
  } finally {
    await browser.close();
    logger.info(`[At Home Scraper] Browser closed`);
  }
}
