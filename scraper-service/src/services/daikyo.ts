import puppeteer from "../puppeteerStealth";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";
import { applyListPostedText } from "./postedDate";


const CATEGORY_MAP: Record<string, string> = {
  "土地": "land",
  "一戸建て": "house",
  "マンション": "mansion",
  "収益物件": "mansion",
};

async function extractListings(page: any, propertyType: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", `
    // Structured selectors, verified against the live PC layout of
    // /buy/{land,house,mansion}/p13/cNNNNN/.
    //
    // The previous version grabbed every <a> and walked up until it hit an
    // ancestor whose textContent contained "万円". On this site that ancestor is
    // the whole result <ul> (or worse, the sidebar), so the address regex
    // /(東京都[^\\s]*区[^\\s]*)/ picked up navigation junk and nothing usable came
    // out. Daikyo actually renders a clean label/value grid per card:
    //   li.list-search-result__item                      (one per property, 16/page)
    //     a.card-props-detail__link[href="/buy/detail/OAK.../"]   detail URL
    //     .card-props-detail__info-item                  one row per attribute
    //       .card-props-detail__info-title               価格 / 住所 / 交通 / 土地面積 ...
    //       .card-props-detail__info-data                the value
    // Reading the pairs by label makes this work unchanged for land, houses and
    // mansions, which expose different attribute sets (土地面積 vs 専有面積 etc).
    //
    // NOTE: this site serves a different (SP) DOM without a desktop UA +
    // viewport and .list-search-result__item does not exist there.
    var cards = Array.prototype.slice.call(document.querySelectorAll("li.list-search-result__item"));
    var results = [];

    var clean = function(el) { return ((el && el.textContent) || "").replace(/\\s+/g, " ").trim(); };

    // "1億979万円" and "4,980万円" both have to work: sum the 億 and 万 parts and
    // strip thousands separators before parseFloat.
    var parsePrice = function(t) {
      var s = (t || "").replace(/\\s/g, "");
      var okuMatch = s.match(/([\\d,]+(?:\\.\\d+)?)億/);
      var manMatch = s.match(/([\\d,]+(?:\\.\\d+)?)万/);
      if (!okuMatch && !manMatch) return 0;
      var oku = okuMatch ? parseFloat(okuMatch[1].replace(/,/g, "")) * 10000 : 0;
      var man = manMatch ? parseFloat(manMatch[1].replace(/,/g, "")) : 0;
      return oku + man;
    };

    // Areas are printed as "95.81m2" here, not "95.81㎡" — match m2 before m.
    var parseArea = function(t) {
      var m = (t || "").match(/([\\d,]+(?:\\.\\d+)?)\\s*(?:㎡|m2|m²|平米|m)/);
      return m ? parseFloat(m[1].replace(/,/g, "")) : null;
    };

    cards.forEach(function(card) {
      var link = card.querySelector("a.card-props-detail__link[href]");
      var url = link ? link.getAttribute("href") : null;
      if (url && !url.startsWith("http")) {
        url = "https://www.daikyo-anabuki.co.jp" + (url.startsWith("/") ? "" : "/") + url;
      }

      var price = 0;
      var address = "";
      var station = "";
      var walkMinutes = null;
      var landSize = null;
      var floorArea = null;
      var layout = "";
      var buildYear = null;
      var yieldPct = null;
      var floor = null;
      var totalUnits = null;

      // Some rows (e.g. 間取り + 専有面積 together on mansion cards) pack TWO
      // label/value pairs into one <li>, each in its own .info-column div.
      // querySelector() (singular) on the <li> only ever returns the FIRST
      // title/data pair in the whole subtree, so the second column's data —
      // 専有面積 on every mansion card — was silently dropped every time.
      // Iterate the columns individually when present, else treat the <li>
      // itself as a single pair (the shape 価格/住所/交通/... already use).
      var rows = Array.prototype.slice.call(card.querySelectorAll(".card-props-detail__info-item"));
      rows.forEach(function(row) {
        var columns = Array.prototype.slice.call(row.querySelectorAll(".card-props-detail__info-column"));
        var groups = columns.length ? columns : [row];
        groups.forEach(function(group) {
        var label = clean(group.querySelector(".card-props-detail__info-title"));
        var value = clean(group.querySelector(".card-props-detail__info-data"));
        if (!label || !value) return;

        if (label.indexOf("価格") >= 0) {
          price = parsePrice(value);
        } else if (label.indexOf("住所") >= 0 || label.indexOf("所在地") >= 0) {
          address = value.replace(/\\s+/g, "");
        } else if (label.indexOf("交通") >= 0 || label.indexOf("最寄") >= 0 || label.indexOf("沿線") >= 0) {
          // "中央本線 「西荻窪」駅 徒歩3分総武・中央緩行線 「西荻窪」駅 徒歩3分"
          // — several lines are concatenated; keep the first (nearest) station.
          var stM = value.match(/「([^」]+)」駅/);
          if (stM) station = stM[1] + "駅";
          else {
            var stM2 = value.match(/([^\\s「」]+)駅/);
            if (stM2) station = stM2[1] + "駅";
          }
          var wkM = value.match(/徒歩(\\d+)分/);
          if (wkM) walkMinutes = parseInt(wkM[1], 10);
        } else if (label.indexOf("土地面積") >= 0) {
          landSize = parseArea(value);
        } else if (label.indexOf("建物面積") >= 0 || label.indexOf("専有面積") >= 0 || label.indexOf("延床") >= 0) {
          floorArea = parseArea(value);
        } else if (label.indexOf("間取") >= 0) {
          layout = value;
        } else if (label.indexOf("築年") >= 0 || label.indexOf("完成") >= 0 || label.indexOf("竣工") >= 0) {
          var byM = value.match(/(\\d{4})年/);
          if (byM) buildYear = parseInt(byM[1], 10);
        } else if (label.indexOf("利回") >= 0) {
          var yM = value.match(/([\\d.]+)\\s*%/);
          if (yM) yieldPct = parseFloat(yM[1]);
        } else if (label.indexOf("所在階") >= 0) {
          var flM = value.match(/(\\d+)階/);
          if (flM) floor = parseInt(flM[1], 10);
        } else if (label.indexOf("総戸数") >= 0) {
          var tuM = value.match(/(\\d+)戸/);
          if (tuM) totalUnits = parseInt(tuM[1], 10);
        }
        });
      });

      // Fall back to the card heading, which repeats the address.
      if (!address) {
        var head = card.querySelector(".card-props-detail__labelnone-text");
        if (head) {
          // The heading also carries a "New 7/18" badge — drop it.
          var ht = clean(head).replace(/New\\s*[\\d\\/]*/g, "").replace(/\\s+/g, "");
          if (/[都道府県市区町村]/.test(ht)) address = ht;
        }
      }

      var ward = "";
      var wm = address.match(/([^都道府県]{2,4}[区市])/);
      if (wm) ward = wm[1];

      // Mansion cards DO carry 専有面積 (see the .info-column fix above) —
      // it just used to get silently dropped by the single-pair-per-row
      // extraction.
      var isMansion = propertyType === "マンション" || propertyType === "mansion" || propertyType === "収益物件";
      var area = isMansion ? (floorArea || 0) : (landSize || floorArea || 0);

      // 掲載日. 大京穴吹 is the ONLY one of the 19 portals that prints a date on
      // its list card: <span class="is-new">New 8/10</span>, with the date also
      // isolated in <span class="date">8/10</span>. Month/day only, so the year
      // is resolved on the Node side (parseJapaneseDate).
      var isNew = false;
      var postedText = "";
      var newBadge = card.querySelector("span.is-new");
      if (newBadge) {
        isNew = true;
        var dateEl = newBadge.querySelector("span.date") || card.querySelector("span.is-new span.date");
        postedText = clean(dateEl) || clean(newBadge).replace(/New/gi, "").trim();
      }

      if (address && price) {
        results.push({
          address: address,
          ward: ward,
          price: price,
          area: area,
          landSize: landSize || undefined,
          floorArea: floorArea || undefined,
          buildYear: buildYear || undefined,
          source: "daikyo",
          url: url || undefined,
          station: station || undefined,
          walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
          propertyType: propertyType,
          layout: layout || undefined,
          yield: yieldPct !== null ? yieldPct : undefined,
          floor: floor !== null ? floor : undefined,
          totalUnits: totalUnits !== null ? totalUnits : undefined,
          isNew: isNew || undefined,
          postedText: postedText || undefined,
        });
      }
    });

    return JSON.stringify(results);
  `), propertyType);
  // "New 8/10" -> epoch ms (year resolved centrally, see postedDate.ts).
  return applyListPostedText(JSON.parse(raw));
}

/**
 * 賃貸 (rent) cards share the exact same list-search-result__item /
 * info-item grid as the 中古 cards above, just with a different label set —
 * 賃料 instead of 価格, plus 管理費/敷金・保証金/礼金 that the buy side never
 * has. Confirmed live: 敷金・保証金 and 礼金 print an ABSOLUTE 万円 amount
 * here (e.g. "8.5万円" on an 8.5万円/月 rent), NOT a "Xヶ月" multiple like
 * keio.ts/suumo.ts/tokyotatemono.ts use — no conversion needed, unlike those
 * sites. No per-type land/house/mansion split either: one unfiltered
 * /rent/p13/c{code}/ URL, with each card's own 物件種別 label ("マンション")
 * giving the real type.
 */
async function extractChintaiListings(page: any): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function(`
    var cards = Array.prototype.slice.call(document.querySelectorAll("li.list-search-result__item"));
    var results = [];
    var clean = function(el) { return ((el && el.textContent) || "").replace(/\\s+/g, " ").trim(); };

    var parseManYen = function(t) {
      var s = (t || "").replace(/\\s/g, "");
      var m = s.match(/([\\d,.]+)万円?/);
      if (m) return parseFloat(m[1].replace(/,/g, ""));
      var y = s.match(/([\\d,.]+)円/);
      return y ? parseFloat(y[1].replace(/,/g, "")) / 10000 : null;
    };
    var parseArea = function(t) {
      var m = (t || "").match(/([\\d,]+(?:\\.\\d+)?)\\s*(?:㎡|m2|m²|平米|m)/);
      return m ? parseFloat(m[1].replace(/,/g, "")) : null;
    };

    cards.forEach(function(card) {
      var link = card.querySelector("a.card-props-detail__link[href]");
      var url = link ? link.getAttribute("href") : null;
      if (url && !url.startsWith("http")) {
        url = "https://www.daikyo-anabuki.co.jp" + (url.startsWith("/") ? "" : "/") + url;
      }
      if (!url) return;

      var rent = null, managementFee = null, deposit = null, keyMoney = null;
      var address = "", station = "", walkMinutes = null;
      var floorArea = null, layout = "", buildYear = null, floor = null, propertyType = "";

      var rows = Array.prototype.slice.call(card.querySelectorAll(".card-props-detail__info-item"));
      rows.forEach(function(row) {
        var columns = Array.prototype.slice.call(row.querySelectorAll(".card-props-detail__info-column"));
        var groups = columns.length ? columns : [row];
        groups.forEach(function(group) {
          var label = clean(group.querySelector(".card-props-detail__info-title"));
          var value = clean(group.querySelector(".card-props-detail__info-data"));
          if (!label || !value) return;

          if (label.indexOf("賃料") >= 0) {
            rent = parseManYen(value);
          } else if (label.indexOf("管理費") >= 0) {
            managementFee = parseManYen(value);
          } else if (label.indexOf("敷金") >= 0) {
            deposit = parseManYen(value);
          } else if (label.indexOf("礼金") >= 0) {
            keyMoney = parseManYen(value);
          } else if (label.indexOf("住所") >= 0 || label.indexOf("所在地") >= 0) {
            address = value.replace(/\\s+/g, "");
          } else if (label.indexOf("交通") >= 0 || label.indexOf("最寄") >= 0 || label.indexOf("沿線") >= 0) {
            var stM = value.match(/「([^」]+)」駅/);
            if (stM) station = stM[1] + "駅";
            else {
              var stM2 = value.match(/([^\\s「」]+)駅/);
              if (stM2) station = stM2[1] + "駅";
            }
            var wkM = value.match(/徒歩(\\d+)分/);
            if (wkM) walkMinutes = parseInt(wkM[1], 10);
          } else if (label.indexOf("専有面積") >= 0 || label.indexOf("建物面積") >= 0) {
            floorArea = parseArea(value);
          } else if (label.indexOf("間取") >= 0) {
            layout = value;
          } else if (label.indexOf("築年") >= 0) {
            var byM = value.match(/(\\d{4})年/);
            if (byM) buildYear = parseInt(byM[1], 10);
          } else if (label.indexOf("所在階") >= 0) {
            var flM = value.match(/(\\d+)階/);
            if (flM) floor = parseInt(flM[1], 10);
          } else if (label.indexOf("物件種別") >= 0) {
            propertyType = value;
          }
        });
      });

      if (!address) {
        var head = card.querySelector(".card-props-detail__labelnone-text");
        if (head) {
          var ht = clean(head).replace(/\\s+/g, "");
          if (/[都道府県市区町村]/.test(ht)) address = ht;
        }
      }

      var ward = "";
      var wm = address.match(/([^都道府県]{2,4}[区市])/);
      if (wm) ward = wm[1];

      if (address && rent != null) {
        results.push({
          address: address,
          ward: ward,
          price: rent,
          rent: rent,
          managementFee: managementFee != null ? managementFee : undefined,
          deposit: deposit != null ? deposit : undefined,
          keyMoney: keyMoney != null ? keyMoney : undefined,
          area: floorArea != null ? floorArea : undefined,
          floorArea: floorArea != null ? floorArea : undefined,
          buildYear: buildYear != null ? buildYear : undefined,
          floor: floor != null ? floor : undefined,
          source: "daikyo",
          url: url,
          station: station || undefined,
          walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
          propertyType: propertyType || undefined,
          layout: layout || undefined,
          dealType: "rent",
        });
      }
    });

    return JSON.stringify(results);
  `));
  return JSON.parse(raw);
}

async function scrapeDaikyoChintai(areaCode: string): Promise<ScrapeResult> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const allListings: PropertyListing[] = [];
  const scrapeErrors: string[] = [];
  const seenUrls = new Set<string>();

  try {
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    let currentPage = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      const url = `https://www.daikyo-anabuki.co.jp/rent/p13/c${areaCode}/${currentPage > 1 ? "?page=" + currentPage : ""}`;
      logger.info(`[Daikyo Scraper] Fetching (賃貸): ${url}`);

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 1500));

      // Same hidden "no results" dialog ships on every page here as on the
      // buy side (see the comment in scrapeDaikyo below) — count real rows.
      const cardCount = await page.evaluate(
        () => document.querySelectorAll("li.list-search-result__item").length
      );
      if (cardCount === 0) {
        logger.info(`[Daikyo Scraper] No 賃貸 result rows on page ${currentPage}`);
        break;
      }

      const listings = await extractChintaiListings(page);
      logger.info(`[Daikyo Scraper] Extracted ${listings.length} 賃貸 listings from page ${currentPage}`);

      const newListings = listings.filter((l) => {
        if (!l.url || seenUrls.has(l.url)) return false;
        seenUrls.add(l.url);
        return true;
      });
      if (newListings.length === 0) {
        logger.info(`[Daikyo Scraper] 賃貸 page ${currentPage}: no new listings, stopping`);
        break;
      }
      allListings.push(...newListings);

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

    logger.info(`[Daikyo Scraper] 賃貸 scrape complete: ${allListings.length} listings for ${areaCode}`);
    return { errors: scrapeErrors, listings: allListings, source: "daikyo", areaCode, scrapedAt: Date.now(), count: allListings.length };
  } catch (error: any) {
    logger.error(`[Daikyo Scraper] Error during 賃貸 scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
    return { errors: scrapeErrors, listings: allListings, source: "daikyo", areaCode, scrapedAt: Date.now(), count: allListings.length };
  } finally {
    await browser.close();
  }
}

export async function scrapeDaikyo(areaCode: string, filterTypes?: string[], dealType?: "buy" | "rent"): Promise<ScrapeResult> {
  if (dealType === "rent") {
    return await scrapeDaikyoChintai(areaCode);
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

    for (const type of typesToScrape) {
      const typePath = CATEGORY_MAP[type];
      if (!typePath) continue;

      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        // e.g. https://www.daikyo-anabuki.co.jp/buy/land/p13/c13106/
        const url = `https://www.daikyo-anabuki.co.jp/buy/${typePath}/p13/c${areaCode}/${currentPage > 1 ? '?page=' + currentPage : ''}`;
        logger.info(`[Daikyo Scraper] Fetching: ${url}`);

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await new Promise((r) => setTimeout(r, 1500));

        // Do NOT sniff body text for "該当する物件": every Daikyo result page ships
        // a hidden dialog reading "現在お選びの条件に該当する物件が見つかりませんでした。",
        // so the old substring check fired on populated pages and broke out
        // before extraction ever ran. That — not the selectors — is why this
        // scraper returned 0 listings. Count the actual result rows instead.
        const cardCount = await page.evaluate(
          () => document.querySelectorAll("li.list-search-result__item").length
        );

        if (cardCount === 0) {
          logger.info(`[Daikyo Scraper] No result rows on page ${currentPage}`);
          break;
        }

        const listings = await extractListings(page, type);
        logger.info(`[Daikyo Scraper] Extracted ${listings.length} listings from page ${currentPage}`);

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
    logger.error(`[Daikyo Scraper] Error during scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "daikyo",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}
