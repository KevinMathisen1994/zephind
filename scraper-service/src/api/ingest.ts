/**
 * Machine-to-machine ingest for the scheduled (cron) scraper. Ported from
 * convex/ingest.js.
 *
 * WHY A SHARED SECRET, NOT CLERK
 * ------------------------------
 * A scheduled run has no browser and no Clerk session, so it cannot use the
 * per-user routes at all. These routes are therefore guarded by
 * SCRAPER_INGEST_SECRET instead, which is the ONLY thing between the open
 * internet and these writes. Consequences:
 *   - Never default-allow. An unset secret throws; it does not fall through to
 *     "nothing configured, allow everything".
 *   - Rotating it means updating both this service's env and the GitHub Actions
 *     secret.
 *   - /orders-for-matching returns every user's orders (the cron needs the
 *     userId so matches can be attributed), so leaking the secret leaks orders.
 *
 * OWNERSHIP: `listings` and `scraperHealth` are deliberately shared tables, so
 * inserted listings need no owner. `matching` IS per-user, and each row is
 * stamped with the userId of the ORDER it belongs to, never a caller-supplied
 * value.
 */
import { Router, type Request } from "express";
import { db } from "../db";
import { HttpError } from "../auth/authz";
import { logger } from "../logger";
import { route } from "./handler";
import { runBackgroundTasks } from "../jobs/cron";
import { evaluateMatchIdsServer } from "./evaluate";

/**
 * Length-independent-ish constant-time comparison. Not a defence against a
 * serious timing attack across a network (jitter dwarfs the signal), but it
 * costs nothing and avoids the obvious early-return leak.
 */
