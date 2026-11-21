/**
 * Zephind MCP tools, shared by the remote endpoint (src/api/mcp.ts) and the local stdio server (src/mcp.ts).
 * ownerId scopes listings: scraped ones are shared (userId null), email-ingested ones belong to their owner.
 */
import * as cheerio from "cheerio";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { supabase } from "../db/supabase";
import { matchOrders } from "../lib/hardFilter";
import { computeMatchScore, mlitTypeForListing, normalizeWard, wardCityCode } from "../lib/scoring";
import { dedupeAndAnnotateListings } from "../lib/dealScore";
import { loadMlitYear } from "../lib/marketCache";
import { db } from "../db";
import { ORDER_FIELDS, pick } from "../api/fields";
import { dispatchScrape, getRunStatus } from "../api/scrapeTrigger";
import { toCriteria } from "../services/propertyMatcher";

const criteriaShape = {
  dealType: z.enum(["buy", "rent"]).optional().describe("Default buy"),
  wards: z.array(z.string()).optional().describe('Areas, e.g. ["世田谷区","杉並区"]'),
  propertyTypes: z.array(z.string()).optional().describe('Any of ["ビル","一棟マンション","アパート","マンション","一戸建て","土地","店舗"]. 1棟商業ビル = ビル'),
  priceMin: z.number().optional().describe("万円"),
  priceMax: z.number().optional().describe("万円 (1.5億 = 15000)"),
  rentMin: z.number().optional().describe("万円/月"),
  rentMax: z.number().optional().describe("万円/月"),
  minYield: z.number().optional().describe("利回り %"),
  maxYield: z.number().optional().describe("利回り %"),
  walkMinutes: z.number().optional().describe("Max 徒歩分"),
  minBuildYear: z.number().optional().describe("築年 e.g. 2000"),
  maxBuildAge: z.number().optional().describe("築年数以内"),
  landSizeMin: z.number().optional().describe("㎡"),
  landSizeMax: z.number().optional().describe("㎡"),
  buildingSizeMin: z.number().optional().describe("建物/専有面積 ㎡"),
  buildingSizeMax: z.number().optional().describe("建物/専有面積 ㎡"),
  structureTypes: z.array(z.string()).optional().describe('e.g. ["RC","SRC","S","木造"]'),
  minRoadWidth: z.number().optional().describe("m"),
  ownerChange: z.boolean().optional().describe("オーナーチェンジ only"),
  sources: z.array(z.string()).optional().describe('Portals, e.g. ["suumo","homes"]'),
};

// Only what the hard filter, scorer and result need; skips emailBody/images etc.
const COLUMNS =
  "_id,title,address,ward,propertyType,dealType,price,previousPrice,priceDropPct,priceDropped,rent,deposit,keyMoney," +
  "petsAllowed,yield,area,landSize,buildYear,structure,structureType,floor,elevators,totalUnits,roadWidth," +
  "buildingCoverageRatio,floorAreaRatio,walkMinutes,walkingMinutes,station,stationName,source,url,description,lastSeenAt," +
  "postedDateKind,dealScore,dealSignals,dealFlags";
const PAGE = 1000; // PostgREST max-rows
const SPEC_LIMIT = 8000;
const PAGE_TEXT_LIMIT = 6000;

function scoped<Q extends { or: (f: string) => Q; is: (c: string, v: null) => Q }>(q: Q, ownerId: string | null): Q {
  return ownerId ? q.or(`userId.is.null,userId.eq.${ownerId}`) : q.is("userId", null);
}

async function loadCandidates(c: Record<string, any>, ownerId: string | null) {
  const rows: Record<string, any>[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = scoped(supabase.from("listings").select(COLUMNS).order("_id").range(from, from + PAGE - 1), ownerId);
    // Coarse cut only; null passes because the hard filter treats unknown as "can't rule out".
    if (c.priceMax) q = q.or(`price.is.null,price.lte.${c.priceMax}`);
    if (c.minYield != null) q = q.or(`yield.is.null,yield.gte.${c.minYield}`);
    // The hard filter doesn't check sources, so this is the only place it applies.
    if (c.sources?.length) q = q.in("source", c.sources);
    const { data, error } = await q;
    if (error) throw new Error(`listings: ${error.message}`);
    rows.push(...(data as unknown as Record<string, any>[]));
    if (data.length < PAGE) return rows;
  }
}

