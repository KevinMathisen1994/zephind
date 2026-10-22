/**
 * Read-only mailbox connection: sync a broker's incoming 物件紹介 (property
 * introduction) emails, extract structured listing data, and run them through
 * the SAME hard-filter matching every scraped listing goes through — so an
 * emailed listing shows up wherever it would if a scraper had found it.
 *
 * Ported from convex/mailIngest.js. That file was a Convex "use node" module
 * and therefore could not touch the database directly; every read and write
 * went through convex/mailIngestData.js. Here both halves are ordinary
 * functions (see ../lib/mailData.ts).
 *
 * THIS IS READ-ONLY AND SEPARATE FROM SENDING
 * -------------------------------------------
 * The proposal-email SEND integration was removed entirely; ProposalModal.tsx
 * opens the user's own mail client via mailto:. This reads incoming mail
 * (gmail.readonly / Mail.Read) and never sends anything.
 *
 * HOW THE FLOW HANGS TOGETHER
 * ---------------------------
 * 1. Browser calls startOAuth (authenticated), which mints a state, stores it
 *    with the caller's userId, and returns the provider's consent URL.
 * 2. Provider redirects the BROWSER to /oauth/{provider}/callback. That request
 *    carries no Clerk session, which is exactly why step 1 recorded the state.
 * 3. The callback calls completeOAuth, which exchanges the code for tokens and
 *    stores them in `mailAccounts`.
 * 4. A cron (see ../jobs/cron.ts) periodically calls syncAllAccounts.
 *
 * TOKENS: refresh tokens are long-lived mailbox credentials, read only by this
 * module, never returned to the browser (myAccounts projects only
 * provider/email/status).
 */
import type { Doc } from "../db";
import * as mailData from "../lib/mailData";
// Pure JS modules, deliberately untyped (see tsconfig checkJs).
import { matchOrders } from "../lib/hardFilter.js";
import { applyIngestRules, parseEmailListings } from "../lib/mailParse.js";

/**
 * Per-provider OAuth + Graph/Gmail endpoints. Client credentials come from env
 * vars so an unconfigured deployment shows no connect button rather than one
 * that fails on click.
 */
export const PROVIDERS: Record<string, any> = {
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

function providerConfig(provider: string) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`不明なプロバイダーです: ${provider}`);
  const clientId = process.env[cfg.clientIdEnv];
  const clientSecret = process.env[cfg.clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new Error(
      `${cfg.label}の連携設定が未完了です: ${cfg.clientIdEnv} / ${cfg.clientSecretEnv} が設定されていません。`,
    );
  }
  return { ...cfg, clientId, clientSecret };
}

/**
 * `Response.json()` throws an opaque "Unexpected token '<'... is not valid
 * JSON" when the server sends back an HTML error page instead of JSON (a
 * Google/Microsoft edge error, an expired or wrong-scope token redirecting to a
 * login page, a typo'd URL hitting a generic 404). Every external call here
 * reads the body as text first and reports which call failed and a snippet of
 * what actually came back.
 */
