/**
 * Ground-truth check: scrape, then open each sampled listing's detail page and
 * confirm the price / area / address we stored actually appear on it.
 *
 *   npx tsx src/verifyScrapes.ts                       # all sources, 杉並区, 5 samples each
 *   npx tsx src/verifyScrapes.ts --sources=suumo,nomu --area=13110 --n=10
 *
 * Writes verify-report.json in cwd so failures can be eyeballed. Read-only: nothing is ingested.
 */
import "./loadEnv";
import { writeFileSync } from "node:fs";
import { KNOWN_SOURCES, runScraper } from "./services/scraperRegistry";
import { fetchHtml } from "./lib/listingSpecs";
import { WARD_CODE_MAP } from "./lib/scoring.js";
import type { PropertyListing } from "./types";
import puppeteer from "./puppeteerStealth";
import type { Browser } from "puppeteer";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const sources = arg("sources")?.split(",") ?? KNOWN_SOURCES;
const area = arg("area") ?? "13115";
const n = Number(arg("n") ?? 5);
const types = arg("types")?.split(",") ?? ["土地", "一戸建て", "マンション", "ビル"];
const wardLabel = Object.entries(WARD_CODE_MAP as Record<string, string>).find(([, c]) => c === area)?.[0];

/** Page text with tags, commas, whitespace removed and full-width digits folded. */
export function normalize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/g, "")
    .replace(/[０-９．，]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,\s]/g, "");
}

/** The ways a portal writes a 万円 price: 5980万円, 1億600万円, 1億円. */
export function priceForms(man: number): string[] {
  const forms = [`${man}万`];
  if (man >= 10000) {
    const oku = Math.floor(man / 10000), rest = Math.round((man % 10000) * 100) / 100;
    forms.push(rest ? `${oku}億${rest}万` : `${oku}億`);
  }
  return forms;
}

// Portals label the same category many ways (売地, 一戸建, 一棟アパート...).
const TYPE_WORDS: Record<string, RegExp> = {
  土地: /土地|売地|宅地|借地/,
  一戸建て: /一戸建|戸建|テラス/,
  マンション: /マンション|区分/,
  ビル: /ビル|一棟|収益|アパート|事務所|店舗|倉庫|工場|ホテル|寮/,
};

let browser: Browser | undefined;
/** For pages that block plain HTTP or need JS (asahi bot challenge, homes, rakuten). */
async function browserHtml(url: string): Promise<string | null> {
  try {
    browser ??= await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      // asahi's challenge auto-submits a form and navigates again.
      await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15000 }).catch(() => {});
      return await page.content();
    } finally {
      await page.close();
    }
  } catch {
    return null;
  }
}

function checkAgainstPage(html: string, l: PropertyListing): string[] {
  const problems: string[] = [];
  const text = normalize(html);
  if (!l.price) problems.push("no price scraped");
  else if (!priceForms(l.price).some((f) => text.includes(f))) problems.push(`price ${l.price}万 not on page`);
  const a = areaFound(text, l);
  if (a === false) problems.push(`area ${l.area}㎡ not on page`);
  const addr = (l.address ?? "").replace(/^東京都/, "").replace(/[\s　]/g, "");
  // First 5 chars cover ward + town; deeper parts are often abbreviated differently.
  if (!addr) problems.push("no address scraped");
  else if (!text.includes(addr.slice(0, 5))) problems.push(`address "${addr}" not on page`);
  return problems;
}

function areaFound(text: string, l: PropertyListing): boolean | null {
  const vals = [l.area, l.landSize, l.floorArea].filter((v): v is number => !!v);
  if (!vals.length) return null;
  // Portals print 85.32 / 85.3 / 85; accept any rounding of the value we stored.
  return vals.some((v) =>
    [v.toFixed(2), v.toFixed(1), String(v), String(Math.round(v))].some((f) => text.includes(f)),
  );
}

