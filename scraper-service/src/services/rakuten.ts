import puppeteer from "../puppeteerStealth";
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

function parseNumber(text: string): number | null {
  const m = text.replace(/,/g, "").match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

/** Extracted so a suspiciously-empty first load (see retry in scrapeRakuten)
 *  can re-run the same extraction without duplicating this whole inline DOM
 *  script. */
async function extractPageListings(page: any, wardName: string, label: string): Promise<any[]> {
  const rawListings = await page.evaluate(new Function("ward", "pt", `
    var items = document.querySelectorAll(".bukken_item");
    var results = Array.from(items).map(function(item) {
      var titleEl = item.querySelector("a.title");
      var titleText = titleEl ? titleEl.textContent?.trim() || "" : "";
      var link = titleEl ? titleEl.getAttribute("href") || "" : "";

      // マンション titles are the building name, so prefer the 所在地 row.
      var addrDd = Array.from(item.querySelectorAll(".gaiyo_item dl")).find(function(dl) {
        return dl.querySelector("dt")?.textContent?.trim() === "所在地";
      })?.querySelector("dd");
      var address = (addrDd?.textContent?.trim()) || titleText.replace(/\\s+[\\d,]+\\s*万円.*$/, "").trim();

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
      if (!price) {
        var priceEm = item.querySelector(".line_content .price em");
        if (priceEm) price = parsePrice(priceEm.textContent || "") || null;
      }

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
      var floor = null;
      var structure = undefined;
      var structureType = undefined;
      var totalUnits = null;
      var roadWidth = null;
      var buildYear = null;
      var floorArea = null;

      for (var i = 0; i < details.length; i++) {
        var d = details[i];
        var stM = d.match(/交通\\s+(.+?)\\s+徒歩(\\d+)分/);
        if (stM) {
          station = stM[1].trim();
          walkMinutes = parseInt(stM[2]);
        }
        if (d.includes("所在階") || d.includes("階数") || d.includes("階建/階")) {
          var bM = d.match(/(?:地下|B)(\\d+)階?/);
          if (bM) {
            floor = -parseInt(bM[1], 10);
          } else {
            var flM = d.match(/(\\d+)階/);
            if (flM) floor = parseInt(flM[1], 10);
          }
        }
        if (d.includes("構造")) {
          structure = d.replace(/.*構造[:：\\s]*/, "").trim();
          if (/SRC|鉄骨鉄筋/.test(d)) structureType = "SRC";
          else if (/RC|鉄筋コンクリート/.test(d)) structureType = "RC";
          else if (/軽量鉄骨/.test(d)) structureType = "軽量鉄骨";
          else if (/鉄骨|S造/.test(d)) structureType = "S";
          else if (/木造|W造/.test(d)) structureType = "木造";
        }
        if (d.includes("総戸数")) {
          var unM = d.match(/(\\d+)\\s*戸/);
          if (unM) totalUnits = parseInt(unM[1], 10);
        }
        if (d.includes("接道") || d.includes("前面道路")) {
          var rwM = d.match(/(?:幅員|幅)\\s*[:：]?\\s*([0-9.]+)\\s*m/) || d.match(/([0-9.]+)\\s*m/);
          if (rwM) roadWidth = parseFloat(rwM[1]);
        }
        if (d.includes("築年月") || d.includes("完成時期")) {
          var byM = d.match(/(20\\d{2}|19\\d{2})年/);
          if (byM) buildYear = parseInt(byM[1], 10);
        }
        if (d.includes("専有面積") || d.includes("建物面積")) {
          var faM = d.match(/([\\d.]+)\\s*m[2²]/);
          if (faM) floorArea = parseFloat(faM[1]);
        }
      }

      // Fallback to allText if not in .gaiyo_item
      if (buildYear === null) {
        var byM2 = allText.match(/(20\\d{2}|19\\d{2})年\\s*\\d{1,2}月/);
        if (byM2) buildYear = parseInt(byM2[1], 10);
      }
      if (structure === undefined) {
        if (/SRC|鉄骨鉄筋/.test(allText)) { structure = "鉄骨鉄筋コンクリート造"; structureType = "SRC"; }
        else if (/RC|鉄筋コンクリート/.test(allText)) { structure = "鉄筋コンクリート造"; structureType = "RC"; }
        else if (/軽量鉄骨/.test(allText)) { structure = "軽量鉄骨造"; structureType = "軽量鉄骨"; }
        else if (/鉄骨|S造/.test(allText)) { structure = "鉄骨造"; structureType = "S"; }
        else if (/木造/.test(allText)) { structure = "木造"; structureType = "木造"; }
      }

      var area = floorArea != null ? floorArea : landSize;
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
        // landSize/area used to default to 0 when unparsed. hardFilter's
        // landSizeMin/buildingSizeMin checks only skip on null/undefined,
        // not 0, so that read as "confirmed 0m²" and was hard-rejected.
        price: price || 0, landSize: landSize || undefined, area: area || undefined,
        floorArea: floorArea || undefined,
        buildingCoverageRatio: bcr, floorAreaRatio: far,
        station: station || undefined, walkMinutes: walkMinutes ?? undefined,
        source: "rakuten", url: fullUrl,
        propertyType: pt || undefined,
        layout: layout || undefined,
        floor: floor !== null ? floor : undefined,
        structure: structure || undefined,
        structureType: structureType || undefined,
        totalUnits: totalUnits !== null ? totalUnits : undefined,
        roadWidth: roadWidth !== null ? roadWidth : undefined,
        buildYear: buildYear !== null ? buildYear : undefined,
      };
    });
    return JSON.stringify(results);
  `) as any, wardName, label) as string;
  return JSON.parse(rawListings);
}

/**
 * 賃貸 (chintai) cards are a building-with-units template, same shape as
 * suumo's/homes' chintai cards: `.bukken_item` is one BUILDING (confirmed
 * live — a single card can hold several `ul.line_content` rows, one per
 * rentable unit), each with a fixed li layout (no per-field classes on most
 * of them, so children are read by position):
 *   [0] checkbox [1] NEW badge [2] floor [3].price (rent/mgmt)
 *   [4] "敷金/礼金/保証/敷引・償却" [5] "layout/area" [6] favorite
 *   [7] detail link [8] inquiry.
 *
 * Confirmed live: rakuten's rent listing images are served off homes.jp's
 * CDN — this is a syndicated homes.co.jp feed, which is why the deposit/
 * keyMoney convention below is identical to homes.ts: each of the 4 slots is
 * "無" (explicitly zero), "Xヶ月" (a multiple of the unit's own rent — convert
 * to an absolute amount) or a bare "X万円"/"X,XXX円" (already absolute); "－"
 * means not disclosed and is kept undefined rather than 0.
 */
async function extractChintaiListings(page: any): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function(`
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
    var buildings = document.querySelectorAll(".bukken_item");

    buildings.forEach(function(building) {
      var propertyType = "";
      var catEl = building.querySelector(".item_label .category");
      if (catEl) propertyType = catEl.textContent.trim().replace(/^賃貸/, "");

      var address = "";
      var station = "";
      var walkMinutes = null;
      var buildYear = null;
      building.querySelectorAll(".gaiyo_item dl").forEach(function(dl) {
        var dt = dl.querySelector("dt");
        var dd = dl.querySelector("dd");
        if (!dt || !dd) return;
        var label = dt.textContent.trim();
        var val = dd.textContent.trim();
        if (label === "所在地") address = val;
        else if (label === "交通") {
          var stM = val.match(/([^\\s、]+駅)/);
          if (stM) station = stM[1];
          var wkM = val.match(/徒歩\\s*(\\d+)\\s*分/);
          if (wkM) walkMinutes = parseInt(wkM[1], 10);
        } else if (label.indexOf("築年月") === 0) {
          var ageM = val.match(/築(\\d+)年/);
          if (ageM) buildYear = new Date().getFullYear() - parseInt(ageM[1], 10);
          else if (/新築/.test(val)) buildYear = new Date().getFullYear();
        }
      });
      if (!address) return;

      var ward = "";
      var wm = address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "")
        .replace(/^[^\\s]{1,4}郡/, "")
        .match(/^(.{1,6}?[市区])/)
        || address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "").replace(/^[^\\s]{1,4}郡/, "").match(/^(.{1,5}?[町村])/);
      if (wm) ward = wm[1];

      var unitRows = building.querySelectorAll("ul.line_content");
      unitRows.forEach(function(row) {
        var cells = row.children;
        if (cells.length < 6) return;

        var floorText = cells[2].textContent.trim();
        var floorM = floorText.match(/(\\d+)\\s*階/);
        var floor = floorM ? parseInt(floorM[1], 10) : null;

        var priceText = cells[3].textContent.replace(/\\s+/g, "");
        var rentM = priceText.match(/([\\d.]+)万円/);
        if (!rentM) return; // no rent = not a real listing row
        var rent = parseFloat(rentM[1]);
        var mgmtM = priceText.match(/\\/([\\d,]+)円/);
        var managementFee = mgmtM ? parseFloat(mgmtM[1].replace(/,/g, "")) / 10000 : undefined;

        var depositParts = cells[4].textContent.split("/").map(function(s) { return s.trim(); });
        var deposit = parseDepositSlot(depositParts[0], rent);
        var keyMoney = parseDepositSlot(depositParts[1], rent);

        // Layout/area cell reads e.g. "1K\\u200b/20.43m2" — a zero-width
        // space sits right before the slash on some cards, so split on the
        // slash itself rather than whitespace.
        var layoutAreaParts = cells[5].textContent.split("/");
        var layout = (layoutAreaParts[0] || "").replace(/[\\u200b\\s]/g, "");
        var areaM = (layoutAreaParts[1] || "").match(/([\\d.]+)\\s*m/);
        var area = areaM ? parseFloat(areaM[1]) : null;

        var linkEl = row.querySelector("a.link_detail");
        var url = linkEl ? linkEl.getAttribute("href") || "" : "";
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
          url: url,
          source: "rakuten",
          propertyType: propertyType || undefined,
          dealType: "rent",
        });
      });
    });

    return JSON.stringify(results);
  `));
  return JSON.parse(raw);
}

