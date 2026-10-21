/**
 * Read-only mailbox connection: sync a broker's incoming 物件紹介 (property
 * introduction) emails, extract structured listing data with an LLM, and run
 * them through the SAME hard-filter matching every scraped listing goes
 * through — so an emailed listing shows up wherever it would if a scraper had
 * found it.
 *
 * "use node" — this file decodes base64/base64url email and attachment
 * bodies via `Buffer`, a Node global the default Convex V8 isolate runtime
 * does not provide.
 *
 * THIS IS READ-ONLY AND SEPARATE FROM SENDING
 * --------------------------------------------
 * The proposal-email SEND integration (Outlook OAuth, Microsoft Graph
 * sendMail) was removed entirely — see convex/emailSettings.js and
 * ProposalModal.tsx, which now just open the user's own mail client via
 * mailto:. This file is a DIFFERENT connection for a DIFFERENT purpose: it
 * reads incoming mail (gmail.readonly / Mail.Read), it never sends anything.
 *
 * HOW THE FLOW HANGS TOGETHER (mirrors the removed send integration's OAuth
 * shape, since the CSRF problem is identical — see oauthStates in schema.js)
 * ------------------------------------------------------------------------
 * 1. Browser calls `startOAuth` (authenticated), which mints a state, stores
 *    it with the caller's userId, and returns the provider's consent URL.
 * 2. Provider redirects the BROWSER to convex/http.js's
 *    `/oauth/{provider}/callback`. That request carries no Clerk session,
 *    which is exactly why step 1 recorded the state.
 * 3. The callback calls `completeOAuth`, which exchanges the code for tokens
 *    and stores them in `mailAccounts`.
 * 4. A Convex cron (see crons.js) periodically calls `syncAllAccounts`, which
 *    syncs each connected mailbox: list new messages since the stored cursor,
 *    extract listing(s) from each with an LLM, run them through hardFilter
 *    against every order, and write matches — the same shape ingestScrape()
 *    in ingest.js writes for a scraped listing.
 *
 * TOKENS
 * ------
 * Same trust model as the removed send integration: refresh tokens are
 * long-lived mailbox credentials, read only by internal server-side
 * functions, never returned to the browser (myAccounts projects only
 * provider/email/status).
 */
"use node";

import { action, internalAction } from "./_generated/server.js";
import { v } from "convex/values";
import { api, internal } from "./_generated/api.js";
import { requireUserId } from "./lib/authz.js";
import { matchOrders } from "./lib/hardFilter.js";
import { parseEmailListings, applyIngestRules } from "./lib/mailParse.js";

/** Per-provider OAuth + Graph/Gmail API endpoints. Client credentials come
 *  from env vars so an unconfigured deployment shows no connect button rather
 *  than one that fails on click (see availableProviders in mailAccounts.js). */
export const PROVIDERS = {
  gmail: {
    label: "Gmail",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
  },
  outlook: {
    label: "Outlook",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "offline_access Mail.Read User.Read",
    clientIdEnv: "MICROSOFT_OAUTH_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_OAUTH_CLIENT_SECRET",
  },
};

function providerConfig(provider) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`不明なプロバイダーです: ${provider}`);
  const clientId = process.env[cfg.clientIdEnv];
  const clientSecret = process.env[cfg.clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new Error(
      `${cfg.label}の連携設定が未完了です: ${cfg.clientIdEnv} / ${cfg.clientSecretEnv} が設定されていません。` +
        ` (Run: npx convex env set ${cfg.clientIdEnv} <value> && npx convex env set ${cfg.clientSecretEnv} <value>)`,
    );
  }
  return { ...cfg, clientId, clientSecret };
}

/**
 * `Response.json()` throws an opaque "Unexpected token '<'... is not valid
 * JSON" when the server sends back an HTML error page instead of JSON (a
 * Google/Microsoft edge error, an expired/wrong-scope token redirecting to a
 * login page, a typo'd URL hitting a generic 404 page, etc.) — confirmed live
 * this is exactly what happened on a real sync. Every external call in this
 * file reads the body as text first and reports which call failed and a
 * snippet of what actually came back, instead of that opaque parse error.
 */
async function readJson(response, label) {
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `${label}の応答がJSON形式ではありません (HTTP ${response.status}): ${raw.slice(0, 300)}`,
    );
  }
}

function redirectUri(provider) {
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (!siteUrl)
    throw new Error("CONVEX_SITE_URL is not set on this deployment");
  return `${siteUrl}/oauth/${provider}/callback`;
}

/** Open the provider's consent screen. Mirrors the removed send-integration's
 *  startOAuth exactly — same CSRF problem, same fix. */
export const startOAuth = action({
  args: { provider: v.string(), redirectTo: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const cfg = providerConfig(args.provider);

    const state = crypto.randomUUID() + crypto.randomUUID();
    await ctx.runMutation(internal.mailIngestData.saveOAuthState, {
      state,
      userId,
      provider: args.provider,
      redirectTo: args.redirectTo,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: redirectUri(args.provider),
      response_type: "code",
      scope: cfg.scope,
      state,
    });
    if (args.provider === "gmail") {
      // access_type=offline + prompt=consent is the only way Google reliably
      // hands back a refresh_token on a repeat connect — without prompt=consent
      // a user who connected before gets no refresh_token at all on reconnect.
      params.set("access_type", "offline");
      params.set("prompt", "consent");
    }

    return { url: `${cfg.authUrl}?${params.toString()}` };
  },
});

