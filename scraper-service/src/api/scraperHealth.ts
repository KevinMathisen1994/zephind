import { Router } from "express";
import { db } from "../db";
import { requireUserId } from "../auth/authz";
import { route } from "./handler";

/** Ported from convex/scraperHealth.js. */
export const scraperHealthRouter = Router();

scraperHealthRouter.get("/", route(async () => db.list("scraperHealth")));

/**
 * Upsert by source: the board wants each scraper's CURRENT status, not an
 * ever-growing audit log.
 */
scraperHealthRouter.post("/", route(async (req) => {
  // Readable by all, writable only by a signed-in user.
  requireUserId(req);
  const b = req.body ?? {};
  if (!b.source || !b.status || typeof b.checkedAt !== "number") {
    throw new Error("source, status and checkedAt are required");
  }
  const fields = {
    source: b.source, label: b.label, status: b.status,
    listingCount: b.listingCount, durationMs: b.durationMs, areaCode: b.areaCode,
    checkedAt: b.checkedAt, issues: b.issues, coverage: b.coverage,
    sample: b.sample, error: b.error,
  };
  const existing = await db.first("scraperHealth", { where: { source: b.source } });
  if (existing) {
    await db.patch("scraperHealth", existing._id, fields);
    return existing._id;
  }
  return db.insert("scraperHealth", fields);
}));
