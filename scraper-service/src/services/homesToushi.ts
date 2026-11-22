/**
 * LIFULL HOME'S 不動産投資 (toushi.homes.co.jp): the 一棟 stock homes.co.jp's own categories don't carry.
 * Static HTML, so fetch + cheerio; each card already states 利回り, 築年月, 構造 and 戸数.
 */
import * as cheerio from "cheerio";
import { config } from "../config";
import { logger } from "../logger";
import { pace } from "../lib/pace";
import { parsePriceMan } from "../lib/mailParse.js";
import { deriveStructureType } from "../lib/mailData";
import type { PropertyListing } from "../types";

// Site's tbg[] type filter, confirmed live: 1 = 区分 (skipped: not 一棟), 2/3/4 = 一棟アパート/マンション/ビル.
const TYPES: Record<number, string> = { 2: "一棟アパート", 3: "一棟マンション", 4: "ビル" };
const PAGE_SIZE = 50;
const MAX_PAGES = 10;

export function parseToushiPage(html: string, propertyType: string): PropertyListing[] {
  const $ = cheerio.load(html);
  const out: PropertyListing[] = [];
  $("li.propertyList__item").each((_, el) => {
    const card = $(el);
    const text = (sel: string) => card.find(sel).first().text().replace(/\s+/g, " ").trim();
    const address = text(".prg-address");
    const price = parsePriceMan(text(".prg-price"));
    const href = card.find("a.propertyList__link").attr("href");
    if (!address || !price || !href) return;
    const yieldPct = parseFloat(text(".prg-yield"));
    const walk = text(".prg-walk");
    const walkM = walk.match(/(?:歩|徒歩)\s*(\d+)\s*分/);
    const structure = text(".prg-structure").replace(/^建物構造\s*/, "");
    const areaM = text(".prg-houseAreaText").match(/([\d.]+)\s*㎡/);
    const unitsM = text(".prg-allNumber").match(/(\d+)\s*戸/);
    const yearM = text(".prg-houseAge").match(/(\d{4})年/);
    const img = card.find("img.prg-propertyPhoto").attr("src");
    out.push({
      address,
      ward: (address.replace(/^東京都/, "").match(/^(.+?[区市町村])/) || [])[1],
      price,
      yield: Number.isFinite(yieldPct) ? yieldPct : undefined,
      station: walk.replace(/\s*(?:歩|徒歩)\s*\d+\s*分.*$/, "") || undefined,
      walkMinutes: walkM ? Number(walkM[1]) : undefined,
      buildYear: yearM ? Number(yearM[1]) : undefined,
      structure: structure || undefined,
      structureType: deriveStructureType(structure),
      floorArea: areaM ? Number(areaM[1]) : undefined,
      area: areaM ? Number(areaM[1]) : undefined,
      totalUnits: unitsM ? Number(unitsM[1]) : undefined,
      title: text(".prg-propertyName") || undefined,
      propertyType,
      source: "homes",
      url: new URL(href, "https://toushi.homes.co.jp").href,
      images: img && !/noimage/.test(img) ? [new URL(img, "https://toushi.homes.co.jp").href] : undefined,
    } as PropertyListing);
  });
  return out;
}

export async function scrapeHomesToushi(areaCode: string): Promise<PropertyListing[]> {
  const all: PropertyListing[] = [];
  for (const [tbg, label] of Object.entries(TYPES)) {
    for (let p = 1; p <= MAX_PAGES; p++) {
      const url = `https://toushi.homes.co.jp/bukkensearch/ad1[]=${areaCode}&tbg[]=${tbg}/?page=${p}`;
      await pace("toushi.homes", 1500, 3000);
      const res = await fetch(url, { headers: { "user-agent": config.userAgent } });
      if (!res.ok) throw new Error(`toushi.homes ${res.status} on ${url}`);
      const rows = parseToushiPage(await res.text(), label);
      all.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
  }
  logger.info(`[Homes Toushi] ${all.length} 一棟 listings for ${areaCode}`);
  return all;
}
