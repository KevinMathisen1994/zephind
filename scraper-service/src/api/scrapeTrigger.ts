/**
 * On-demand scraping, triggered from ANY device. Ported from
 * convex/scrapeTrigger.js.
 *
 * The scrape buttons cannot call this service's own /scrape directly from a
 * deployed browser: that only works on the one laptop running it. Instead a
 * GitHub-hosted runner does the scraping and writes results back:
 *
 *   browser -> this route -> GitHub workflow_dispatch -> Actions runs cli.ts
 *           -> cli.ts writes through /api/ingest -> UI refetches
 *
 * CONSEQUENCE FOR CALLERS: this is ASYNCHRONOUS. `{ ok: true }` means GitHub
 * ACCEPTED the request, nothing more. Listings appear minutes later. Any UI that
 * says 完了 on return is lying.
 *
 * SECURITY: every route requires a signed-in caller — a dispatch spends Actions
 * minutes and hammers the portals. GITHUB_DISPATCH_TOKEN is never logged and
 * never returned, not even truncated.
 */
import { Router } from "express";
import { db } from "../db";
import { HttpError, requireOwned, requireUserId } from "../auth/authz";
import { route } from "./handler";

const WORKFLOW_FILE = "scrape.yml";
const GITHUB_API_VERSION = "2022-11-28";
// GitHub rejects API requests with no User-Agent.
const USER_AGENT = "zephind-backend";
// Which branch's workflow file + code to run.
const WORKFLOW_REF = "main";

/** Throws in Japanese: the message is surfaced verbatim in the UI. */
function githubConfig() {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!repo) {
    throw new HttpError(500, "スクレイピングの起動設定が未完了です: GITHUB_REPO が設定されていません。");
  }
  if (!token) {
    throw new HttpError(500, "スクレイピングの起動設定が未完了です: GITHUB_DISPATCH_TOKEN が設定されていません。");
  }
  return { repo, token };
}

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
  };
}

/**
 * workflow_dispatch inputs become env vars inside the runner, and cli.ts splits
 * them on commas. Anything outside [alphanumeric _ , -] is either useless or an
 * attempt to smuggle something in. Reject rather than silently strip, so a typo
 * is visible instead of scraping the wrong thing.
 */
function cleanListInput(raw: unknown, label: string): string {
  if (raw === undefined || raw === null) return "";
  const value = String(raw).trim();
  if (value === "") return "";
  if (!/^[A-Za-z0-9_,-]+$/.test(value)) {
    throw new HttpError(400, `${label} の指定に使用できない文字が含まれています: ${value}`);
  }
  return value;
}

export const scrapeTriggerRouter = Router();

