/**
 * Client-facing mail ingest routes. Ported from the public half of
 * convex/mailIngestData.js and convex/mailIngest.js.
 */
import { Router } from "express";
import { db } from "../db";
import { requireOwned, requireUserId } from "../auth/authz";
import { route } from "./handler";
import { PROVIDER_LABELS, cleanList, ingestSettingsForUser } from "../lib/mailData";
import {
  getAttachmentData, getEmailDetailsForListing, inspectRecentMail, startOAuth, syncNow,
} from "../services/mailIngest";
import { MAIL_INGEST_SETTING_FIELDS, pick } from "./fields";

export const mailRouter = Router();

/**
 * Which providers this deployment can actually offer — an unconfigured
 * deployment shows no connect button rather than one that fails on click.
 */
mailRouter.get("/providers", route(async () =>
  Object.entries(PROVIDER_LABELS).map(([provider, cfg]) => {
    const available = Boolean(process.env[cfg.clientIdEnv] && process.env[cfg.clientSecretEnv]);
    return {
      provider,
      label: cfg.label,
      available,
      unavailableReason: available ? undefined : `${cfg.clientIdEnv} / ${cfg.clientSecretEnv} が未設定です。`,
    };
  }),
));

/**
 * The caller's own connected mailboxes. Never returns tokens — only enough to
 * render a connection-status card.
 */
mailRouter.get("/accounts", route(async (req) => {
  const userId = requireUserId(req);
  const rows = await db.list("mailAccounts", { where: { userId } });
  return rows.map((r) => ({
    _id: r._id,
    provider: r.provider,
    email: r.email,
    connectedAt: r.connectedAt,
    needsReconnect: r.needsReconnect,
    lastError: r.lastError,
    lastSyncedAt: r.lastSyncedAt,
  }));
}));

mailRouter.delete("/accounts/:id", route(async (req) => {
  await requireOwned(req, "mailAccounts", req.params.id, "メールアカウント");
  await db.delete("mailAccounts", req.params.id);
  return { ok: true };
}));

mailRouter.post("/oauth/start", route(async (req) => {
  const userId = requireUserId(req);
  const { provider, redirectTo } = req.body ?? {};
  if (!provider) throw new Error("provider is required");
  return startOAuth(userId, provider, redirectTo);
}));

mailRouter.get("/settings", route(async (req) => {
  const userId = requireUserId(req);
  return ingestSettingsForUser(userId);
}));

mailRouter.put("/settings", route(async (req) => {
  const userId = requireUserId(req);
  const body = pick(req.body ?? {}, MAIL_INGEST_SETTING_FIELDS);
  const fields = {
    requiredKeywords: cleanList(body.requiredKeywords),
    blockedKeywords: cleanList(body.blockedKeywords),
    allowedSenders: cleanList(body.allowedSenders),
    blockedSenders: cleanList(body.blockedSenders),
    requireAttachment: body.requireAttachment ?? false,
    updatedAt: Date.now(),
  };
  const existing = await db.first("mailIngestSettings", { where: { userId } });
  if (existing) {
    await db.patch("mailIngestSettings", existing._id, fields);
    return existing._id;
  }
  return db.insert("mailIngestSettings", { userId, ...fields });
}));

mailRouter.post("/sync", route(async (req) => {
  const userId = requireUserId(req);
  return syncNow(userId, { fullSync: req.body?.fullSync, daysBack: req.body?.daysBack });
}));

mailRouter.post("/inspect", route(async (req) => {
  const userId = requireUserId(req);
  return inspectRecentMail(userId, {
    limit: req.body?.limit,
    matchingOnly: req.body?.matchingOnly,
    daysBack: req.body?.daysBack,
    runAi: req.body?.runAi,
  });
}));

mailRouter.post("/attachment", route(async (req) => {
  const userId = requireUserId(req);
  const { provider, messageId, attachmentId, mimeType, filename } = req.body ?? {};
  if (!provider || !messageId || !attachmentId) {
    throw new Error("provider, messageId and attachmentId are required");
  }
  return getAttachmentData(userId, { provider, messageId, attachmentId, mimeType, filename });
}));

mailRouter.get("/listing/:listingId/email", route(async (req) => {
  const userId = requireUserId(req);
  return getEmailDetailsForListing(userId, req.params.listingId);
}));