export async function searchListings(criteria: Record<string, any>, limit: number, ownerId: string | null) {
  const candidates = await loadCandidates(criteria, ownerId);
  const matched = candidates.filter((l) => matchOrders(l, [criteria]).matchedOrderIndices.length > 0);
  // The same building is often listed by several brokers/portals; show it once (cheapest) and say where else.
  const dupes = dedupeAndAnnotateListings(matched);
  const results = matched
    .filter((l) => !dupes.get(l._id)?.duplicateOf)
    // shortcut: no market ctx, so market-value part of the match score is skipped; dealScore carries price-vs-market instead.
    .map((l) => ({ l, a: computeMatchScore(l, criteria, {}) }))
    .sort((x, y) => y.a.score - x.a.score || (y.l.dealScore ?? 0) - (x.l.dealScore ?? 0))
    .slice(0, limit)
    .map(({ l, a }) => {
      const g = dupes.get(l._id)?.group;
      return {
        id: l._id,
        matchScore: a.score,
        title: l.title, address: l.address, ward: l.ward, propertyType: l.propertyType,
        price万円: l.price, rent万円: l.rent, yield: l.yield, area: l.area, landSize: l.landSize,
        buildYear: l.buildYear, structure: l.structure ?? l.structureType,
        station: l.stationName ?? l.station, walkMinutes: l.walkMinutes ?? l.walkingMinutes,
        source: l.source, url: l.url,
        lastSeen: l.lastSeenAt ? new Date(l.lastSeenAt).toISOString().slice(0, 10) : null,
        disqualifiers: a.disqualifiers.map((d: { reason: string }) => d.reason),
        unverified: a.unverified,
        dealScore: l.dealScore,
        dealReasons: (l.dealSignals ?? []).map((x: { label: string; reason: string }) => `${x.label}: ${x.reason}`),
        dealFlags: l.dealFlags ?? [],
        alsoListed: g && g.count > 1
          ? { listings: g.count, sources: [...g.sources], priceRange万円: [g.minPrice, g.maxPrice] }
          : undefined,
      };
    });
  return { scanned: candidates.length, matched: matched.length, returned: results.length, results };
}

async function getScopedListing(id: string, ownerId: string | null) {
  const { data, error } = await scoped(supabase.from("listings").select(COLUMNS).eq("_id", id), ownerId).maybeSingle();
  if (error) throw new Error(`listings: ${error.message}`);
  return data as unknown as Record<string, any> | null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) * q)] : null;
};

/** Listing price per ㎡ against MLIT 不動産情報ライブラリ transactions (XIT001) in the same ward and type. */
export async function marketCheck(id: string, ownerId: string | null) {
  const l = await getScopedListing(id, ownerId);
  if (!l) return { error: "Listing not found" };
  const type = mlitTypeForListing(l.propertyType);
  // MLIT "Area" is land area for 土地 and 土地と建物 trades, 専有面積 for 区分 condos; compare like with like.
  const basis = type === "中古マンション等" ? "専有面積" : "土地面積";
  const listingArea = type === "中古マンション等" ? l.area : l.landSize;
  const listingPpsm = l.price && listingArea ? +(l.price / listingArea).toFixed(1) : null;
  const deal = {
    dealScore: l.dealScore,
    dealReasons: (l.dealSignals ?? []).map((x: { label: string; reason: string; weight: number }) => `${x.label}(重み${x.weight}): ${x.reason}`),
    dealFlags: l.dealFlags ?? [],
  };
  const ward = normalizeWard(l.ward) || l.ward;
  const cityCode = wardCityCode(l.ward);
  if (!cityCode) return { ...deal, note: `MLIT city code unknown for ward "${l.ward}"; no transaction comps.` };

  const year = new Date().getFullYear();
  const trades = (await Promise.all([year - 1, year - 2].map((y) => loadMlitYear(ward, cityCode, y, true))))
    .flat()
    .filter((t: any) => t.type === type && t.price > 0 && t.area > 0);
  const ppsms = trades.map((t: any) => t.price / t.area);
  const med = median(ppsms);
  const ratio = listingPpsm && med ? +(listingPpsm / med).toFixed(2) : null;
  // Same 町名 first: a ward-wide median mixes very different streets.
  const district = (t: any) => (t.district && l.address?.includes(t.district) ? 0 : 1);
  const comps = [...trades]
    .sort((a: any, b: any) => district(a) - district(b) || Math.abs(a.area - (listingArea ?? a.area)) - Math.abs(b.area - (listingArea ?? b.area)))
    .slice(0, 8)
    .map((t: any) => ({
      period: t.period, district: t.district, price万円: t.price, [`${basis}㎡`]: t.area,
      ppsm万円: +(t.price / t.area).toFixed(1), buildYear: t.buildYear, structure: t.structure,
      station: t.station, walkMinutes: t.walkMinutes,
    }));
  return {
    ...deal,
    mlitType: type,
    basis,
    listing: { price万円: l.price, [`${basis}㎡`]: listingArea, ppsm万円: listingPpsm, yield: l.yield, buildYear: l.buildYear },
    market: {
      trades: trades.length,
      medianPpsm万円: med && +med.toFixed(1),
      p25Ppsm万円: quantile(ppsms, 0.25)?.toFixed(1),
      p75Ppsm万円: quantile(ppsms, 0.75)?.toFixed(1),
    },
    listingVsMedian: ratio,
    comps,
    caveats: [
      "MLIT data is actual closed trades for the last 2 years, ward-wide; building age, frontage and tenancy are not adjusted.",
      ...(type === "宅地(土地と建物)" ? ["For buildings, price per land ㎡ ignores floor area and income; judge 収益物件 mainly on yield and 積算."] : []),
      ...(trades.length < 10 ? [`Only ${trades.length} comparable trades: treat the median as weak.`] : []),
    ],
  };
}

