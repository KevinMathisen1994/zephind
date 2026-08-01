/**
 * Machine-to-machine ingest for the scheduled (cron) scraper.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Until now nothing on the server persisted scrape results: the BROWSER did it.
 * Admin.tsx / Orders.tsx fetched JSON from the scraper's HTTP endpoint and then
 * called api.listings.create / api.matching.create with the signed-in user's
 * Clerk session attached. A scheduled run has no browser and no Clerk session,
 * so it cannot call those mutations at all — matching.create goes through
 * requireUserId() and throws 未認証 for an anonymous caller. The scraper therefore
 * has to persist its own results, which is what the two functions below are for.
 *
 * WHY PUBLIC FUNCTIONS WITH A SHARED SECRET
 * -----------------------------------------
 * Convex `internal*` functions are not reachable from ConvexHttpClient, so a
 * headless process can only call PUBLIC functions. These are therefore public,
 * and the `secret` argument — compared against the SCRAPER_INGEST_SECRET env var
 * on the deployment — is the ONLY thing standing between the open internet and
 * these writes. Consequences:
 *   - Never default-allow. If SCRAPER_INGEST_SECRET is unset we throw, we do not
 *     fall through to "no secret configured, allow everything".
 *   - Rotating the secret means updating BOTH `npx convex env set
 *     SCRAPER_INGEST_SECRET ...` and the GitHub Actions secret.
 *   - listOrdersForMatching returns every user's orders (the cron job needs the
 *     userId so matches can be attributed), so leaking the secret leaks orders.
 *
 * OWNERSHIP
 * ---------
 * `listings` and `scraperHealth` are deliberately shared/unscoped tables, so
 * inserted listings need no owner. `matching` IS per-user, so each match row is
 * stamped with the userId of the ORDER it belongs to — never with a value the
 * caller supplied — so it shows up for exactly the account that owns the order.
 */
import { query, mutation } from "./_generated/server.js";
import { v } from "convex/values";

/**
 * Length-independent-ish constant-time comparison. Not a defence against a
 * serious timing attack across a network (jitter dwarfs the signal), but it
 * costs nothing and avoids the obvious early-return leak.
 */
function secretsMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function assertSecret(secret) {
  const expected = process.env.SCRAPER_INGEST_SECRET;
  if (!expected) {
    // Fail closed: an unset env var must never mean "anyone may write".
    throw new Error(
      "SCRAPER_INGEST_SECRET is not configured on this deployment. " +
        "Run: npx convex env set SCRAPER_INGEST_SECRET <value>",
    );
  }
  if (!secretsMatch(secret, expected)) {
    throw new Error("Invalid ingest secret");
  }
}

/**
 * Every order, including its userId, for the cron job to filter against.
 *
 * The scraper needs the raw criteria (to run hardFilter locally) and the userId
 * (so ingestScrape can attribute the resulting matches). This intentionally
 * crosses the per-user isolation boundary, which is why it is secret-guarded.
 */
export const listOrdersForMatching = query({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    assertSecret(args.secret);
    return await ctx.db.query("orders").collect();
  },
});

// Only these fields are copied off a scraped listing. The scrapers emit extra
// bookkeeping keys (matchedOrderIndices, rejectionReason, ...) that are not in
// the listings schema, and v.any() means the validator will not catch them.
const LISTING_STRING_FIELDS = [
  "address", "ward", "source", "status", "url", "description",
  "layout", "station", "stationName", "title", "propertyType", "zoning", "pdfUrl",
];
const LISTING_NUMBER_FIELDS = [
  "price", "area", "landSize", "buildYear", "rooms", "walkMinutes",
  "walkingMinutes", "mlitBenchmark", "score", "latitude", "longitude",
  "buildingCoverageRatio", "floorAreaRatio", "roadWidth", "frontage",
];

function normalizeListing(raw, source) {
  const doc = {};
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
  if (Array.isArray(raw.images)) {
    const images = raw.images.filter((i) => typeof i === "string");
    if (images.length > 0) doc.images = images;
  }
  // Scrapers vary: some call it url, some detailUrl.
  if (!doc.url && typeof raw.detailUrl === "string" && raw.detailUrl) {
    doc.url = raw.detailUrl;
  }
  doc.source = doc.source || source || "scraper";
  doc.status = doc.status || "new";
  return doc;
}