/** Exchange the OAuth code for tokens and store the connection. Called from
 *  convex/http.js's callback route (no Clerk session — the state IS the
 *  identity check). */
export const completeOAuth = action({
  args: { provider: v.string(), code: v.string(), state: v.string() },
  handler: async (ctx, args) => {
    const stateRow = await ctx.runMutation(
      internal.mailIngestData.consumeOAuthState,
      {
        state: args.state,
      },
    );
    if (!stateRow || stateRow.provider !== args.provider) {
      throw new Error("認証情報の検証に失敗しました。もう一度お試しください。");
    }

    const cfg = providerConfig(args.provider);
    const tokenRes = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code: args.code,
        redirect_uri: redirectUri(args.provider),
        grant_type: "authorization_code",
      }),
    });
    const tokenBody = await readJson(tokenRes, `${cfg.label}トークン交換`);
    if (!tokenRes.ok) {
      throw new Error(
        `トークン取得に失敗しました (${cfg.label}, HTTP ${tokenRes.status}): ${tokenBody.error_description || tokenBody.error || JSON.stringify(tokenBody)}`,
      );
    }
    const { access_token, refresh_token, expires_in } = tokenBody;
    if (!refresh_token) {
      throw new Error(
        `${cfg.label}が更新トークンを返しませんでした。既に接続済みの場合は一度「解除」してから再接続してください。`,
      );
    }

    const email = await fetchAccountEmail(args.provider, access_token);

    await ctx.runMutation(internal.mailIngestData.upsertMailAccount, {
      userId: stateRow.userId,
      provider: args.provider,
      email,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + (expires_in || 3600) * 1000,
      scope: cfg.scope,
    });

    return { label: cfg.label, email };
  },
});

async function fetchAccountEmail(provider, accessToken) {
  if (provider === "gmail") {
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const body = await readJson(res, "Gmailプロフィール取得");
    if (!res.ok)
      throw new Error(
        `Gmailプロフィール取得に失敗しました: ${JSON.stringify(body)}`,
      );
    return body.emailAddress;
  }
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await readJson(res, "Microsoft Graphプロフィール取得");
  if (!res.ok)
    throw new Error(
      `Microsoft Graphプロフィール取得に失敗しました: ${JSON.stringify(body)}`,
    );
  return body.mail || body.userPrincipalName;
}

/** Refresh an access token, persisting the new one. Returns the (possibly
 *  refreshed) access token to use right now. */
async function getValidAccessToken(ctx, account) {
  if (account.expiresAt > Date.now() + 60_000) return account.accessToken;

  const cfg = providerConfig(account.provider);
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: account.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await readJson(res, "トークン更新");
  if (!res.ok) {
    await ctx.runMutation(internal.mailIngestData.markNeedsReconnect, {
      id: account._id,
      lastError: `トークン更新に失敗しました: ${body.error_description || body.error || JSON.stringify(body)}`,
    });
    throw new Error("REAUTH_REQUIRED");
  }
  const expiresAt = Date.now() + (body.expires_in || 3600) * 1000;
  await ctx.runMutation(internal.mailIngestData.saveRefreshedToken, {
    id: account._id,
    accessToken: body.access_token,
    // Google does not always re-issue a refresh_token on refresh; keep the
    // existing one when it doesn't.
    refreshToken: body.refresh_token || account.refreshToken,
    expiresAt,
  });
  return body.access_token;
}

/** Extract text from a PDF attachment's raw bytes. Table-heavy 物件概要書
 *  layouts may extract with jumbled label/value adjacency (pdf-parse reads in
 *  raw stream order, not visual grid order) — the extraction prompt below is
 *  told this is a raw dump, not a guarantee, and left to do its best.
 *
 *  Gemini can read a PDF's real layout directly instead of needing this at
 *  all, which would be the better path here — but the GEMINI_API_KEY
 *  configured on this deployment needs paid prepay credits that are
 *  currently depleted (confirmed live), so this uses Groq (see
 *  extractListings) instead, which is text-only. */