const ORDER_INPUT_FIELDS = ORDER_FIELDS.filter(
  (f) => !["status", "isScraping", "scrapingStatus", "activeSource", "scrapeRunId", "lastScrapeAt", "lastScrapeBy", "customerId", "criteria"].includes(f),
);

export async function createOrderAndScrape(name: string, criteria: Record<string, any>, ownerId: string) {
  const fields = pick({ ...criteria, name }, ORDER_INPUT_FIELDS as any);
  const orderId = await db.insert("orders", { ...fields, userId: ownerId, status: "pending" });
  const run = await dispatchScrape({ orderId, triggeredBy: "Claude連携" }).catch((e: Error) => ({ error: e.message }));
  return "error" in run
    ? { orderId, scrapeStarted: false, error: run.error }
    : { orderId, scrapeStarted: true, runId: run.runId, next: "Call scrape_status with this orderId later. Scrapes usually take 10-30+ minutes." };
}

export async function scrapeStatus(orderId: string, ownerId: string, limit: number) {
  const order = await db.first("orders", { where: { _id: orderId, userId: ownerId } });
  if (!order) return { error: "Order not found" };
  if (!order.scrapeRunId) {
    return { orderId, status: order.lastScrapeAt ? "starting_or_unknown" : "not_started", lastScrapeAt: order.lastScrapeAt };
  }
  const run = await getRunStatus(order.scrapeRunId);
  const minutes = Math.round((Date.now() - new Date(run.startedAt).getTime()) / 60000);
  if (run.status !== "completed") return { orderId, status: run.status, minutesElapsed: minutes, next: "Not finished yet; check again later." };
  return { orderId, status: "completed", conclusion: run.conclusion, ...(await searchListings(toCriteria(order), limit, ownerId)) };
}

/** Japanese portals still serve Shift_JIS/EUC-JP, so decode by declared charset instead of assuming UTF-8. */
function decode(buf: ArrayBuffer, contentType: string | null): string {
  const head = new TextDecoder("latin1").decode(buf.slice(0, 4096));
  const charset = (contentType?.match(/charset=([\w-]+)/i) ?? head.match(/<meta[^>]+charset=["']?([\w-]+)/i))?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

export async function checkListingPage(id: string, ownerId: string | null) {
  // Only URLs already in our DB are fetched, so the tool can't be pointed at arbitrary hosts.
  const listing = await getScopedListing(id, ownerId);
  if (!listing) return { error: "Listing not found" };
  const db = {
    price万円: listing.price, yield: listing.yield, area: listing.area, landSize: listing.landSize,
    buildYear: listing.buildYear, structure: listing.structure, address: listing.address, url: listing.url,
  };
  if (!listing.url?.startsWith("http")) return { db, error: "Listing has no web page (e.g. email-ingested)" };

  let res: Response;
  try {
    res = await fetch(listing.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept-Language": "ja,en;q=0.8",
      },
    });
  } catch (e) {
    return { db, error: `Fetch failed: ${(e as Error).message}` };
  }
  const html = decode(await res.arrayBuffer(), res.headers.get("content-type"));
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,iframe,header,footer,nav").remove();
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  // Portals keep specs (所在地, 利回り, 構造...) in th/td or dt/dd pairs, often past the nav-heavy top of the page.
  const specRows = new Set<string>();
  $("tr").each((_, tr) => {
    const cells = $(tr).children("th,td").map((_, c) => clean($(c).text())).get().filter(Boolean);
    if (cells.length >= 2) specRows.add(cells.join(" | "));
  });
  $("dt").each((_, dt) => {
    const dd = clean($(dt).next("dd").text());
    if (dd) specRows.add(`${clean($(dt).text())} | ${dd}`);
  });
  const specs = [...specRows].join("\n").slice(0, SPEC_LIMIT);
  const text = $("body").text().replace(/[ \t　]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  const blocked = [403, 405, 429].includes(res.status) || /Human Verification|captcha|アクセスが集中/i.test(text.slice(0, 3000));
  return {
    db,
    httpStatus: res.status,
    finalUrl: res.url,
    pageTitle: $("title").text().trim(),
    note: blocked
      ? "Portal blocked the automated request (bot check). Page content unavailable; this does not mean the listing is gone."
      : res.status === 404 || res.status === 410
        ? "Page not found: listing is likely removed/sold."
        : res.url !== listing.url
          ? "Redirected to a different URL: check whether the listing still exists."
          : undefined,
    specs: blocked ? undefined : specs,
    text: blocked ? undefined : text.slice(0, PAGE_TEXT_LIMIT),
    truncated: !blocked && text.length > PAGE_TEXT_LIMIT,
  };
}

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 1) }] });

