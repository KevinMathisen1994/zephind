import puppeteer from "puppeteer";
import { logger } from "../logger";
import { config } from "../config";
import type { PropertyListing, ScrapeResult } from "../types";


const CATEGORY_MAP: Record<string, string> = {
  "土地": "tochi",
  "一戸建て": "ikkodate",
  "マンション": "mansion",
  "収益物件": "mansion",
};

// Livable is a Next.js app whose CSS-module class names carry a per-build hash
// (".Card_item__f7R1e"). The hash rotates on every deploy, so it must never be
// hardcoded — but the "<Module>_<localName>" prefix in front of it is stable,
// which is what the [class*='...'] substring selectors below key on.
const CARD_SELECTORS = [
  "[class*='Card_buiPropertyListCard']",
  "[class*='propertyCardContents']",
  "[class*='propertyInfoContainer']",
];

async function extractListings(page: any, propertyType: string): Promise<PropertyListing[]> {
  const raw = await page.evaluate(new Function("propertyType", "cardSelectors", `
    // Structured extraction, verified against the live PC layout of
    // /kounyu/{tochi,mansion,kodate}/tokyo/aNNNNN/.
    //
    // The previous version looked for cards under a[href*='/kounyu/'] and that is
    // exactly why this returned 0: Livable's detail links do NOT live under
    // /kounyu/ at all, they are root-level "/tochi/C13267655/",
    // "/mansion/C48267224/", "/kodate/C48267P37/". The only /kounyu/ hrefs on the
    // page are area-filter links, so the card list was always empty. It then
    // compounded that by walking up from each anchor to the first ancestor
    // containing "万円", which yields oversized containers.
    //
    // Real structure per card:
    //   [class*='Card_buiPropertyListCard']       one per property (30/page)
    //     a[href="/tochi/C13267655/"]             detail URL (repeated overlay links)
    //     [class*='Card_price']                   "1億2,680万円" / "6,180万円（税込）"
    //     li[class*='Card_item']                  type / NEW badge / address / each rail line
    //     span|div[class*='Card_text']            one attribute each: 3LDK, 建物 75.60m2,
    //                                            土地 75.88m2, 2027年2月築, 2階／地上7階 ...
    //
    // IMPORTANT: read the Card_text spans individually, never the concatenated
    // text of their parent <li>. On mansion cards that parent reads
    // "1LDK＋納戸×150.74m2..." — the layout's "×1" runs straight into the area
    // "50.74m2", so a regex over the blob reports 150.74m2 instead of 50.74m2.
    var cards = [];
    for (var s = 0; s < cardSelectors.length; s++) {
      cards = Array.prototype.slice.call(document.querySelectorAll(cardSelectors[s]));
      if (cards.length) break;
    }

    var results = [];
    var clean = function(el) { return ((el && el.textContent) || "").replace(/\\s+/g, " ").trim(); };

    // "1億2,680万円" and "4,980万円" both have to work: sum the 億 and 万 parts and
    // strip thousands separators before parseFloat.
    var parsePrice = function(t) {
      var str = (t || "").replace(/\\s/g, "");
      var okuMatch = str.match(/([\\d,]+(?:\\.\\d+)?)億/);
      var manMatch = str.match(/([\\d,]+(?:\\.\\d+)?)万/);
      if (!okuMatch && !manMatch) return 0;
      var oku = okuMatch ? parseFloat(okuMatch[1].replace(/,/g, "")) * 10000 : 0;
      var man = manMatch ? parseFloat(manMatch[1].replace(/,/g, "")) : 0;
      return oku + man;
    };

    // "75.60m2" — the 2 is a <sup>, so textContent yields a literal "m2".
    var parseArea = function(t) {
      var m = (t || "").match(/([\\d,]+(?:\\.\\d+)?)\\s*(?:㎡|m2|m²|平米)/);
      return m ? parseFloat(m[1].replace(/,/g, "")) : null;
    };

    cards.forEach(function(card) {
      var link = card.querySelector("a[href]");
      var url = link ? link.getAttribute("href") : null;
      if (url && !url.startsWith("http")) {
        url = "https://www.livable.co.jp" + (url.startsWith("/") ? "" : "/") + url;
      }

      var price = parsePrice(clean(card.querySelector("[class*='Card_price']"))) ||
                  parsePrice(clean(card.querySelector("[class*='globalPriceSingle']")));

      var address = "";
      var station = "";
      var walkMinutes = null;

      var rows = Array.prototype.slice.call(card.querySelectorAll("li[class*='Card_item']"));
      rows.forEach(function(row) {
        var t = clean(row);
        if (!t) return;

        // Rail lines look like "京王井の頭線「久我山」駅 徒歩6分"; a card lists one
        // per line, so keep the first (nearest) one only.
        if (!station && t.indexOf("駅") >= 0 && t.indexOf("徒歩") >= 0) {
          var stM = t.match(/「([^」]+)」駅/) || t.match(/([^\\s「」]+)駅/);
          if (stM) station = stM[1] + "駅";
          var wkM = t.match(/徒歩(\\d+)分/);
          if (wkM) walkMinutes = parseInt(wkM[1], 10);
          return;
        }

        // The address row is the only one shaped "<pref>...<city/ward>...".
        if (!address) {
          var flat = t.replace(/\\s+/g, "");
          var adM = flat.match(/^(.{2,3}[都道府県].{1,8}?[市区郡].*)$/);
          if (adM) address = adM[1];
        }
      });

      var landSize = null;
      var floorArea = null;
      var layout = "";
      var age = "";
      var buildYear = null;
      var floor = null;
      var bcr = null;
      var far = null;

      var attrs = Array.prototype.slice.call(card.querySelectorAll("[class*='Card_text']"));
      attrs.forEach(function(el) {
        var t = clean(el);
        if (!t) return;
        var flat = t.replace(/\\s+/g, "");

        if (/^土地/.test(flat)) {
          landSize = parseArea(flat);
        } else if (/^(建物|延床|専有|内法|壁芯)/.test(flat)) {
          // Older mansions are quoted as 内法 (net) rather than 壁芯 (centre-line)
          // floor area; both label the same field for our purposes.
          floorArea = parseArea(flat);
        } else if (/^[\\d,]+(?:\\.\\d+)?(?:㎡|m2|m²)$/.test(flat)) {
          // A bare area with no label is the mansion's 専有面積.
          floorArea = parseArea(flat);
        } else if (/建ぺい率/.test(flat)) {
          var bM = flat.match(/建ぺい率([\\d.]+)/);
          if (bM) bcr = parseFloat(bM[1]);
        } else if (/容積率/.test(flat)) {
          var fM = flat.match(/容積率([\\d.]+)/);
          if (fM) far = parseFloat(fM[1]);
        } else if (/(\\d{4})年\\d{1,2}月築/.test(flat)) {
          var yM = flat.match(/(\\d{4})年(\\d{1,2})月築/);
          if (yM) { buildYear = parseInt(yM[1], 10); age = yM[1] + "年" + yM[2] + "月"; }
        } else if (/^\\d+階／/.test(flat)) {
          var flM = flat.match(/^(\\d+)階／/);
          if (flM) floor = parseInt(flM[1], 10);
        } else if (!layout && /^(ワンルーム|1R|[1-9]\\d?[SLDK])/.test(flat)) {
          layout = t;
        }
      });

      var ward = "";
      var wm = address.match(/([^都道府県]{2,4}[区市])/);
      if (wm) ward = wm[1];

      var isMansion = propertyType === "マンション" || propertyType === "mansion" || propertyType === "収益物件";
      var area = isMansion ? (floorArea || 0) : (landSize || floorArea || 0);

      if (address && price) {
        results.push({
          address: address,
          ward: ward,
          price: price,
          area: area,
          landSize: landSize || undefined,
          floorArea: floorArea || undefined,
          buildYear: buildYear || undefined,
          source: "tokyu",
          url: url || undefined,
          station: station || undefined,
          walkMinutes: walkMinutes !== null ? walkMinutes : undefined,
          propertyType: propertyType,
          layout: layout || undefined,
          age: age || undefined,
          floor: floor !== null ? floor : undefined,
          buildingCoverageRatio: bcr !== null ? bcr : undefined,
          floorAreaRatio: far !== null ? far : undefined,
        });
      }
    });

    return JSON.stringify(results);
  `), propertyType, CARD_SELECTORS);
  return JSON.parse(raw);
}

