import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";

puppeteer.use(StealthPlugin());

const TOKYO_WARD_MAP: Record<string, string> = {
  "13101": "千代田区", "13102": "中央区", "13103": "港区",
  "13104": "新宿区", "13105": "文京区", "13106": "台東区",
  "13107": "墨田区", "13108": "江東区", "13109": "品川区",
  "13110": "目黒区", "13111": "大田区", "13112": "世田谷区",
  "13113": "渋谷区", "13114": "中野区", "13115": "杉並区",
  "13116": "豊島区", "13117": "北区", "13118": "荒川区",
  "13119": "板橋区", "13120": "練馬区", "13121": "足立区",
  "13122": "葛飾区", "13123": "江戸川区",
};

async function extractListings(page: any): Promise<PropertyListing[]> {
  return await page.evaluate((wardMap: Record<string, string>) => {
    const results: PropertyListing[] = [];
    const items = document.querySelectorAll(".search-result-box.detail-link");

    items.forEach((el) => {
      // Address
      const addrEl = el.querySelector(".address");
      const address = addrEl?.textContent?.trim() || "";
      if (!address) return;

      // Determine ward from address
      let ward = "";
      for (const [, name] of Object.entries(wardMap)) {
        if (address.includes(name)) { ward = name; break; }
      }
      if (!ward) {
        const wm = address.match(/(東京都)?(.{2,4}区)/);
        if (wm) ward = wm[2];
      }

      // Price: find row with "価格" title
      let price: number | null = null;
      const detailRows = el.querySelectorAll(".room-detail-title");
      detailRows.forEach((titleEl) => {
        if (titleEl.textContent?.trim() === "価格") {
          const valEl = titleEl.closest(".col")?.querySelector(".room-detail-value");
          if (valEl) {
            const text = valEl.textContent?.trim() || "";
            const cleaned = text.replace(/[\s,]/g, "");
            const firstPart = cleaned.split(/[~〜-]/)[0];
            const okuMatch = firstPart.match(/(\d+(?:\.\d+)?)億/);
            const manMatch = firstPart.match(/(\d+(?:\.\d+)?)万/);
            if (okuMatch || manMatch) {
              const oku = okuMatch ? parseFloat(okuMatch[1]) * 10000 : 0;
              const man = manMatch ? parseFloat(manMatch[1]) : 0;
              price = oku + man;
            } else {
              const simpleMatch = firstPart.match(/(\d+(?:\.\d+)?)/);
              if (simpleMatch) price = parseFloat(simpleMatch[1]);
            }
          }
        }
      });

      // Land area
      let area: number | null = null;
      detailRows.forEach((titleEl) => {
        if (titleEl.textContent?.trim() === "土地面積") {
          const valEl = titleEl.closest(".col")?.querySelector(".room-detail-value");
          if (valEl) {
            const m = valEl.textContent?.trim().match(/([\d,.]+)㎡/);
            if (m) area = parseFloat(m[1].replace(/,/g, ""));
          }
        }
      });

      // BCR / FAR from "建・容率"
      let bcr: number | null = null;
      let far: number | null = null;
      detailRows.forEach((titleEl) => {
        if (titleEl.textContent?.trim() === "建・容率") {
          const valEl = titleEl.closest(".col")?.querySelector(".room-detail-value");
          if (valEl) {
            const m = valEl.textContent?.trim().match(/([\d.]+)％[・\s]*([\d.]+)％/);
            if (m) { bcr = parseFloat(m[1]); far = parseFloat(m[2]); }
          }
        }
      });

      // Station / walk from traffic section
      let station = "";
      let walkMinutes: number | null = null;
      const trafficEl = el.querySelector(".traffic");
      if (trafficEl) {
        // Get first traffic line (nearest station)
        const firstLine = trafficEl.querySelector("div");
        if (firstLine) {
          const text = firstLine.textContent?.trim() || "";
          const stM = text.match(/([^\s]+駅)/);
          if (stM) station = stM[1];
          const wkM = text.match(/徒歩\s*(\d+)\s*分/);
          if (wkM) walkMinutes = parseInt(wkM[1]);
        }
      }

      // Detail URL
      const detailBtn = el.querySelector("a.detail-btn");
      let url = "";
      if (detailBtn) {
        const href = detailBtn.getAttribute("href") || "";
        url = href.startsWith("http") ? href : `https://www.hatomarksite.com${href}`;
      }

      results.push({
        address,
        ward,
        price: price || 0,
        area: area || 0,
        landSize: area || 0,
        source: "hatomark",
        station: station || undefined,
        walkMinutes: walkMinutes ?? undefined,
        buildingCoverageRatio: bcr ?? undefined,
        floorAreaRatio: far ?? undefined,
        url: url || undefined,
        propertyType: "土地",
      });
    });

    return results;
  }, TOKYO_WARD_MAP);
}

