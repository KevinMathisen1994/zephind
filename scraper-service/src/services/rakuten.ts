import puppeteer from "puppeteer";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


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

function parseNumber(text: string): number | null {
  const m = text.replace(/,/g, "").match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

export async function scrapeRakuten(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
  const wardName = TOKYO_WARD_MAP[areaCode] || areaCode;
  const catMap: Record<string, { path: string; label: string }> = {
    land: { path: "land", label: "土地" },
    house: { path: "house", label: "一戸建て" },
    usedmansion: { path: "usedmansion", label: "マンション" },
  };
  const paths = filterTypes && filterTypes.length > 0
    ? Object.entries(catMap).filter(([, v]) => filterTypes.includes(v.label)).map(([k]) => k)
    : Object.keys(catMap);
  if (paths.length === 0) {
    logger.info(`[Rakuten] No matching categories for ${wardName}, skipping`);
    return { listings: [], source: "rakuten", areaCode, scrapedAt: Date.now(), count: 0 };
  }
  const allListings: PropertyListing[] = [];
  const seenSignatures = new Set<string>();

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    for (const pathKey of paths) {
      const { path, label } = catMap[pathKey];
      const url = `https://realestate.rakuten.co.jp/${path}/area-13-${areaCode}/?moneyroom=&moneyroomh=&landarea=&landareah=`;
      logger.info(`[Rakuten] Scraping ${path} for ${wardName}`, { url });

      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
      await new Promise(r => setTimeout(r, 3000));

      // Close any login modal
      await page.evaluate(() => {
        document.querySelectorAll('[class*="close"]').forEach((el: any) => {
          if (el && el.click) el.click();
        });
      });
      await new Promise(r => setTimeout(r, 1000));

      // Try up to 5 pages per category
      for (let p = 1; p <= 5; p++) {
        if (p > 1) {
          const nextUrl = `https://realestate.rakuten.co.jp/${path}/area-13-${areaCode}/?moneyroom=&moneyroomh=&landarea=&landareah=&page=${p}`;
          try {
            await page.goto(nextUrl, { waitUntil: "networkidle2", timeout: 30000 });
            await new Promise(r => setTimeout(r, 2000));
          } catch { break; }
        }

        const rawListings = await page.evaluate(new Function("ward", "pt", `
          var items = document.querySelectorAll(".bukken_item");
          var results = Array.from(items).map(function(item) {
            var titleEl = item.querySelector("a.title");
            var titleText = titleEl ? titleEl.textContent?.trim() || "" : "";
            var link = titleEl ? titleEl.getAttribute("href") || "" : "";

            var address = titleText.replace(/\\s+[\\d,]+\\s*万円.*$/, "").trim();

            var parsePrice = function(text) {
              if (!text) return 0;
              var cleaned = text.replace(/[\\s,]/g, "");
              var firstPart = cleaned.split(/[~〜-]/)[0];
              var okuMatch = firstPart.match(/([\\d,]+(?:\\.\\d+)?)億/);
              var manMatch = firstPart.match(/([\\d,]+(?:\\.\\d+)?)万/);
              if (okuMatch || manMatch) {
                var oku = okuMatch ? parseFloat(okuMatch[1].replace(/,/g, "")) * 10000 : 0;
                var man = manMatch ? parseFloat(manMatch[1].replace(/,/g, "")) : 0;
                return oku + man;
              }
              var simpleMatch = firstPart.match(/(\\d+(?:\\.\\d+)?)/);
              return simpleMatch ? parseFloat(simpleMatch[1]) : 0;
            };

            var priceMatch = titleText.match(/([\\d,億万円〜~]+万円)/) || titleText.match(/([\\d,]+)\\s*万円/);
            var price = priceMatch ? parsePrice(priceMatch[1]) : null;

            var allText = item.textContent?.trim().replace(/\\s+/g, " ") || "";

            var areaMatch = allText.match(/([\\d.]+)\\s*m[2²]/);
            var landSize = areaMatch ? parseFloat(areaMatch[1]) : null;

            var bcrMatch = allText.match(/(\\d+)\\s*%\\s+\\d+\\s*%/);
            var bcr = bcrMatch ? parseInt(bcrMatch[1]) : null;
            var farMatch = allText.match(/\\d+\\s*%\\s+(\\d+)\\s*%/);
            var far = farMatch ? parseInt(farMatch[1]) : null;

            var layout = "";
            var lM = allText.match(/間取り\\s*([^\\s\\u3000,，|｜（(]+)/);
            if (lM) {
              layout = lM[1].replace(/[\\uFF01-\\uFF5E]/g, function(ch) {
                return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
              }).replace(/\\u3000/g, " ");
            }

            var details = Array.from(item.querySelectorAll(".gaiyo_item")).map(function(g) {
              return g.textContent?.trim().replace(/\\s+/g, " ") || "";
            });
            var station = "";
            var walkMinutes = null;
            for (var i = 0; i < details.length; i++) {
              var d = details[i];
              var stM = d.match(/交通\\s+(.+?)\\s+徒歩(\\d+)分/);
              if (stM) {
                station = stM[1].trim();
                walkMinutes = parseInt(stM[2]);
              }
            }

            var fullUrl = link.startsWith("http") ? link : "https://realestate.rakuten.co.jp" + link;

            // Derive the ward from the scraped address, not from the injected
            // ward label. TOKYO_WARD_MAP only covers the 23 wards, so for
            // 市部/郡部/島嶼部 that label is the RAW AREA CODE ("13209") — this is
            // where the "13212"/"13208" ward values in the listings table came
            // from. Fall back to the label only when the address yields nothing.
            // (No backticks in this comment: it lives inside a template literal.)
            var derivedWard = "";
            var dwm = (address || "").replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "")
              .replace(/^[^\\s]{1,4}郡/, "")
              .match(/^(.{1,6}?[市区])/)
              || (address || "").replace(/^東京都/, "").replace(/^[^\\s]{1,4}郡/, "").match(/^(.{1,5}?[町村])/);
            if (dwm) derivedWard = dwm[1];

            return {
              address: address || ward, ward: derivedWard || ward,
              price: price || 0, landSize: landSize || 0, area: landSize || 0,
              buildingCoverageRatio: bcr, floorAreaRatio: far,
              station: station || undefined, walkMinutes: walkMinutes ?? undefined,
              source: "rakuten", url: fullUrl,
              propertyType: pt || undefined,
              layout: layout || undefined,
            };
          });
          return JSON.stringify(results);
        `) as any, wardName, label) as string;
        const pageListings = JSON.parse(rawListings);

      allListings.push(...pageListings);

      // Check if there's a next page
      const hasNext = await page.evaluate(() => {
        const nextLink = document.querySelector('a[rel="next"], a[class*="next"]');
        if (nextLink) return true;
        // Check for page number links
        const pageLinks = document.querySelectorAll('a[href*="page="]');
        return pageLinks.length > 0;
      });

      if (!hasNext && p === 1) {
        // Still try page 2 via URL
        if (pageListings.length === 0) break;
      }
      if (!hasNext) break;
      }
    }

    logger.info(`Rakuten Fudosan scrape complete: ${allListings.length} listings from ${wardName}`);
    return {
      listings: allListings,
      source: "rakuten",
      areaCode,
      scrapedAt: Date.now(),
      count: allListings.length,
    };
  } finally {
    await browser.close();
  }
}