function secretsMatch(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Accepts the secret in the body (as Convex did) or as a bearer-style header. */
function assertSecret(req: Request): void {
  const expected = process.env.SCRAPER_INGEST_SECRET;
  if (!expected) {
    // Fail closed: an unset env var must never mean "anyone may write".
    throw new HttpError(500, "SCRAPER_INGEST_SECRET is not configured on this service.");
  }
  const supplied = req.body?.secret ?? req.header("x-ingest-secret");
  if (!secretsMatch(supplied, expected)) throw new HttpError(401, "Invalid ingest secret");
}

// Only these fields are copied off a scraped listing. Scrapers emit extra
// bookkeeping keys (matchedOrderIndices, rejectionReason, ...) that are not
// columns, and Postgres rejects an unknown column outright.
const LISTING_STRING_FIELDS = [
  "address", "ward", "source", "status", "url", "description",
  "layout", "station", "stationName", "title", "propertyType", "zoning", "pdfUrl",
  "structure", "structureType",
  // "posted" (情報公開日/掲載日) vs "updated" (更新日), so the UI can label a
  // re-post date honestly instead of calling it the posting date.
  "postedDateKind",
  // "rent" for a 賃貸-vertical listing, "buy" (or absent) for a for-sale one.
  "dealType",
];
const LISTING_NUMBER_FIELDS = [
  "price", "area", "landSize", "buildYear", "rooms", "walkMinutes",
  "walkingMinutes", "mlitBenchmark", "score", "latitude", "longitude",
  "buildingCoverageRatio", "floorAreaRatio", "roadWidth", "frontage",
  "yield", "totalUnits", "floor", "elevators",
  // 掲載日 as epoch ms — see src/services/postedDate.ts.
  "postedAt",
  // Rental-only economics, all 万円 (deposit/keyMoney absolute, not a
  // month-multiple) — additive to `price`, not a replacement.
  "rent", "managementFee", "deposit", "keyMoney",
  // Price change tracking
  "previousPrice", "initialPrice", "priceDropPct", "priceChangedAt",
];
const LISTING_BOOLEAN_FIELDS = ["isNew", "petsAllowed", "priceDropped"];

function normalizeListing(raw: any, source: string): Record<string, any> {
  const doc: Record<string, any> = {};
  for (const key of LISTING_STRING_FIELDS) {
    const value = raw[key];
    if (typeof value === "string" && value.length > 0) doc[key] = value;
  }
  for (const key of LISTING_NUMBER_FIELDS) {
    const value = raw[key];
    if (value === null || value === undefined || value === "") continue;
    const num = Number(value);
    if (Number.isFinite(num)) doc[key] = num;
  }
  for (const key of LISTING_BOOLEAN_FIELDS) {
    if (typeof raw[key] === "boolean") doc[key] = raw[key];
  }
  if (Array.isArray(raw.images)) {
    const images = raw.images.filter((i: unknown) => typeof i === "string");
    if (images.length > 0) doc.images = images;
  }
  // Scrapers vary: some call it url, some detailUrl.
  if (!doc.url && typeof raw.detailUrl === "string" && raw.detailUrl) doc.url = raw.detailUrl;
  doc.source = doc.source || source || "scraper";
  doc.status = doc.status || "new";
  return doc;
}

/**
 * `floor`/`elevators` (migration 0003) and the price-tracking columns (0004)
 * are not present in every deployment. Naming a missing column makes PostgREST
 * reject the WHOLE request, so one unapplied migration took ingestion down for
 * every listing in the batch — first 0003, now 0004:
 *   selectIn listings.url: column listings.previousPrice does not exist
 * Probe once, remember what this database lacks, and strip those fields from
 * reads and writes instead of failing the run.
 */
const missingListingColumns = new Set<string>();
let listingColumnsProbed = false;

async function findMissingListingColumns(): Promise<Set<string>> {
  if (listingColumnsProbed) return missingListingColumns;
  listingColumnsProbed = true;

  const probe = async (cols: string[]): Promise<void> => {
    if (cols.length === 0) return;
    const { error } = await db.raw
      .from("listings")
      .select(cols.join(","))
      .limit(1);
    if (!error) return;
    const msg = String((error as { message?: string }).message ?? "");
    // PostgREST names the offender: "column listings.previousPrice does not exist"
    const m = msg.match(/column listings\.([A-Za-z_]+) does not exist/);
    if (m) {
      missingListingColumns.add(m[1]);
      await probe(cols.filter((c) => c !== m[1]));
    }
  };

  await probe([
    "floor",
    "elevators",
    "previousPrice",
    "initialPrice",
    "priceDropPct",
    "priceChangedAt",
  ]);

  if (missingListingColumns.size > 0) {
    logger.warn(
      `[ingest] listings is missing ${[...missingListingColumns].join(", ")} — ` +
        `apply supabase/migrations (0003/0004). Those fields are skipped.`,
    );
  }
  return missingListingColumns;
}

/** Drop columns this database does not have, so an insert cannot 400 on them. */
function stripMissingColumns<T extends Record<string, any>>(
  doc: T,
  missing: Set<string>,
): T {
  if (missing.size === 0) return doc;
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!missing.has(key)) out[key] = value;
  }
  return out as T;
}

/**
 * Insert listing rows, dropping any column this database turns out to lack.
 * The probe covers the known migrations; the retry covers a column a newer
 * scraper sends that the probe never asked about.
 */
async function insertListings(
  rows: Record<string, any>[],
): Promise<{ _id: string; url?: string }[]> {
  const missing = await findMissingListingColumns();
  const res = await db.raw
    .from("listings")
    .insert(rows.map((r) => stripMissingColumns(r, missing)))
    .select("_id,url");
  if (!res.error) return (res.data ?? []) as { _id: string; url?: string }[];

  // An insert names the column differently from a select:
  // "Could not find the 'floor' column of 'listings' in the schema cache"
  const offender = String(res.error.message).match(
    /Could not find the '([A-Za-z_]+)' column/,
  );
  if (offender && !missing.has(offender[1])) {
    missingListingColumns.add(offender[1]);
    return insertListings(rows);
  }
  throw new HttpError(500, `ingestScrape insert: ${res.error.message}`);
}

export const ingestRouter = Router();

/**
 * Every order, including its userId, for the cron job to filter against. It
 * needs the raw criteria (to run hardFilter locally) and the userId (to
 * attribute matches). This intentionally crosses the per-user isolation
 * boundary, which is why it is secret-guarded.
 */
ingestRouter.post("/orders-for-matching", route(async (req) => {
  assertSecret(req);
  return db.list("orders");
}));

/**
 * Of the given urls, which are NOT in the listings table yet.
 *
 * The scraper uses this to decide whose detail page is worth opening for a
 * 掲載日: a posted date never changes, so fetching it once, for genuinely new
 * inventory only, is the difference between a handful of extra page loads a
 * night and one per listing per run forever.
 */
