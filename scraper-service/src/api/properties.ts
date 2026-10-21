import { Router } from "express";
import { db } from "../db";
import { listOwned, requireOwned, requireUserId } from "../auth/authz";
import { route } from "./handler";
import { PROPERTY_FIELDS, pick } from "./fields";

/**
 * Ported from convex/properties.js. Legacy/unused table, kept scoped for parity
 * so it is safe if ever revived.
 */
export const propertiesRouter = Router();

propertiesRouter.get("/", route(async (req) => listOwned(req, "properties")));

propertiesRouter.get("/:id", route(async (req) => {
  const { doc } = await requireOwned(req, "properties", req.params.id, "物件");
  return doc;
}));

propertiesRouter.post("/", route(async (req) => {
  const userId = requireUserId(req);
  const fields = pick(req.body ?? {}, PROPERTY_FIELDS);
  return db.insert("properties", {
    ...fields,
    userId,
    status: fields.status || "pending",
    enrichedAt: fields.enrichedAt || Date.now(),
  });
}));

propertiesRouter.delete("/:id", route(async (req) => {
  await requireOwned(req, "properties", req.params.id, "物件");
  await db.delete("properties", req.params.id);
  return { ok: true };
}));