async function pdfToText(bytes) {
  // Import the lib entry, NOT the package root. pdf-parse@1.1.1's index.js
  // runs a "debug" block when `module.parent` is falsy, which under Convex's
  // bundler it always is — so importing "pdf-parse" makes every call read a
  // test fixture off disk and throw ENOENT ./test/data/05-versions-space.pdf
  // before touching the real buffer. This silently ate every PDF attachment.
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
  const result = await pdfParse(Buffer.from(bytes));
  return result.text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Groq's free "on_demand" tier caps at 8000 tokens/minute for this model —
// with real requests running ~3000-4000 tokens (email body + PDF text), only
// ~2 fit per 60s window. Reactive retry-after-429 alone isn't enough: by the
// time one message's retry succeeds, the next message's first attempt can
// still collide with the same near-exhausted window. So usage is tracked
// here (a rolling log of {time, tokens}, module-scoped — fine to reset
// between action invocations since it's a live rate limit, not saved state)
// and checked BEFORE each call, not just recovered from after.
let tokenUsageLog = [];
const TPM_LIMIT = 8000;
const TPM_SAFE = 7000; // margin below the hard cap for estimation error

function pruneTokenLog(now) {
  tokenUsageLog = tokenUsageLog.filter((e) => now - e.time < 60000);
}

function estimateTokens(body) {
  // Rough chars-per-token proxy for mixed Japanese/English text — good
  // enough to decide "wait" vs "go", not an exact count.
  return Math.ceil(JSON.stringify(body.messages).length / 2);
}

async function waitForTokenBudget(estimatedTokens) {
  for (;;) {
    const now = Date.now();
    pruneTokenLog(now);
    const used = tokenUsageLog.reduce((sum, e) => sum + e.tokens, 0);
    if (used + estimatedTokens <= TPM_SAFE || tokenUsageLog.length === 0)
      return;
    const oldest = tokenUsageLog[0];
    await sleep(Math.max(60000 - (now - oldest.time) + 1000, 1000));
  }
}

// Groq's 429 body writes the wait as e.g. "802.5ms", "21.0975s", or
// "8m50.063999999s" — parses whichever combination of h/m/(s|ms) is present.
function parseRetryAfterMs(message) {
  const outer = (message || "").match(
    /try again in ((?:\d+h)?(?:\d+m)?[\d.]+(?:ms|s))/i,
  );
  if (!outer) return null;
  let str = outer[1];
  let totalMs = 0;
  const h = str.match(/^(\d+)h/);
  if (h) {
    totalMs += parseFloat(h[1]) * 3600000;
    str = str.slice(h[0].length);
  }
  const m = str.match(/^(\d+)m/);
  if (m) {
    totalMs += parseFloat(m[1]) * 60000;
    str = str.slice(m[0].length);
  }
  if (/ms$/.test(str)) totalMs += parseFloat(str);
  else if (/s$/.test(str)) totalMs += parseFloat(str) * 1000;
  return totalMs;
}

/**
 * Falls back to a fixed wait if the 429 body's format changes; gives up
 * after a few tries (the proactive wait above should make this rare) — EXCEPT
 * for a tokens-PER-DAY limit (as opposed to per-minute): that's a different,
 * much larger budget (200k/day on the free tier) that doesn't meaningfully
 * refill on the timescale of one message's retry. Waiting the exact quoted
 * time frees roughly enough for THIS request and no more, so retrying every
 * subsequent message the same way would mean an ~8min wait per remaining
 * message — impractical and likely to blow the action's execution time.
 * Thrown as a distinguishable error so syncOneAccount can abort the batch
 * instead of retrying it message-by-message.
 */
async function callGroqWithRetry(body) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");

  const estimated = estimateTokens(body);
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await waitForTokenBudget(estimated);

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const data = await readJson(response, "Groq抽出");

    if (response.status === 429) {
      const msg = data.error?.message || "";
      if (/tokens per day|\(TPD\)/i.test(msg)) {
        const err = new Error(msg);
        err.code = "GROQ_TPD_EXHAUSTED";
        throw err;
      }
      if (attempt < maxAttempts) {
        await sleep((parseRetryAfterMs(msg) ?? 5000) + 500);
        continue;
      }
    }
    if (!response.ok) {
      throw new Error(
        data.error?.message || `Groq API error (HTTP ${response.status})`,
      );
    }
    tokenUsageLog.push({
      time: Date.now(),
      tokens: data.usage?.total_tokens || estimated,
    });
    return data;
  }
  throw new Error(
    "Groq API error: レート制限のため複数回リトライしましたが失敗しました",
  );
}

/**
 * Rules first, LLM only for what rules cannot read.
 *
 * Most broker mail states its property as label-value text in the body, which
 * convex/lib/mailParse.js reads deterministically — no API call, no quota, and
 * it keeps working while every configured provider is down (Groq's daily token
 * cap aborted a real 25-message batch, Rax AI is in maintenance, the Gemini
 * key is out of credit). The LLM is reached only for a message that looks like
 * a listing but did not parse: in practice a cover note whose data is entirely
 * inside a マイソク PDF, whose two-column layout pdfToText shreds beyond what
 * regex can pair up.
 *
 * A message the parser judges to be neither (a newsletter, or a 物件求 — a
 * broker advertising what they want to buy) costs nothing at all. That is a
 * precision gain, not just a saving: asked to read those, the LLM invented
 * listings, and four "Premium deal — Seoul" rows from a flight-deals mailout
 * are still in the listings table.
 */
async function extractListings(emailText, pdfBuffers) {
  const pdfTexts = [];
  for (const bytes of pdfBuffers || []) {
    try {
      pdfTexts.push(await pdfToText(bytes));
    } catch (e) {
      console.error("[MailIngest] PDF text extraction failed:", e);
    }
  }

  const parsed = parseEmailListings(emailText, pdfTexts);
  if (parsed.listings.length > 0) {
    console.log(
      `[MailIngest] Parsed ${parsed.listings.length} listing(s) without the LLM`,
    );
    return parsed.listings;
  }
  if (!parsed.needsLlm) {
    console.log(`[MailIngest] Skipped (${parsed.reason})`);
    return [];
  }
  await sleep(1500);
  return await extractListingsWithLlm(emailText, pdfTexts);
}

/**
 * One call per broker email — extracts EVERY property it describes (a single
 * email can introduce several, confirmed in real examples: one "練馬・国立"
 * email described two unrelated buildings) into structured fields.
 *
 * Uses Groq, not the Rax AI gateway convex/evaluate.js depends on — Rax AI
 * had an extended maintenance outage that made this whole feature
 * untestable. Gemini (also configured on this deployment) would read a PDF's
 * real layout natively instead of needing pdfToText, which is exactly what
 * every message that still reaches this function needs, but its key is out of
 * prepay credits — worth revisiting if that gets funded.
 */