async function readJson(response: Response, label: string): Promise<any> {
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label}の応答がJSON形式ではありません (HTTP ${response.status}): ${raw.slice(0, 300)}`);
  }
}

/** Where the provider sends the browser back to. Must match the console config. */
function redirectUri(provider: string) {
  // Escape hatch: if the provider console already has a different URI registered
  // (a different port, a tunnel domain, or a `/api` prefix added by a proxy),
  // point the app at THAT value instead of moving the registration. The exact
  // string must match the console byte-for-byte — this is the value that
  // "redirect_uri is not valid" is complaining about.
  const override = process.env[`${provider.toUpperCase()}_OAUTH_REDIRECT_URI`];
  if (override) return override;

  const siteUrl = process.env.PUBLIC_BACKEND_URL;
  if (!siteUrl) throw new Error("PUBLIC_BACKEND_URL is not set on this service");
  return `${siteUrl.replace(/\/$/, "")}/oauth/${provider}/callback`;
}

/** Open the provider's consent screen. */
export async function startOAuth(userId: string, provider: string, redirectTo?: string) {
  const cfg = providerConfig(provider);
  const state = crypto.randomUUID() + crypto.randomUUID();
  await mailData.saveOAuthState({
    state, userId, provider, redirectTo, expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(provider),
    response_type: "code",
    scope: cfg.scope,
    state,
  });
  if (provider === "gmail") {
    // access_type=offline + prompt=consent is the only way Google reliably
    // hands back a refresh_token on a repeat connect — without prompt=consent a
    // user who connected before gets no refresh_token at all on reconnect.
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }
  return { url: `${cfg.authUrl}?${params.toString()}` };
}

/**
 * Exchange the OAuth code for tokens and store the connection. Called from the
 * callback route, which has no Clerk session — the state IS the identity check.
 */
export async function completeOAuth(provider: string, code: string, state: string) {
  const stateRow = await mailData.consumeOAuthState(state);
  if (!stateRow || stateRow.provider !== provider) {
    throw new Error("認証情報の検証に失敗しました。もう一度お試しください。");
  }

  const cfg = providerConfig(provider);
  const tokenRes = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: redirectUri(provider),
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

  const email = await fetchAccountEmail(provider, access_token);
  await mailData.upsertMailAccount({
    userId: stateRow.userId as string,
    provider,
    email,
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: Date.now() + (expires_in || 3600) * 1000,
    scope: cfg.scope,
  });
  return { label: cfg.label as string, email };
}

async function fetchAccountEmail(provider: string, accessToken: string) {
  if (provider === "gmail") {
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await readJson(res, "Gmailプロフィール取得");
    if (!res.ok) throw new Error(`Gmailプロフィール取得に失敗しました: ${JSON.stringify(body)}`);
    return body.emailAddress;
  }
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await readJson(res, "Microsoft Graphプロフィール取得");
  if (!res.ok) throw new Error(`Microsoft Graphプロフィール取得に失敗しました: ${JSON.stringify(body)}`);
  return body.mail || body.userPrincipalName;
}

/** Refresh an access token, persisting the new one. Returns the token to use now. */
async function getValidAccessToken(account: Doc): Promise<string> {
  if ((account.expiresAt as number) > Date.now() + 60_000) return account.accessToken;

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
    await mailData.markNeedsReconnect(
      account._id,
      `トークン更新に失敗しました: ${body.error_description || body.error || JSON.stringify(body)}`,
    );
    throw new Error("REAUTH_REQUIRED");
  }
  const expiresAt = Date.now() + (body.expires_in || 3600) * 1000;
  await mailData.saveRefreshedToken(account._id, {
    accessToken: body.access_token,
    // Google does not always re-issue a refresh_token on refresh; keep the
    // existing one when it doesn't.
    refreshToken: body.refresh_token || account.refreshToken,
    expiresAt,
  });
  return body.access_token;
}

/**
 * Extract text from a PDF attachment's raw bytes. Table-heavy 物件概要書 layouts
 * may extract with jumbled label/value adjacency (pdf-parse reads in raw stream
 * order, not visual grid order) — the extraction prompt below is told this is a
 * raw dump, not a guarantee, and left to do its best.
 */
async function pdfToText(bytes: Buffer): Promise<string> {
  // Import the lib entry, NOT the package root. pdf-parse@1.1.1's index.js runs
  // a "debug" block when `module.parent` is falsy, which makes every call read a
  // test fixture off disk and throw ENOENT ./test/data/05-versions-space.pdf
  // before touching the real buffer.
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
  const result = await pdfParse(Buffer.from(bytes));
  return result.text;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Groq's free "on_demand" tier caps at 8000 tokens/minute for this model — with
// real requests running ~3000-4000 tokens (email body + PDF text), only ~2 fit
// per 60s window. Reactive retry-after-429 alone isn't enough: by the time one
// message's retry succeeds, the next message's first attempt can still collide
// with the same near-exhausted window. So usage is tracked here and checked
// BEFORE each call, not just recovered from after.
let tokenUsageLog: { time: number; tokens: number }[] = [];
const TPM_SAFE = 7000; // margin below the 8000 hard cap for estimation error

function pruneTokenLog(now: number) {
  tokenUsageLog = tokenUsageLog.filter((e) => now - e.time < 60000);
}

function estimateTokens(body: any) {
  // Rough chars-per-token proxy for mixed Japanese/English text — good enough to
  // decide "wait" vs "go", not an exact count.
  return Math.ceil(JSON.stringify(body.messages).length / 2);
}

async function waitForTokenBudget(estimatedTokens: number) {
  for (;;) {
    const now = Date.now();
    pruneTokenLog(now);
    const used = tokenUsageLog.reduce((sum, e) => sum + e.tokens, 0);
    if (used + estimatedTokens <= TPM_SAFE || tokenUsageLog.length === 0) return;
    const oldest = tokenUsageLog[0];
    await sleep(Math.max(60000 - (now - oldest.time) + 1000, 1000));
  }
}

// Groq's 429 body writes the wait as e.g. "802.5ms", "21.0975s", or
// "8m50.063999999s" — parses whichever combination of h/m/(s|ms) is present.
function parseRetryAfterMs(message: string): number | null {
  const outer = (message || "").match(/try again in ((?:\d+h)?(?:\d+m)?[\d.]+(?:ms|s))/i);
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
 * Falls back to a fixed wait if the 429 body's format changes; gives up after a
 * few tries — EXCEPT for a tokens-PER-DAY limit, which is a different, much
 * larger budget (200k/day on the free tier) that does not meaningfully refill on
 * the timescale of one message's retry. Waiting the quoted time frees roughly
 * enough for THIS request and no more, so retrying every subsequent message the
 * same way would mean an ~8min wait per remaining message. Thrown as a
 * distinguishable error so syncOneAccount can abort the batch.
 */
async function callGroqWithRetry(body: any): Promise<any> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");

  const estimated = estimateTokens(body);
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await waitForTokenBudget(estimated);

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await readJson(response, "Groq抽出");

    if (response.status === 429) {
      const msg = data.error?.message || "";
      if (/tokens per day|\(TPD\)/i.test(msg)) {
        const err: any = new Error(msg);
        err.code = "GROQ_TPD_EXHAUSTED";
        throw err;
      }
      if (attempt < maxAttempts) {
        await sleep((parseRetryAfterMs(msg) ?? 5000) + 500);
        continue;
      }
    }
    if (!response.ok) {
      throw new Error(data.error?.message || `Groq API error (HTTP ${response.status})`);
    }
    tokenUsageLog.push({ time: Date.now(), tokens: data.usage?.total_tokens || estimated });
    return data;
  }
  throw new Error("Groq API error: レート制限のため複数回リトライしましたが失敗しました");
}

/**
 * Rules first, LLM only for what rules cannot read.
 *
 * Most broker mail states its property as label-value text in the body, which
 * ../lib/mailParse.js reads deterministically — no API call, no quota, and it
 * keeps working while every configured provider is down. The LLM is reached only
 * for a message that looks like a listing but did not parse: in practice a cover
 * note whose data is entirely inside a マイソク PDF whose two-column layout
 * pdfToText shreds beyond what regex can pair up.
 *
 * A message the parser judges to be neither (a newsletter, or a 物件求 — a broker
 * advertising what they want to buy) costs nothing at all. That is a precision
 * gain, not just a saving: asked to read those, the LLM invented listings, and
 * four "Premium deal — Seoul" rows from a flight-deals mailout are still in the
 * listings table.
 */
/** The extraction contract, shared by both models so their prompts cannot drift. */
const LISTING_JSON_SHAPE =
  '{"listings": [{"title": string|null, "address": string|null, "ward": string|null, ' +
  '"price": number|null, "area": number|null, "landSize": number|null, "station": string|null, ' +
  '"walkMinutes": number|null, "propertyType": string|null, "yield": number|null, ' +
  '"buildYear": number|null, "structure": string|null, "buildingCoverageRatio": number|null, ' +
  '"floorAreaRatio": number|null, "roadWidth": number|null, "totalUnits": number|null, ' +
  '"description": string|null}]}';

const EXTRACTION_RULES = `不明な項目はnullにしてください。推測で埋めないこと。
価格は万円単位の数値、利回りは%を除いた数値、面積は㎡単位の数値、徒歩は分単位の整数にしてください。
propertyTypeは 土地|一戸建て|マンション|ビル|店舗 のいずれかにしてください。
一棟まるごとの建物（一棟レジ・収益マンション・共同住宅・店舗ビル等）は用途を問わず「ビル」、区分所有の一住戸は「マンション」にしてください。
この5語は scraped 物件で実際に使われている語彙と揃えてあります。「一棟マンション」「アパート」は出力しないでください。
wardは市区名です。「〇〇区」だけでなく「〇〇市」も対象で、住所から必ず埋めてください（例: 練馬区、国立市、さいたま市大宮区なら「大宮区」）。都道府県名や丁目は含めないこと。
titleは資料中の「物件名」があればそれを使い、無ければ住所や種別から短い名前を作ってください。
物件を紹介していない文書（ニュースレター、物件求むの案内など）の場合は空配列を返してください。`;

/**
 * Extraction from the PDF itself, via Gemini.
 *
 * This exists because a 販売図面 draws its price/address table rather than
 * storing it as text: pdfToText recovers the room labels (洋室, LDK, ELV) and
 * nothing else, so every text-based path — rules and Groq alike — correctly
 * concludes there is no listing in what it can read. Gemini is given the raw
 * PDF bytes and reads the document as laid out.
 *
 * Returning [] is a real answer, not a failure: asked to read a newsletter, a
 * model that can actually see the page says so, which is what stops the
 * invented rows that the text-only path used to produce.
 */
export async function extractListingsWithGemini(
  emailText: string,
  pdfBuffers: Buffer[],
): Promise<any[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const parts: any[] = [
    {
      text:
        `以下は不動産仲介会社から届いたメール本文と、その添付資料（PDF）です。