ingestRouter.post("/unknown-listing-urls", route(async (req) => {
  assertSecret(req);
  const urls: string[] = (req.body?.urls ?? []).filter((u: unknown) => typeof u === "string" && u);
  if (urls.length > 300) {
    throw new HttpError(400, `unknownListingUrls: ${urls.length} urls in one call — chunk to 300 or fewer`);
  }
  if (urls.length === 0) return [];
  // Convex did an indexed read per url; as HTTP round trips that would be 300
  // sequential calls. selectIn splits by URL length, so a chunk of long portal
  // urls still goes out as few requests without overrunning the request line.
  const rows = await db.selectIn("listings", "url", "url", urls);
  const known = new Set(rows.map((r) => r.url));
  return urls.filter((u) => !known.has(u));
}));

/**
 * Listings that still have no 掲載日, so a run can go back and fill them in.
 *
 * Dates are normally fetched only for URLs never seen before, which leaves every
 * listing found BEFORE 掲載日 scraping existed empty forever. This fixes those.
 */
ingestRouter.post("/listings-missing-posted-date", route(async (req) => {
  assertSecret(req);
  const limit = Math.min(Math.max(Number(req.body?.limit) || 1, 1), 500);
  const sources: string[] | null =
    Array.isArray(req.body?.sources) && req.body.sources.length > 0 ? req.body.sources : null;

  let q = db.raw.from("listings").select("_id,url,source").is("postedAt", null).not("url", "is", null);
  // Source filtering moves into the query (Convex filtered in JS after taking
  // limit*3 rows, which under-delivered whenever the wanted sources were rare).
  if (sources) q = q.in("source", sources);
  const { data, error } = await q.limit(limit);
  if (error) throw new HttpError(500, `listingsMissingPostedDate: ${error.message}`);
  return (data ?? []).map((r: any) => ({ listingId: r._id, url: r.url, source: r.source ?? "" }));
}));

/** Write the 掲載日 found for existing listings (the backfill's other half). */
ingestRouter.post("/save-posted-dates", route(async (req) => {
  assertSecret(req);
  const updates: { listingId: string; postedAt: number; postedDateKind?: string }[] =
    req.body?.updates ?? [];
  if (updates.length > 200) {
    throw new HttpError(400, `savePostedDates: ${updates.length} updates in one call — chunk to 200 or fewer`);
  }
  if (updates.length === 0) return { updated: 0 };

  // Never overwrite a date already recorded: the scrape-time value came from the
  // same page and a later re-read adds nothing but churn. Expressed as a
  // condition on the update itself rather than a read-then-write, which over
  // HTTP would race two concurrent backfills.
  let updated = 0;
  for (const u of updates) {
    if (!u?.listingId || !Number.isFinite(u.postedAt)) continue;
    const { data, error } = await db.raw
      .from("listings")
      .update({ postedAt: u.postedAt, postedDateKind: u.postedDateKind ?? null })
      .eq("_id", u.listingId)
      .is("postedAt", null)
      .select("_id");
    if (error) throw new HttpError(500, `savePostedDates: ${error.message}`);
    updated += (data ?? []).length;
  }
  return { updated };
}));

/**
 * Persist one source+area slice of a scrape run.
 *
 * Called once per (source, area) rather than once per run, so a crash partway
 * through a 19-portal sweep keeps everything already scraped.
 */
