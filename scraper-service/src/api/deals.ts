import { Router } from "express";
import { db } from "../db";
import { requireOwned, requireUserId } from "../auth/authz";
import { route } from "./handler";
import { DEAL_FIELDS, pick } from "./fields";

/** Ported from convex/deals.js. */
export const dealsRouter = Router();

// Newest first, so this is not listOwned().
dealsRouter.get("/", route(async (req) => {
  const userId = requireUserId(req);
  return db.list("deals", { where: { userId }, order: { by: "_creationTime", desc: true } });
}));

dealsRouter.get("/:id", route(async (req) => {
  const { doc } = await requireOwned(req, "deals", req.params.id, "案件");
  return doc;
}));

dealsRouter.post("/", route(async (req) => {
  const userId = requireUserId(req);
  const fields = pick(req.body ?? {}, DEAL_FIELDS);
  if (!fields.title) throw new Error("title is required");
  const now = Date.now();

  // Dedup, scoped to the caller's own deals: a matching title in another
  // account must not be treated as "our" duplicate and patched with this
  // caller's data.
  if (fields.orderId || fields.customerId || fields.title) {
    const recent = await db.list("deals", { where: { userId, status: "proposed" } });
    const duplicate = recent.find((d) => {
      const sameOrderCust =
        fields.orderId && fields.customerId &&
        d.orderId === fields.orderId && d.customerId === fields.customerId;
      const sameTitle = d.title === fields.title;
      const isRecent = now - (d.createdAt || 0) < 10 * 60 * 1000;
      return (sameOrderCust || sameTitle) && isRecent;
    });
    if (duplicate) {
      await db.patch("deals", duplicate._id, { ...fields, updatedAt: now });
      return duplicate._id;
    }
  }

  return db.insert("deals", {
    ...fields,
    userId,
    status: fields.status || "proposed",
    createdAt: now,
    updatedAt: now,
  });
}));

dealsRouter.patch("/:id/status", route(async (req) => {
  await requireOwned(req, "deals", req.params.id, "案件");
  const status = req.body?.status;
  if (typeof status !== "string") throw new Error("status is required");
  await db.patch("deals", req.params.id, { status, updatedAt: Date.now() });
  return { ok: true };
}));

dealsRouter.delete("/:id", route(async (req) => {
  await requireOwned(req, "deals", req.params.id, "案件");
  await db.delete("deals", req.params.id);
  return { ok: true };
}));