` +
        `紹介されている物件を全て抽出してください。1通に複数の物件が含まれることがあります。

` +
        `【メール本文】
${emailText.slice(0, 6000)}

${EXTRACTION_RULES}

` +
        `以下の形式のJSONオブジェクトのみを出力してください。
${LISTING_JSON_SHAPE}`,
    },
    // Capped: a マイソク is a page or two, and the whole request is base64, so a
    // stray 20MB scan would otherwise be inlined into the call.
    ...pdfBuffers.slice(0, 3).map((b) => ({
      inline_data: { mime_type: "application/pdf", data: b.toString("base64") },
    })),
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    },
  );
  const body = await readJson(res, "Gemini抽出");
  if (!res.ok) {
    throw new Error(`Gemini抽出に失敗しました (HTTP ${res.status}): ${body?.error?.message || JSON.stringify(body).slice(0, 200)}`);
  }
  const text = body.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "{}";
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Gemini抽出結果がJSON形式ではありません: ${String(text).slice(0, 300)}`);
  }
  return Array.isArray(parsed.listings) ? parsed.listings : [];
}

export interface ExtractionResult {
  listings: any[];
  /** Which path produced them; "none" means nothing was extracted. */
  engine: "rules" | "gemini" | "groq" | "none" | "stored";
  /** The rules classifier's verdict, kept whatever the engine. */
  reason: string;
}