async function scrapeRakutenChintai(areaCode: string, wardName: string): Promise<ScrapeResult> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const allListings: PropertyListing[] = [];
  const seenUrls = new Set<string>();
  // Confirmed live: rakuten's /rent/ vertical has no ward-scoped URL path or
  // query param the way the buy side does (no "area-13-{code}" support) — the
  // only thing that actually narrows results is the free-text "keyword"
  // search box on /rent/keyword/pref-13/, which DOES filter correctly when
  // given a ward name (confirmed live: keyword=港区 renders
  // "東京都　港区の賃貸物件一覧" with real 港区 addresses, not a landing page).
  const MAX_PAGES = 30;

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    for (let p = 1; p <= MAX_PAGES; p++) {
      const url = `https://realestate.rakuten.co.jp/rent/keyword/pref-13/?keyword=${encodeURIComponent(wardName)}&sortBy=7&page=${p}`;
      logger.info(`[Rakuten] Loading chintai page ${p} for ${wardName}...`);

      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
      } catch {
        logger.warn(`[Rakuten] Chintai page ${p} failed to load`);
        break;
      }

      try {
        await page.waitForSelector(".bukken_item", { timeout: 15000 });
      } catch {
        logger.info(`[Rakuten] No chintai listings on page ${p}, stopping`);
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
        logger.info(`[Rakuten] Chintai page ${p}: no new listings, stopping`);
        break;
      }

      logger.info(`[Rakuten] Chintai page ${p}: ${newListings.length} new listings (total: ${allListings.length + newListings.length})`);
      allListings.push(...newListings);
    }

    logger.info(`[Rakuten] Chintai scrape complete: ${allListings.length} listings for ${wardName}`);
    allListings.slice(0, 5).forEach((l, i) => {
      logger.info(
        `[Rakuten]   [${i}] ${l.ward} ${l.address} | rent=${l.rent}万円 | mgmt=${l.managementFee ?? "?"}万円 | deposit=${l.deposit ?? "?"} | keyMoney=${l.keyMoney ?? "?"} | type=${l.propertyType}`
      );
    });

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

