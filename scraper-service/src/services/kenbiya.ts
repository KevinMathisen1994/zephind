import puppeteer from "puppeteer";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


const CODE_TO_WARD: Record<string, string> = {
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

const WARD_TO_SLUG: Record<string, string> = {
  "千代田区": "chiyoda-ku", "中央区": "chuo-ku", "港区": "minato-ku",
  "新宿区": "shinjuku-ku", "文京区": "bunkyo-ku", "台東区": "taito-ku",
  "墨田区": "sumida-ku", "江東区": "koto-ku", "品川区": "shinagawa-ku",
  "目黒区": "meguro-ku", "大田区": "ota-ku", "世田谷区": "setagaya-ku",
  "渋谷区": "shibuya-ku", "中野区": "nakano-ku", "杉並区": "suginami-ku",
  "豊島区": "toshima-ku", "北区": "kita-ku", "荒川区": "arakawa-ku",
  "板橋区": "itabashi-ku", "練馬区": "nerima-ku", "足立区": "adachi-ku",
  "葛飾区": "katsushika-ku", "江戸川区": "edogawa-ku",
};

async function extractListings(page: any): Promise<PropertyListing[]> {
  return await page.evaluate(() => {
    const results: PropertyListing[] = [];
    const items = document.querySelectorAll("li.item");

    items.forEach((el) => {
      // Title
      const title = el.querySelector(".subTitle")?.textContent?.trim() || "";

      // Price: handle "X億Y,YYY万円" or "X,XXX万円" format
      let price: number | null = null;
      const priceEl = el.querySelector(".price");
      if (priceEl) {
        const text = priceEl.textContent?.trim() || "";
        const okuM = text.match(/([\d,]+)\s*億/);
        const manM = text.match(/([\d,]+)\s*万円/);
        const oku = okuM ? parseFloat(okuM[1].replace(/,/g, "")) * 10000 : 0;
        const man = manM ? parseFloat(manM[1].replace(/,/g, "")) : 0;
        price = oku + man;
        // Fallback: just look for digits before 万円
        if (!okuM && !manM) {
          const simpleM = text.match(/([\d,]+)/);
          if (simpleM) price = parseFloat(simpleM[1].replace(/,/g, ""));
        }
      }

      // Land area
      let area: number | null = null;
      const landEl = el.querySelector(".land .num");
      if (landEl) {
        const aText = landEl.textContent?.trim() || "";
        const aM = aText.match(/([\d,.]+)/);
        if (aM) area = parseFloat(aM[1].replace(/,/g, ""));
      }

      // Address & station from trafficInfo
      const trafficLis = el.querySelectorAll(".trafficInfo li");
      let address = "";
      let station = "";
      let walkMinutes: number | null = null;

      if (trafficLis.length > 0) {
        address = trafficLis[0]?.textContent?.trim() || "";
      }
      if (trafficLis.length > 1) {
        const tText = trafficLis[1]?.textContent?.trim() || "";
        const stM = tText.match(/([^\s]+駅)/);
        if (stM) station = stM[1];
        const wkM = tText.match(/歩\s*(\d+)\s*分/);
        if (wkM) walkMinutes = parseInt(wkM[1]);
      }

      // Determine ward from address
      let ward = "";
      // Strip the prefecture first: /(.{2,4}[区市])/ scanned over
      // "東京都杉並区…" matches "京都杉並区" — it is greedy from the left and
      // the 東 lands outside the capture. This is the source of the corrupt
      // ward values ("京都町田市") seen in the listings table.
      const wm = address.replace(/^東京都|^北海道|^[^\s]{2,3}[府県]/, "")
        // Drop a 郡 (county) prefix — the municipality follows it,
        // e.g. 西多摩郡瑞穂町 -> 瑞穂町.
        .replace(/^[^\s]{1,4}郡/, "")
        // 市/区 BEFORE 町/村: one combined [区市町村] class matches 武蔵村
        // inside 武蔵村山市. The 町/村 fallback covers 島嶼部 (大島町, 八丈町,
        // 檜原村, 小笠原村) and 郡部, which previously extracted no ward at all.
        .match(/^(.{1,6}?[市区])/)
        || address.replace(/^東京都|^北海道|^[^\s]{2,3}[府県]/, "").replace(/^[^\s]{1,4}郡/, "").match(/^(.{1,5}?[町村])/);
      if (wm) ward = wm[1];

      // Detail URL
      const link = el.querySelector("a.link");
      let url = "";
      if (link) {
        const href = link.getAttribute("href") || "";
        url = href.startsWith("http") ? href : `https://www.kenbiya.com${href}`;
      }

      if (!price && !address) return;

      // Detect property type from icon
      let propertyType = "土地";
      const iconEl = el.querySelector(".photo .icon") as HTMLImageElement | null;
      if (iconEl) {
        const src = iconEl.src || "";
        if (src.includes("cate_APT") || src.includes("cate_MAN")) propertyType = "マンション";
        else if (src.includes("cate_BUL")) propertyType = "ビル";
        else if (src.includes("cate_LND")) propertyType = "土地";
        else if (src.includes("cate_HOU") || src.includes("cate_KOD") || src.includes("cate_HSE") || src.includes("house")) propertyType = "一戸建て";
      }
      // Fallback based on title/description text keywords
      const fullText = (title + " " + address).toLowerCase();
      if (propertyType === "土地") {
        if (fullText.includes("戸建") || fullText.includes("テラスハウス") || fullText.includes("一戸建")) {
          propertyType = "一戸建て";
        } else if (fullText.includes("マンション") || fullText.includes("アパート")) {
          propertyType = "マンション";
        }
      }

      results.push({
        address,
        ward,
        price: price || 0,
        area: area || 0,
        landSize: area || 0,
        source: "kenbiya",
        station: station || undefined,
        walkMinutes: walkMinutes ?? undefined,
        url: url || undefined,
        description: title || undefined,
        propertyType,
      });
    });

    return results;
  });
}

export async function scrapeKenbiya(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
  const wardName = CODE_TO_WARD[areaCode] || areaCode;
  const wardSlug = WARD_TO_SLUG[wardName];
  logger.info(`[Kenbiya Scraper] Starting scrape`, { ward: wardName, areaCode });

  if (!wardSlug) {
    logger.warn(`[Kenbiya Scraper] No ward slug mapping for ${areaCode}, skipping`);
    return { listings: [], source: "kenbiya", areaCode, scrapedAt: Date.now(), count: 0 };
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const allListings: PropertyListing[] = [];

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    let hasMore = true;
    const maxPages = 5;

    for (let p = 0; p < maxPages && hasMore; p++) {
      if (p === 0) {
        const baseUrl = `https://www.kenbiya.com/s/tokyo/${wardSlug}/`;
        logger.info(`[Kenbiya Scraper] Loading page for ${wardName} (batch ${p + 1})...`);

        try {
          await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 60000 });
        } catch {
          logger.warn(`[Kenbiya Scraper] Failed to load ${baseUrl}`);
          break;
        }
      } else {
        logger.info(`[Kenbiya Scraper] Processing next page for ${wardName} (batch ${p + 1})...`);
      }

      try {
        await page.waitForSelector("li.item", { timeout: 15000 });
      } catch {
        logger.warn(`[Kenbiya Scraper] No listings on page for ${wardName}`);
        break;
      }

      await new Promise((r) => setTimeout(r, 2000));

      // Scroll to bottom repeatedly to trigger lazy loading
      for (let s = 0; s < 5; s++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise((r) => setTimeout(r, 1500));
      }

      const listings = await extractListings(page);
      logger.info(`[Kenbiya Scraper] Found ${listings.length} land listings on page`);

      // Dedup by URL
      const existingUrls = new Set(allListings.map((l) => l.url));
      const newListings = listings.filter((l) => !existingUrls.has(l.url));
      allListings.push(...newListings);

      // Check for "次の50件" button
      hasMore = await page.evaluate(() => {
        const nextBtn = Array.from(document.querySelectorAll("a")).find(
          (a) => a.textContent?.trim() === "次の50件"
        );
        return !!nextBtn && nextBtn.style.display !== "none";
      });

      if (hasMore) {
        logger.info(`[Kenbiya Scraper] "次の50件" found, clicking...`);
        try {
          await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll("a")).find(
              (a) => a.textContent?.trim() === "次の50件"
            );
            if (btn) btn.click();
          });
          await new Promise((r) => setTimeout(r, 3000));
          await page.waitForSelector("li.item", { timeout: 10000 });
        } catch {
          logger.warn(`[Kenbiya Scraper] Failed to load next batch`);
          break;
        }
      }
    }

    logger.info(
      `[Kenbiya Scraper] Scrape complete: ${allListings.length} land listings for ${wardName}`
    );
    allListings.slice(0, 5).forEach((l, i) => {
      logger.info(
        `[Kenbiya Scraper]   [${i}] ${l.ward} ${l.address} | price=${l.price}万 | land=${l.landSize}㎡ | walk=${l.walkMinutes ?? "?"}min | station=${l.station ?? "?"}`
      );
    });

    return {
      listings: allListings,
      source: "kenbiya",
      areaCode,
      scrapedAt: Date.now(),
      count: allListings.length,
    };
  } finally {
    await browser.close();
    logger.info(`[Kenbiya Scraper] Browser closed`);
  }
}
