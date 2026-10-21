import { supabase } from "./supabase";

/**
 * Thin Convex-shaped wrapper over supabase-js.
 *
 * The ported backend was written against `ctx.db.get/insert/patch/replace/delete`
 * and index-scoped queries. Keeping those names (and returning rows that already
 * carry `_id`/`_creationTime`, see supabase/migrations/0001_init.sql) is what lets
 * the port stay mechanical instead of a rewrite of every call site.
 */

export type Doc = Record<string, any> & { _id: string; _creationTime: number };

function unwrap<T>(res: { data: T | null; error: any }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

/**
 * PostgREST puts `in.(...)` filters in the URL, so one request per N values,
 * batched by total character length rather than count — ids are ~33 chars but
 * listing urls can be 200+, and a single budget covers both. 4000 leaves room
 * for the rest of the query string under the usual 8KB request-line limit.
 *
 * This is why it exists at all: the Orders page asks for every matched
 * listing's id in one call (thousands of them), which as a single filter is a
 * 100KB URL and a flat 400 from PostgREST.
 */
const URL_FILTER_BUDGET = 4000;

function chunkByLength(values: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const v of values) {
    const cost = v.length + 3; // the value plus its quoting and separator
    if (current.length > 0 && length + cost > URL_FILTER_BUDGET) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(v);
    length += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * `select ... where <column> in (...)`, split across as many requests as the URL
 * length needs. Results are concatenated; order is not guaranteed.
 */
export async function selectIn(
  table: string,
  columns: string,
  column: string,
  values: string[],
): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  for (const chunk of chunkByLength(values)) {
    const res = await supabase.from(table).select(columns).in(column, chunk);
    out.push(...((unwrap(res, `selectIn ${table}.${column}`) as Record<string, any>[]) ?? []));
  }
  return out;
}

/** One row by id, or null. Mirrors ctx.db.get. */
export async function get(table: string, id: string | undefined | null): Promise<Doc | null> {
  if (!id) return null;
  const res = await supabase.from(table).select("*").eq("_id", id).maybeSingle();
  return unwrap(res, `get ${table}`) as Doc | null;
}

/** Several rows by id, in the order asked, nulls preserved. Avoids N round trips. */
export async function getMany(table: string, ids: (string | null | undefined)[]): Promise<(Doc | null)[]> {
  const wanted = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (wanted.length === 0) return ids.map(() => null);
  const rows = (await selectIn(table, "*", "_id", wanted)) as Doc[];
  const byId = new Map(rows.map((r) => [r._id, r]));
  return ids.map((i) => (i ? byId.get(i) ?? null : null));
}

export type Where = Record<string, any>;

export interface ListOpts {
  /** Equality filters, ANDed. A null value matches SQL NULL. */
  where?: Where;
  order?: { by: string; desc?: boolean };
  limit?: number;
  offset?: number;
}

/** Equality-filtered scan. Mirrors ctx.db.query(...).withIndex(...).collect(). */
export async function list(table: string, opts: ListOpts = {}): Promise<Doc[]> {
  let q = supabase.from(table).select("*");
  for (const [col, val] of Object.entries(opts.where ?? {})) {
    q = val === null ? q.is(col, null) : q.eq(col, val);
  }
  if (opts.order) q = q.order(opts.order.by, { ascending: !opts.order.desc, nullsFirst: false });
  if (opts.limit != null) {
    const from = opts.offset ?? 0;
    q = q.range(from, from + opts.limit - 1);
  }
  const res = await q;
  return (unwrap(res, `list ${table}`) as Doc[]) ?? [];
}

/** First match or null. Mirrors ctx.db.query(...).unique()/first(). */
export async function first(table: string, opts: ListOpts = {}): Promise<Doc | null> {
  const rows = await list(table, { ...opts, limit: 1 });
  return rows[0] ?? null;
}

export async function count(table: string, where: Where = {}): Promise<number> {
  let q = supabase.from(table).select("_id", { count: "exact", head: true });
  for (const [col, val] of Object.entries(where)) {
    q = val === null ? q.is(col, null) : q.eq(col, val);
  }
  const res = await q;
  if (res.error) throw new Error(`count ${table}: ${res.error.message}`);
  return res.count ?? 0;
}

/** Inserts and returns the new id. Mirrors ctx.db.insert. */
export async function insert(table: string, doc: Record<string, any>): Promise<string> {
  const res = await supabase.from(table).insert(strip(doc)).select("_id").single();
  return (unwrap(res, `insert ${table}`) as { _id: string })._id;
}

/** Bulk insert, returning new ids in input order. */
export async function insertMany(table: string, docs: Record<string, any>[]): Promise<string[]> {
  if (docs.length === 0) return [];
  const res = await supabase.from(table).insert(docs.map(strip)).select("_id");
  return (unwrap(res, `insertMany ${table}`) as { _id: string }[]).map((r) => r._id);
}

/** Shallow merge into an existing row. Mirrors ctx.db.patch. */
export async function patch(table: string, id: string, fields: Record<string, any>): Promise<void> {
  const res = await supabase.from(table).update(strip(fields)).eq("_id", id).select("_id");
  unwrap(res, `patch ${table}`);
}

/** Patch every row matching `where`. Returns the number of rows touched. */
export async function patchWhere(table: string, where: Where, fields: Record<string, any>): Promise<number> {
  let q = supabase.from(table).update(strip(fields));
  for (const [col, val] of Object.entries(where)) {
    q = val === null ? q.is(col, null) : q.eq(col, val);
  }
  const res = await q.select("_id");
  return (unwrap(res, `patchWhere ${table}`) as { _id: string }[]).length;
}

export async function remove(table: string, id: string): Promise<void> {
  const res = await supabase.from(table).delete().eq("_id", id).select("_id");
  unwrap(res, `delete ${table}`);
}

export async function removeMany(table: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  let deleted = 0;
  for (const chunk of chunkByLength(ids)) {
    const res = await supabase.from(table).delete().in("_id", chunk).select("_id");
    deleted += (unwrap(res, `deleteMany ${table}`) as { _id: string }[]).length;
  }
  return deleted;
}

export async function removeWhere(table: string, where: Where): Promise<number> {
  let q = supabase.from(table).delete();
  for (const [col, val] of Object.entries(where)) {
    q = val === null ? q.is(col, null) : q.eq(col, val);
  }
  const res = await q.select("_id");
  return (unwrap(res, `deleteWhere ${table}`) as { _id: string }[]).length;
}

/**
 * Convex ignored `undefined` fields on patch; Postgres would write NULL and wipe
 * a column the caller never meant to touch. `_id`/`_creationTime` are dropped so
 * a round-tripped doc can be re-inserted without colliding.
 */
function strip(doc: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (v === undefined) continue;
    if (k === "_id" || k === "_creationTime") continue;
    out[k] = v;
  }
  return out;
}

export const db = {
  get, getMany, selectIn, list, first, count,
  insert, insertMany, patch, patchWhere,
  delete: remove, deleteMany: removeMany, deleteWhere: removeWhere,
  raw: supabase,
};