type Check = { source: string; url?: string; title?: string; price: number; area: number; address: string; problems: string[] };

async function verifySource(source: string) {
  const t0 = Date.now();
  let listings: PropertyListing[] = [];
  let errors: string[] = [];
  try {
    const r = await runScraper(source, area, types);
    listings = r?.listings ?? [];
    errors = r?.errors ?? [];
  } catch (e: any) {
    errors = [String(e?.message ?? e)];
  }

  // Whole-batch sanity, no network needed.
  const batch: string[] = [];
  const wrongWard = wardLabel ? listings.filter((l) => !(l.address ?? "").includes(wardLabel) && l.ward !== wardLabel) : [];
  if (wrongWard.length) batch.push(`${wrongWard.length} listings outside ${wardLabel} (e.g. ${wrongWard[0].address})`);
  const urls = listings.map((l) => l.url).filter(Boolean);
  const dupes = urls.length - new Set(urls).size;
  if (dupes) batch.push(`${dupes} duplicate URLs`);
  const badType = listings.filter((l) => l.propertyType && !types.some((t) => (TYPE_WORDS[t] ?? new RegExp(t)).test(l.propertyType!)));
  if (badType.length) batch.push(`${badType.length} listings with type outside request (e.g. ${badType[0].propertyType})`);
  const weird = listings.filter((l) => l.price && l.area && (l.price / l.area < 5 || l.price / l.area > 2000));
  if (weird.length) batch.push(`${weird.length} with 万円/㎡ outside 5..2000 (e.g. ${weird[0].price}万 / ${weird[0].area}㎡)`);

  const sample = [...listings].filter((l) => l.url).sort(() => Math.random() - 0.5).slice(0, n);
  const checks: Check[] = [];
  let unfetchable = 0;
  for (const l of sample) {
    let problems: string[] | null = null;
    const html = await fetchHtml(l.url!);
    if (html) problems = checkAgainstPage(html, l);
    if (!problems || problems.length) {
      const rendered = await browserHtml(l.url!);
      const retry = rendered ? checkAgainstPage(rendered, l) : null;
      if (retry && (!problems || retry.length < problems.length)) problems = retry;
    }
    if (!problems) {
      unfetchable++;
      problems = ["detail page not fetchable (blocked or dead link), check by hand"];
    }
    await new Promise((r) => setTimeout(r, 1500)); // homes/athome block bursts
    checks.push({ source, url: l.url, title: l.title, price: l.price, area: l.area, address: l.address, problems });
  }

  const failed = checks.filter((c) => c.problems.length);
  return { source, listings: listings.length, sampled: sample.length, unfetchable, failed: failed.length, batch, errors, secs: Math.round((Date.now() - t0) / 1000), checks };
}

async function main() {
  console.log(`Verifying ${sources.length} sources, area ${area} (${wardLabel ?? "?"}), ${n} samples each\n`);
  const results = [];
  for (const s of sources) {
    const r = await verifySource(s);
    results.push(r);
    const verdict = r.listings === 0 ? "NO DATA" : r.failed - r.unfetchable > 0 || r.batch.length ? "CHECK" : "ok";
    console.log(`${verdict.padEnd(8)}${s.padEnd(16)}${r.listings} listings, ${r.sampled - r.failed}/${r.sampled} verified, ${r.unfetchable} unfetchable, ${r.secs}s`);
    for (const b of [...r.errors.map((e) => `error: ${e}`), ...r.batch]) console.log(`          - ${b}`);
    for (const c of r.checks.filter((c) => c.problems.length)) console.log(`          x ${c.url}\n            ${c.problems.join("; ")}`);
  }
  writeFileSync("verify-report.json", JSON.stringify({ area, types, at: new Date().toISOString(), results }, null, 2));
  await browser?.close();
  console.log("\nFull report: verify-report.json");
  process.exit(0);
}

if (process.argv[1]?.endsWith("verifyScrapes.ts")) main();
