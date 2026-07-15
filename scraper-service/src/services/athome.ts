import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";

puppeteer.use(StealthPlugin());

const TOKYO_WARD_MAP: Record<string, string> = {
  "13101": "千代田区", "13102": "中央区", "13103": "港区", "13104": "新宿区",
  "13105": "文京区", "13106": "台東区", "13107": "墨田区", "13108": "江東区",
  "13109": "品川区", "13110": "目黒区", "13111": "大田区", "13112": "世田谷区",
  "13113": "渋谷区", "13114": "中野区", "13115": "杉並区", "13116": "豊島区",
  "13117": "北区", "13118": "荒川区", "13119": "板橋区", "13120": "練馬区",
  "13121": "足立区", "13122": "葛飾区", "13123": "江戸川区",
};

const CODE_TO_CITY: Record<string, string> = {
  "13101": "chiyoda", "13102": "chuou", "13103": "minato", "13104": "shinjuku",
  "13105": "bunkyo", "13106": "taito", "13107": "sumida", "13108": "koutou",
  "13109": "shinagawa", "13110": "meguro", "13111": "oota", "13112": "setagaya",
  "13113": "shibuya", "13114": "nakano", "13115": "suginami", "13116": "toshima",
  "13117": "kita", "13118": "arakawa", "13119": "itabashi", "13120": "nerima",
  "13121": "adachi", "13122": "katsushika", "13123": "edogawa",
};

async function extractListingsFromPage(page: any, wardName: string, pType?: string): Promise<{ listings: any[], detailUrls: string[] }> {
  return await page.evaluate((ward: string, pt: string) => {
    const parsePrice = (text: string) => {
      if (!text) return 0;
      const cleaned = text.replace(/[\s,]/g, "");
      const firstPart = cleaned.split(/[~〜-]/)[0];
      const okuMatch = firstPart.match(/(\d+(?:\.\d+)?)億/);
      const manMatch = firstPart.match(/(\d+(?:\.\d+)?)万/);
      if (okuMatch || manMatch) {
        const oku = okuMatch ? parseFloat(okuMatch[1]) * 10000 : 0;
        const man = manMatch ? parseFloat(manMatch[1]) : 0;
        return oku + man;
      }
      const simpleMatch = firstPart.match(/(\d+(?:\.\d+)?)/);
      return simpleMatch ? parseFloat(simpleMatch[1]) : 0;
    };

    const results: any[] = [];
    const urls: string[] = [];
    document.querySelectorAll(".card-box-inner").forEach((card) => {
      const cardText = card.textContent || "";

      const titleEl = card.querySelector(".title-wrap__title-text");
      let address = titleEl ? titleEl.textContent?.trim() || "" : "";
      if (!address) { const m = cardText.match(/(東京都[^\s]{1,40}?[区市])/); if (m) address = m[1]; }

      let price: number | null = null;
      const priceEl = card.querySelector(".property-price");
      if (priceEl) {
        price = parsePrice(priceEl.textContent?.trim() || "");
      }
      if (!price) { const m = cardText.match(/([\d,億万〜~]+万円)/); if (m) price = parsePrice(m[1]); }
      if (!address || !price) return;

      const table = card.querySelector(".property-detail-table");
      const text = table ? table.textContent || "" : cardText;

      let area: number | null = null;
      const am2 = text.match(/土地面積[：:]*\s*([\d,.]+)\s*m²/);
      if (am2) area = parseFloat(am2[1].replace(/,/g, ""));
      if (!area) { const ts = text.match(/([\d,.]+)\s*坪/); if (ts) area = parseFloat(ts[1].replace(/,/g, "")) * 3.30578; }

      let station = "";
      let walkMinutes: number | null = null;
      const stM = cardText.match(/「([^」]+)」\s*駅/);
      if (stM) station = stM[1] + "駅";
      else { const sm = cardText.match(/([^\s]+駅)/); if (sm) station = sm[1]; }
      const wkM = cardText.match(/徒歩\s*(\d+)\s*分/);
      if (wkM) walkMinutes = parseInt(wkM[1]);

      let bcr: number | null = null;
      let far: number | null = null;
      const bf = text.match(/建ぺい率[／/]容積率[：:]*\s*([\d.]+)%[／/]\s*([\d.]+)%/);
      if (bf) { bcr = parseFloat(bf[1]); far = parseFloat(bf[2]); }
      else {
        const bm = text.match(/建ぺい率[：:]?\s*([\d.]+)\s*%/); if (bm) bcr = parseFloat(bm[1]);
        const fm2 = text.match(/容積率[：:]?\s*([\d.]+)\s*%/); if (fm2) far = parseFloat(fm2[1]);
      }

      let layout = "";
      const lM = cardText.match(/間取り\s*([a-zA-Z\d\+]+)/);
      if (lM) layout = lM[1];

      let detailUrl = "";
      const linkEl = card.closest("a") || card.querySelector("a[href*='/tochi/']");
      if (linkEl) {
        const href = linkEl.getAttribute("href") || "";
        detailUrl = href.startsWith("http") ? href : `https://www.athome.co.jp${href}`;
      }

      results.push({ address, ward, price, area: area || 0, landSize: area || 0, source: "athome", station: station || undefined, walkMinutes: walkMinutes ?? undefined, buildingCoverageRatio: bcr ?? undefined, floorAreaRatio: far ?? undefined, detailUrl: detailUrl || undefined, propertyType: pt || undefined, layout: layout || undefined });
      if (detailUrl) urls.push(detailUrl);
    });
    return { listings: results, detailUrls: urls };
  }, wardName, pType || "");
}

async function scrapeDetailPage(page: any, url: string): Promise<{ roadWidth?: number; frontage?: number }> {
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 1000));
    return await page.evaluate(() => {
      const text = document.body?.textContent || "";
      let roadWidth: number | undefined;
      let frontage: number | undefined;
      const rp = [/道路幅[：:]\s*([\d.]+)\s*m/, /前面道路[：:]\s*([\d.]+)\s*m/, /幅員[：:]\s*([\d.]+)\s*m/];
      for (const p of rp) { const m = text.match(p); if (m) { roadWidth = parseFloat(m[1]); break; } }
      const fp = [/間口[：:]\s*([\d.]+)\s*m/, /間口[：:]\s*約?\s*([\d.]+)/];
      for (const p of fp) { const m = text.match(p); if (m) { frontage = parseFloat(m[1]); break; } }
      return { roadWidth, frontage };
    });
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

    const allCategories: Record<string, string> = { tochi: "土地", kodate: "一戸建て" };
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

      if (p === 1) {
        try { await page.waitForSelector(".card-box-inner", { timeout: 20000 }); } catch { logger.warn(`[At Home Scraper] No .card-box-inner on page 1`); }
      } else {
        try { await page.waitForSelector(".card-box-inner", { timeout: 15000 }); } catch { logger.warn(`[At Home Scraper] No .card-box-inner on page ${p}, assuming end`); break; }
      }
      await new Promise(r => setTimeout(r, 2000));

      const { listings, detailUrls } = await extractListingsFromPage(page, wardName, cat === "tochi" ? "土地" : "一戸建て");
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
