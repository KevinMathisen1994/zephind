/**
 * Scraper health checks.
 *
 * The failure mode we care about: a target site changes its HTML/CSS, our
 * selectors stop matching, and the scraper keeps returning HTTP 200 with zero
 * or half-populated listings. Nothing throws, so it looks fine — it just
 * quietly stops finding properties. That is invisible without this check.
 *
 * So we don't just ask "did it error". We run the real scraper and inspect the
 * SHAPE of what came back:
 *   - threw / timed out              -> broken
 *   - 0 listings                     -> broken (selectors almost certainly changed)
 *   - listings but no prices         -> degraded (price selector changed)
 *   - listings but no addresses      -> degraded (address selector changed)
 *   - prices implausible vs the ward -> degraded (parsing bug, e.g. comma truncation)
 */
import { logger } from "../logger";
import { runScraper, KNOWN_SOURCES, SOURCE_LABELS } from "./scraperRegistry";
import type { PropertyListing } from "../types";

export type HealthStatus = "ok" | "degraded" | "broken";

export interface FieldCoverage {
  field: string;
  present: number;
  pct: number;
}

export interface ScraperHealth {
  source: string;
  label: string;
  status: HealthStatus;
  listingCount: number;
  durationMs: number;
  areaCode: string;
  checkedAt: number;
  issues: string[];
  coverage: FieldCoverage[];
  sample: { address?: string; price?: number; propertyType?: string; url?: string } | null;
  error: string | null;
}

// 杉並区 — a dense residential ward every one of these portals lists. A source
// legitimately having no inventory here would be surprising, which is what makes
// "0 results" a usable breakage signal.
const DEFAULT_AREA_CODE = "13115";

// Ask for all three categories. Most scrapers default to 土地 only when given no
// types, and a source with no 土地 inventory in this ward then returns 0 and looks
// broken. Measured: stepon returns 0 for 土地-only but 30 for マンション.
const PROBE_TYPES = ["土地", "マンション", "一戸建て"];

// Below this, a 0-result almost certainly means the browser never got to a page
// (launch failure / resource contention) rather than "this ward has no listings".
// Real scrapes here take 8-120s; contention failures came back in ~1.0s.
const IMPLAUSIBLY_FAST_MS = 4_000;

// Per-scraper timeout. Generous on purpose: suumo legitimately takes ~116s for
// all three categories, and a 90s limit reported it as broken when it was fine.
// A false "broken" is worse than a slow check — it sends you debugging nothing.
const CHECK_TIMEOUT_MS = 240_000;

// Fields we expect any usable listing to carry. Deliberately does NOT include
// yield/roadWidth/buildYear — those are 0% across every scraper today, so
// demanding them would mark all 19 permanently broken and make the board useless.
const CORE_FIELDS: (keyof PropertyListing)[] = [
  "address", "price", "propertyType", "url", "area", "walkMinutes", "station", "ward",
];

