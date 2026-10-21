import { Router } from "express";
import { db } from "../db";
import { listOwned, requireOwned, requireUserId } from "../auth/authz";
import { route } from "./handler";
import { CUSTOMER_FIELDS, pick } from "./fields";

/** Ported from convex/customers.js. */
export const customersRouter = Router();

customersRouter.get("/", route(async (req) => listOwned(req, "customers")));

customersRouter.get("/:id", route(async (req) => {
  const { doc } = await requireOwned(req, "customers", req.params.id, "顧客");
  return doc;
}));

customersRouter.post("/", route(async (req) => {
  const userId = requireUserId(req);
  const fields = pick(req.body ?? {}, CUSTOMER_FIELDS);
  if (!fields.name) throw new Error("name is required");
  return db.insert("customers", { ...fields, userId, createdAt: Date.now() });
}));

customersRouter.patch("/:id", route(async (req) => {
  await requireOwned(req, "customers", req.params.id, "顧客");
  await db.patch("customers", req.params.id, pick(req.body ?? {}, CUSTOMER_FIELDS));
  return { ok: true };
}));

customersRouter.delete("/:id", route(async (req) => {
  await requireOwned(req, "customers", req.params.id, "顧客");
  await db.delete("customers", req.params.id);
  return { ok: true };
}));
