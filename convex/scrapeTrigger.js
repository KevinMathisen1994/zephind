/**
 * On-demand scraping, triggered from ANY device.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The scrape buttons used to be `fetch(import.meta.env.VITE_SCRAPER_URL + "/scrape")`
 * straight from the browser. VITE_SCRAPER_URL is baked into the bundle at BUILD
 * time and its value is http://localhost:3001, so every deployed client asked
 * *its own* machine for a scraper. That only ever worked on the one laptop that
 * happens to run scraper-service; on a phone it failed instantly.
 *
 * The scheduled path already solves the same problem properly:
 *   .github/workflows/scrape.yml -> scraper-service/src/cli.ts -> convex/ingest.js
 * A GitHub-hosted runner does the scraping and writes results to Convex itself.
 * That workflow already declares `workflow_dispatch` with `areas` and `sources`
 * inputs, so on-demand scraping is just "press the same button from code":
 *
 *   browser -> this action -> GitHub workflow_dispatch -> Actions runs cli.ts
 *           -> cli.ts writes via convex/ingest.js -> useQuery updates the UI
 *
 * CONSEQUENCE FOR CALLERS: this is ASYNCHRONOUS. `triggerScrape` returning
 * `{ ok: true }` means GitHub ACCEPTED the request, nothing more. Listings appear
 * minutes later through the reactive queries. Any UI that says "完了" on return
 * is lying.
 *
 * SECURITY
 * --------
 * Every function here starts with requireUserId(). A dispatch spends GitHub
 * Actions minutes and hammers the portals, so anonymous callers must not have it.
 * GITHUB_DISPATCH_TOKEN is never logged and never returned, not even truncated.
 */
import { action } from "./_generated/server.js";
import { v } from "convex/values";
import { requireUserId } from "./lib/authz.js";

const WORKFLOW_FILE = "scrape.yml";
const GITHUB_API_VERSION = "2022-11-28";
// GitHub rejects API requests with no User-Agent.
const USER_AGENT = "zephind-convex";
// The workflow's `ref` input — which branch's workflow file + code to run.
const WORKFLOW_REF = "main";

/**
 * Reads and validates deployment config.
 * Throws in Japanese because the message is surfaced verbatim in the UI.
 */
function githubConfig() {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!repo) {
    throw new Error(
      "スクレイピングの起動設定が未完了です: GITHUB_REPO が設定されていません。" +
        " (Run: npx convex env set GITHUB_REPO <owner>/<repo>)",
    );
  }
  if (!token) {
    throw new Error(
      "スクレイピングの起動設定が未完了です: GITHUB_DISPATCH_TOKEN が設定されていません。" +
        " (Run: npx convex env set GITHUB_DISPATCH_TOKEN <github-pat>)",
    );
  }
  return { repo, token };
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
  };
}

/**
 * workflow_dispatch inputs are free-form strings that end up as env vars inside
 * the runner. cli.ts splits them on commas, so anything outside
 * [alphanumeric _ , -] is either useless or an attempt to smuggle something in.
 * Reject rather than silently strip, so a typo is visible instead of scraping
 * the wrong thing.
 */
function cleanListInput(raw, label) {
  if (raw === undefined || raw === null) return "";
  const value = String(raw).trim();
  if (value === "") return "";
  if (!/^[A-Za-z0-9_,-]+$/.test(value)) {
    throw new Error(`${label} の指定に使用できない文字が含まれています: ${value}`);
  }
  return value;
}

/**
 * Fire the scrape workflow on GitHub Actions.
 *
 * Returns { ok: true, ... } if GitHub accepted the dispatch, or { error } if it
 * refused. GitHub's own refusal text is included verbatim: its messages
 * ("No ref found for: main", "Resource not accessible by personal access
 * token", "Not Found" for a missing workflow) are the fastest way to tell a bad
 * branch from a bad token scope from a bad repo name.
 */
export const triggerScrape = action({
  args: {
    areas: v.optional(v.string()),
    sources: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUserId(ctx);

    const { repo, token } = githubConfig();
    const areas = cleanListInput(args.areas, "エリアコード");
    const sources = cleanListInput(args.sources, "取得サイト");

    const url = `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: githubHeaders(token),
        // Both inputs are declared `required: false, default: ""` in the
        // workflow; an empty string means "use the workflow's own default"
        // (all known sources / area codes derived from existing orders).
        body: JSON.stringify({
          ref: WORKFLOW_REF,
          inputs: { areas, sources },
        }),
      });
    } catch (err) {
      // Network-level failure reaching api.github.com at all.
      return {
        error: `GitHub に接続できませんでした: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // A successful workflow_dispatch is 204 No Content — there is no body to
    // parse and no "ok" field to check. Anything else is a failure.
    if (response.status !== 204) {
      let body = "";
      try {
        body = (await response.text()).slice(0, 500);
      } catch {
        body = "(レスポンス本文を読み取れませんでした)";
      }
      return {
        error:
          `スクレイピングの起動に失敗しました (GitHub ${response.status}): ${body || "(本文なし)"}`,
      };
    }

    return {
      ok: true,
      // Echoed back so the UI can say what was actually requested; "" means the
      // workflow's default applies.
      areas,
      sources,
    };
  },
});

/**
 * The last few runs of the scrape workflow, so the UI can show whether a
 * dispatch is queued / in progress / finished.
 *
 * This is an ACTION, not a query, on purpose: Convex queries are deterministic
 * and cannot call fetch. That also means it does NOT update reactively — the
 * caller has to poll it.
 */
export const getRecentRuns = action({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);

    const { repo, token } = githubConfig();
    const url = `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=5`;

    let response;
    try {
      response = await fetch(url, { headers: githubHeaders(token) });
    } catch (err) {
      return {
        error: `GitHub に接続できませんでした: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!response.ok) {
      let body = "";
      try {
        body = (await response.text()).slice(0, 500);
      } catch {
        body = "(レスポンス本文を読み取れませんでした)";
      }
      return {
        error: `実行状況を取得できませんでした (GitHub ${response.status}): ${body || "(本文なし)"}`,
      };
    }

    const data = await response.json();
    const runs = Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
    return {
      runs: runs.map((run) => ({
        id: run.id,
        status: run.status ?? null,
        conclusion: run.conclusion ?? null,
        created_at: run.created_at ?? null,
        html_url: run.html_url ?? null,
      })),
    };
  },
});