export async function extractListings(
  emailText: string,
  pdfBuffers: Buffer[],
): Promise<ExtractionResult> {
  const pdfTexts: string[] = [];
  for (const bytes of pdfBuffers || []) {
    try {
      pdfTexts.push(await pdfToText(bytes));
    } catch (e) {
      console.error("[MailIngest] PDF text extraction failed:", e);
    }
  }

  const parsed = parseEmailListings(emailText, pdfTexts);
  if (parsed.listings.length > 0) {
    console.log(`[MailIngest] Parsed ${parsed.listings.length} listing(s) without the LLM`);
    return { listings: parsed.listings, engine: "rules", reason: parsed.reason };
  }

  // Gemini before the rules' verdict, whenever there is a PDF to read. The
  // needsLlm gate exists to keep contentless text away from a text-only model;
  // it does not apply to a model reading the document itself, and a "not a
  // listing" verdict reached from unreadable pdfToText output is exactly the
  // case Gemini is here to rescue.
  if (process.env.GEMINI_API_KEY && pdfBuffers?.length > 0) {
    try {
      const fromPdf = await extractListingsWithGemini(emailText, pdfBuffers);
      console.log(`[MailIngest] Gemini read ${pdfBuffers.length} PDF(s): ${fromPdf.length} listing(s)`);
      // [] is Gemini's answer, not a failure, so it is not second-guessed by
      // re-running the text-only path over the same unreadable text.
      return { listings: fromPdf, engine: fromPdf.length > 0 ? "gemini" : "none", reason: parsed.reason };
    } catch (e) {
      console.error("[MailIngest] Gemini extraction failed, falling back:", e);
    }
  }

  if (!parsed.needsLlm) {
    console.log(`[MailIngest] Skipped (${parsed.reason})`);
    return { listings: [], engine: "none", reason: parsed.reason };
  }
  await sleep(1500);
  const fromText = await extractListingsWithLlm(emailText, pdfTexts);
  return { listings: fromText, engine: fromText.length > 0 ? "groq" : "none", reason: parsed.reason };
}

