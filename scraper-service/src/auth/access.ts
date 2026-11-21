/**
 * Email allowlist for signing in. Admins (ADMIN_EMAILS env) are always allowed and manage the list.
 * Not enforced while the list is empty, so deploying this locks nobody out.
 * Needs the Clerk session token to carry `email` (Clerk dashboard → Sessions → Customize session token).
 */
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { db } from "../db";
import { HttpError, requireUserId } from "./authz";
import { route } from "../api/handler";

const CACHE_MS = 30_000;
let cache: { at: number; emails: Set<string> } | null = null;

const adminEmails = () =>
  (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export const isAdmin = (email?: string | null) => !!email && adminEmails().includes(email.toLowerCase());

async function allowlist(): Promise<Set<string>> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const rows = await db.list("allowedEmails");
    cache = { at: Date.now(), emails: new Set(rows.map((r) => String(r.email).toLowerCase())) };
  }
  return cache.emails;
}

export async function isAllowed(email?: string | null): Promise<boolean> {
  const list = await allowlist();
  if (list.size === 0) return true;
  if (!email) return false;
  return isAdmin(email) || list.has(email.toLowerCase());
}

/** Rejects signed-in callers not on the list. Unauthenticated requests pass through to each route's own check. */
export async function enforceAllowlist(req: Request, res: Response, next: NextFunction) {
  // /api/access/me must answer for blocked users so the UI can show why.
  if (!req.identity || req.path === "/api/access/me") return next();
  try {
    if (await isAllowed(req.identity.email)) return next();
    res.status(403).json({ error: "このアカウントにはアクセス権がありません。管理者に連絡してください。", code: "not_allowed" });
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req: Request) {
  requireUserId(req);
  if (!isAdmin(req.identity?.email)) throw new HttpError(403, "管理者のみ操作できます");
}

export const accessRouter = Router();

accessRouter.get("/me", route(async (req) => {
  requireUserId(req);
  const email = req.identity?.email ?? null;
  return {
    email,
    allowed: await isAllowed(email),
    isAdmin: isAdmin(email),
    enforced: (await allowlist()).size > 0,
  };
}));

accessRouter.get("/allowlist", route(async (req) => {
  requireAdmin(req);
  return db.list("allowedEmails", { order: { by: "email" } });
}));

accessRouter.post("/allowlist", route(async (req) => {
  requireAdmin(req);
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "メールアドレスの形式が正しくありません");
  if (await db.first("allowedEmails", { where: { email } })) throw new HttpError(409, "すでに登録されています");
  const id = await db.insert("allowedEmails", { email, addedBy: req.identity!.email });
  cache = null;
  return { id };
}));

accessRouter.delete("/allowlist/:id", route(async (req) => {
  requireAdmin(req);
  await db.delete("allowedEmails", req.params.id);
  cache = null;
  return null;
}));