export async function scrapeTokyu(areaCode: string, filterTypes?: string[]): Promise<ScrapeResult> {
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
    const prefCode = areaCode.substring(0, 2); 
    const cityCode = areaCode.substring(2);

    for (const type of typesToScrape) {
      let typePath = CATEGORY_MAP[type];
      if (!typePath) continue;
      if (typePath === "ikkodate") typePath = "kodate"; // Adjust based on Livable URL

      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        // e.g. https://www.livable.co.jp/kounyu/tochi/tokyo/a13106/
        // Pagination usually looks like ?p=2 or similar, we'll try ?page=2
        const url = `https://www.livable.co.jp/kounyu/${typePath}/tokyo/a${prefCode}${cityCode}/${currentPage > 1 ? '?page=' + currentPage : ''}`;
        logger.info(`[Tokyu Scraper] Fetching: ${url}`);
        
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await new Promise((r) => setTimeout(r, 1500));
        
        // Count real result cards rather than sniffing body text for
        // "該当する物件" — that substring shows up in boilerplate/hidden dialogs on
        // sites in this family and makes a populated page look empty.
        const cardCount = await page.evaluate(
          (selectors: string[]) => {
            for (const s of selectors) {
              const n = document.querySelectorAll(s).length;
              if (n) return n;
            }
            return 0;
          },
          CARD_SELECTORS
        );

        if (cardCount === 0) {
          logger.info(`[Tokyu Scraper] No result cards on page ${currentPage}`);
          break;
        }

        const listings = await extractListings(page, type);
        logger.info(`[Tokyu Scraper] Extracted ${listings.length} listings from page ${currentPage}`);

        if (listings.length === 0) {
          break;
        }

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

        // There is no "次へ" label on Livable — the only anchor containing 次 is the
        // photo carousel's "次のスライド", so the old text probe never advanced past
        // page 1. Pagination is plain "?page=N" links; look for the next number.
        const nextButtonVisible = await page.evaluate((nextPage: number) => {
          return Array.from(document.querySelectorAll("a[href]")).some((a) =>
            (a.getAttribute("href") || "").includes(`?page=${nextPage}`)
          );
        }, currentPage + 1);

        if (nextButtonVisible && currentPage < config.maxPagesPerSite) {
          currentPage++;
        } else {
          hasNextPage = false;
        }
      }
    }
  } catch (error: any) {
    logger.error(`[Tokyu Scraper] Error during scraping: ${error.message}`);
    scrapeErrors.push(error?.message ?? String(error));
  } finally {
    await browser.close();
  }

  return {
    errors: scrapeErrors,
    source: "tokyu",
    areaCode,
    scrapedAt: Date.now(),
    listings: allListings,
    count: allListings.length,
  };
}
