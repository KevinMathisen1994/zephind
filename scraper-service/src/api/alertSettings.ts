import { Router, Request } from "express";
import { db } from "../db";
import { requireUserId, HttpError } from "../auth/authz";
import { route } from "./handler";
import { WORKFLOW_REF, githubConfig, githubHeaders } from "./scrapeTrigger";
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
    dailyDigest: body.dailyDigest === true,
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

  // Unsaved form values win over saved ones.
  const existing = (await db.first("alertSettings", { where: { userId } })) as unknown as AlertSettingsRecord | null;
  const target: AlertSettingsRecord = {
    userId,
    webhookUrl: body.webhookUrl ?? existing?.webhookUrl,
    emailAddress: body.emailAddress ?? existing?.emailAddress,
  };
  if (!target.webhookUrl && !target.emailAddress) {
    throw new HttpError(400, "通知先メールアドレスを入力してください");
  }

  const result = await sendTestNotification(target);
  const failures = Object.values(result).filter((r) => r && !r.success).map((r) => r!.error);
  return {
    success: failures.length === 0,
    message: failures.length === 0 ? "テスト通知を送信しました" : `送信に失敗しました: ${failures.join(" / ")}`,
    details: result,
  };
}));

// One test report per user per 2 minutes: each one costs a GitHub Actions run.
const DIGEST_TEST_COOLDOWN_MS = 2 * 60 * 1000;
const lastDigestTest = new Map<string, number>();

/**
 * POST /api/alerts/test-digest
 * Emails the caller's 新着物件レポート (last 24h) now. The PDF needs Chrome, so this starts the
 * digest-test GitHub workflow; the email arrives a minute or two later.
 */
alertSettingsRouter.post("/test-digest", route(async (req: Request) => {
  const userId = requireUserId(req);
  const settings = await db.first("alertSettings", { where: { userId } });
  if (!settings?.emailAddress) throw new HttpError(400, "通知先メールアドレスを入力して「設定を保存」してください");
  // shortcut: in-memory, so it resets per edge instance; good enough to stop double clicks.
  const last = lastDigestTest.get(userId) ?? 0;
  if (Date.now() - last < DIGEST_TEST_COOLDOWN_MS) throw new HttpError(429, "テスト送信は2分に1回までです。少し待ってから再度お試しください");

  const { repo, token } = githubConfig();
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/digest-test.yml/dispatches`, {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({ ref: WORKFLOW_REF, inputs: { userId } }),
  });
  if (res.status !== 204) {
    throw new HttpError(502, `テスト送信の起動に失敗しました (GitHub ${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  lastDigestTest.set(userId, Date.now());
  return { ok: true, emailAddress: settings.emailAddress };
}));
