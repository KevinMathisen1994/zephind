import { Router } from "express";
import { db } from "../db";
import { requireUserId } from "../auth/authz";
import { route } from "./handler";

/**
 * Ported from convex/listings.js.
 *
 * Reads stay shared by design (scraped portal data is common infrastructure);
 * writes require a signed-in caller. Shared is not the same as unauthenticated.
 */
export const listingsRouter = Router();

const LISTING_FIELDS = [
  "address", "ward", "price", "area", "buildYear", "source", "status", "url",
  "description", "title", "rooms", "layout", "station", "walkMinutes",
  "buildingCoverageRatio", "floorAreaRatio", "propertyType",
  "structure", "structureType", "totalUnits", "floor", "elevators",
  "roadWidth", "frontage", "yield",
] as const;

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

listingsRouter.get("/", route(async (req) => {
  const ward = typeof req.query.ward === "string" ? req.query.ward : undefined;
  const priceMin = num(req.query.priceMin);
  const priceMax = num(req.query.priceMax);
  const limit = Math.min(num(req.query.limit) || 1000, 8000);

  let q = db.raw.from("listings").select("*");
  if (ward) q = q.eq("ward", ward);
  // Price bounds were applied client-side in Convex because the index was on
  // ward; Postgres can do both, so they move into the query and stop the 8000
  // row ceiling from being spent on rows that are filtered out anyway.
  if (priceMin != null) q = q.or(`price.is.null,price.gte.${priceMin}`);
  if (priceMax != null) q = q.or(`price.is.null,price.lte.${priceMax}`);
  const { data, error } = await q.limit(limit);
  if (error) throw new Error(`list listings: ${error.message}`);
  return data ?? [];
}));

listingsRouter.post("/by-ids", route(async (req) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (ids.length === 0) return [];
  const rows = await db.getMany("listings", ids);
  return rows.filter(Boolean);
}));

listingsRouter.get("/by-url", route(async (req) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  if (!url) throw new Error("url is required");
  return db.first("listings", { where: { url } });
}));

listingsRouter.get("/:id", route(async (req) => db.get("listings", req.params.id)));

listingsRouter.post("/", route(async (req) => {
  requireUserId(req);
  const fields: Record<string, any> = {};
  for (const k of LISTING_FIELDS) if (req.body?.[k] !== undefined) fields[k] = req.body[k];

  // Idempotent: skip if same address+price exists (area varies between agents).
  if (fields.address && fields.price) {
    const existing = await db.first("listings", {
      where: { address: fields.address, price: fields.price },
    });
    if (existing) return existing._id;
  }
  return db.insert("listings", {
    ...fields,
    status: fields.status || "new",
    source: fields.source || "manual",
  });
}));

listingsRouter.patch("/:id", route(async (req) => {
  requireUserId(req);
  const fields: Record<string, any> = {};
  for (const k of LISTING_FIELDS) if (req.body?.[k] !== undefined) fields[k] = req.body[k];
  await db.patch("listings", req.params.id, fields);
  return { ok: true };
}));

listingsRouter.delete("/:id", route(async (req) => {
  requireUserId(req);
  await db.delete("listings", req.params.id);
  return { ok: true };
}));
