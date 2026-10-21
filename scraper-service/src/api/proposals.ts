import { Router } from "express";
import { db } from "../db";
import { listOwned, requireOwned, requireUserId } from "../auth/authz";
import { route } from "./handler";
import { PROPOSAL_FIELDS, pick } from "./fields";

/** Ported from convex/proposals.js. */
export const proposalsRouter = Router();

proposalsRouter.get("/", route(async (req) => listOwned(req, "proposals")));

proposalsRouter.get("/:id", route(async (req) => {
  const { doc } = await requireOwned(req, "proposals", req.params.id, "提案");
  return doc;
}));

proposalsRouter.post("/", route(async (req) => {
  const userId = requireUserId(req);
  const fields = pick(req.body ?? {}, PROPOSAL_FIELDS);
  return db.insert("proposals", { ...fields, userId, status: fields.status || "draft" });
}));

proposalsRouter.delete("/:id", route(async (req) => {
  await requireOwned(req, "proposals", req.params.id, "提案");
  await db.delete("proposals", req.params.id);
  return { ok: true };
}));
