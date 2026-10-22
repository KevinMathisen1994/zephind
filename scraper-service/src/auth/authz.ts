import type { Request } from "express";
import { db, type Doc } from "../db";

/**
 * Per-user access control, ported from convex/lib/authz.js.
 *
 * These THROW rather than returning null, for the same reason they did there:
 * a helper that quietly returned "no user" would keep leaking whole tables on a
 * wiring mistake. A misconfigured JWT should surface as an error, not silence.
 */

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** The Clerk user id (JWT `sub`) for the caller. Throws if unauthenticated. */
export function requireUserId(req: Request): string {
  const sub = req.identity?.subject;
  if (!sub) throw new HttpError(401, "未認証のリクエストです。ログインしてください。");
  return sub;
}

/**
 * Loads a row and verifies the caller owns it. Used by every update/delete.
 *
 * `table` is the real table; `label` is what the user sees. They are separate
 * because a Convex id encoded its own table, so the Convex version took only
 * the Japanese label — passing that as a table name here queries
 * `public.オーダー`, which does not exist.
 */
export async function requireOwned(
  req: Request,
  table: string,
  id: string,
  label: string = table,
): Promise<{ doc: Doc; userId: string }> {
  const userId = requireUserId(req);
  const doc = await db.get(table, id);
  // Same message whether it is missing or someone else's, so ids can't be probed.
  if (!doc || doc.userId !== userId) throw new HttpError(404, `${label} が見つかりません`);
  return { doc, userId };
}

/** All rows in `table` owned by the caller. */
export async function listOwned(req: Request, table: string): Promise<Doc[]> {
  const userId = requireUserId(req);
  // Newest first, and stable: without an ORDER BY Postgres returns rows in heap
  // order, which shifts after every UPDATE and made lists reshuffle on refetch.
  return db.list(table, { where: { userId }, order: { by: "_creationTime", desc: true } });
}
