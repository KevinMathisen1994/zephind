import puppeteer from "../puppeteerStealth";
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


/**
 * 賃貸 (chintai) cards are a completely different template from the 中古/新築
 * one above: each `.cassetteitem` is a BUILDING, and inside it one `<tbody>`
 * per actual rentable UNIT (different floor/rent/layout), so one building
 * card can yield several listings. Confirmed live (港区, bs=040): there is no
 * per-type category param the way the buy side has bs=030/020/011 — one URL
 * returns 賃貸マンション/賃貸アパート/賃貸一戸建て all mixed together, with each
 * unit's real type in `.cassetteitem_content-label .ui-pct`. Same pattern as
 * kenbiya.ts: read the real type per card, let hardFilter narrow downstream.
 */
async function extractChintaiListings(page: any): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function(`
    var parseYen = function(text) {
      if (!text) return null;
      var t = text.replace(/[\\s,]/g, "");
      if (!t || t === "-" || t === "‐" || t === "―") return null;
      var okuM = t.match(/([\\d.]+)億/);
      var manM = t.match(/([\\d.]+)万円?/);
      if (okuM || manM) {
        var oku = okuM ? parseFloat(okuM[1]) * 10000 : 0;
        var man = manM ? parseFloat(manM[1]) : 0;
        return oku + man;
      }
      var yenM = t.match(/([\\d.]+)円/);
      if (yenM) return parseFloat(yenM[1]) / 10000;
      return null;
    };

    var results = [];
    var buildings = document.querySelectorAll(".cassetteitem");

    buildings.forEach(function(building) {
      var typeLabel = building.querySelector(".cassetteitem_content-label .ui-pct");
      var rawType = typeLabel ? typeLabel.textContent.trim() : "";

      var addrEl = building.querySelector(".cassetteitem_detail-col1");
      var address = addrEl ? addrEl.textContent.trim() : "";
      if (!address) return;

      var ward = "";
      var wm = address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "")
        .replace(/^[^\\s]{1,4}郡/, "")
        .match(/^(.{1,6}?[市区])/)
        || address.replace(/^東京都|^北海道|^[^\\s]{2,3}[府県]/, "").replace(/^[^\\s]{1,4}郡/, "").match(/^(.{1,5}?[町村])/);
      if (wm) ward = wm[1];

      var stationEl = building.querySelector(".cassetteitem_detail-col2 .cassetteitem_detail-text");
      var stationText = stationEl ? stationEl.textContent.trim() : "";
      var station = "";
      var walkMinutes = null;
      var stM = stationText.match(/([^\\s\\/]+駅)/);
      if (stM) station = stM[1];
      var wkM = stationText.match(/歩(\\d+)分/);
      if (wkM) walkMinutes = parseInt(wkM[1], 10);

      var col3 = building.querySelector(".cassetteitem_detail-col3");
      var col3Text = col3 ? col3.textContent : "";
      var buildYear = null;
      if (/新築/.test(col3Text)) {
        buildYear = new Date().getFullYear();
      } else {
        var ageM = col3Text.match(/築(\\d+)年/);
        if (ageM) buildYear = new Date().getFullYear() - parseInt(ageM[1], 10);
      }

      var rows = building.querySelectorAll("tbody tr.js-cassette_link");
      rows.forEach(function(row) {
        var rentEl = row.querySelector(".cassetteitem_price--rent");
        var rent = parseYen(rentEl ? rentEl.textContent : "");
        if (rent == null) return; // no rent = not a real listing row

        var mgmtEl = row.querySelector(".cassetteitem_price--administration");
        var managementFee = parseYen(mgmtEl ? mgmtEl.textContent : "");
        var depositEl = row.querySelector(".cassetteitem_price--deposit");
        var deposit = parseYen(depositEl ? depositEl.textContent : "");
        var gratuityEl = row.querySelector(".cassetteitem_price--gratuity");
        var keyMoney = parseYen(gratuityEl ? gratuityEl.textContent : "");

        var layoutEl = row.querySelector(".cassetteitem_madori");
        var layout = layoutEl ? layoutEl.textContent.trim() : "";
        var areaEl = row.querySelector(".cassetteitem_menseki");
        var areaText = areaEl ? areaEl.textContent : "";
        var areaM = areaText.match(/([\\d.]+)\\s*m/);
        var area = areaM ? parseFloat(areaM[1]) : null;

        var floor = null;
        var tds = row.querySelectorAll("td");
        if (tds.length > 2) {
          var floorM = tds[2].textContent.match(/(\\d+)\\s*階/);
          if (floorM) floor = parseInt(floorM[1], 10);
        }

        var linkEl = row.querySelector("a.js-cassette_link_href");
        var url = "";
        if (linkEl) {
          var href = linkEl.getAttribute("href") || "";
          url = href.indexOf("http") === 0 ? href : "https://suumo.jp" + href;
        }
        if (!url) return; // no detail link = can't dedupe/match reliably

        results.push({
          address: address,
          ward: ward,
          price: rent, // kept for any code path that reads .price generically
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
          walkMinutes: walkMinutes != null ? walkMinutes : undefined,
          url: url,
          source: "suumo",
          propertyType: rawType || undefined,
          dealType: "rent",
        });
      });
    });

    return JSON.stringify(results);
  `));
  return JSON.parse(raw);
}