export function createZephindMcpServer(ownerId: string | null): McpServer {
  const server = new McpServer({ name: "zephind", version: "1.1.0" });

  server.registerTool(
    "search_listings",
    {
      description:
        "Search Zephind's property listings for a buyer's criteria and return the best matches ranked by match score (0-100). " +
        "Prices are in 万円. Each result lists disqualifiers and unverified items (fields the listing doesn't state). " +
        "Use check_listing_page on promising results to verify them against the live portal page, and market_check to judge the price. " +
        "If nothing fits, offer create_order_and_scrape.",
      // Cast: the SDK's zod-shape inference hits TS2589 on a schema this wide.
      inputSchema: { ...criteriaShape, limit: z.number().int().min(1).max(50).optional().describe("Default 10") } as any,
    },
    async ({ limit = 10, ...criteria }: Record<string, any>) => json(await searchListings(criteria, limit, ownerId)),
  );

  server.registerTool(
    "check_listing_page",
    {
      description:
        "Fetch the live portal page of a listing (by id from search_listings) and return its text alongside our DB values. " +
        "Use it to confirm the listing is still online, fill fields our DB lacks (利回り, 構造, 築年, 土地権利, 接道, 現況), and spot price changes. " +
        "Some portals (homes, athome) may block automated requests.",
      inputSchema: { id: z.string().describe("Listing id from search_listings") } as any,
    },
    async ({ id }: { id: string }) => json(await checkListingPage(id, ownerId)),
  );

  server.registerTool(
    "market_check",
    {
      description:
        "Judge whether a listing's price is fair: compares its price per ㎡ with actual MLIT 不動産情報ライブラリ trades (last 2 years, same ward and type), " +
        "lists the closest comparable trades, and returns Zephind's deal score with its reasons (相場乖離, 実質利回り, 土地値, 売り急ぎ...).",
      inputSchema: { id: z.string().describe("Listing id from search_listings") } as any,
    },
    async ({ id }: { id: string }) => json(await marketCheck(id, ownerId)),
  );

  if (ownerId) {
    server.registerTool(
      "create_order_and_scrape",
      {
        description:
          "When search_listings finds nothing (or too little), save the buyer's criteria as a Zephind order (visible in the app's 物件検索) " +
          "and start a fresh scrape of the portals for it. The scrape runs in the background for 10-30+ minutes; then call scrape_status. " +
          "Confirm with the user before calling: it creates an order and spends scraping capacity.",
        inputSchema: {
          name: z.string().describe("Order name, e.g. client name + summary"),
          ...criteriaShape,
        } as any,
      },
      async ({ name, ...criteria }: Record<string, any>) => json(await createOrderAndScrape(name, criteria, ownerId)),
    );

    server.registerTool(
      "scrape_status",
      {
        description:
          "Check the scrape started by create_order_and_scrape. When completed, returns the best matches for the order (same format as search_listings). " +
          "Then use check_listing_page and market_check on the top results.",
        inputSchema: {
          orderId: z.string(),
          limit: z.number().int().min(1).max(50).optional().describe("Default 10"),
        } as any,
      },
      async ({ orderId, limit = 10 }: { orderId: string; limit?: number }) => json(await scrapeStatus(orderId, ownerId, limit)),
    );
  }

  return server;
}
