/**
 * Ingest client for the headless (cron) scraper.
 *
 * The browser UI persists scrape results with the signed-in user's Clerk
 * session. A scheduled run has no session, so it talks to the secret-guarded
 * /api/ingest routes instead. See src/api/ingest.ts for why they exist.
 *
 * This runs on a GitHub Actions runner, not inside this service, so it reaches
 * the backend over HTTP even though the routes live in the same repo.
 */
import dotenv from "dotenv";

dotenv.config();

export interface IngestOrder {
  _id: string;
  userId?: string;
  name?: string;
  ward?: string;
  wards?: string[];
  criteria?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface IngestMatch {
  listingUrl: string;
  orderId: string;
}

export interface IngestSummary {
  listingsInserted: number;
  listingsSkipped: number;
  matchesCreated: number;
  matchesSkipped: number;
  /** Why matches were skipped — duplicate vs unownable vs listing rejected. */
  matchSkipReasons?: {
    duplicate?: number;
    noOwner?: number;
    listingRejected?: number;
  };
}

export interface IngestClient {
  backendUrl: string;
  listOrdersForMatching(): Promise<IngestOrder[]>;
  ingestScrape(input: {
    source: string;
    areaCode: string;
    listings: unknown[];
    matches: IngestMatch[];
  }): Promise<IngestSummary>;
  updateProgress(input: {
    source: string;
    orderId?: string;
    statusText?: string;
  }): Promise<void>;
  /** Of `urls`, those not yet stored — i.e. the ones worth a 掲載日 lookup. */
  unknownListingUrls(urls: string[]): Promise<string[]>;
  /** Stamp "who searched, and when" on the orders a run covered. */
  markScrapeRun(input: { orderIds: string[]; triggeredBy: string }): Promise<void>;
  /** Stored listings that still have no 掲載日, for the backfill pass. */
  listingsMissingPostedDate(input: {
    limit: number;
    sources?: string[];
  }): Promise<{ listingId: string; url: string; source: string }[]>;
  /** Write backfilled 掲載日 onto existing listings. */
  savePostedDates(
    updates: { listingId: string; postedAt: number; postedDateKind?: string }[],
  ): Promise<number>;
}

/**
 * Builds the ingest client, or throws with an actionable message. Deliberately
 * loud: a cron job that silently no-ops because an env var is missing looks
 * exactly like a cron job that found nothing to scrape.
 */
export function createIngestClient(): IngestClient {
  const backendUrl = (process.env.BACKEND_URL || "").replace(/\/$/, "");
  const secret = process.env.SCRAPER_INGEST_SECRET || "";

  const missing: string[] = [];
  if (!backendUrl) missing.push("BACKEND_URL (e.g. https://zephind-api.example.com)");
  if (!secret) missing.push("SCRAPER_INGEST_SECRET (must equal the value set on the backend)");
  if (missing.length > 0) {
    throw new Error(
      `Cannot reach the backend — missing environment variable(s):\n  - ${missing.join("\n  - ")}`,
    );
  }

  async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${backendUrl}/api/ingest${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, ...body }),
    });
    const raw = await res.text();
    let parsed: any;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      // An HTML error page from a proxy in front of the backend, most often.
      throw new Error(`POST ${path} returned non-JSON (HTTP ${res.status}): ${raw.slice(0, 300)}`);
    }
    if (!res.ok) throw new Error(`POST ${path} failed (HTTP ${res.status}): ${parsed?.error ?? raw.slice(0, 300)}`);
    return parsed as T;
  }

  return {
    backendUrl,
    listOrdersForMatching() {
      return post<IngestOrder[]>("/orders-for-matching", {});
    },
    ingestScrape(input) {
      return post<IngestSummary>("/scrape", {
        source: input.source,
        areaCode: input.areaCode,
        listings: input.listings,
        matches: input.matches,
      });
    },
    async unknownListingUrls(urls) {
      // The route refuses more than 300 per call, so chunk here rather than at
      // every call site.
      const CHUNK = 200;
      const unknown: string[] = [];
      for (let i = 0; i < urls.length; i += CHUNK) {
        unknown.push(...(await post<string[]>("/unknown-listing-urls", { urls: urls.slice(i, i + CHUNK) })));
      }
      return unknown;
    },
    async markScrapeRun(input) {
      const CHUNK = 100; // the route refuses more than this per call
      // One timestamp for the whole run, so every order it covered reports the
      // same 最終検索 rather than drifting by chunk.
      const at = Date.now();
      for (let i = 0; i < input.orderIds.length; i += CHUNK) {
        await post("/mark-scrape-run", {
          orderIds: input.orderIds.slice(i, i + CHUNK),
          triggeredBy: input.triggeredBy,
          at,
        });
      }
    },
    listingsMissingPostedDate(input) {
      return post("/listings-missing-posted-date", { limit: input.limit, sources: input.sources });
    },
    async savePostedDates(updates) {
      const CHUNK = 200; // the route refuses more than this per call
      let updated = 0;
      for (let i = 0; i < updates.length; i += CHUNK) {
        const result = await post<{ updated: number }>("/save-posted-dates", {
          updates: updates.slice(i, i + CHUNK),
        });
        updated += result?.updated ?? 0;
      }
      return updated;
    },
    async updateProgress(input) {
      try {
        await post("/progress", {
          source: input.source,
          orderId: input.orderId,
          statusText: input.statusText,
        });
      } catch {
        /* non-fatal progress update error */
      }
    },
  };
}
