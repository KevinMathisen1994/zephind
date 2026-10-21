/**
 * 保存物件 — per-user shortlist. Ported from convex/savedListings.js.
 *
 * Each save copies the fields the UI shows rather than storing only a
 * listingId: `listings` is shared, disposable inventory that order deletion
 * cleans up, so an id-only shortlist would rot into blank rows for exactly the
 * properties someone cared enough to save.
 */
import { Router } from "express";
import { db } from "../db";
import { listOwned, requireOwned, requireUserId } from "../auth/authz";
import { route } from "./handler";
import { SAVED_LISTING_FIELDS, pick } from "./fields";

export const savedListingsRouter = Router();

savedListingsRouter.get("/", route(async (req) => {
  const rows = await listOwned(req, "savedListings");
  return rows.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}));

// Just the ids, for star state in a long results list — the Orders page has no
// use for every snapshot field.
savedListingsRouter.get("/ids", route(async (req) => {
  const rows = await listOwned(req, "savedListings");
  return rows.map((row) => row.listingId).filter(Boolean);
}));

/** Star / unstar in one call; idempotent per (user, listing). */
savedListingsRouter.post("/toggle", route(async (req) => {
  const userId = requireUserId(req);
  const fields = pick(req.body ?? {}, SAVED_LISTING_FIELDS);
  if (!fields.listingId) throw new Error("listingId が必要です");

  const existing = await db.first("savedListings", {
    where: { userId, listingId: fields.listingId },
  });
  if (existing) {
    await db.delete("savedListings", existing._id);
    return { saved: false };
  }
  await db.insert("savedListings", { ...fields, userId, savedAt: Date.now() });
  return { saved: true };
}));

savedListingsRouter.patch("/:id/note", route(async (req) => {
  await requireOwned(req, "savedListings", req.params.id, "保存物件");
  const note = req.body?.note;
  if (typeof note !== "string") throw new Error("note is required");
  await db.patch("savedListings", req.params.id, { note });
  return { ok: true };
}));

savedListingsRouter.delete("/:id", route(async (req) => {
  await requireOwned(req, "savedListings", req.params.id, "保存物件");
  await db.delete("savedListings", req.params.id);
  return { ok: true };
}));