ingestRouter.post("/scrape", route(async (req) => {
  assertSecret(req);
  const source: string = req.body?.source ?? "";
  const rawListings: any[] = req.body?.listings ?? [];
  const matches: { listingUrl: string; orderId: string }[] = req.body?.matches ?? [];

  let listingsInserted = 0;
  let listingsSkipped = 0;
  let matchesCreated = 0;
  let matchesSkipped = 0;
  // Broken down by cause: "matchesSkipped=55" alone couldn't distinguish
  // "already done" from "this order can never receive matches", which made a
  // normal idempotent re-run look identical to a data-model bug.
  const skipReasons = { listingRejected: 0, noOwner: 0, duplicate: 0 };

  // url -> listing _id, for resolving the match pairs below without re-querying.
  const listingIdByUrl = new Map<string, string>();

  const docs: Record<string, any>[] = [];
  const noUrlDocs: Record<string, any>[] = [];
  for (const raw of rawListings) {
    if (!raw || typeof raw !== "object") {
      listingsSkipped++;
      continue;
    }
    const doc = normalizeListing(raw, source);
    if (doc.url) {
      // Duplicate inside this very batch (portals repeat a listing across
      // result pages).
      if (docs.some((d) => d.url === doc.url)) {
        listingsSkipped++;
        continue;
      }
      docs.push(doc);
    } else if (doc.address && doc.price != null) {
      noUrlDocs.push(doc);
    } else {
      // Neither a url nor address+price — undedupable, so refuse it rather than
      // insert a row the next run would insert again.
      listingsSkipped++;
    }
  }

  // One lookup for every url in the batch instead of one per listing.
  if (docs.length > 0) {
    const missing = await findMissingListingColumns();
    // Read the price-tracking columns only if this database actually has them.
    const priceColumns = ["previousPrice", "initialPrice"].filter(
      (c) => !missing.has(c),
    );
    const rows = await db.selectIn(
      "listings",
      ["_id", "url", "price", ...priceColumns].join(","),
      "url",
      docs.map((d) => d.url),
    );
    const canTrackPriceChanges =
      !missing.has("previousPrice") &&
      !missing.has("priceDropped") &&
      !missing.has("priceChangedAt");
    const existingByUrl = new Map<string, any>();
    for (const row of rows) {
      listingIdByUrl.set(row.url, row._id);
      existingByUrl.set(row.url, row);
    }

    // Track price changes on existing listings:
    // Listings stay on portals for months and sellers drop their ask. When a scraper
    // sees an existing URL with a changed price, update the price, record previousPrice,
    // and re-score any existing matches with the new bargain price.
    for (const d of docs) {
      const existing = existingByUrl.get(d.url);
      if (!existing) continue;
      // Nowhere to record the history — see findMissingListingColumns().
      if (!canTrackPriceChanges) continue;

      if (d.price != null && existing.price != null && d.price !== existing.price) {
        const isDrop = d.price < existing.price;
        const prevPrice = existing.price;
        const initPrice = existing.initialPrice ?? existing.price;
        const dropPct = isDrop ? Math.round(((prevPrice - d.price) / prevPrice) * 1000) / 10 : null;

        const patchData: Record<string, any> = {
          price: d.price,
          previousPrice: prevPrice,
          initialPrice: initPrice,
          priceDropped: isDrop,
          priceChangedAt: Date.now(),
        };
        if (dropPct != null) {
          patchData.priceDropPct = dropPct;
        }

        try {
          await db.patch("listings", existing._id, patchData);
          logger.info(`[Price change] ${d.url}: ${prevPrice}万 -> ${d.price}万 (${isDrop ? `-${dropPct}% drop` : "increase"})`);

          if (isDrop) {
            // Re-evaluate existing matches for this listing with the new lower price
            db.list("matching", { where: { listingId: existing._id } }).then((affected) => {
              if (affected && affected.length > 0) {
                const matchIds = affected.map((m) => m._id);
                evaluateMatchIdsServer(matchIds).catch((err) =>
                  logger.warn(`[Price drop re-evaluate] failed: ${err}`)
                );
              }
            }).catch(() => {});
          }
        } catch (err: any) {
          // If columns previousPrice / priceDropped do not exist in schema yet, fallback to price only
          if (err?.message && (err.message.includes("previousPrice") || err.message.includes("priceDropped"))) {
            try {
              await db.patch("listings", existing._id, { price: d.price });
            } catch {}
          }
        }
      }
    }

    const fresh = docs.filter((d) => !existingByUrl.has(d.url));
    listingsSkipped += docs.length - fresh.length;
    if (fresh.length > 0) {
      const inserted = await insertListings(fresh);
      for (const row of inserted) {
        if (row.url) listingIdByUrl.set(row.url, row._id);
      }
      listingsInserted += inserted.length;
    }
  }

  // No url: fall back to the address+price check listings.create uses. Only a
  // handful of listings per run lack a url.
  for (const doc of noUrlDocs) {
    const existing = await db.first("listings", { where: { address: doc.address, price: doc.price } });
    if (existing) {
      listingsSkipped++;
      continue;
    }
    await insertListings([doc]);
    listingsInserted++;
  }

  // Resolve orders and existing matches in bulk, for the same reason as above.
  const orderIds = [...new Set(matches.map((m) => m.orderId).filter(Boolean))];
  const orderRows = orderIds.length > 0 ? await db.getMany("orders", orderIds) : [];
  const orderById = new Map(orderRows.filter(Boolean).map((o) => [o!._id, o!]));

  const existingPairs = new Set<string>();
  if (orderIds.length > 0) {
    const rows = await db.selectIn("matching", "orderId,listingId", "orderId", orderIds);
    for (const row of rows) existingPairs.add(`${row.orderId}\u0000${row.listingId}`);
  }

  const toInsert: Record<string, any>[] = [];
  for (const match of matches) {
    const listingId = listingIdByUrl.get(match.listingUrl);
    if (!listingId) {
      // Its listing was rejected above (or never sent).
      matchesSkipped++;
      skipReasons.listingRejected++;
      continue;
    }
    const order = orderById.get(match.orderId);
    if (!order || !order.userId) {
      // Missing order, or a pre-isolation order with no owner. An ownerless
      // match is a row no query can ever return, so skip it.
      matchesSkipped++;
      skipReasons.noOwner++;
      continue;
    }
    const key = `${match.orderId}\u0000${listingId}`;
    if (existingPairs.has(key)) {
      matchesSkipped++;
      skipReasons.duplicate++;
      continue;
    }
    existingPairs.add(key);
    toInsert.push({
      // Ownership comes from the ORDER, never from the caller.
      userId: order.userId,
      orderId: match.orderId,
      listingId,
      status: "matched",
    });
  }
  if (toInsert.length > 0) {
    const insertedIds = await db.insertMany("matching", toInsert);
    matchesCreated += toInsert.length;

    // Evaluate on the server, not in the browser.
    // The scrape runs 3 times a day, so automatically score the new matches.
    if (insertedIds && insertedIds.length > 0) {
      void evaluateMatchIdsServer(insertedIds).catch((err) => {
        logger.error(`[Server evaluate] auto-evaluation on ingest failed: ${err}`);
      });
    }
  }

  return {
    listingsInserted,
    listingsSkipped,
    matchesCreated,
    matchesSkipped,
    matchSkipReasons: skipReasons,
  };
}));

