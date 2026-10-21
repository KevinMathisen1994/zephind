/**
 * Per-user proposal-mail signature. Ported from convex/emailSettings.js.
 *
 * Sending is not configured here: the proposal modal opens the user's own mail
 * client (mailto:) with subject/body prefilled, so there is no server send path.
 */
import { Router } from "express";
import { db } from "../db";
import { requireUserId } from "../auth/authz";
import { route } from "./handler";

export const emailSettingsRouter = Router();

emailSettingsRouter.get("/", route(async (req) => {
  const userId = requireUserId(req);
  return db.first("emailSettings", { where: { userId } });
}));

emailSettingsRouter.put("/", route(async (req) => {
  const userId = requireUserId(req);
  const fields = { signature: req.body?.signature, updatedAt: Date.now() };
  const existing = await db.first("emailSettings", { where: { userId } });
  if (existing) {
    await db.patch("emailSettings", existing._id, fields);
    return existing._id;
  }
  return db.insert("emailSettings", { ...fields, userId });
}));
