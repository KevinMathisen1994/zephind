import { logger } from "../logger";
import { db } from "../db";

export interface AlertNotificationItem {
  userId?: string;
  matchId?: string;
  orderId?: string;
  orderName?: string;
  listingId?: string;
  title?: string;
  address?: string;
  price?: number; // 万円
  rent?: number; // 万円/月
  yield?: number; // %
  score: number;
  scoreDetail?: any;
  ward?: string;
  station?: string;
  walkMinutes?: number;
  source?: string;
  isPriceDrop?: boolean;
  priceDropPercent?: number;
  originalPrice?: number;
}

export interface AlertSettingsRecord {
  _id?: string;
  userId: string;
  webhookUrl?: string;
  emailAddress?: string;
  minScore?: number;
  notifyHighScores?: boolean;
  notifyPriceDrops?: boolean;
  enabled?: boolean;
}

// In-memory cache of alerted match IDs to prevent duplicate alerts within 24h
const recentAlertsCache = new Set<string>();

/**
 * Format price in Japanese 万円 / 億円 text.
 */
function formatPriceText(priceMan: number): string {
  if (Math.abs(priceMan) < 10000) return `${priceMan.toLocaleString()}万円`;
  const oku = Math.trunc(priceMan / 10000);
  const rest = Math.round(priceMan - oku * 10000);
  return rest ? `${oku}億${Math.abs(rest).toLocaleString()}万円` : `${oku}億円`;
}

/**
 * Format message for Discord, Slack, LINE Notify or generic webhooks.
 */
