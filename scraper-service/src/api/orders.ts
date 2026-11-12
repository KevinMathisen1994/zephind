import { Router } from "express";
import { db } from "../db";
import { HttpError, listOwned, requireOwned, requireUserId } from "../auth/authz";
import { route } from "./handler";
import { ORDER_FIELDS, pick } from "./fields";
import { hardFilter, toCriteria } from "../services/propertyMatcher";
import type { PropertyListing } from "../types";

/** Ported from convex/orders.js. */
export const ordersRouter = Router();

ordersRouter.get("/", route(async (req) => listOwned(req, "orders")));

ordersRouter.get("/:id", route(async (req) => {
  const { doc } = await requireOwned(req, "orders", req.params.id, "オーダー");
  return doc;
}));

ordersRouter.post("/", route(async (req) => {
  // userId comes from the verified JWT and any client-supplied value is
  // discarded — otherwise a caller could create rows owned by someone else.
  const userId = requireUserId(req);
  const fields = pick(req.body ?? {}, ORDER_FIELDS);
  return db.insert("orders", {
    ...fields,
    userId,
    status: fields.status || "pending",
  });
}));

ordersRouter.patch("/:id", route(async (req) => {
  // Ownership check first: without it any signed-in user could patch any order
  // by guessing its id.
  const { userId } = await requireOwned(req, "orders", req.params.id, "オーダー");
  await db.patch("orders", req.params.id, pick(req.body ?? {}, ORDER_FIELDS));
  const removedMatches = await pruneMatches(req.params.id, userId);
  return { ok: true, removedMatches };
}));

ordersRouter.delete("/:id", route(async (req) => {
  await requireOwned(req, "orders", req.params.id, "オーダー");
  // Cascade (matches, then listings no other order still references) runs in
  // one transaction server-side — see supabase/migrations/0002_rpc.sql. Doing
  // it as separate calls from here would leave orphans on a mid-way failure,
  // which is exactly what the Convex mutation prevented.
  const { error } = await db.raw.rpc("delete_order", { p_order_id: req.params.id });
  if (error) throw new HttpError(500, `delete_order: ${error.message}`);
  return { ok: true };
}));

const PAGE = 1000; // PostgREST max-rows

/** Delete this order's matches whose listing no longer passes the order's (edited) criteria. */
async function pruneMatches(orderId: string, userId: string): Promise<number> {
  const order = await db.get("orders", orderId);
  if (!order) return 0;
  const criteria = [toCriteria(order)];
  const stale: string[] = [];
  // Ordered by _id so offset paging is stable.
  for (let offset = 0; ; offset += PAGE) {
    const page = await db.list("matching", { where: { orderId, userId }, order: { by: "_id" }, limit: PAGE, offset });
    // Missing listing: nothing to judge, the row stays.
    const listings = (await db.getMany("listings", page.map((m) => m.listingId))).filter(Boolean);
    const failed = new Set(
      hardFilter(listings as unknown as PropertyListing[], criteria).failed.map((l) => (l as any)._id),
    );
    for (const m of page) if (failed.has(m.listingId)) stale.push(m._id);
    if (page.length < PAGE) break;
  }
  return stale.length ? db.deleteMany("matching", stale) : 0;
}