scrapeTriggerRouter.post("/trigger", route(async (req) => {
  requireUserId(req);

  // Who pressed the button, from the verified JWT so 実行: 柴田 cannot be forged.
  const id = req.identity!;
  const fullName =
    id.name || id.nickname || [id.givenName, id.familyName].filter(Boolean).join(" ") || "";
  // Client-supplied name is the LAST resort before the generic label, and is
  // sanitised: it is rendered on a card, so no control characters, bounded length.
  const clientName = String(req.body?.triggeredByName ?? "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 60);
  const triggeredBy = fullName || id.email || clientName || "ログインユーザー";

  const orderId: string | undefined = req.body?.orderId || undefined;
  // Verify the caller owns the order they are scoping the run to. Without it any
  // signed-in user could spend Actions minutes on another account's order.
  if (orderId) await requireOwned(req, "orders", orderId, "オーダー");

  const { repo, token } = githubConfig();
  const areas = cleanListInput(req.body?.areas, "エリアコード");
  const sources = cleanListInput(req.body?.sources, "取得サイト");

  const url = `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: githubHeaders(token),
      // Both inputs are declared `required: false, default: ""`; an empty string
      // means "use the workflow's own default".
      body: JSON.stringify({
        ref: WORKFLOW_REF,
        inputs: { areas, sources, orderId: orderId ?? "" },
      }),
    });
  } catch (err) {
    return { error: `GitHub に接続できませんでした: ${err instanceof Error ? err.message : String(err)}` };
  }

  // A successful workflow_dispatch is 204 No Content. Anything else is a failure.
  // GitHub's own text is echoed: it is the fastest way to tell a bad branch from
  // a bad token scope from a bad repo name.
  if (response.status !== 204) {
    const body = await response.text().catch(() => "(レスポンス本文を読み取れませんでした)");
    return { error: `スクレイピングの起動に失敗しました (GitHub ${response.status}): ${body.slice(0, 500) || "(本文なし)"}` };
  }

  // 204 has no body, so the dispatch never tells us which run it created. Poll
  // briefly for the newest one — without a run id the UI can only ask "is ANY
  // run live", which showed one account's scrape to every other account.
  let runId: number | null = null;
  for (let attempt = 0; attempt < 5 && runId === null; attempt++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const listRes = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=1`,
        { headers: githubHeaders(token) },
      );
      if (!listRes.ok) continue;
      const data: any = await listRes.json();
      const newest = data.workflow_runs?.[0];
      // Only claim it if it is genuinely fresh; an older run would pin the UI to
      // something this dispatch did not start.
      if (newest && Date.now() - new Date(newest.created_at).getTime() < 120_000) {
        runId = newest.id;
      }
    } catch {
      /* transient — keep trying within the attempt budget */
    }
  }

  // Stamp the order even when the run id poll came back empty: "who searched,
  // and when" is useful on its own.
  if (orderId) {
    await db.patch("orders", orderId, {
      ...(runId !== null ? { scrapeRunId: runId } : {}),
      lastScrapeAt: Date.now(),
      lastScrapeBy: triggeredBy,
    });
  }

  return { ok: true, runId, areas, sources };
}));

/** Last few workflow runs, so the UI can show queued / in progress / finished. */
scrapeTriggerRouter.get("/runs", route(async (req) => {
  requireUserId(req);
  const { repo, token } = githubConfig();
  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=5`,
      { headers: githubHeaders(token) },
    );
  } catch (err) {
    return { error: `GitHub に接続できませんでした: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "(レスポンス本文を読み取れませんでした)");
    return { error: `実行状況を取得できませんでした (GitHub ${response.status}): ${body.slice(0, 500) || "(本文なし)"}` };
  }
  const data: any = await response.json();
  const runs = Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
  return {
    runs: runs.map((run: any) => ({
      id: run.id,
      status: run.status ?? null,
      conclusion: run.conclusion ?? null,
      created_at: run.created_at ?? null,
      html_url: run.html_url ?? null,
    })),
  };
}));

/**
 * Cancels the run started for a given order. Ownership of the ORDER is what
 * authorises this, so a user can never cancel an arbitrary run id they guessed.
 */
scrapeTriggerRouter.post("/cancel", route(async (req) => {
  requireUserId(req);
  const orderId = req.body?.orderId;
  if (!orderId) throw new HttpError(400, "orderId is required");
  const { repo, token } = githubConfig();

  const { doc: order } = await requireOwned(req, "orders", orderId, "オーダー");
  const runId = order.scrapeRunId;
  if (!runId) return { error: "このオーダーには実行中のスクレイピングがありません。" };

  const response = await fetch(
    `https://api.github.com/repos/${repo}/actions/runs/${runId}/cancel`,
    { method: "POST", headers: githubHeaders(token) },
  );

  // 202 = cancellation requested. 409 means it already finished or was already
  // cancelling, which is the desired end state either way.
  if (response.status !== 202 && response.status !== 409) {
    const body = await response.text().catch(() => "(レスポンス本文を読み取れませんでした)");
    return { error: `スクレイピングの中止に失敗しました (GitHub ${response.status}): ${body.slice(0, 500) || "(本文なし)"}` };
  }

  // Clear the flags now rather than waiting for the poller: GitHub can take a
  // while to report the run as cancelled, and leaving the badge up would make
  // the button look broken. Explicit null, not undefined — the db helper strips
  // undefined so it would leave the stale run id in place.
  await db.patch("orders", orderId, { scrapingStatus: "cancelled", scrapeRunId: null });

  return { ok: true, alreadyFinished: response.status === 409 };
}));