/**
 * Record who searched, and when, for the orders a run covered.
 *
 * A user-initiated search is stamped from the caller's JWT at dispatch time. The
 * NIGHTLY run has no user at all, so those orders had a blank 実行者 on the card,
 * indistinguishable from "never searched". The cron caller passes its own label
 * ("自動取得（定期実行）"), which is why triggeredBy is an argument here.
 */
ingestRouter.post("/mark-scrape-run", route(async (req) => {
  assertSecret(req);
  const orderIds: string[] = req.body?.orderIds ?? [];
  const triggeredBy: string = req.body?.triggeredBy ?? "";
  if (orderIds.length > 100) {
    throw new HttpError(400, `markScrapeRun: ${orderIds.length} orders in one call — chunk to 100 or fewer`);
  }
  if (orderIds.length === 0) return { updated: 0 };
  const at = req.body?.at ?? Date.now();
  const { data, error } = await db.raw
    .from("orders")
    .update({ lastScrapeAt: at, lastScrapeBy: triggeredBy })
    .in("_id", orderIds)
    .select("_id");
  if (error) throw new HttpError(500, `markScrapeRun: ${error.message}`);
  return { updated: (data ?? []).length };
}));

ingestRouter.post("/progress", route(async (req) => {
  assertSecret(req);
  const { source, orderId, statusText } = req.body ?? {};
  if (orderId) {
    await db.patch("orders", orderId, {
      activeSource: source,
      scrapingStatus: statusText || `${source} を検索中...`,
    });
  }
  return { ok: true };
}));

/** Mail sync + server evaluation. pg_cron calls this on Supabase; the Node server uses its own timer. */
ingestRouter.post("/background", route(async (req) => {
  assertSecret(req);
  await runBackgroundTasks();
  return { ok: true };
}));
