/**
 * Imports a Convex snapshot export into Supabase.
 *
 *   npx convex export --path ./convex-snapshot
 *   node scraper-service/scripts/import-convex-snapshot.mjs ./convex-export
 *
 * It lives under scraper-service because that is the package holding
 * @supabase/supabase-js, and Node resolves imports from the script's own
 * directory rather than the working directory.
 *
 * `--path` is required, and a path with no .zip extension exports a directory
 * rather than a zip, which is what this script reads. The export defaults to the
 * DEV deployment; this project's app pointed at dev (earnest-sturgeon-124), so
 * that default is the one with the data. Add `--prod` only if a production
 * deployment also holds rows worth keeping.
 *
 * A Convex export lays each table out as <table>/documents.jsonl, one JSON
 * document per line, each carrying `_id` and `_creationTime`. The Postgres
 * schema keeps those exact column names (see supabase/migrations/0001_init.sql),
 * so a document maps to a row without renaming anything — and the old opaque
 * Convex ids carry over, which is what keeps every stored cross-table reference
 * (matching.orderId, savedListings.listingId, ...) pointing at the right row.
 *
 * Idempotent: rows are upserted on `_id`, so a re-run after a partial failure
 * resumes rather than duplicating.
 */
import { createClient } from "@supabase/supabase-js";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

const root = process.argv[2];
if (!root) {
  console.error("Usage: node scraper-service/scripts/import-convex-snapshot.mjs <unzipped-export-dir>");
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

/**
 * Columns typed `text[]` in Postgres. Everything else that is an array or
 * object goes to jsonb, which supabase-js serialises correctly on its own; a
 * text[] column would choke on a JS array of objects, so only genuine string
 * lists are listed here.
 */
const TEXT_ARRAY_COLUMNS = new Set([
  "images", "wards", "propertyTypes", "structureTypes", "layoutTypes",
  "aiStrengths", "aiWeaknesses", "strengths", "weaknesses", "issues",
  "requiredKeywords", "blockedKeywords", "allowedSenders", "blockedSenders",
]);

/** Tables the schema defines. A table in the export but not here is reported, not guessed at. */
const TABLES = [
  "listings", "orders", "properties", "proposals", "users", "savedSearches",
  "historicalData", "placesCache", "criteria", "evaluations", "enrichment",
  "market", "matching", "propertySources", "tourism", "mlitEnrichment",
  "ingestEvents", "customers", "deals", "savedListings", "emailSettings",
  "mailAccounts", "mailIngestSettings", "oauthStates", "scraperHealth",
];

function normalizeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue;
    // Convex system fields other than the two the schema keeps.
    if (k.startsWith("_") && k !== "_id" && k !== "_creationTime") continue;
    if (Array.isArray(v) && !TEXT_ARRAY_COLUMNS.has(k) && v.some((e) => e !== null && typeof e === "object")) {
      out[k] = v; // jsonb
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function importTable(table) {
  const file = join(root, table, "documents.jsonl");
  try {
    await stat(file);
  } catch {
    return { table, skipped: "no documents.jsonl in export" };
  }

  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let batch = [];
  let inserted = 0;
  const errors = [];

  // Batched because a per-row round trip over 1,200+ listings is minutes of
  // pure latency.
  const BATCH = 500;
  const flush = async () => {
    if (batch.length === 0) return;
    const { error } = await supabase.from(table).upsert(batch, { onConflict: "_id" });
    if (error) errors.push(error.message);
    else inserted += batch.length;
    batch = [];
  };

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    batch.push(normalizeRow(JSON.parse(trimmed)));
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  return { table, inserted, errors: errors.slice(0, 3) };
}

const present = new Set(
  (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name),
);
const unknown = [...present].filter((t) => !TABLES.includes(t));
if (unknown.length > 0) {
  console.warn(`Export holds tables the schema does not define, skipping: ${unknown.join(", ")}`);
}

// Order matters only for readability here — there are no foreign keys, by
// design: cross-table references are plain text ids, exactly as Convex had them.
for (const table of TABLES) {
  const result = await importTable(table);
  console.log(JSON.stringify(result));
}