async function extractListingsWithLlm(emailText, pdfTexts) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");
  const pdfSection = pdfTexts
    .map(
      (t, i) =>
        `\n\n=== 添付PDF ${i + 1} (抽出テキスト) ===\n${t.slice(0, 6000)}`,
    )
    .join("");

  const prompt = `以下は不動産仲介会社から届いたメール（と添付資料）です。紹介されている物件を全て抽出してください。
1通のメールに複数の物件が含まれることがあります。該当する物件が無ければ空配列を返してください。

${emailText.slice(0, 6000)}${pdfSection}

不明な項目はnullにしてください。推測で埋めないこと。
価格・年収は万円単位の数値、利回りは%を除いた数値、面積は㎡単位の数値、徒歩は分単位の整数にしてください。
propertyTypeは 土地|一戸建て|マンション|一棟マンション|アパート|ビル|店舗 のいずれかにしてください。
titleは本文中の「物件名」があればそれを使い、無ければメールの件名ではなく住所や種別から短い名前を作ってください。

以下の形式のJSONオブジェクトのみを出力してください。他の文章は一切含めないこと。
{"listings": [{"title": string|null, "address": string|null, "ward": string|null, "price": number|null, "area": number|null, "landSize": number|null, "station": string|null, "walkMinutes": number|null, "propertyType": string|null, "yield": number|null, "buildYear": number|null, "structure": string|null, "buildingCoverageRatio": number|null, "floorAreaRatio": number|null, "roadWidth": number|null, "totalUnits": number|null, "description": string|null}]}`;

  const data = await callGroqWithRetry({
    model: "openai/gpt-oss-120b",
    messages: [
      {
        role: "system",
        content:
          "あなたは日本の不動産仲介メールから物件データを抽出する専門システムです。指定されたJSON形式以外は絶対に出力しないでください。推測で数値を埋めず、記載が無い項目はnullにしてください。",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  });

  const content = data.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(
      `抽出結果がJSON形式ではありません: ${String(content).slice(0, 300)}`,
    );
  }
  return Array.isArray(parsed.listings) ? parsed.listings : [];
}

async function fetchGmailMessage(accessToken, id) {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const msg = await readJson(res, "Gmailメッセージ取得");
  if (!res.ok)
    throw new Error(
      `Gmailメッセージ取得に失敗しました: ${JSON.stringify(msg)}`,
    );

  const headers = Object.fromEntries(
    (msg.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]),
  );

  let bodyText = "";
  const pdfParts = [];
  // Every named part, PDF or not — the inspector shows what a message actually
  // carried, so "the データ is in the Excel sheet" is visible rather than
  // looking like an empty email.
  const attachments = [];
  const walk = (part) => {
    if (!part) return;
    if (part.mimeType === "text/plain" && part.body?.data) {
      bodyText +=
        Buffer.from(part.body.data, "base64url").toString("utf-8") + "\n";
    }
    if (part.filename) {
      attachments.push({
        id: part.body?.attachmentId || "",
        filename: part.filename,
        mimeType: part.mimeType || "",
        size: part.body?.size || 0,
      });
    }
    if (part.mimeType === "application/pdf" && part.body?.attachmentId) {
      pdfParts.push(part.body.attachmentId);
    }
    (part.parts || []).forEach(walk);
  };
  walk(msg.payload);
  if (!bodyText && msg.payload?.body?.data) {
    bodyText = Buffer.from(msg.payload.body.data, "base64url").toString(
      "utf-8",
    );
  }

  const pdfBuffers = [];
  for (const attachmentId of pdfParts.slice(0, 3)) {
    try {
      const attRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/attachments/${attachmentId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const att = await readJson(attRes, "Gmail添付ファイル取得");
      if (att.data) pdfBuffers.push(Buffer.from(att.data, "base64url"));
    } catch (e) {
      // A single unfetchable attachment should not lose the whole email —
      // extraction still runs on the body text (and any other PDFs) alone.
      console.error(
        `[MailIngest] Attachment fetch failed for gmail message ${id}:`,
        e,
      );
    }
  }

  return {
    subject: headers["subject"] || "",
    from: headers["from"] || "",
    receivedAt: msg.internalDate ? parseInt(msg.internalDate, 10) : Date.now(),
    bodyText,
    pdfBuffers,
    attachments,
  };
}

async function fetchOutlookMessage(accessToken, id) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${id}?$select=subject,from,receivedDateTime,body,hasAttachments`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const msg = await readJson(res, "Graphメッセージ取得");
  if (!res.ok)
    throw new Error(
      `Graphメッセージ取得に失敗しました: ${JSON.stringify(msg)}`,
    );

  // body.contentType is usually "html" — strip tags to plain-ish text rather
  // than pulling in a full HTML parser dependency for this.
  const rawBody = msg.body?.content || "";
  const bodyText =
    msg.body?.contentType === "html"
      ? rawBody
          .replace(/<style[^>]*>.*?<\/style>/gis, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/\s+/g, " ")
      : rawBody;

  const pdfBuffers = [];
  const attachments = [];
  if (msg.hasAttachments) {
    const attRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${id}/attachments`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const attBody = await readJson(attRes, "Graph添付ファイル一覧取得");
    for (const a of attBody.value || []) {
      attachments.push({
        id: a.id || "",
        filename: a.name || "",
        mimeType: a.contentType || "",
        size: a.size || 0,
      });
    }
    const pdfAttachments = (attBody.value || [])
      .filter((a) => a.contentType === "application/pdf" && a.contentBytes)
      .slice(0, 3);
    for (const a of pdfAttachments) {
      pdfBuffers.push(Buffer.from(a.contentBytes, "base64"));
    }
  }

  return {
    subject: msg.subject || "",
    from: msg.from?.emailAddress
      ? `${msg.from.emailAddress.name || ""} <${msg.from.emailAddress.address}>`
      : "",
    receivedAt: msg.receivedDateTime
      ? new Date(msg.receivedDateTime).getTime()
      : Date.now(),
    bodyText,
    pdfBuffers,
    attachments,
  };
}

