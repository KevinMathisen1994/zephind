import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

http.route({
    path: "/health",
    method: "GET",
    handler: httpAction(async () => {
        return new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
        });
    }),
});

/**
 * Small self-closing page for the OAuth popup (see convex/mailIngest.js for
 * the flow this is the last step of).
 *
 * The connect flow runs in a popup so the app behind it keeps its state. The
 * page tells the opener the outcome and closes itself; if it was opened as a
 * normal tab (popup blocked), the message stays on screen instead of leaving
 * a blank window.
 */
function resultPage({ ok, title, detail }) {
    const safe = (text) =>
        String(text ?? "").replace(/[&<>"']/g, (c) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
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

/**
 * OAuth redirect target for both providers (see convex/mailIngest.js).
 *
 * This request arrives straight from Google/Microsoft in the user's browser
 * and carries NO Clerk session, so it cannot ask who is connecting. The
 * `state` parameter — minted by the authenticated startOAuth action,
 * single-use and short-lived — is what identifies the user.
 */
const oauthCallback = httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const provider = url.pathname.split("/")[2];
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
        return new Response(
            resultPage({
                ok: false,
                title: "メールアカウントを接続できませんでした",
                detail: `${error}${url.searchParams.get("error_description") ? `\n${url.searchParams.get("error_description")}` : ""}`,
            }),
            { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
    }

    if (!code || !state) {
        return new Response(
            resultPage({
                ok: false,
                title: "メールアカウントを接続できませんでした",
                detail: "認証情報が不足しています（code / state）。もう一度お試しください。",
            }),
            { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
    }

    try {
        const result = await ctx.runAction(api.mailIngest.completeOAuth, { provider, code, state });
        return new Response(
            resultPage({
                ok: true,
                title: `${result.label} を接続しました`,
                detail: `${result.email}\nこのウィンドウは自動で閉じます。届いた物件紹介メールが自動で抽出・照合されます。`,
            }),
            { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
    } catch (err) {
        return new Response(
            resultPage({
                ok: false,
                title: "メールアカウントを接続できませんでした",
                detail: err instanceof Error ? err.message : String(err),
            }),
            { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
    }
});

http.route({ path: "/oauth/gmail/callback", method: "GET", handler: oauthCallback });
http.route({ path: "/oauth/outlook/callback", method: "GET", handler: oauthCallback });

export default http;
