/**
 * 毎朝の新着物件レポート: after the first scheduled scrape of the day (JST), each user
 * who opted in gets one email with a PDF listing the new matches per order.
 * Runs in the scrape workflow's finalize job, where Chrome is already installed.
 */
import puppeteer from "puppeteer";
import { db } from "../db";
import { logger } from "../logger";
import { type AlertSettingsRecord, formatPriceText, sendEmail, zephindLink } from "../services/alertNotifier";

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_MS = 9 * 60 * 60 * 1000;
// shortcut: caps one digest at 3000 new matches; a normal day is a few hundred. Page the query if that ever binds.
const MAX_MATCHES = 3000;
const LISTING_COLS = "_id,title,price,address,ward,area,landSize,layout,station,propertyType,source,url";

export interface DigestListing {
  id: string;
  title?: string;
  price?: number;
  address?: string;
  ward?: string;
  area?: number;
  landSize?: number;
  layout?: string;
  station?: string;
  propertyType?: string;
  source?: string;
  url?: string;
  score?: number | null;
}
export interface DigestGroup { orderId: string; orderName: string; listings: DigestListing[] }

/** JST calendar day, e.g. "2026/11/28". */
export const jstDay = (ms: number) => new Date(ms + JST_MS).toISOString().slice(0, 10).replace(/-/g, "/");

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Scraped URLs are untrusted; only http(s) may become a link.
const safeUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : "");