/**
 * Build a targeted query for Gmail or Outlook using the user's ingest settings
 * (required keywords, allowed senders, attachments) so the provider searches the
 * entire 3-month window directly instead of scanning only recent inbox noise.
 */
function buildProviderQuery(provider, settings, daysBack = 90) {
  if (provider === "gmail") {
    const parts = [`newer_than:${daysBack}d`, "-in:trash", "-in:spam"];
    if (settings) {
      if (settings.requireAttachment) {
        parts.push("has:attachment");
      }
      if (settings.allowedSenders && settings.allowedSenders.length > 0) {
        const senders = settings.allowedSenders
          .map((s) => `from:${s}`)
          .join(" OR ");
        parts.push(`(${senders})`);
      }
      if (settings.requiredKeywords && settings.requiredKeywords.length > 0) {
        const kws = settings.requiredKeywords.map((k) => `"${k}"`).join(" OR ");
        parts.push(`(${kws})`);
      }
      if (settings.blockedSenders && settings.blockedSenders.length > 0) {
        for (const s of settings.blockedSenders) {
          parts.push(`-from:${s}`);
        }
      }
      if (settings.blockedKeywords && settings.blockedKeywords.length > 0) {
        for (const k of settings.blockedKeywords) {
          parts.push(`-"${k}"`);
        }
      }
    }
    if (
      !settings?.requiredKeywords?.length &&
      !settings?.allowedSenders?.length
    ) {
      parts.unshift("in:inbox");
    }
    return parts.join(" ");
  }

  const startDate = new Date(
    Date.now() - daysBack * 24 * 60 * 60 * 1000,
  ).toISOString();
  let filter = `receivedDateTime ge ${startDate}`;
  if (settings?.requireAttachment) {
    filter += " and hasAttachments eq true";
  }
  return filter;
}

/** List new message ids since the stored cursor.
 *  When no cursor is provided (or when backfilling), queries up to 90 days (3 months) back with pagination. */
