import { db } from "../db";
import { logger } from "../logger";
import { config } from "../config";
import {
  parseBuildYear,
  parseFloor,
  parseStructure,
  parseTotalUnits,
} from "../services/propertyDetail";

/**
 * Full spec table of a listing's detail page (マンション名, 管理費, 修繕積立金,
 * 向き, 土地権利, ...) kept as label -> value, plus a few numeric columns the
 * scorer and filters already use. Runs on the server for NEW listings only, so a
 * scrape that finds 100 known listings makes no extra requests.
 */

// Sites whose detail pages answer a plain HTTP GET with server-rendered tables.
// Others (At Home, HOME'S) bot-block plain requests, so they stay off this list.
const SPEC_SOURCES = new Set(["tokyu"]);

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function textOf(html: string): string {
  return html
    .replace(/<sup>\s*2\s*<\/sup>/gi, "²")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t　]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" / ");
}

/** Every label/value pair from th/td rows and dt/dd items. First occurrence of a label wins. */
export function parseSpecPairs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const patterns = [
    /<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
    /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi,
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      // Summary rows label themselves "間取り ："; strip that so they merge with the table rows.
      const label = textOf(m[1]).replace(/\s*\/\s*/g, "/").replace(/[\s:：]+$/, "");
      const value = textOf(m[2])
        .replace(/\s*(Googleマップ|支払額シミュレーション)\s*/g, " ")
        .replace(/(\d)\s*m²/g, "$1㎡")
        .trim();
      if (!label || label.length > 30 || !value || /^[-ー－—]+$/.test(value)) continue;
      if (/担当者|営業時間|定休日|物件番号/.test(label)) continue; // agent/office boilerplate
      if (!(label in out) && Object.keys(out).length < 60) out[label] = value.slice(0, 300);
    }
  }
  return out;
}

const yenToMan = (s: string | undefined): number | undefined => {
  const m = s?.replace(/,/g, "").match(/([\d.]+)\s*円/) ?? s?.replace(/,/g, "").match(/^([\d.]+)/);
  return m ? Math.round((parseFloat(m[1]) / 10000) * 10000) / 10000 : undefined;
};

/** Numeric columns derivable from the pairs; only used where the listing has no value yet. */
export function deriveFields(specs: Record<string, string>): Record<string, any> {
  const pick = (...labels: string[]) => labels.map((l) => specs[l]).find(Boolean);
  const out: Record<string, any> = {};

  const floor = parseFloor(pick("所在階数", "所在階") ?? "");
  if (floor != null) out.floor = floor;
  const structure = parseStructure(pick("建物構造", "構造") ?? "");
  if (structure) {
    out.structure = structure.structure;
    out.structureType = structure.structureType;
  }
  const units = parseTotalUnits(pick("総戸数") ?? "");
  if (units != null) out.totalUnits = units;

  const built = pick("築年月");
  const ym = built?.match(/(\d{4})\s*[\/年]/);
  const year = ym ? parseInt(ym[1], 10) : parseBuildYear(built ?? "");
  if (year != null) out.buildYear = year;

  const y = pick("予定利回り", "表面利回り", "利回り")?.match(/([\d.]+)\s*%/);
  if (y) out.yield = parseFloat(y[1]);

  // 管理費 for a sale is the monthly fee, same unit (万円/月) as the rental column.
  const fee = yenToMan(pick("管理費(月額)", "管理費"));
  if (fee != null) out.managementFee = fee;
  return out;
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": config.userAgent, "Accept-Language": "ja,en;q=0.8" },
      signal: AbortSignal.timeout(15000),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function saveSpecs(id: string, specs: Record<string, string>, existing: Record<string, any>) {
  const derived = deriveFields(specs);
  const fill: Record<string, any> = {};
  for (const [k, v] of Object.entries(derived)) if (existing[k] == null) fill[k] = v;
  // A database that lacks a column rejects the whole patch, so fall back step by step.
  for (const fields of [{ specs, ...fill }, { specs }]) {
    try {
      await db.patch("listings", id, fields);
      return true;
    } catch (err) {
      logger.debug(`[specs] patch ${id} failed (${(err as Error).message}); retrying with fewer fields`);
    }
  }
  return false;
}

/** Fetch and store specs for these listings. Never throws: a missing spec is not an error. */
export async function enrichListingSpecs(listingIds: string[], opts: { delayMs?: number } = {}): Promise<number> {
  if (listingIds.length === 0) return 0;
  let saved = 0;
  try {
    const rows = await db.selectIn("listings", "*", "_id", listingIds);
    for (const row of rows) {
      if (!row.url || row.specs || !SPEC_SOURCES.has(row.source)) continue;
      const html = await fetchHtml(row.url);
      const specs = html ? parseSpecPairs(html) : {};
      if (Object.keys(specs).length > 0 && (await saveSpecs(row._id, specs, row))) saved++;
      await new Promise((r) => setTimeout(r, opts.delayMs ?? 700));
    }
  } catch (err) {
    logger.warn(`[specs] enrichment stopped: ${(err as Error).message}`);
  }
  logger.info(`[specs] saved specs for ${saved}/${listingIds.length} listing(s)`);
  return saved;
}
