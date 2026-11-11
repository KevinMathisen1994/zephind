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
// Verified by fetching a live detail page of each. Left out on purpose: At Home and HOME'S
// (bot-block after bursts), 健美家 (429), ハトマーク and 大京穴吹 (JS-rendered, no tables).
export const SPEC_SOURCES = new Set([
  "tokyu", "nomu", "rakuten", "asahi", "tokyotatemono", "haseko",
  "mitsubishi_ufj", "stepon", "mitsui", "suumo", "odakyu",
]);

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", sup2: "²" };

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
// Labels that come from page chrome (forms, footers, agent boxes, nav), not the property.
const NOISE_LABEL =
  /担当者|営業時間|定休日|物件番号|関連リンク|お問い?合|会社|免許|保証協会|所属団体|^TEL|FAX|現在地|他のエリア|不動産検索|関連サービス|インフォメーション|楽天グループ|^借りる$|を買う$|^建てる$|^売る$|リフォームする|住まいの相談|現地外観写真|エントランス$|^★|サポート$|^その他$|^(駅|コンビニ)$|^次回更新|営業センター|対象設備機器|検査項目|保証箇所|お掃除箇所|作業範囲|ホームステージング|その他共用部|メールアドレス|お名前|ご住所|問い?合|自社管理番号/;

export function parseSpecPairs(rawHtml: string): Record<string, string> {
  // Forms, footers and nav hold look-alike label/value rows (inquiry fields, site links).
  const html = rawHtml.replace(/<(script|style|form|footer|nav|header)\b[\s\S]*?<\/\1>/gi, " ");
  const out: Record<string, string> = {};
  const patterns = [
    /<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
    /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi,
    // Some sites (三井のリハウス) use <td class="…header…"><td class="…data…"> rows.
    /<td[^>]*class="[^"]*(?:header|label)[^"]*"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      // Summary rows label themselves "間取り ："; strip that so they merge with the table rows.
      let label = textOf(m[1]).replace(/\s*\/\s*/g, "/").replace(/\/?ヒント$/, "").replace(/[\s:：]+$/, "");
      const value = textOf(m[2])
        .replace(/\s*(Googleマップ|支払額シミュレーション)\s*/g, " ")
        .replace(/&sup2;/g, "²")
        .replace(/(\d)\s*m²/g, "$1㎡")
        .replace(/\s*ヒント.*$/, "")
        .trim();
      // ノムコム packs "土地面積/164.47m²(49.75坪)/土地権利" into one th: area then label.
      const packed = label.match(/^(.+?)\/(\d[^/]*)\/(.+)$/);
      if (packed) {
        if (!(packed[1] in out)) out[packed[1]] = packed[2];
        label = packed[3];
      }
      if (!label || label.length > 30 || !value || /^[-ー－—]+$/.test(value)) continue;
      if (NOISE_LABEL.test(label)) continue;
      if (!(label in out) && Object.keys(out).length < 60) out[label] = value.slice(0, 300);
    }
  }
  return out;
}

// "15,910（円/月）", "46,170円", "3万100円／月" -> 万円
const yenToMan = (s: string | undefined): number | undefined => {
  const t = s?.replace(/,/g, "");
  const man = t?.match(/(\d+)万(\d*)円/);
  if (man) return parseInt(man[1], 10) + (man[2] ? parseInt(man[2], 10) / 10000 : 0);
  const m = t?.match(/([\d.]+)\s*円/) ?? t?.match(/^([\d.]+)/);
  return m ? Math.round((parseFloat(m[1]) / 10000) * 10000) / 10000 : undefined;
};

/** Numeric columns derivable from the pairs; only used where the listing has no value yet. */
export function deriveFields(specs: Record<string, string>): Record<string, any> {
  const pick = (...labels: string[]) => labels.map((l) => specs[l]).find(Boolean);
  const out: Record<string, any> = {};

  const floor = parseFloor(pick("所在階数", "所在階", "階数", "全体階/所在階", "所在階/階数") ?? "");
  if (floor != null) out.floor = floor;
  const structure = parseStructure(pick("建物構造", "構造", "構造・階建て", "所在階/構造", "構造/階建", "所在階/構造・階建") ?? "");
  if (structure) {
    out.structure = structure.structure;
    out.structureType = structure.structureType;
  }
  const units = parseTotalUnits(pick("総戸数") ?? "");
  if (units != null) out.totalUnits = units;

  const built = pick("築年月", "建築年月", "完成時期（築年月）", "完成時期(築年月)", "完成時期");
  const ym = built?.match(/(\d{4})\s*[\/年]/);
  const year = ym ? parseInt(ym[1], 10) : parseBuildYear(built ?? "");
  if (year != null) out.buildYear = year;

  const y = pick("予定利回り", "表面利回り", "利回り")?.match(/([\d.]+)\s*%/);
  if (y) out.yield = parseFloat(y[1]);

  // 管理費 for a sale is the monthly fee, same unit (万円/月) as the rental column.
  const fee = yenToMan(pick("管理費(月額)", "管理費", "管理費等", "管理費・共益費", "管理費・共益費等"));
  if (fee != null) out.managementFee = fee;
  return out;
}

export async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": config.userAgent, "Accept-Language": "ja,en;q=0.8" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    // ステップ and a few others still serve Shift_JIS; decoding as UTF-8 gives mojibake.
    const buf = await res.arrayBuffer();
    const header = res.headers.get("content-type")?.match(/charset=([\w-]+)/i)?.[1];
    const meta = new TextDecoder("latin1").decode(buf.slice(0, 3000)).match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
    try {
      return new TextDecoder(header || meta || "utf-8").decode(buf);
    } catch {
      return new TextDecoder("utf-8").decode(buf);
    }
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
      if (!html) continue; // transient fetch failure: leave specs null so it is retried
      const specs = parseSpecPairs(html);
      if (Object.keys(specs).length > 0) {
        if (await saveSpecs(row._id, specs, row)) saved++;
      } else {
        // {} marks "page has no spec table" so the backfill queue cannot stall on it.
        await db.patch("listings", row._id, { specs: {} }).catch(() => {});
      }
      await new Promise((r) => setTimeout(r, opts.delayMs ?? 700));
    }
  } catch (err) {
    logger.warn(`[specs] enrichment stopped: ${(err as Error).message}`);
  }
  logger.info(`[specs] saved specs for ${saved}/${listingIds.length} listing(s)`);
  return saved;
}

/** Newest listings still missing specs. Run from the background cron: the
 *  post-ingest enrichment dies with the scrape process. */
export async function backfillSpecs(limit = 20): Promise<{ attempted: number; saved: number }> {
  const { data, error } = await db.raw
    .from("listings")
    .select("_id")
    .is("specs", null)
    .in("source", [...SPEC_SOURCES])
    .not("url", "is", null)
    .order("_creationTime", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`backfillSpecs: ${error.message}`);
  const saved = await enrichListingSpecs((data ?? []).map((r: any) => r._id));
  return { attempted: data?.length ?? 0, saved };
}