/**
 * Persist one source+area slice of a scrape run.
 *
 * Called once per (source, area) rather than once per run, so a crash partway
 * through a 19-portal sweep keeps everything already scraped.
 */
export const ingestScrape = mutation({
  args: {
    secret: v.string(),
    source: v.string(),
    areaCode: v.string(),
    // Shapes vary per scraper; normalizeListing() whitelists what we store.
    listings: v.array(v.any()),
    matches: v.array(
      v.object({ listingUrl: v.string(), orderId: v.string() }),
    ),
  },
  handler: async (ctx, args) => {
    assertSecret(args.secret);

    let listingsInserted = 0;
    let listingsSkipped = 0;
    let matchesCreated = 0;
    let matchesSkipped = 0;

    // url -> listing _id, for resolving the match pairs below without re-querying.
    const listingIdByUrl = new Map();

    for (const raw of args.listings) {
      if (!raw || typeof raw !== "object") {
        listingsSkipped++;
        continue;
      }
      const doc = normalizeListing(raw, args.source);

      if (doc.url) {
        if (listingIdByUrl.has(doc.url)) {
          // Duplicate inside this very batch (portals repeat a listing across
          // result pages).
          listingsSkipped++;
          continue;
        }
        const existing = await ctx.db
          .query("listings")
          .withIndex("by_url", (q) => q.eq("url", doc.url))
          .first();
        if (existing) {
          // SKIP rather than PATCH, deliberately. A listing row accumulates
          // downstream state the scraper does not know about — score,
          // mlitBenchmark, a status moved off "new" by a human — and a nightly
          // patch from a thin scrape payload would keep clobbering it. Price
          // changes are therefore NOT picked up on an existing url; that is the
          // accepted trade-off for not destroying enrichment every night.
          listingIdByUrl.set(doc.url, existing._id);
          listingsSkipped++;
          continue;
        }
        const id = await ctx.db.insert("listings", doc);
        listingIdByUrl.set(doc.url, id);
        listingsInserted++;
        continue;
      }

      // No url: fall back to the address+price check that listings.create uses.
      // Unindexed, but only a handful of listings per run lack a url.
      if (doc.address && doc.price != null) {
        const existing = await ctx.db
          .query("listings")
          .filter((q) =>
            q.and(
              q.eq(q.field("address"), doc.address),
              q.eq(q.field("price"), doc.price),
            ),
          )
          .first();
        if (existing) {
          listingsSkipped++;
          continue;
        }
        await ctx.db.insert("listings", doc);
        listingsInserted++;
        continue;
      }

      // Neither a url nor address+price — undedupable, so refuse it rather than
      // insert a row the next run would insert again.
      listingsSkipped++;
    }

    // Cache order lookups; a run typically matches many listings to few orders.
    const orderCache = new Map();

    for (const match of args.matches) {
      let listingId = listingIdByUrl.get(match.listingUrl);
      if (!listingId) {
        const found = await ctx.db
          .query("listings")
          .withIndex("by_url", (q) => q.eq("url", match.listingUrl))
          .first();
        if (found) {
          listingId = found._id;
          listingIdByUrl.set(match.listingUrl, found._id);
        }
      }
      if (!listingId) {
        // Its listing was rejected above (or never sent).
        matchesSkipped++;
        continue;
      }

      let order = orderCache.get(match.orderId);
      if (order === undefined) {
        const orderId = ctx.db.normalizeId("orders", match.orderId);
        order = orderId ? await ctx.db.get(orderId) : null;
        orderCache.set(match.orderId, order);
      }
      if (!order || !order.userId) {
        // Missing order, or a pre-isolation order with no owner. Inserting an
        // ownerless match would create a row no query can ever return, so skip.
        matchesSkipped++;
        continue;
      }

      const existingMatch = await ctx.db
        .query("matching")
        .withIndex("by_order", (q) => q.eq("orderId", match.orderId))
        .filter((q) => q.eq(q.field("listingId"), listingId))
        .first();
      if (existingMatch) {
        matchesSkipped++;
        continue;
      }

      await ctx.db.insert("matching", {
        // Ownership comes from the ORDER, never from the caller.
        userId: order.userId,
        orderId: match.orderId,
        listingId: listingId,
        status: "matched",
      });
      matchesCreated++;
    }

    return { listingsInserted, listingsSkipped, matchesCreated, matchesSkipped };
  },
});