async function scrapeSuumoChintai(areaCode: string, wardName: string): Promise<ScrapeResult> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const allListings: PropertyListing[] = [];
  const seenUrls = new Set<string>();
  // Confirmed live: 港区 alone still returned ~150-230 NEW listings per page
  // all the way to page 10 with no sign of tapering off — a buy-side cap of
  // 10 (chosen for a single property-type category) badly undercounts a
  // dense ward's whole 賃貸 inventory (every type mixed into one page, same
  // reasoning as kenbiya/keio/nomu_pro's higher caps elsewhere).
  const MAX_PAGES = 30;

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    for (let p = 1; p <= MAX_PAGES; p++) {
      // bs=040 (賃貸マンション・アパート) — confirmed live it already returns
      // 賃貸一戸建て too, not just マンション/アパート, so there is no separate
      // house category to also fetch here (unlike the buy side's 030/020/011).
      const url = `https://suumo.jp/jj/chintai/ichiran/FR301FC001/?ar=030&bs=040&ta=13&sc=${areaCode}&cb=0.0&ct=9999999&et=9999999&mb=0&mt=9999999&cn=9999999&fw2=&page=${p}`;
      logger.info(`[Suumo Scraper] Loading chintai page ${p} for ${wardName}...`);

      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
      } catch {
        logger.warn(`[Suumo Scraper] Chintai page ${p} failed to load`);
        break;
      }

      try {
        await page.waitForSelector(".cassetteitem", { timeout: 15000 });
      } catch {
        logger.info(`[Suumo Scraper] No chintai listings on page ${p}, stopping`);
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
        logger.info(`[Suumo Scraper] Chintai page ${p}: no new listings, stopping`);
        break;
      }

      logger.info(`[Suumo Scraper] Chintai page ${p}: ${newListings.length} new listings (total: ${allListings.length + newListings.length})`);
      allListings.push(...newListings);
    }

    logger.info(`[Suumo Scraper] Chintai scrape complete: ${allListings.length} listings for ${wardName}`);
    allListings.slice(0, 5).forEach((l, i) => {
      logger.info(
        `[Suumo Scraper]   [${i}] ${l.ward} ${l.address} | rent=${l.rent}万円 | mgmt=${l.managementFee ?? "?"}万円 | deposit=${l.deposit ?? "?"} | keyMoney=${l.keyMoney ?? "?"} | type=${l.propertyType}`
      );
    });

    return {
      listings: allListings,
      source: "suumo",
      areaCode,
      scrapedAt: Date.now(),
      count: allListings.length,
    };
  } finally {
    await browser.close();
    logger.info(`[Suumo Scraper] Browser closed`);
  }
}