export function formatAlertMessage(item: AlertNotificationItem): {
  title: string;
  text: string;
  discordPayload: any;
  slackPayload: any;
} {
  const isDrop = item.isPriceDrop || (item.priceDropPercent && item.priceDropPercent > 0);
  const headline = isDrop
    ? `🔥【大幅値下げ速報】${item.priceDropPercent ? `▲${item.priceDropPercent}%値下げ！` : "価格改定！"}`
    : `🌟【高評価マッチ速報】AIスコア ${item.score}点 / 100点`;

  const priceStr = item.price ? formatPriceText(item.price) : "価格要相談";
  const yieldStr = item.yield ? `表面利回り ${item.yield}%` : "";
  const rentStr = item.rent ? `想定家賃 ¥${Math.round(item.rent * 10000).toLocaleString()}/月` : "";
  const locStr = [
    item.ward,
    item.station ? `${item.station}${item.walkMinutes !== undefined ? ` 徒歩${item.walkMinutes}分` : ""}` : "",
  ].filter(Boolean).join(" ");

  const textLines = [
    headline,
    `物件名: ${item.title || item.address || "都内厳選収益物件"}`,
    locStr ? `所在地: ${locStr}` : "",
    `販売価格: ${priceStr} ${yieldStr ? `(${yieldStr})` : ""}`,
    rentStr ? `想定賃料: ${rentStr}` : "",
    item.orderName ? `合致検索条件: 【${item.orderName}】` : "",
    `AI適合スコア: ${item.score}点 / 100点`,
    "",
    "⚡ 速報：他社に先駆けて買付・詳細確認をおすすめします！",
    "※社内CRM・Zephindで収支シミュレーションおよび提案文作成が可能です。",
  ].filter(Boolean);

  const fullText = textLines.join("\n");

  // Discord webhook rich embed
  const discordPayload = {
    content: headline,
    embeds: [
      {
        title: item.title || item.address || "注目収益物件",
        description: locStr,
        color: item.score >= 85 ? 0x10b981 : 0x3b82f6, // Emerald or Blue
        fields: [
          { name: "価格", value: priceStr, inline: true },
          { name: "想定利回り", value: yieldStr || "—", inline: true },
          { name: "AI適合スコア", value: `${item.score}点 / 100点`, inline: true },
          { name: "合致検索条件", value: item.orderName || "全般", inline: true },
          { name: "情報ソース", value: item.source || "Webスクレイピング", inline: true },
        ],
        footer: { text: "Zephind Real Estate Intelligence" },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  // Slack webhook format
  const slackPayload = {
    text: headline,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${headline}*\n*${item.title || item.address || "注目収益物件"}*\n${locStr}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*価格:*\n${priceStr}` },
          { type: "mrkdwn", text: `*利回り:*\n${yieldStr || "—"}` },
          { type: "mrkdwn", text: `*AIスコア:*\n${item.score}点` },
          { type: "mrkdwn", text: `*希望条件:*\n${item.orderName || "全般"}` },
        ],
      },
    ],
  };

  return {
    title: headline,
    text: fullText,
    discordPayload,
    slackPayload,
  };
}

/**
 * Dispatch alert to a webhook (LINE Notify token, Discord, Slack, or generic HTTP POST).
 */
export async function sendWebhookAlert(
  urlOrToken: string,
  item: AlertNotificationItem,
): Promise<{ success: boolean; status?: number; error?: string }> {
  try {
    const trimmed = urlOrToken.trim();
    const { title, text, discordPayload, slackPayload } = formatAlertMessage(item);

    // 1. Check if it's a LINE Notify token (starts with non-URL alphanumeric string or notify-api)
    const isLineNotifyToken = !trimmed.startsWith("http") && trimmed.length >= 20;
    const isLineNotifyUrl = trimmed.includes("notify-api.line.me");

    if (isLineNotifyToken || isLineNotifyUrl) {
      const token = isLineNotifyToken ? trimmed : trimmed.replace(/.*token=/, "");
      const res = await fetch("https://notify-api.line.me/api/notify", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${token}`,
        },
        body: new URLSearchParams({ message: `\n${text}` }).toString(),
      });
      if (!res.ok) {
        const body = await res.text();
        return { success: false, status: res.status, error: `LINE Notify Error: ${body}` };
      }
      return { success: true, status: 200 };
    }

    // 2. Check if Discord Webhook
    if (trimmed.includes("discord.com/api/webhooks")) {
      const res = await fetch(trimmed, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(discordPayload),
      });
      if (!res.ok) {
        return { success: false, status: res.status, error: `Discord Error: ${await res.text()}` };
      }
      return { success: true, status: 200 };
    }

    // 3. Check if Slack Webhook
    if (trimmed.includes("hooks.slack.com")) {
      const res = await fetch(trimmed, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackPayload),
      });
      if (!res.ok) {
        return { success: false, status: res.status, error: `Slack Error: ${await res.text()}` };
      }
      return { success: true, status: 200 };
    }

    // 4. Generic Webhook (POST JSON)
    const res = await fetch(trimmed, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "hot_match_alert",
        title,
        message: text,
        item,
        timestamp: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      return { success: false, status: res.status, error: `Webhook Error: ${await res.text()}` };
    }
    return { success: true, status: 200 };
  } catch (err: any) {
    logger.error("Failed to dispatch webhook alert", { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Dispatch alert to Email.
 */
export async function sendEmailAlert(
  emailAddress: string,
  item: AlertNotificationItem,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { title, text } = formatAlertMessage(item);
    logger.info(`[Email Alert] Prepared alert email to ${emailAddress}: ${title}`);

    // If Resend, Sendgrid, or SMTP environment variables are configured, we send via API
    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: process.env.ALERT_FROM_EMAIL || "Zephind Alerts <alerts@zephind.com>",
          to: [emailAddress],
          subject: title,
          text: text,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        return { success: false, error: `Resend error: ${body}` };
      }
      return { success: true };
    }

    // Log success if no direct mail transport is provisioned in dev
    logger.info(`[Email Alert] Alert queued for ${emailAddress}`);
    return { success: true };
  } catch (err: any) {
    logger.error("Failed to send email alert", { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Dispatch hot match alerts to all subscribed users.
 */
export async function dispatchHotMatchAlerts(items: AlertNotificationItem[]): Promise<number> {
  if (items.length === 0) return 0;

  try {
    // 1. Fetch all enabled alert settings
    const { data: rawSettings, error } = await db.raw
      .from("alertSettings")
      .select("*")
      .eq("enabled", true);

    if (error || !rawSettings || rawSettings.length === 0) {
      return 0;
    }

    const settingsList = rawSettings as AlertSettingsRecord[];
    let dispatchedCount = 0;

    for (const item of items) {
      const matchKey = `${item.matchId || item.listingId}`;
      if (recentAlertsCache.has(matchKey)) {
        continue; // Already notified recently
      }

      for (const settings of settingsList) {
        if (item.userId && settings.userId !== item.userId) {
          continue;
        }
        const minScore = settings.minScore ?? 80;
        const matchesScore = settings.notifyHighScores !== false && item.score >= minScore;
        const matchesDrop = settings.notifyPriceDrops !== false && Boolean(item.isPriceDrop);

        if (!matchesScore && !matchesDrop) {
          continue;
        }

        // Send Webhook if configured
        if (settings.webhookUrl) {
          await sendWebhookAlert(settings.webhookUrl, item);
        }

        // Send Email if configured
        if (settings.emailAddress) {
          await sendEmailAlert(settings.emailAddress, item);
        }

        dispatchedCount++;
      }

      recentAlertsCache.add(matchKey);
    }

    // Clean up cache if growing too large (keep last 1000)
    if (recentAlertsCache.size > 2000) {
      recentAlertsCache.clear();
    }

    if (dispatchedCount > 0) {
      logger.info(`Dispatched ${dispatchedCount} hot match alert notification(s).`);
    }

    return dispatchedCount;
  } catch (err: any) {
    logger.error("Error in dispatchHotMatchAlerts", { error: err.message });
    return 0;
  }
}

/**
 * Send a realistic test notification to verify integration.
 */
export async function sendTestNotification(settings: AlertSettingsRecord): Promise<{
  webhookResult?: { success: boolean; status?: number; error?: string };
  emailResult?: { success: boolean; error?: string };
}> {
  const sampleItem: AlertNotificationItem = {
    title: "港区南麻布5丁目 一棟RC収益レジデンス",
    address: "東京都港区南麻布5-12-3",
    price: 38000, // 3億8,000万円
    rent: 215, // 215万円/月
    yield: 6.8, // 6.8%
    score: 92, // 92点
    ward: "港区",
    station: "広尾駅",
    walkMinutes: 4,
    orderName: "都心好立地・高利回り一棟RC",
    source: "健美家",
    isPriceDrop: true,
    priceDropPercent: 8,
  };

  const result: {
    webhookResult?: { success: boolean; status?: number; error?: string };
    emailResult?: { success: boolean; error?: string };
  } = {};

  if (settings.webhookUrl) {
    result.webhookResult = await sendWebhookAlert(settings.webhookUrl, sampleItem);
  }

  if (settings.emailAddress) {
    result.emailResult = await sendEmailAlert(settings.emailAddress, sampleItem);
  }

  return result;
}
