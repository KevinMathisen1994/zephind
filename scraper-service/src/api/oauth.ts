/**
 * OAuth redirect target for both mail providers. Ported from convex/http.js.
 *
 * This request arrives straight from Google/Microsoft in the user's browser and
 * carries NO Clerk session, so it cannot ask who is connecting. The `state`
 * parameter — minted by the authenticated /mail/oauth/start route, single-use
 * and short-lived — is what identifies the user.
 */
import { Router, type Request, type Response } from "express";
import { completeOAuth } from "../services/mailIngest";

/**
 * Small self-closing page for the OAuth popup. The connect flow runs in a popup
 * so the app behind it keeps its state; the page tells the opener the outcome
 * and closes itself. If it was opened as a normal tab (popup blocked) the
 * message stays on screen instead of leaving a blank window.
 */
function resultPage({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  const safe = (text: unknown) =>
    String(text ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
    );
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>${safe(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f6f8f6; }
  .card { background: #fff; border: 1px solid #eaeeea; border-radius: 16px; padding: 32px 36px; max-width: 480px; text-align: center; }
  h1 { font-size: 16px; margin: 0 0 8px; color: ${ok ? "#1a7100" : "#b91c1c"}; }
  p { font-size: 13px; line-height: 1.7; color: #475569; margin: 0; white-space: pre-wrap; }
</style></head>
<body><div class="card"><h1>${safe(title)}</h1><p>${safe(detail)}</p></div>
<script>
  // Let the app refresh its connected-account list immediately.
  try { window.opener && window.opener.postMessage({ type: "zephind-oauth", ok: ${ok ? "true" : "false"} }, "*"); } catch (e) {}
  ${ok ? "setTimeout(function () { window.close(); }, 1200);" : ""}
</script>
</body></html>`;
}

function html(res: Response, status: number, body: string) {
  res.status(status).set("Content-Type", "text/html; charset=utf-8").send(body);
}

export const oauthRouter = Router();

async function callback(req: Request, res: Response, provider: string) {
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const error = typeof req.query.error === "string" ? req.query.error : null;

  if (error) {
    const description = typeof req.query.error_description === "string" ? req.query.error_description : "";
    html(res, 400, resultPage({
      ok: false,
      title: "メールアカウントを接続できませんでした",
      detail: `${error}${description ? `\n${description}` : ""}`,
    }));
    return;
  }

  if (!code || !state) {
    html(res, 400, resultPage({
      ok: false,
      title: "メールアカウントを接続できませんでした",
      detail: "認証情報が不足しています（code / state）。もう一度お試しください。",
    }));
    return;
  }

  try {
    const result = await completeOAuth(provider, code, state);
    html(res, 200, resultPage({
      ok: true,
      title: `${result.label} を接続しました`,
      detail: `${result.email}\nこのウィンドウは自動で閉じます。届いた物件紹介メールが自動で抽出・照合されます。`,
    }));
  } catch (err) {
    html(res, 500, resultPage({
      ok: false,
      title: "メールアカウントを接続できませんでした",
      detail: err instanceof Error ? err.message : String(err),
    }));
  }
}

oauthRouter.get("/gmail/callback", (req, res) => void callback(req, res, "gmail"));
oauthRouter.get("/outlook/callback", (req, res) => void callback(req, res, "outlook"));