/**
 * One call per broker email — extracts EVERY property it describes (a single
 * email can introduce several: one 練馬・国立 email described two unrelated
 * buildings) into structured fields.
 *
 * Uses Groq rather than the Rax AI gateway evaluate.ts depends on — Rax AI had
 * an extended maintenance outage that made this feature untestable. Gemini would
 * read a PDF's real layout natively instead of needing pdfToText, which is
 * exactly what every message reaching this function needs, but its key is out of
 * prepay credits.
 */
async function extractListingsWithLlm(emailText: string, pdfTexts: string[]): Promise<any[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");
  const pdfSection = pdfTexts
    .map((t, i) => `\n\n=== 添付PDF ${i + 1} (抽出テキスト) ===\n${t.slice(0, 6000)}`)
    .join("");

  const prompt = `以下は不動産仲介会社から届いたメール（と添付資料）です。紹介されている物件を全て抽出してください。
1通のメールに複数の物件が含まれることがあります。該当する物件が無ければ空配列を返してください。

${emailText.slice(0, 6000)}${pdfSection}

${EXTRACTION_RULES}

以下の形式のJSONオブジェクトのみを出力してください。他の文章は一切含めないこと。
${LISTING_JSON_SHAPE}`;

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
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`抽出結果がJSON形式ではありません: ${String(content).slice(0, 300)}`);
  }
  return Array.isArray(parsed.listings) ? parsed.listings : [];
}

export interface FetchedMessage {
  subject: string;
  from: string;
  receivedAt: number;
  bodyText: string;
  pdfBuffers: Buffer[];
  attachments: { id: string; filename: string; mimeType: string; size: number }[];
}

async function fetchGmailMessage(accessToken: string, id: string): Promise<FetchedMessage> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const msg = await readJson(res, "Gmailメッセージ取得");
  if (!res.ok) throw new Error(`Gmailメッセージ取得に失敗しました: ${JSON.stringify(msg)}`);

  const headers: Record<string, string> = Object.fromEntries(
    (msg.payload?.headers || []).map((h: any) => [h.name.toLowerCase(), h.value]),
  );

  let bodyText = "";
  const pdfParts: string[] = [];
  // Every named part, PDF or not — the inspector shows what a message actually
  // carried, so "the データ is in the Excel sheet" is visible rather than looking
  // like an empty email.
  const attachments: FetchedMessage["attachments"] = [];
  const walk = (part: any) => {
    if (!part) return;
    if (part.mimeType === "text/plain" && part.body?.data) {
      bodyText += Buffer.from(part.body.data, "base64url").toString("utf-8") + "\n";
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
    bodyText = Buffer.from(msg.payload.body.data, "base64url").toString("utf-8");
  }

  const pdfBuffers: Buffer[] = [];
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
      console.error(`[MailIngest] Attachment fetch failed for gmail message ${id}:`, e);
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

async function fetchOutlookMessage(accessToken: string, id: string): Promise<FetchedMessage> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${id}?$select=subject,from,receivedDateTime,body,hasAttachments`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const msg = await readJson(res, "Graphメッセージ取得");
  if (!res.ok) throw new Error(`Graphメッセージ取得に失敗しました: ${JSON.stringify(msg)}`);

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

  const pdfBuffers: Buffer[] = [];
  const attachments: FetchedMessage["attachments"] = [];
  if (msg.hasAttachments) {
    const attRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${id}/attachments`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
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
      .filter((a: any) => a.contentType === "application/pdf" && a.contentBytes)
      .slice(0, 3);
    for (const a of pdfAttachments) pdfBuffers.push(Buffer.from(a.contentBytes, "base64"));
  }

  return {
    subject: msg.subject || "",
    from: msg.from?.emailAddress
      ? `${msg.from.emailAddress.name || ""} <${msg.from.emailAddress.address}>`
      : "",
    receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime).getTime() : Date.now(),
    bodyText,
    pdfBuffers,
    attachments,
  };
}

/**
 * Build a targeted query for Gmail or Outlook from the user's ingest settings so
 * the provider searches the entire window directly instead of scanning only
 * recent inbox noise.
 */