async function listNewMessageIds(provider, accessToken, cursor, options = {}) {
  const daysBack = options.daysBack ?? 90;
  const maxTotal = options.maxTotal ?? 500;

  if (provider === "gmail") {
    if (cursor) {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/history/list?startHistoryId=${cursor}&historyTypes=messageAdded`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (res.status === 404)
        return await listNewMessageIds("gmail", accessToken, null, options);
      const body = await readJson(res, "Gmail history取得");
      if (!res.ok) {
        throw new Error(
          `Gmail history取得に失敗しました: ${JSON.stringify(body)}`,
        );
      }
      const ids = (body.history || []).flatMap((h) =>
        (h.messagesAdded || []).map((m) => m.message.id),
      );
      const profileRes = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      const profile = await readJson(
        profileRes,
        "Gmailプロフィール取得(history)",
      );
      return {
        ids: [...new Set(ids)],
        nextCursor: String(profile.historyId || cursor),
      };
    }

    const query =
      options.query || buildProviderQuery("gmail", options.settings, daysBack);
    let allIds = [];
    let pageToken = undefined;

    do {
      const pageParam = pageToken
        ? `&pageToken=${encodeURIComponent(pageToken)}`
        : "";
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=${encodeURIComponent(query)}${pageParam}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await readJson(res, "Gmailメッセージ一覧取得");
      if (!res.ok)
        throw new Error(
          `Gmailメッセージ一覧取得に失敗しました: ${JSON.stringify(body)}`,
        );
      const pageIds = (body.messages || []).map((m) => m.id);
      allIds.push(...pageIds);
      pageToken = body.nextPageToken;
    } while (pageToken && allIds.length < maxTotal);

    const profileRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const profile = await readJson(profileRes, "Gmailプロフィール取得(一覧)");
    return {
      ids: allIds.slice(0, maxTotal),
      nextCursor: String(profile.historyId),
    };
  }

  // Outlook: delta query or date-filtered query
  if (cursor) {
    const res = await fetch(cursor, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 410 /* Gone: deltaLink expired */) {
      return await listNewMessageIds("outlook", accessToken, null, options);
    }
    const body = await readJson(res, "Outlookメッセージ一覧取得");
    if (!res.ok) {
      throw new Error(
        `Outlookメッセージ一覧取得に失敗しました: ${JSON.stringify(body)}`,
      );
    }
    const ids = (body.value || []).map((m) => m.id);
    const nextCursor =
      body["@odata.deltaLink"] || body["@odata.nextLink"] || cursor;
    return { ids, nextCursor };
  }

  const filter =
    options.filter || buildProviderQuery("outlook", options.settings, daysBack);
  let url = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$filter=${encodeURIComponent(filter)}&$top=50&$orderby=receivedDateTime desc`;
  let allIds = [];
  let nextCursor = null;

  while (url && allIds.length < maxTotal) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await readJson(res, "Outlookメッセージ一覧取得");
    if (!res.ok)
      throw new Error(
        `Outlookメッセージ一覧取得に失敗しました: ${JSON.stringify(body)}`,
      );
    const pageIds = (body.value || []).map((m) => m.id);
    allIds.push(...pageIds);
    nextCursor =
      body["@odata.deltaLink"] || body["@odata.nextLink"] || nextCursor;
    url = body["@odata.nextLink"] || null;
  }

  return { ids: allIds.slice(0, maxTotal), nextCursor: nextCursor || "" };
}

async function syncOneAccount(ctx, account, options = {}) {
  let accessToken;
  try {
    accessToken = await getValidAccessToken(ctx, account);
  } catch {
    return { synced: 0, listingsFound: 0, error: "REAUTH_REQUIRED" };
  }

  const orders = await ctx.runQuery(
    internal.mailIngestData.listAllOrderCriteria,
    {},
  );
  // Read once per account, not per message: these rules never change mid-sync.
  const ingestSettings = await ctx.runQuery(
    internal.mailIngestData.ingestSettingsForUser,
    {
      userId: account.userId,
    },
  );

  const cursorToUse = options.fullSync ? null : account.syncCursor;
  const { ids, nextCursor } = await listNewMessageIds(
    account.provider,
    accessToken,
    cursorToUse,
    {
      daysBack: options.daysBack ?? 90,
      maxTotal: options.maxTotal ?? 500,
      settings: ingestSettings,
    },
  );

  let listingsFound = 0;
  let messagesWithListings = 0;
  let filteredOut = 0;

  const messageErrors = [];
  const subjectsSeen = [];

  for (const id of ids) {
    try {
      const msg =
        account.provider === "gmail"
          ? await fetchGmailMessage(accessToken, id)
          : await fetchOutlookMessage(accessToken, id);
      subjectsSeen.push(msg.subject || "(件名なし)");

      const rule = applyIngestRules(msg, ingestSettings);
      if (!rule.accepted) {
        filteredOut++;
        console.log(`[MailIngest] 設定により除外: ${rule.reason}`);
        continue;
      }

      const emailText = `件名: ${msg.subject}\n差出人: ${msg.from}\n\n${msg.bodyText}`;
      const extracted = await extractListings(emailText, msg.pdfBuffers);
      if (extracted.length === 0) continue;
      messagesWithListings++;

      for (let i = 0; i < extracted.length; i++) {
        const item = extracted[i];
        if (!item.address && !item.title) continue;

        const pseudoUrl = `email:${account.provider}:${id}:${i}`;
        const { matchedOrderIndices, reasons: _reasons } = matchOrdersAgainst(
          item,
          orders,
        );

        await ctx.runMutation(internal.mailIngestData.saveEmailListing, {
          url: pseudoUrl,
          userId: account.userId,
          listing: item,
          emailFrom: msg.from,
          emailReceivedAt: msg.receivedAt,
          emailSubject: msg.subject,
          emailBody: (msg.bodyText || "").slice(0, 10000),
          emailAttachments: (msg.attachments || []).map((a) => ({
            id: a.id || "",
            filename: a.filename || "attachment",
            mimeType: a.mimeType || "",
            size: a.size || 0,
          })),
          matchedOrderIds: matchedOrderIndices.map(
            (idx) => orders[idx].orderId,
          ),
        });
        listingsFound++;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[MailIngest] Failed to process message ${id}:`, e);
      if (messageErrors.length < 5) messageErrors.push(message);
      // Groq's daily token cap, not the per-minute one — waiting the exact
      // quoted time only frees enough for one more request, so retrying the
      // rest of this batch the same way would just wait ~8min per remaining
      // message. Stop here instead of grinding through the rest of ids.
      if (e && e.code === "GROQ_TPD_EXHAUSTED") {
        messageErrors.push(
          "Groqの1日の利用上限に達したため、残りのメールは処理せず同期を中断しました。時間をおいて再度「今すぐ同期」をお試しください。",
        );
        return {
          synced: ids.length,
          subjectsSeen: subjectsSeen.slice(0, 10),
          messagesWithListings,
          listingsFound,
          filteredOut,
          messageErrors,
        };
      }
    }
  }

  await ctx.runMutation(internal.mailIngestData.saveSyncCursor, {
    id: account._id,
    syncCursor: nextCursor,
    lastSyncedAt: Date.now(),
  });

  return {
    synced: ids.length,
    subjectsSeen: subjectsSeen.slice(0, 10),
    messagesWithListings,
    listingsFound,
    filteredOut,
    messageErrors,
  };
}

function matchOrdersAgainst(item, orders) {
  return matchOrders(
    item,
    orders.map((o) => o.criteria),
  );
}

export const syncNow = action({
  args: {
    fullSync: v.optional(v.boolean()),
    daysBack: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const accounts = await ctx.runQuery(
      internal.mailIngestData.accountsForUser,
      { userId },
    );
    const results = [];
    for (const account of accounts) {
      results.push({
        provider: account.provider,
        ...(await syncOneAccount(ctx, account, {
          fullSync: args.fullSync ?? true,
          daysBack: args.daysBack ?? 90,
        })),
      });
    }
    return results;
  },
});

export const inspectRecentMail = action({
  args: {
    limit: v.optional(v.number()),
    matchingOnly: v.optional(v.boolean()),
    daysBack: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const limit = args.limit ?? 50;
    const matchingOnly = args.matchingOnly ?? true;
    const daysBack = args.daysBack ?? 90;
    const accounts = await ctx.runQuery(
      internal.mailIngestData.accountsForUser,
      { userId },
    );
    const ingestSettings = await ctx.runQuery(
      internal.mailIngestData.ingestSettingsForUser,
      { userId },
    );

    const out = [];
    for (const account of accounts) {
      let accessToken;
      try {
        accessToken = await getValidAccessToken(ctx, account);
      } catch {
        out.push({ provider: account.provider, error: "REAUTH_REQUIRED" });
        continue;
      }

      const { ids } = await listNewMessageIds(
        account.provider,
        accessToken,
        null,
        {
          daysBack,
          maxTotal: 500,
          settings: ingestSettings,
        },
      );

      for (const id of ids) {
        if (out.length >= limit) break;
        try {
          const msg =
            account.provider === "gmail"
              ? await fetchGmailMessage(accessToken, id)
              : await fetchOutlookMessage(accessToken, id);

          const rule = applyIngestRules(msg, ingestSettings);
          if (matchingOnly && !rule.accepted) {
            continue;
          }

          const pdfTexts = [];
          if (rule.accepted) {
            for (const bytes of msg.pdfBuffers || []) {
              try {
                pdfTexts.push(await pdfToText(bytes));
              } catch (e) {
                pdfTexts.push(
                  `（PDF読み取り失敗: ${e instanceof Error ? e.message : String(e)}）`,
                );
              }
            }
          }

          const emailText = `件名: ${msg.subject}\n差出人: ${msg.from}\n\n${msg.bodyText}`;
          const parsed = parseEmailListings(emailText, pdfTexts);

          out.push({
            provider: account.provider,
            id,
            subject: msg.subject,
            from: msg.from,
            receivedAt: msg.receivedAt,
            bodyText: (msg.bodyText || "").slice(0, 8000),
            attachments: msg.attachments || [],
            pdfTexts: pdfTexts.map((t) => t.slice(0, 4000)),
            filtered: !rule.accepted,
            filterReason: rule.reason,
            listings: rule.accepted ? parsed.listings : [],
            needsLlm: rule.accepted ? parsed.needsLlm : false,
            reason: rule.accepted ? parsed.reason : rule.reason,
          });
        } catch (e) {
          out.push({
            provider: account.provider,
            id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
    return out;
  },
});

export const syncAllAccounts = internalAction({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.runQuery(
      internal.mailIngestData.allAccounts,
      {},
    );
    for (const account of accounts) {
      if (account.needsReconnect) continue;
      try {
        await syncOneAccount(ctx, account);
      } catch (e) {
        console.error(
          `[MailIngest] Sync failed for account ${account._id}:`,
          e,
        );
      }
    }
  },
});

/**
 * DEV-ONLY corpus dump — not called by the app, not exposed publicly.
 *
 * A rule-based extractor (see the planned convex/lib/mailParse.js) has to be
 * written against the formats these brokers actually send, and nothing
 * persists a raw body: saveEmailListing stores only the extracted fields.
 * This returns what syncOneAccount would feed the LLM — the same bodyText and
 * the same pdfToText output — so regexes can be built and tested against real
 * mail instead of guessed formats.
 *
 * Run: npx convex run mailIngest:dumpRawMessages '{"limit":10}' > corpus.json
 *
 * Deliberately passes a null cursor to listNewMessageIds: the stored cursor
 * only yields messages arrived since the last sync, which on an already-synced
 * account is nothing. Null takes the most recent 25 inbox messages instead.
 * Reads nothing into the DB and does not advance the cursor, so running it
 * cannot disturb a real sync.
 */
export const dumpRawMessages = internalAction({
  args: {
    userId: v.optional(v.string()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    // Gmail search string, e.g. "物件 OR 収益 OR マイソク". Overrides the default
    // in:inbox listing so a mailbox where broker mail is filed, archived or
    // older than the most recent 25 can still be sampled.
    gmailQuery: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const offset = args.offset ?? 0;
    // Japanese text is ~3 bytes/char in UTF-8 and Convex caps a function's
    // return value — truncate per-field so a few long マイソク PDFs can't push
    // one dump over the limit and lose the whole batch.
    const CAP = 10000;
    const clip = (s) =>
      s.length > CAP
        ? `${s.slice(0, CAP)}\n<<truncated ${s.length - CAP} chars>>`
        : s;

    const accounts = args.userId
      ? await ctx.runQuery(internal.mailIngestData.accountsForUser, {
          userId: args.userId,
        })
      : await ctx.runQuery(internal.mailIngestData.allAccounts, {});

    const out = [];
    for (const account of accounts) {
      let accessToken;
      try {
        accessToken = await getValidAccessToken(ctx, account);
      } catch {
        out.push({ provider: account.provider, error: "REAUTH_REQUIRED" });
        continue;
      }

      let ids;
      if (args.gmailQuery && account.provider === "gmail") {
        const res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${offset + limit}&q=${encodeURIComponent(args.gmailQuery)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const body = await readJson(res, "Gmail検索");
        if (!res.ok)
          throw new Error(`Gmail検索に失敗しました: ${JSON.stringify(body)}`);
        ids = (body.messages || []).map((m) => m.id);
      } else {
        ({ ids } = await listNewMessageIds(
          account.provider,
          accessToken,
          null,
        ));
      }
      for (const id of ids.slice(offset, offset + limit)) {
        try {
          const msg =
            account.provider === "gmail"
              ? await fetchGmailMessage(accessToken, id)
              : await fetchOutlookMessage(accessToken, id);

          const pdfTexts = [];
          for (const bytes of msg.pdfBuffers || []) {
            try {
              pdfTexts.push(clip(await pdfToText(bytes)));
            } catch (e) {
              pdfTexts.push(
                `<<PDF抽出失敗: ${e instanceof Error ? e.message : String(e)}>>`,
              );
            }
          }

          out.push({
            provider: account.provider,
            id,
            subject: msg.subject,
            from: msg.from,
            receivedAt: msg.receivedAt,
            // Flagged separately because an empty body is a format finding,
            // not a failure: fetchGmailMessage only walks text/plain parts, so
            // an HTML-only broker mail lands here blank and would need an HTML
            // path before any parser could read it.
            bodyEmpty: !(msg.bodyText || "").trim(),
            bodyText: clip(msg.bodyText || ""),
            pdfCount: (msg.pdfBuffers || []).length,
            pdfTexts,
          });
        } catch (e) {
          out.push({
            provider: account.provider,
            id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
    return out;
  },
});

export const getAttachmentData = action({
  args: {
    provider: v.string(),
    messageId: v.string(),
    attachmentId: v.string(),
    mimeType: v.optional(v.string()),
    filename: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const accounts = await ctx.runQuery(
      internal.mailIngestData.accountsForUser,
      { userId },
    );
    const account = accounts.find((a) => a.provider === args.provider);
    if (!account) throw new Error("メールアカウントが見つかりません");

    const accessToken = await getValidAccessToken(ctx, account);
    let buffer;
    let contentType = args.mimeType || "application/pdf";

    if (args.provider === "gmail") {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.messageId}/attachments/${args.attachmentId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const att = await readJson(res, "Gmail添付ファイル取得");
      if (!att.data)
        throw new Error("添付ファイルデータを取得できませんでした");
      buffer = Buffer.from(att.data, "base64url");
    } else {
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${args.messageId}/attachments/${args.attachmentId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const att = await readJson(res, "Graph添付ファイル取得");
      if (!att.contentBytes)
        throw new Error("添付ファイルデータを取得できませんでした");
      buffer = Buffer.from(att.contentBytes, "base64");
      if (att.contentType) contentType = att.contentType;
    }

    return {
      base64: buffer.toString("base64"),
      mimeType: contentType,
      filename: args.filename,
    };
  },
});

export const getEmailDetailsForListing = action({
  args: { listingId: v.id("listings") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const listing = await ctx.runQuery(internal.mailIngestData.getListingById, {
      id: args.listingId,
    });
    if (!listing || listing.source !== "email" || !listing.url) return null;

    const parts = listing.url.split(":");
    const provider = parts[1] || "gmail";
    const messageId = parts[2] || "";

    // If already cached on the listing document with attachments and subject
    if (listing.emailSubject !== undefined && listing.emailAttachments !== undefined) {
      return {
        provider,
        messageId,
        subject: listing.emailSubject || "",
        bodyText: listing.emailBody || "",
        attachments: listing.emailAttachments || [],
        from: listing.emailFrom || "",
        receivedAt: listing.emailReceivedAt,
      };
    }

    if (!messageId) return null;

    const accounts = await ctx.runQuery(
      internal.mailIngestData.accountsForUser,
      { userId },
    );
    const account = accounts.find((a) => a.provider === provider);
    if (!account) {
      return {
        provider,
        messageId,
        subject: listing.emailSubject || "",
        bodyText: listing.emailBody || "",
        attachments: listing.emailAttachments || [],
        from: listing.emailFrom || "",
        receivedAt: listing.emailReceivedAt,
      };
    }

    try {
      const accessToken = await getValidAccessToken(ctx, account);
      const msg =
        provider === "gmail"
          ? await fetchGmailMessage(accessToken, messageId)
          : await fetchOutlookMessage(accessToken, messageId);

      const attachments = (msg.attachments || []).map((a) => ({
        id: a.id || "",
        filename: a.filename || "attachment",
        mimeType: a.mimeType || "",
        size: a.size || 0,
      }));

      await ctx.runMutation(internal.mailIngestData.updateListingEmailDetails, {
        listingId: args.listingId,
        emailSubject: msg.subject,
        emailBody: (msg.bodyText || "").slice(0, 10000),
        emailAttachments: attachments,
      });

      return {
        provider,
        messageId,
        subject: msg.subject,
        bodyText: msg.bodyText || "",
        attachments,
        from: msg.from || listing.emailFrom,
        receivedAt: msg.receivedAt || listing.emailReceivedAt,
      };
    } catch (e) {
      console.error(`[MailIngest] Failed to fetch email details for listing:`, e);
      return {
        provider,
        messageId,
        subject: listing.emailSubject || "",
        bodyText: listing.emailBody || "",
        attachments: listing.emailAttachments || [],
        from: listing.emailFrom || "",
        receivedAt: listing.emailReceivedAt,
      };
    }
  },
});