export async function scrapeRakuten(areaCode: string, filterTypes?: string[], dealType?: "buy" | "rent"): Promise<ScrapeResult> {
  const wardName = TOKYO_WARD_MAP[areaCode] || areaCode;

  if (dealType === "rent") {
    return await scrapeRakutenChintai(areaCode, wardName);
  }

  const catMap: Record<string, { path: string; label: string }> = {
    land: { path: "land", label: "土地" },
    // "house" 404s ("ページが見つかりません") — confirmed live. The site's real
    // 中古一戸建て listing path is "useddetached".
    house: { path: "useddetached", label: "一戸建て" },
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
  const scrapeErrors: string[] = [];
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

      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const title = await page.title().catch(() => "");
      if ((resp && resp.status() >= 500) || title.includes("メンテナンス") || title.includes("Maintenance")) {
        const msg = `楽天不動産サイトは現在メンテナンス中です (HTTP ${resp?.status() ?? 503}, ${title})`;
        logger.warn(`[Rakuten] ${msg}`);
        scrapeErrors.push(msg);
        break;
      }
      await new Promise(r => setTimeout(r, 2000));

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

        let pageListings = await extractPageListings(page, wardName, label);

        // A rapid first request into a fresh category page occasionally comes
        // back with a real 200 page but an empty listing DOM (confirmed live:
        // re-loading the exact same URL moments later found real cards) — a
        // soft anti-bot/session-warmup effect, not a real empty ward. Only
        // worth retrying on the very first page load per category, once.
        if (p === 1 && pageListings.length === 0) {
          logger.warn(`[Rakuten] ${label}/${wardName}: empty on first load, reloading once to rule out a transient block`);
          await new Promise(r => setTimeout(r, 3000));
          await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
          await new Promise(r => setTimeout(r, 3000));
          await page.evaluate(() => {
            document.querySelectorAll('[class*="close"]').forEach((el: any) => {
              if (el && el.click) el.click();
            });
          });
          await new Promise(r => setTimeout(r, 1000));
          pageListings = await extractPageListings(page, wardName, label);
          if (pageListings.length > 0) {
            logger.info(`[Rakuten] ${label}/${wardName}: retry found ${pageListings.length} listings the first load missed`);
          } else {
            scrapeErrors.push(`${label}: empty on first load and on retry — likely a real empty ward, but could not rule out a block`);
          }
        }

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
      errors: scrapeErrors.length > 0 ? scrapeErrors : undefined,
    };
  } finally {
    await browser.close();
  }
}
