import { Router } from "express";
import { db } from "../db";
import { HttpError, listOwned, requireOwned, requireUserId } from "../auth/authz";
import { route } from "./handler";

/** Ported from convex/matching.js. */
export const matchingRouter = Router();

// Lists are the newest 1000 rows (PostgREST max-rows); counts come from /summary.
matchingRouter.get("/", route(async (req) => listOwned(req, "matching")));

/** Per-order totals: { orderId, total, new24h, high, new24hHigh }[]. */
matchingRouter.get("/summary", route(async (req) => {
  const userId = requireUserId(req);
  const { data, error } = await db.raw.rpc("matching_summary", { p_user_id: userId });
  if (error) throw new HttpError(500, `matching summary: ${error.message}`);
  // bigint arrives as string from PostgREST.
  return (data ?? []).map((r: Record<string, unknown>) => ({
    orderId: r.orderId,
    total: Number(r.total),
    new24h: Number(r.new24h),
    high: Number(r.high),
    new24hHigh: Number(r.new24hHigh),
  }));
}));

matchingRouter.get("/by-order/:orderId", route(async (req) => {
  // The caller must own the parent ORDER.
  const { userId } = await requireOwned(req, "orders", req.params.orderId, "オーダー");
  // Second filter on the match's own userId: matching.orderId is a plain string
  // column, so owning the order alone would not stop a legacy or mis-owned row
  // from leaking through.
  return db.list("matching", {
    where: { orderId: req.params.orderId, userId },
    order: { by: "_creationTime", desc: true },
  });
}));

matchingRouter.get("/by-listing/:listingId", route(async (req) => {
  const userId = requireUserId(req);
  return db.list("matching", { where: { listingId: req.params.listingId, userId } });
}));

matchingRouter.post("/", route(async (req) => {
  const userId = requireUserId(req);
  const { orderId, listingId, score, status } = req.body ?? {};
  // Idempotent per (order, listing), scoped to the caller — unscoped, the
  // lookup could hand out another account's match id.
  if (orderId && listingId) {
    const existing = await db.first("matching", { where: { orderId, listingId, userId } });
    if (existing) return existing._id;
  }
  return db.insert("matching", {
    orderId, listingId, score,
    userId,
    status: status || "pending",
  });
}));

/** evaluation | score | scoreDetail, one patch each, all ownership-checked. */
for (const field of ["evaluation", "score", "scoreDetail"] as const) {
  matchingRouter.patch(`/:id/${field}`, route(async (req) => {
    await requireOwned(req, "matching", req.params.id, "マッチング");
    if (req.body?.[field] === undefined) throw new Error(`${field} is required`);
    await db.patch("matching", req.params.id, { [field]: req.body[field] });
    return { ok: true };
  }));
}

matchingRouter.delete("/:id", route(async (req) => {
  await requireOwned(req, "matching", req.params.id, "マッチング");
  await db.delete("matching", req.params.id);
  return { ok: true };
}));
