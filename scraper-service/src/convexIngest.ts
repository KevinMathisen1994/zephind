/**
 * Convex client for the headless (cron) scraper.
 *
 * The browser UI persists scrape results with the signed-in user's Clerk
 * session. A scheduled run has no session, so it talks to the secret-guarded
 * functions in convex/ingest.js instead. See that file for why they are public.
 *
 * `anyApi` is used rather than the generated `api` object because
 * scraper-service is a separate package with its own tsconfig rootDir and
 * cannot import convex/_generated without dragging the whole app build in.
 * The trade-off is that function names are not type-checked here — they are
 * validated at runtime by the deployment, and a typo fails loudly on the first
 * call rather than silently.
 */
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
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
  convexUrl: string;
  listOrdersForMatching(): Promise<IngestOrder[]>;
  ingestScrape(input: {
    source: string;
    areaCode: string;
    listings: unknown[];
    matches: IngestMatch[];
  }): Promise<IngestSummary>;
}

/**
 * Builds the ingest client, or throws with an actionable message. Deliberately
 * loud: a cron job that silently no-ops because an env var is missing looks
 * exactly like a cron job that found nothing to scrape.
 */
export function createIngestClient(): IngestClient {
  const convexUrl = process.env.CONVEX_URL || "";
  const secret = process.env.SCRAPER_INGEST_SECRET || "";

  const missing: string[] = [];
  if (!convexUrl) missing.push("CONVEX_URL (e.g. https://<deployment>.convex.cloud)");
  if (!secret) missing.push("SCRAPER_INGEST_SECRET (must equal the value set via `npx convex env set SCRAPER_INGEST_SECRET ...`)");
  if (missing.length > 0) {
    throw new Error(
      `Cannot reach Convex — missing environment variable(s):\n  - ${missing.join("\n  - ")}`,
    );
  }

  const client = new ConvexHttpClient(convexUrl);

  return {
    convexUrl,
    async listOrdersForMatching() {
      return (await client.query(anyApi.ingest.listOrdersForMatching, {
        secret,
      })) as IngestOrder[];
    },
    async ingestScrape(input) {
      return (await client.mutation(anyApi.ingest.ingestScrape, {
        secret,
        source: input.source,
        areaCode: input.areaCode,
        listings: input.listings,
        matches: input.matches,
      })) as IngestSummary;
    },
  };
}
