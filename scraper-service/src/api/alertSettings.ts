import { Router, Request } from "express";
import { db } from "../db";
import { requireUserId, HttpError } from "../auth/authz";
import { route } from "./handler";
import { sendTestNotification, AlertSettingsRecord } from "../services/alertNotifier";

export const alertSettingsRouter = Router();

/**
 * GET /api/alerts/settings
 * Fetch the current user's alert notification settings.
 */
alertSettingsRouter.get("/settings", route(async (req: Request) => {
  const userId = requireUserId(req);
  const settings = await db.first("alertSettings", { where: { userId } });
  if (!settings) {
    return {
      userId,
      webhookUrl: "",
      emailAddress: "",
      minScore: 80,
      notifyHighScores: true,
      notifyPriceDrops: true,
      enabled: true,
    };
  }
  return settings;
}));

/**
 * PUT /api/alerts/settings
 * Save or update the user's alert notification settings.
 */
alertSettingsRouter.put("/settings", route(async (req: Request) => {
  const userId = requireUserId(req);
  const body = req.body || {};

  const fields = {
    webhookUrl: typeof body.webhookUrl === "string" ? body.webhookUrl.trim() : undefined,
    emailAddress: typeof body.emailAddress === "string" ? body.emailAddress.trim() : undefined,
    minScore: typeof body.minScore === "number" ? body.minScore : 80,
    notifyHighScores: body.notifyHighScores !== false,
    notifyPriceDrops: body.notifyPriceDrops !== false,
    enabled: body.enabled !== false,
    updatedAt: Date.now(),
  };

  const existing = await db.first("alertSettings", { where: { userId } });
  if (existing) {
    await db.patch("alertSettings", existing._id, fields);
    return { ...existing, ...fields };
  }

  const newId = await db.insert("alertSettings", {
    ...fields,
    userId,
  });
  return { _id: newId, userId, ...fields };
}));

/**
 * POST /api/alerts/test
 * Send an immediate test notification to verify delivery.
 */
alertSettingsRouter.post("/test", route(async (req: Request) => {
  const userId = requireUserId(req);
  const body = req.body || {};

  // If parameters passed in body, test those; otherwise test existing saved settings
  let targetSettings: AlertSettingsRecord = {
    userId,
    webhookUrl: body.webhookUrl,
    emailAddress: body.emailAddress,
    minScore: body.minScore ?? 80,
    notifyHighScores: true,
    notifyPriceDrops: true,
    enabled: true,
  };

  if (!targetSettings.webhookUrl && !targetSettings.emailAddress) {
    const existing = await db.first("alertSettings", { where: { userId } });
    if (!existing || (!existing.webhookUrl && !existing.emailAddress)) {
      throw new HttpError(400, "Webhook URLまたは通知先メールアドレスを入力してください");
    }
    targetSettings = existing as unknown as AlertSettingsRecord;
  }

  const result = await sendTestNotification(targetSettings);
  return {
    success: true,
    message: "テスト通知を送信しました",
    details: result,
  };
}));