export async function scrapeHatomark(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
  const wardName = TOKYO_WARD_MAP[areaCode] || areaCode;
  logger.info(`[Hatomark Scraper] Starting scrape`, { ward: wardName, areaCode });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const allListings: PropertyListing[] = [];

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    const MAX_PAGES = 20;
    let totalExpected = 0;
    const seenUrls = new Set<string>();

    for (let p = 1; p <= MAX_PAGES; p++) {
      const url = `https://www.hatomarksite.com/search/zentaku/buy/land/area/13/list?m_adr[]=${areaCode}&page=${p}`;
      logger.info(`[Hatomark Scraper] Loading page ${p} for ${wardName}...`);

      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
      } catch {
        logger.warn(`[Hatomark Scraper] Page ${p} failed to load`);
        break;
      }

      try {
        await page.waitForSelector(".search-result-box.detail-link", { timeout: 15000 });
      } catch {
        logger.warn(`[Hatomark Scraper] No listings on page ${p}, stopping`);
        break;
      }

      await new Promise((r) => setTimeout(r, 2000));

      // Get total expected count from page 1
      if (p === 1) {
        totalExpected = await page.evaluate(() => {
          const m = document.body?.textContent?.match(/(\d+)\s*件/);
          return m ? parseInt(m[1]) : 0;
        });
        logger.info(`[Hatomark Scraper] Total expected: ${totalExpected}`);
      }

      const listings = await extractListings(page);

      // Dedup against previously seen URLs
      const newListings = listings.filter((l) => {
        if (!l.url) return true;
        if (seenUrls.has(l.url)) return false;
        seenUrls.add(l.url);
        return true;
      });

      if (newListings.length === 0) {
        logger.info(`[Hatomark Scraper] Page ${p}: no new listings, stopping`);
        break;
      }

      logger.info(`[Hatomark Scraper] Page ${p}: ${newListings.length} new listings (total: ${allListings.length + newListings.length})`);
      allListings.push(...newListings);

      // Stop if we've collected all expected listings
      if (totalExpected > 0 && allListings.length >= totalExpected) {
        logger.info(`[Hatomark Scraper] Reached expected total (${totalExpected}), stopping`);
        break;
      }
    }

    logger.info(
      `[Hatomark Scraper] Scrape complete: ${allListings.length} properties`,
      { ward: wardName, pages: Math.min(allListings.length, 20) }
    );
    allListings.slice(0, 5).forEach((l, i) => {
      logger.info(
        `[Hatomark Scraper]   [${i}] ${l.ward} ${l.address} | price=${l.price}万 | land=${l.landSize}㎡ | walk=${l.walkMinutes ?? "?"}min | station=${l.station ?? "?"} | bcr=${l.buildingCoverageRatio ?? "?"}% | far=${l.floorAreaRatio ?? "?"}%`
      );
    });

    return {
      listings: allListings,
      source: "hatomark",
      areaCode,
      scrapedAt: Date.now(),
      count: allListings.length,
    };
  } finally {
    await browser.close();
    logger.info(`[Hatomark Scraper] Browser closed`);
  }
}
