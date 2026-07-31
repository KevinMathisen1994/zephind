/**
 * Per-user access control helpers.
 *
 * Design note: these THROW rather than returning null. Every previous query was
 * an unguarded `.collect()`, so a helper that quietly returned "no user" would
 * have kept leaking the whole table on any wiring mistake. Failing loudly means a
 * misconfigured JWT surfaces as an error instead of a silent data leak.
 */

/** The Clerk user id (JWT `sub`) for the caller. Throws if unauthenticated. */
export async function requireUserId(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error(
      "未認証のリクエストです。ログインしてください。 (Not signed in — if you ARE signed in, the Clerk 'convex' JWT template or CLERK_JWT_ISSUER_DOMAIN is misconfigured; see convex/auth.config.js)",
    );
  }
  return identity.subject;
}

/**
 * Loads a document and verifies the caller owns it.
 * Used by every update/delete so one account cannot mutate another's rows by id.
 */
export async function requireOwned(ctx, table, id) {
  const userId = await requireUserId(ctx);
  const doc = await ctx.db.get(id);
  if (!doc) throw new Error(`${table} が見つかりません`);
  if (doc.userId !== userId) {
    // Same message whether it is missing or someone else's, so ids can't be probed.
    throw new Error(`${table} が見つかりません`);
  }
  return { doc, userId };
}

/** All rows in `table` owned by the caller, via the by_user index. */
export async function listOwned(ctx, table) {
  const userId = await requireUserId(ctx);
  return await ctx.db
    .query(table)
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
}