async function extractListings(page: any): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function(`

    var items = document.querySelectorAll(".dottable--cassette");
    var results = [];

    items.forEach(function(el) {
      var getVal = function(label) {
        var dls = el.querySelectorAll(".dottable-line dl");
        for (var i = 0; i < dls.length; i++) {
          var dt = dls[i].querySelector("dt");
          if (dt && dt.textContent.trim() === label) {
            return dls[i].querySelector("dd")?.textContent?.trim() || "";
          }
        }
        return "";
      };

      var priceText = getVal("販売価格");
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
      var price = parsePrice(priceText);

      var address = getVal("所在地") || "";

      var stationText = getVal("沿線・駅");
      var station = "";
      var walkMinutes = null;
      var stM = stationText.match(/([^\\s]+駅)/);
      if (stM) station = stM[1];
      var wkM = stationText.match(/徒歩(\\d+)分/);
      if (wkM) walkMinutes = parseInt(wkM[1], 10);

      // Land vs unit area are DIFFERENT numbers and the cassette prints whichever
      // applies: 土地面積 on 土地/戸建て pages, 専有面積 (壁芯) on 中古マンション.
      // Reading only 土地面積 left every mansion with no area at all, so the
      // buyer's 専有面積 range could never be checked against it.
      var parseArea = function(text) {
        if (!text) return null;
        var m = text.match(/([\\d,.]+)\\s*m[²2]/);
        return m ? parseFloat(m[1].replace(/,/g, "")) : null;
      };
      var landSize = parseArea(getVal("土地面積"));
      var floorArea = parseArea(getVal("専有面積") || getVal("建物面積"));
      // 専有面積 is the mansion figure; fall back to land for the other pages.
      var area = floorArea != null ? floorArea : landSize;

      // 築年月 reads "1968年1月".
      var buildYear = null;
      var byM = getVal("築年月").match(/(\\d{4})年/);
      if (byM) buildYear = parseInt(byM[1], 10);

      var bcrFarText = getVal("建ぺい率・容積率");
      var bcr = null;
      var far = null;
      var bfM = bcrFarText.match(/([\\d.]+)％[\\s・/]*([\\d.]+)％/);
      if (bfM) { bcr = parseFloat(bfM[1]); far = parseFloat(bfM[2]); }

      var layout = getVal("間取り");

      var floorText = getVal("所在階") || getVal("階数") || getVal("階建/階") || getVal("所在階/階数");
      var floor = null;
      if (floorText) {
        var bM = floorText.match(/(?:地下|B)(\\d+)階?/);
        if (bM) {
          floor = -parseInt(bM[1], 10);
        } else {
          var flM = floorText.match(/(\\d+)階/);
          if (flM) floor = parseInt(flM[1], 10);
        }
      }

      var structText = getVal("建物構造") || getVal("構造") || getVal("構造・階建て");
      var structure = structText || undefined;
      var structureType = undefined;
      if (structText) {
        if (/SRC|鉄骨鉄筋/.test(structText)) structureType = "SRC";
        else if (/RC|鉄筋コンクリート/.test(structText)) structureType = "RC";
        else if (/軽量鉄骨/.test(structText)) structureType = "軽量鉄骨";
        else if (/鉄骨|S造/.test(structText)) structureType = "S";
        else if (/木造|W造/.test(structText)) structureType = "木造";
      }

      var unitsText = getVal("総戸数") || getVal("総戸数（販売戸数）");
      var totalUnits = null;
      if (unitsText) {
        var unM = unitsText.match(/(\\d+)\\s*戸/);
        if (unM) totalUnits = parseInt(unM[1], 10);
      }

      var roadText = getVal("前面道路") || getVal("接道状況") || getVal("接道") || getVal("接道方位・幅員");
      var roadWidth = null;
      var frontage = null;
      if (roadText) {
        var rwM = roadText.match(/(?:幅員|幅)\\s*[:：]?\\s*([0-9.]+)\\s*m/) || roadText.match(/([0-9.]+)\\s*m\\s*(?:公道|私道|道路)/) || roadText.match(/([0-9.]+)\\s*m/);
        if (rwM) roadWidth = parseFloat(rwM[1]);
        var frM = roadText.match(/(?:間口|接面)\\s*[:：]?\\s*([0-9.]+)\\s*m/);
        if (frM) frontage = parseFloat(frM[1]);
      }
      var frontageText = getVal("間口") || getVal("接面");
      if (frontageText && frontage === null) {
        var frM2 = frontageText.match(/([0-9.]+)\\s*m/);
        if (frM2) frontage = parseFloat(frM2[1]);
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

      if (!address) return;

      // The detail link is NOT inside .dottable--cassette (it has no anchors at
      // all) — it lives on the enclosing .property_unit card. Walk up to find
      // it, otherwise every listing comes back with no URL.
      var url = "";
      var card = el.closest(".property_unit");
      var link = card ? card.querySelector('a[href*="/nc_"]') : null;
      if (link) {
        var href = link.getAttribute("href") || "";
        url = href.indexOf("http") === 0 ? href : "https://suumo.jp" + href;
      }

      results.push({
        address: address,
        ward: ward,
        price: price || 0,
        // Was defaulting to 0 when unparsed. hardFilter's landSizeMin/
        // buildingSizeMin checks only skip on null/undefined, not 0, so an
        // unparsed size read as "confirmed 0m²" and was hard-rejected by
        // any such filter instead of being treated as unknown.
        area: area || undefined,
        // Only the real 土地面積 goes here. It used to be the same value as
        // area, i.e. a mansion's 専有面積 was also reported as its plot size,
        // which made a 30㎡ flat look like a 30㎡ plot to every land filter.
        landSize: landSize || undefined,
        floorArea: floorArea || undefined,
        buildYear: buildYear || undefined,
        url: url || undefined,
        source: "suumo",
        station: station || undefined,
        walkMinutes: walkMinutes != null ? walkMinutes : undefined,
        buildingCoverageRatio: bcr != null ? bcr : undefined,
        floorAreaRatio: far != null ? far : undefined,
        layout: layout || undefined,
        floor: floor != null ? floor : undefined,
        structure: structure || undefined,
        structureType: structureType || undefined,
        totalUnits: totalUnits != null ? totalUnits : undefined,
        roadWidth: roadWidth != null ? roadWidth : undefined,
        frontage: frontage != null ? frontage : undefined,
      });
    });

    return JSON.stringify(results);
  `));
  return JSON.parse(raw);
}