function buildProviderQuery(provider: string, settings: any, daysBack = 90): string {
  if (provider === "gmail") {
    const parts = [`newer_than:${daysBack}d`, "-in:trash", "-in:spam"];
    if (settings) {
      if (settings.requireAttachment) parts.push("has:attachment");
      if (settings.allowedSenders?.length > 0) {
        parts.push(`(${settings.allowedSenders.map((s: string) => `from:${s}`).join(" OR ")})`);
      }
      if (settings.requiredKeywords?.length > 0) {
        parts.push(`(${settings.requiredKeywords.map((k: string) => `"${k}"`).join(" OR ")})`);
      }
      for (const s of settings.blockedSenders || []) parts.push(`-from:${s}`);
      for (const k of settings.blockedKeywords || []) parts.push(`-"${k}"`);
    }
    if (!settings?.requiredKeywords?.length && !settings?.allowedSenders?.length) {
      parts.unshift("in:inbox");
    }
    return parts.join(" ");
  }

  const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  let filter = `receivedDateTime ge ${startDate}`;
  if (settings?.requireAttachment) filter += " and hasAttachments eq true";
  return filter;
}

/**
 * List new message ids since the stored cursor. With no cursor (or when
 * backfilling), queries up to 90 days back with pagination.
 */
async function listNewMessageIds(
  provider: string,
  accessToken: string,
  cursor: string | null,
  options: any = {},
): Promise<{ ids: string[]; nextCursor: string }> {
  const daysBack = options.daysBack ?? 90;
  const maxTotal = options.maxTotal ?? 500;

  if (provider === "gmail") {
    if (cursor) {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/history/list?startHistoryId=${cursor}&historyTypes=messageAdded`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (res.status === 404) return listNewMessageIds("gmail", accessToken, null, options);
      const body = await readJson(res, "Gmail history取得");
      if (!res.ok) throw new Error(`Gmail history取得に失敗しました: ${JSON.stringify(body)}`);
      const ids = (body.history || []).flatMap((h: any) =>
        (h.messagesAdded || []).map((m: any) => m.message.id),
      );
      const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const profile = await readJson(profileRes, "Gmailプロフィール取得(history)");
      return { ids: [...new Set<string>(ids)], nextCursor: String(profile.historyId || cursor) };
    }

    const query = options.query || buildProviderQuery("gmail", options.settings, daysBack);
    const allIds: string[] = [];
    let pageToken: string | undefined;

    do {
      const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=${encodeURIComponent(query)}${pageParam}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const body = await readJson(res, "Gmailメッセージ一覧取得");
      if (!res.ok) throw new Error(`Gmailメッセージ一覧取得に失敗しました: ${JSON.stringify(body)}`);
      allIds.push(...(body.messages || []).map((m: any) => m.id));
      pageToken = body.nextPageToken;
    } while (pageToken && allIds.length < maxTotal);

    const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = await readJson(profileRes, "Gmailプロフィール取得(一覧)");
    return { ids: allIds.slice(0, maxTotal), nextCursor: String(profile.historyId) };
  }

  // Outlook: delta query or date-filtered query.
  if (cursor) {
    const res = await fetch(cursor, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 410 /* Gone: deltaLink expired */) {
      return listNewMessageIds("outlook", accessToken, null, options);
    }
    const body = await readJson(res, "Outlookメッセージ一覧取得");
    if (!res.ok) throw new Error(`Outlookメッセージ一覧取得に失敗しました: ${JSON.stringify(body)}`);
    const ids = (body.value || []).map((m: any) => m.id);
    const nextCursor = body["@odata.deltaLink"] || body["@odata.nextLink"] || cursor;
    return { ids, nextCursor };
  }

  const filter = options.filter || buildProviderQuery("outlook", options.settings, daysBack);
  let url: string | null =
    `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$filter=${encodeURIComponent(filter)}&$top=50&$orderby=receivedDateTime desc`;
  const allIds: string[] = [];
  let nextCursor: string | null = null;

  while (url && allIds.length < maxTotal) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await readJson(res, "Outlookメッセージ一覧取得");
    if (!res.ok) throw new Error(`Outlookメッセージ一覧取得に失敗しました: ${JSON.stringify(body)}`);
    allIds.push(...(body.value || []).map((m: any) => m.id));
    nextCursor = body["@odata.deltaLink"] || body["@odata.nextLink"] || nextCursor;
    url = body["@odata.nextLink"] || null;
  }

  return { ids: allIds.slice(0, maxTotal), nextCursor: nextCursor || "" };
}

function matchOrdersAgainst(item: any, orders: any[]) {
  return matchOrders(item, orders.map((o) => o.criteria));
}

export async function syncOneAccount(account: Doc, options: any = {}) {
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(account);
  } catch {
    return { synced: 0, listingsFound: 0, error: "REAUTH_REQUIRED" };
  }

  const orders = await mailData.listAllOrderCriteria();
  // Read once per account, not per message: these rules never change mid-sync.
  const ingestSettings = await mailData.ingestSettingsForUser(account.userId);

  const cursorToUse = options.fullSync ? null : account.syncCursor;
  const { ids, nextCursor } = await listNewMessageIds(account.provider, accessToken, cursorToUse, {
    daysBack: options.daysBack ?? 90,
    maxTotal: options.maxTotal ?? 500,
    settings: ingestSettings,
  });

  let listingsFound = 0;
  let messagesWithListings = 0;
  let filteredOut = 0;
  const messageErrors: string[] = [];
  const subjectsSeen: string[] = [];

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
      const { listings: extracted } = await extractListings(emailText, msg.pdfBuffers);
      if (extracted.length === 0) continue;
      messagesWithListings++;

      for (let i = 0; i < extracted.length; i++) {
        const item = extracted[i];
        if (!item.address && !item.title) continue;

        const pseudoUrl = `email:${account.provider}:${id}:${i}`;
        const { matchedOrderIndices } = matchOrdersAgainst(item, orders);

        await mailData.saveEmailListing({
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
          matchedOrderIds: matchedOrderIndices.map((idx: number) => orders[idx].orderId),
        });
        listingsFound++;
      }
    } catch (e: any) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[MailIngest] Failed to process message ${id}:`, e);
      if (messageErrors.length < 5) messageErrors.push(message);
      // Groq's daily token cap, not the per-minute one — waiting the quoted time
      // only frees enough for one more request, so retrying the rest of this
      // batch the same way would wait ~8min per remaining message.
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

  await mailData.saveSyncCursor(account._id, nextCursor, Date.now());

  return {
    synced: ids.length,
    subjectsSeen: subjectsSeen.slice(0, 10),
    messagesWithListings,
    listingsFound,
    filteredOut,
    messageErrors,
  };
}

export async function syncNow(userId: string, opts: { fullSync?: boolean; daysBack?: number } = {}) {
  const accounts = await mailData.accountsForUser(userId);
  const results = [];
  for (const account of accounts) {
    results.push({
      provider: account.provider,
      ...(await syncOneAccount(account, {
        fullSync: opts.fullSync ?? true,
        daysBack: opts.daysBack ?? 90,
      })),
    });
  }
  return results;
}

export async function inspectRecentMail(
  userId: string,
  opts: { limit?: number; matchingOnly?: boolean; daysBack?: number; runAi?: boolean } = {},
) {
  const limit = opts.limit ?? 50;
  const matchingOnly = opts.matchingOnly ?? true;
  const daysBack = opts.daysBack ?? 90;
  // Opt-in: this is the same extraction a sync performs, so it costs one model
  // call per message that the rules could not read. Off by default keeps the
  // inspector free to open.
  const runAi = opts.runAi ?? false;
  const accounts = await mailData.accountsForUser(userId);
  const ingestSettings = await mailData.ingestSettingsForUser(userId);

  const out: any[] = [];
  for (const account of accounts) {
    let accessToken: string;
    try {
      accessToken = await getValidAccessToken(account);
    } catch {
      out.push({ provider: account.provider, error: "REAUTH_REQUIRED" });
      continue;
    }

    const { ids } = await listNewMessageIds(account.provider, accessToken, null, {
      daysBack, maxTotal: 500, settings: ingestSettings,
    });

    for (const id of ids) {
      if (out.length >= limit) break;
      try {
        const msg =
          account.provider === "gmail"
            ? await fetchGmailMessage(accessToken, id)
            : await fetchOutlookMessage(accessToken, id);

        const rule = applyIngestRules(msg, ingestSettings);
        if (matchingOnly && !rule.accepted) continue;

        const pdfTexts: string[] = [];
        if (rule.accepted) {
          for (const bytes of msg.pdfBuffers || []) {
            try {
              pdfTexts.push(await pdfToText(bytes));
            } catch (e) {
              pdfTexts.push(`（PDF読み取り失敗: ${e instanceof Error ? e.message : String(e)}）`);
            }
          }
        }

        const emailText = `件名: ${msg.subject}\n差出人: ${msg.from}\n\n${msg.bodyText}`;
        const parsed = parseEmailListings(emailText, pdfTexts);

        // What a real sync would store, rather than only what the rules alone
        // could read. Writes nothing.
        let extracted: ExtractionResult | null = null;
        if (runAi && rule.accepted) {
          try {
            // Already ingested? Show the stored rows rather than paying a model
            // to re-read a message the sync has already processed.
            const stored = await mailData.listingsForMessage(account.provider, id);
            extracted = stored.length > 0
              ? { listings: stored, engine: "stored", reason: parsed.reason }
              : await extractListings(emailText, msg.pdfBuffers);
          } catch (e) {
            extracted = {
              listings: [],
              engine: "none",
              reason: `抽出に失敗: ${e instanceof Error ? e.message : String(e)}`,
            };
          }
        }

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
          listings: extracted ? extracted.listings : rule.accepted ? parsed.listings : [],
          needsLlm: rule.accepted ? parsed.needsLlm : false,
          reason: rule.accepted ? parsed.reason : rule.reason,
          // Absent unless the AI pass ran, so the UI can tell "rules found
          // nothing" apart from "nothing found it".
          engine: extracted?.engine,
        });
      } catch (e) {
        out.push({ provider: account.provider, id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return out;
}

/** Called by the scheduled job. Skips accounts already known to need reconnect. */
export async function syncAllAccounts() {
  const accounts = await mailData.allAccounts();
  for (const account of accounts) {
    if (account.needsReconnect) continue;
    try {
      await syncOneAccount(account);
    } catch (e) {
      console.error(`[MailIngest] Sync failed for account ${account._id}:`, e);
    }
  }
}

export async function getAttachmentData(
  userId: string,
  args: { provider: string; messageId: string; attachmentId: string; mimeType?: string; filename?: string },
) {
  const accounts = await mailData.accountsForUser(userId);
  const account = accounts.find((a) => a.provider === args.provider);
  if (!account) throw new Error("メールアカウントが見つかりません");

  const accessToken = await getValidAccessToken(account);
  let buffer: Buffer;
  let contentType = args.mimeType || "application/pdf";

  if (args.provider === "gmail") {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.messageId}/attachments/${args.attachmentId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const att = await readJson(res, "Gmail添付ファイル取得");
    if (!att.data) throw new Error("添付ファイルデータを取得できませんでした");
    buffer = Buffer.from(att.data, "base64url");
  } else {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${args.messageId}/attachments/${args.attachmentId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const att = await readJson(res, "Graph添付ファイル取得");
    if (!att.contentBytes) throw new Error("添付ファイルデータを取得できませんでした");
    buffer = Buffer.from(att.contentBytes, "base64");
    if (att.contentType) contentType = att.contentType;
  }

  return { base64: buffer.toString("base64"), mimeType: contentType, filename: args.filename };
}

export async function getEmailDetailsForListing(userId: string, listingId: string) {
  const listing = await mailData.getListingById(listingId);
  if (!listing || listing.source !== "email" || !listing.url) return null;

  const parts = String(listing.url).split(":");
  const provider = parts[1] || "gmail";
  const messageId = parts[2] || "";

  const cached = () => ({
    provider,
    messageId,
    subject: listing.emailSubject || "",
    bodyText: listing.emailBody || "",
    attachments: listing.emailAttachments || [],
    from: listing.emailFrom || "",
    receivedAt: listing.emailReceivedAt,
  });

  // Already cached on the listing row with attachments and subject.
  if (listing.emailSubject != null && listing.emailAttachments != null) return cached();
  if (!messageId) return null;

  const accounts = await mailData.accountsForUser(userId);
  const account = accounts.find((a) => a.provider === provider);
  if (!account) return cached();

  try {
    const accessToken = await getValidAccessToken(account);
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

    await mailData.updateListingEmailDetails(listingId, {
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
    console.error("[MailIngest] Failed to fetch email details for listing:", e);
    return cached();
  }
}