function coverageOf(listings: PropertyListing[]): FieldCoverage[] {
  return CORE_FIELDS.map((f) => {
    const present = listings.filter((l) => {
      const v = l[f];
      return v !== undefined && v !== null && v !== "" && v !== 0;
    }).length;
    return {
      field: String(f),
      present,
      pct: listings.length ? Math.round((present / listings.length) * 100) : 0,
    };
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    );
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export async function checkScraper(
  source: string,
  areaCode = DEFAULT_AREA_CODE,
): Promise<ScraperHealth> {
  const started = Date.now();
  const base = {
    source,
    label: SOURCE_LABELS[source] || source,
    areaCode,
    checkedAt: started,
  };

  try {
    let result = await withTimeout(
      runScraper(source, areaCode, PROBE_TYPES),
      CHECK_TIMEOUT_MS,
      source,
    );
    let listings = result?.listings ?? [];

    // A 0-result that came back too fast to have loaded a page is an
    // infrastructure blip, not evidence about the selectors. Retry once before
    // accusing the scraper — otherwise a transient browser-launch failure
    // reports as "selectors changed" and sends you debugging the wrong thing.
    if (listings.length === 0 && Date.now() - started < IMPLAUSIBLY_FAST_MS) {
      logger.warn(`[health] ${source}: 0 results in <4s, retrying once`);
      result = await withTimeout(
        runScraper(source, areaCode, PROBE_TYPES),
        CHECK_TIMEOUT_MS,
        source,
      );
      listings = result?.listings ?? [];
    }

    const durationMs = Date.now() - started;
    const coverage = coverageOf(listings);
    const pct = (f: string) => coverage.find((c) => c.field === f)?.pct ?? 0;
    const issues: string[] = [];
    let status: HealthStatus = "ok";

    // A scraper that caught its own error tells us the real cause. Prefer it
    // over guessing at selectors — ERR_CONNECTION_REFUSED and "selectors
    // changed" need completely different fixes.
    const reported = result?.errors ?? [];
    for (const e of reported) issues.push(`スクレイパー内部エラー: ${e}`);

    if (listings.length === 0) {
      status = "broken";
      if (reported.length > 0) {
        issues.push("0件取得 — 上記エラーが原因。セレクタではなく接続/ナビゲーションを確認");
      } else {
        issues.push(
          durationMs < IMPLAUSIBLY_FAST_MS
            ? `0件取得（${(durationMs / 1000).toFixed(1)}秒で終了）— ページ取得前に失敗した可能性。ブラウザ起動失敗やリソース競合を確認`
            : "0件取得 — セレクタが変更された可能性が高い（HTML/CSS構造の変更を確認）",
        );
      }
    } else {
      // Partial failure: some pages worked, others errored.
      if (reported.length > 0) status = "degraded";
      if (pct("price") < 50) {
        status = "degraded";
        issues.push(`価格の取得率が ${pct("price")}% — 価格セレクタ要確認`);
      }
      if (pct("address") < 50) {
        status = "degraded";
        issues.push(`所在地の取得率が ${pct("address")}% — 所在地セレクタ要確認`);
      }
      if (pct("url") < 50) {
        status = "degraded";
        issues.push(`物件URLの取得率が ${pct("url")}% — リンクセレクタ要確認`);
      }
      if (pct("propertyType") < 50) {
        status = "degraded";
        issues.push(`物件種別の取得率が ${pct("propertyType")}%`);
      }

      // Field PRESENCE is not field CORRECTNESS. tokyotatemono returned an
      // "address" of 東京23区(122) — a nav label with a result count — which
      // passed the coverage check while being useless. Check plausibility too.
      const addrs = listings.map((l) => l.address).filter((a): a is string => !!a);
      if (addrs.length > 0) {
        // A real Tokyo address has a locality AFTER the 区/市/町/村 (丁目, block
        // numbers, a district name). Checking only "contains 区 + a digit" is not
        // enough — "東京23区" satisfies that and is still a nav label. A trailing
        // "(NN)" result count is a reliable tell that we grabbed a filter link.
        const plausible = addrs.filter((a) => {
          const head = a.match(/^.*[区市町村]/);
          if (!head) return false;
          const tail = a.slice(head[0].length);
          return (
            tail.length > 0 &&
            !/\(\d+\)/.test(a) &&
            /[0-9０-９一二三四五六七八九十ぁ-んァ-ヶ一-龠]/.test(tail)
          );
        }).length;
        const pctPlausible = Math.round((plausible / addrs.length) * 100);
        if (pctPlausible < 50) {
          status = "degraded";
          issues.push(
            `所在地が住所として不自然（${pctPlausible}%のみ妥当）— ナビ要素等の誤取得の疑い（例: "${addrs[0]?.slice(0, 20)}"）`,
          );
        }
      }

      const urls = listings.map((l) => l.url).filter((u): u is string => !!u);
      if (urls.length > 0) {
        const bad = urls.filter((u) => !/^https?:\/\//.test(u)).length;
        if (bad / urls.length > 0.5) {
          status = "degraded";
          issues.push(`物件URLが不正な形式（${bad}/${urls.length}件）— リンク取得ロジック要確認`);
        }
      }

      // Parsing-bug detector: 東京23区 with a median under 300万円 means we are
      // reading the wrong element or truncating digits, not finding bargains.
      const prices = listings.map((l) => l.price).filter((p): p is number => !!p).sort((a, b) => a - b);
      if (prices.length >= 3) {
        const median = prices[Math.floor(prices.length / 2)];
        if (median < 300) {
          status = "degraded";
          issues.push(
            `価格の中央値が ${median}万円 — 桁落ち/別要素の誤取得の疑い（例: 「4,980万円」を980と解釈）`,
          );
        }
      }
    }

    logger.info(
      `[health] ${source}: ${status} (${listings.length} listings, ${durationMs}ms)`,
    );

    const first = listings[0];
    return {
      ...base,
      status,
      listingCount: listings.length,
      durationMs,
      issues,
      coverage,
      sample: first
        ? { address: first.address, price: first.price, propertyType: first.propertyType, url: first.url }
        : null,
      error: null,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[health] ${source}: broken — ${message}`);
    return {
      ...base,
      status: "broken",
      listingCount: 0,
      durationMs,
      issues: [`実行時エラー: ${message}`],
      coverage: [],
      sample: null,
      error: message,
    };
  }
}

/** Checks many scrapers with bounded concurrency (each spawns a browser). */
export async function checkAllScrapers(
  sources: string[] = KNOWN_SOURCES,
  areaCode = DEFAULT_AREA_CODE,
  // Sequential by default. Each check launches its own Chrome; running these in
  // parallel caused every check after the first few to fail instantly with 0
  // results, which read as "15 scrapers broken" when nothing was wrong.
  concurrency = 1,
): Promise<ScraperHealth[]> {
  const queue = [...sources];
  const out: ScraperHealth[] = [];

  async function worker() {
    for (;;) {
      const src = queue.shift();
      if (!src) return;
      out.push(await checkScraper(src, areaCode));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
  return out.sort((a, b) => sources.indexOf(a.source) - sources.indexOf(b.source));
}