export async function scrapeSuumo(areaCode: string, filterTypes?: string[], dealType?: "buy" | "rent"): Promise<ScrapeResult> {
  const wardName = CODE_TO_WARD[areaCode] || areaCode;
  logger.info(`[Suumo Scraper] Starting scrape`, { ward: wardName, areaCode, dealType });

  if (dealType === "rent") {
    return await scrapeSuumoChintai(areaCode, wardName);
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

    const MAX_PAGES = 10;
    const catMap: Record<string, string> = { "030": "土地", "020": "一戸建て", "011": "マンション" };
    const categories = filterTypes && filterTypes.length > 0
      ? Object.entries(catMap).filter(([, label]) => filterTypes.includes(label)).map(([key]) => key)
      : Object.keys(catMap);
    if (categories.length === 0) {
      logger.info(`[Suumo Scraper] No matching categories for ${wardName}, skipping`);
      return { listings: [], source: "suumo", areaCode, scrapedAt: Date.now(), count: 0 };
    }

    for (const bs of categories) {
      logger.info(`[Suumo Scraper] Category bs=${bs} for ${wardName}...`);

      for (let p = 1; p <= MAX_PAGES; p++) {
        const url = `https://suumo.jp/jj/bukken/ichiran/JJ010FJ001/?ar=030&bs=${bs}&ta=13&sc=${areaCode}&kb=1&kt=9999999&km=1&page=${p}`;
        logger.info(`[Suumo Scraper] Loading page ${p} (bs=${bs}) for ${wardName}...`);

        try {
          await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
        } catch {
          logger.warn(`[Suumo Scraper] Page ${p} failed to load`);
          break;
        }

        const title = await page.title();
        if (title.includes("メンテナンス") || title.includes("Maintenance")) {
          logger.warn(`[Suumo Scraper] SUUMO is currently under maintenance: ${title}`);
          scrapeErrors.push(`SUUMOサイトは現在メンテナンス中です (${title})`);
          break;
        }

        try {
          await page.waitForSelector(".dottable--cassette", { timeout: 15000 });
        } catch {
          logger.info(`[Suumo Scraper] No listings on page ${p}, stopping`);
          break;
        }

        await new Promise((r) => setTimeout(r, 2000));

        const listings = await extractListings(page);
        // Tag with property type based on category
        const typeLabel = bs === "030" ? "土地" : bs === "020" ? "一戸建て" : "マンション";
        for (const l of listings) {
          l.propertyType = typeLabel;
        }

        const newListings = listings.filter((l) => {
          const sig = `${l.address}|${l.price}`;
          if (seenSignatures.has(sig)) return false;
          seenSignatures.add(sig);
          return true;
        });

        if (newListings.length === 0) {
          logger.info(`[Suumo Scraper] Page ${p}: no new listings, stopping`);
          break;
        }

        logger.info(`[Suumo Scraper] Page ${p}: ${newListings.length} new listings (total: ${allListings.length + newListings.length})`);
        allListings.push(...newListings);
      }
      if (scrapeErrors.length > 0) break;
    }

    logger.info(`[Suumo Scraper] Scrape complete: ${allListings.length} listings for ${wardName}`);
    allListings.slice(0, 5).forEach((l, i) => {
      logger.info(
        `[Suumo Scraper]   [${i}] ${l.ward} ${l.address} | price=${l.price}万 | land=${l.landSize}㎡ | walk=${l.walkMinutes ?? "?"}min | station=${l.station ?? "?"} | bcr=${l.buildingCoverageRatio ?? "?"}%`
      );
    });

    return {
      errors: scrapeErrors.length > 0 ? scrapeErrors : undefined,
      listings: allListings,
      source: "suumo",
      areaCode,
      scrapedAt: Date.now(),
      count: allListings.length,
    };
  } finally {
    await browser.close();
    logger.info(`[Suumo Scraper] Browser closed`);
  }
}
