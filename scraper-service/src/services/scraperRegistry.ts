/**
 * Single source of truth for "which scrapers exist and how do I run one".
 *
 * Extracted from scrapeRoutes.ts so the health checker exercises the exact same
 * dispatch path the real scrape endpoint uses — a health check that called the
 * scrapers a different way could pass while production was broken.
 */
import { scrapeAtHome } from "./athome";
import { scrapeRakuten } from "./rakuten";
import { scrapeHatomark } from "./hatomark";
import { scrapeKenbiya } from "./kenbiya";
import { scrapeSuumo } from "./suumo";
import { scrapeHomes } from "./homes";
import { scrapeNomu } from "./nomu";
import { scrapeNomuPro } from "./nomuPro";
import { scrapeMitsui } from "./mitsui";
import { scrapeStepon } from "./stepon";
import { scrapeTokyu } from "./tokyu";
import { scrapeMizuho } from "./mizuho";
import { scrapeSumai1 } from "./sumai1";
import { scrapeOdakyu } from "./odakyu";
import { scrapeKeio } from "./keio";
import { scrapeHaseko } from "./haseko";
import { scrapeDaikyo } from "./daikyo";
import { scrapeTokyoTatemono } from "./tokyotatemono";
import { scrapeAsahi } from "./asahi";
import type { ScrapeResult } from "../types";

export const KNOWN_SOURCES = [
  "athome", "rakuten", "hatomark", "kenbiya", "suumo", "homes", "nomu",
  "nomu_pro", "mitsui", "stepon", "tokyu", "mizuho", "mitsubishi_ufj",
  "odakyu", "keio", "haseko", "daikyo", "tokyotatemono", "asahi",
];

export const SOURCE_LABELS: Record<string, string> = {
  athome: "At Home",
  hatomark: "鳩マーク",
  kenbiya: "健美家",
  rakuten: "楽天不動産",
  suumo: "SUUMO",
  homes: "LIFULL HOME'S",
  nomu: "ノムコム",
  nomu_pro: "ノムコム・プロ",
  mitsui: "三井のリハウス",
  stepon: "住友不動産ステップ",
  tokyu: "東急リバブル",
  mizuho: "みずほ不動産販売",
  mitsubishi_ufj: "三菱UFJ不動産販売",
  odakyu: "小田急不動産仲介",
  keio: "京王不動産仲介",
  asahi: "朝日住宅",
  haseko: "長谷工不動産",
  daikyo: "大京穴吹不動産",
  tokyotatemono: "東京建物不動産販売",
};

export async function runScraper(
  source: string,
  code: string,
  requestedTypes?: string[],
): Promise<ScrapeResult> {
  switch (source) {
    case "athome":   return await scrapeAtHome(code, requestedTypes);
    case "rakuten":  return await scrapeRakuten(code, requestedTypes);
    case "hatomark": return await scrapeHatomark(code, requestedTypes);
    case "kenbiya":  return await scrapeKenbiya(code, requestedTypes);
    case "suumo":    return await scrapeSuumo(code, requestedTypes);
    case "homes":    return await scrapeHomes(code, requestedTypes);
    case "nomu":     return await scrapeNomu(code, requestedTypes);
    case "nomu_pro": return await scrapeNomuPro(code, requestedTypes);
    case "mitsui":   return await scrapeMitsui(code, requestedTypes);
    case "stepon":         return await scrapeStepon(code, requestedTypes);
    case "tokyu":          return await scrapeTokyu(code, requestedTypes);
    case "mizuho":         return await scrapeMizuho(code, requestedTypes);
    case "mitsubishi_ufj": return await scrapeSumai1(code, requestedTypes);
    case "odakyu":         return await scrapeOdakyu(code, requestedTypes);
    case "keio":           return await scrapeKeio(code, requestedTypes);
    case "haseko":         return await scrapeHaseko(code, requestedTypes);
    case "daikyo":         return await scrapeDaikyo(code, requestedTypes);
    case "tokyotatemono":  return await scrapeTokyoTatemono(code, requestedTypes);
    case "asahi":          return await scrapeAsahi(code, requestedTypes);
    default:         throw new Error(`Unknown source: ${source}`);
  }
}