export function renderDigestHtml(groups: DigestGroup[], day: string, appUrl: string): string {
  const total = groups.reduce((n, g) => n + g.listings.length, 0);
  const sections = groups.map((g) => {
    const rows = g.listings.map((l, i) => {
      const zephind = zephindLink(appUrl, l.id, g.orderId);
      const src = safeUrl(l.url);
      // Some scrapers store a field label (e.g. "土地面積建物面積") as the layout; show only real layouts.
      const layout = l.layout && !/面積/.test(l.layout) ? l.layout : "";
      const size = [l.area ? `${l.area}㎡` : "", l.landSize ? `土地${l.landSize}㎡` : "", layout].filter(Boolean).join(" / ");
      return `<tr>
        <td class="n">${i + 1}</td>
        <td><div class="t">${esc(l.title || l.address || "（タイトルなし）")}</div><div class="s">${esc([l.propertyType, l.ward, l.title ? l.address : ""].filter(Boolean).join("・"))}</div></td>
        <td class="p">${l.price ? esc(formatPriceText(l.price)) : "—"}</td>
        <td>${esc(size || "—")}<div class="s">${esc(l.station ?? "")}</div></td>
        <td class="c">${l.score != null ? esc(l.score) : "—"}</td>
        <td class="l">${zephind ? `<a href="${esc(zephind)}">Zephind</a>` : ""}${src ? `<a href="${esc(src)}">${esc(l.source || "掲載元")}</a>` : ""}</td>
      </tr>`;
    }).join("");
    return `<h2>${esc(g.orderName)} <span>${g.listings.length}件</span></h2>
      <table><thead><tr><th>#</th><th>物件</th><th>価格</th><th>面積・間取り / 駅</th><th>AI</th><th>リンク</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
<style>
  body { font-family: "Noto Sans JP", sans-serif; color: #1f2a24; font-size: 9.5pt; margin: 0; }
  h1 { font-size: 17pt; margin: 0 0 2pt; } .sub { color: #66706a; margin-bottom: 14pt; }
  h2 { font-size: 12pt; margin: 16pt 0 6pt; padding-bottom: 3pt; border-bottom: 2px solid #3c5a40; break-after: avoid; }
  h2 span { font-size: 9pt; color: #66706a; font-weight: 400; }
  table { width: 100%; border-collapse: collapse; } tr { break-inside: avoid; }
  th { text-align: left; font-size: 8pt; color: #66706a; border-bottom: 1px solid #d9ddd8; padding: 3pt 4pt; }
  td { border-bottom: 1px solid #eceeea; padding: 4pt; vertical-align: top; }
  .n { color: #99a19b; width: 16pt; } .t { font-weight: 700; } .s { color: #66706a; font-size: 8pt; }
  .p { white-space: nowrap; font-weight: 700; } .c { text-align: center; }
  .l a { display: block; color: #2f6f43; white-space: nowrap; }
</style></head><body>
<h1>新着物件レポート</h1><div class="sub">${esc(day)}・${groups.length}オーダー・${total}件</div>
${sections}
</body></html>`;
}

export async function renderPdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

/** New matches for one user since `since`, grouped by order (orders in name order, newest match first). */
export async function collectGroups(userId: string, since: number): Promise<DigestGroup[]> {
  const { data: matches, error } = await db.raw
    .from("matching")
    .select("orderId,listingId,score,_creationTime")
    .eq("userId", userId)
    .gt("_creationTime", since)
    .order("_creationTime", { ascending: false })
    .limit(MAX_MATCHES);
  if (error) throw new Error(`digest matches: ${error.message}`);
  if (!matches?.length) return [];

  const orders = await db.list("orders", { where: { userId } });
  const listingIds = [...new Set(matches.map((m) => m.listingId).filter(Boolean))] as string[];
  const listings = new Map((await db.selectIn("listings", LISTING_COLS, "_id", listingIds)).map((l) => [l._id, l]));

  const groups = new Map<string, DigestGroup>();
  for (const m of matches) {
    const order = orders.find((o) => o._id === m.orderId);
    const l = listings.get(m.listingId);
    if (!order || !l) continue; // order or listing deleted since
    const g: DigestGroup = groups.get(order._id) ?? { orderId: order._id, orderName: order.name || `オーダー #${order._id.slice(0, 6)}`, listings: [] };
    if (!g.listings.some((x) => x.id === l._id)) g.listings.push({ ...(l as Omit<DigestListing, "id">), id: l._id, score: m.score });
    groups.set(order._id, g);
  }
  return [...groups.values()].sort((a, b) => a.orderName.localeCompare(b.orderName, "ja"));
}

/**
 * Builds and emails one user's report. A test covers the last 24h, says so in the subject, and does not
 * count as the day's report. Returns false only when the email could not be sent (so the caller can retry).
 */
export async function sendDigest(s: AlertSettingsRecord, now: number, opts: { test?: boolean } = {}): Promise<{ sent: boolean; total: number; error?: string }> {
  if (!s.emailAddress) return { sent: false, total: 0, error: "通知先メールアドレスが未設定です" };
  const appUrl = process.env.APP_URL ?? "";
  const today = jstDay(now);
  const groups = await collectGroups(s.userId, opts.test ? now - DAY_MS : (s.lastDigestAt ?? now - DAY_MS));
  const total = groups.reduce((n, g) => n + g.listings.length, 0);
  // A test with nothing new still sends, so the person pressing the button sees that it works.
  if (total === 0 && !opts.test) return { sent: false, total };
  const summary = groups.map((g) => `・${g.orderName}: ${g.listings.length}件`).join("\n");
  const prefix = opts.test ? "【テスト】" : "";
  const result = await sendEmail({
    to: s.emailAddress,
    subject: `${prefix}【Zephind】新着物件レポート ${today}（${total}件）`,
    text: `本日の新着物件は${total}件です。${total ? "詳細は添付PDFをご覧ください。" : ""}\n\n${summary}\n${appUrl ? `\n${appUrl.replace(/\/$/, "")}/orders` : ""}`,
    html: `<p>本日の新着物件は<b>${total}件</b>です。${total ? "詳細は添付PDFをご覧ください。" : ""}</p><ul>${groups
      .map((g) => `<li>${esc(g.orderName)}: ${g.listings.length}件</li>`).join("")}</ul>`,
    attachments: total
      ? [{ filename: `zephind_新着物件_${today.replace(/\//g, "")}.pdf`, content: await renderPdf(renderDigestHtml(groups, today, appUrl)) }]
      : undefined,
  });
  return { sent: result.success, total, error: result.error };
}

/** Sends today's digest to every opted-in user who has not had one yet today (JST). */
export async function sendDailyDigests(now = Date.now()): Promise<number> {
  const { data, error } = await db.raw.from("alertSettings").select("*").eq("enabled", true).eq("dailyDigest", true);
  if (error) throw new Error(`digest settings: ${error.message}`);
  const today = jstDay(now);
  let sent = 0;

  for (const s of (data ?? []) as AlertSettingsRecord[]) {
    if (!s._id || !s.emailAddress) continue;
    if (s.lastDigestAt && jstDay(s.lastDigestAt) === today) continue;
    try {
      const r = await sendDigest(s, now);
      // Not marked as sent, so the next scheduled run retries.
      if (r.total > 0 && !r.sent) {
        logger.warn(`[digest] ${s.emailAddress}: ${r.error}`);
        continue;
      }
      if (r.sent) sent++;
      // Also marked on a day with nothing new, so tomorrow's digest starts from here.
      await db.patch("alertSettings", s._id, { lastDigestAt: now });
    } catch (err) {
      logger.error(`[digest] failed for ${s.userId}: ${(err as Error).message}`);
    }
  }
  return sent;
}
