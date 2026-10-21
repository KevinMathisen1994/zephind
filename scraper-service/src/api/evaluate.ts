/**
 * AI evaluation of one listing against one order. Ported from convex/evaluate.js.
 *
 * Scoring logic lives in ../lib/scoring.js so it can be unit-tested with plain
 * `node`, outside any framework. See that file for the layered model.
 */
import { Router, type Request } from "express";
import { db } from "../db";
import { requireOwned, requireUserId } from "../auth/authz";
import { route } from "./handler";
// Pure JS module, deliberately untyped (see tsconfig checkJs).
import { computeMatchScore, mlitTypeForListing, wardCityCode } from "../lib/scoring.js";
import {
  CACHE_TTL_MS, getMlitCache, getPlacesCache, saveMlitCache, savePlacesCache,
} from "../lib/marketCache";

/**
 * The Rax AI gateway sometimes streams SSE ("data: {...}\n\n" chunks) even when
 * asked not to, instead of a single JSON object. Handle both shapes so a stray
 * stream doesn't blow up on JSON.parse (it used to fail on the literal "data:"
 * prefix with "Unexpected token 'd'").
 */
function parseChatCompletion(raw: string, status: number): any {
  const trimmed = raw.trim();
  // An empty or non-JSON body used to surface as "Unexpected end of JSON
  // input", which names the parser rather than the failure. The gateway
  // answering 405 with no body (its maintenance behaviour) is the common case.
  if (!trimmed) throw new Error(`Rax AI returned an empty body (HTTP ${status})`);
  if (!trimmed.startsWith("data:")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(`Rax AI returned a non-JSON body (HTTP ${status}): ${trimmed.slice(0, 200)}`);
    }
  }

  let content = "";
  let model: string | undefined;
  let error: any;
  for (const line of trimmed.split("\n")) {
    const payload = line.trim().replace(/^data:\s*/, "");
    if (!payload || payload === "[DONE]") continue;
    let chunk: any;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }
    if (chunk.error) error = chunk.error;
    if (chunk.model) model = chunk.model;
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) content += delta;
  }
  if (error) return { error };
  return { model, choices: [{ message: { content } }] };
}


/**
 * Amenity categories counted around a listing, and the label each gets in the
 * prompt. One entry can name several Places types: the legacy API's single
 * "lodging" type was split into per-accommodation types in Places API (New), so
 * covering the same ground takes a list.
 */
const NEARBY_CATEGORIES: { label: string; types: string[] }[] = [
  { label: "飲食店", types: ["restaurant"] },
  { label: "ホテル", types: ["hotel", "motel", "inn", "guest_house", "hostel", "resort_hotel", "bed_and_breakfast"] },
  { label: "駅", types: ["train_station", "subway_station"] },
  { label: "公園", types: ["park"] },
  { label: "スーパー", types: ["supermarket"] },
  { label: "コンビニ", types: ["convenience_store"] },
];

/**
 * One nearby search against Places API (New).
 *
 * The legacy `maps/api/place/nearbysearch/json` endpoint this replaced cannot be
 * enabled on Google Cloud projects created from 2025 onward, so a fresh project
 * only offers this one. It is a different host, a POST rather than a GET, and it
 * requires an explicit field mask — asking for no fields is an error, and asking
 * for more than needed is billed at a higher tier.
 *
 * maxResultCount caps at 20, which matches what one legacy page returned, so the
 * counts stay comparable to those already cached from the old API.
 */
async function searchNearby(
  apiKey: string,
  loc: { lat: number; lng: number },
  includedTypes: string[],
): Promise<{ count: number; names: string[] }> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.displayName",
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: 20,
      languageCode: "ja",
      locationRestriction: {
        circle: { center: { latitude: loc.lat, longitude: loc.lng }, radius: 500 },
      },
    }),
  });

  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Places search failed (HTTP ${res.status})` +
        (body?.error?.message ? ` — ${body.error.message}` : ""),
    );
  }
  // An area with no matches returns {} rather than an empty array.
  const places: any[] = body.places ?? [];
  return { count: places.length, names: places.map((p) => p.displayName?.text).filter(Boolean) };
}

/**
 * Rax AI allows ~15 requests per 60s window and publishes the state in
 * `x-ratelimit-remaining` / `x-ratelimit-reset` (reset is epoch ms). The Orders
 * page batch-evaluates 5 listings concurrently with no pacing, so an order of
 * any size used to exhaust the window and every later listing came back with
 * "AI解説の生成に失敗しました（Rate limit exceeded）" and no narrative.
 *
 * Calls are therefore serialised through one queue and paced from the headers.
 * This mirrors what mailIngest.ts already does for Groq. Serialising costs
 * nothing in practice: 15/minute is slower than one call completes anyway.
 */
const raxLimit = { remaining: Number.POSITIVE_INFINITY, resetAt: 0 };
let raxQueue: Promise<unknown> = Promise.resolve();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs `fn` after every earlier Rax call, waiting out an exhausted window. */
function queueRaxCall<T>(fn: () => Promise<T>): Promise<T> {
  const run = raxQueue.then(async () => {
    for (;;) {
      // A reset in the past means the window has rolled over.
      if (Date.now() >= raxLimit.resetAt) raxLimit.remaining = Number.POSITIVE_INFINITY;
      if (raxLimit.remaining > 0) break;
      await sleep(Math.max(raxLimit.resetAt - Date.now(), 0) + 250);
    }
    raxLimit.remaining -= 1;
    return fn();
  });
  // Keep the chain alive: an unhandled rejection here would stall every later call.
  raxQueue = run.catch(() => undefined);
  return run;
}

function recordRaxLimits(res: Response) {
  const remaining = Number(res.headers.get("x-ratelimit-remaining"));
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(remaining)) raxLimit.remaining = remaining;
  if (Number.isFinite(reset)) raxLimit.resetAt = reset;
}

/**
 * One chat completion, paced and retried on a rate-limit refusal. Gives up after
 * a few attempts so a stuck window cannot hold an HTTP request open forever —
 * the caller still saves the deterministic score either way.
 */
async function callRaxChat(apiKey: string, payload: unknown): Promise<any> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; ; attempt++) {
    const { data, rateLimited } = await queueRaxCall(async () => {
      // `www.` is required. The bare host 301-redirects here, and fetch replays a
      // redirected POST as a GET, which this endpoint answers 405 with an empty
      // body — surfacing as "Unexpected end of JSON input" rather than anything
      // resembling a wrong URL.
      const response = await fetch("https://www.ai.raxcore.dev/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      recordRaxLimits(response);
      const raw = await response.text();
      const parsed = parseChatCompletion(raw, response.status);
      const message = String(parsed?.error?.message ?? "");
      return {
        data: parsed,
        rateLimited: response.status === 429 || /rate limit/i.test(message),
      };
    });

    if (!rateLimited || attempt >= MAX_ATTEMPTS) return data;
    // Wait out the window the headers just described before trying again.
    await sleep(Math.max(raxLimit.resetAt - Date.now(), 1000) + 250);
    raxLimit.remaining = 0;
  }
}

export const evaluateRouter = Router();

evaluateRouter.post("/", route(async (req: Request) => {
  // Unauthenticated callers could otherwise burn LLM / Places / MLIT quota.
  // The writes below are separately ownership-checked; this stops the spend.
  requireUserId(req);
  const apiKey = process.env.RAX_API_KEY;
  if (!apiKey) return { error: "RAX_API_KEY not configured" };

  const args: any = req.body ?? {};
  const c: any = args.orderCriteria || {};
  const isRental = (args.dealType ?? c.dealType) === "rent";

  // The match is patched at the end. Check ownership NOW: the Convex version
  // got this from the mutations it called through, which no longer exist here,
  // and a late check would mean the LLM spend happens before the refusal.
  if (args.matchId) await requireOwned(req, "matching", args.matchId, "マッチング");

  // 1. Property summary. Rent and price/yield are mutually exclusive (a listing
  // is one or the other), so which line prints is decided by dealType, not by
  // which field happens to be set.
  const propertySummary = `
【物件概要】
・所在地: ${args.address || ""} ${args.ward || ""}
${
  isRental
    ? `・賃料: ${args.rent ? `${args.rent.toLocaleString()}万円/月` : "未記載"}\n・管理費: ${args.managementFee ? `${args.managementFee}万円/月` : "なし/未記載"}\n・敷金/礼金: ${args.deposit != null ? `${args.deposit}万円` : "未記載"} / ${args.keyMoney != null ? `${args.keyMoney}万円` : "未記載"}\n・ペット: ${args.petsAllowed === true ? "相談可" : args.petsAllowed === false ? "不可" : "未記載"}`
    : `・価格: ${args.price ? `${args.price.toLocaleString()}万円` : "未記載"}\n・想定利回り: ${args.yield ? `${args.yield}%` : "要確認"}`
}
・土地面積: ${args.landSize ? `${args.landSize}㎡` : "要確認"}
・延床/専有面積: ${args.area ? `${args.area}㎡` : "要確認"}
・物件種別: ${args.propertyType || "未記載"}
・構造/築年: ${args.structure || "構造未記載"} / ${args.buildYear ? `${args.buildYear}年築` : "築年未記載"}
・最寄駅: ${args.station || ""} ${args.walkMinutes !== undefined ? `(徒歩${args.walkMinutes}分)` : ""}
・前面道路幅員: ${args.roadWidth ? `${args.roadWidth}m` : "未記載"}
・建ぺい率/容積率: ${args.buildingCoverageRatio ? `${args.buildingCoverageRatio}%` : "未"}/ ${args.floorAreaRatio ? `${args.floorAreaRatio}%` : "未"}
・階数/エレベーター: ${args.floor ? `${args.floor}階` : "階数未記載"} / ${args.elevators !== undefined ? `${args.elevators}機` : "要確認"}
・物件備考/概要: ${args.description || "なし"}
`.trim();

  // 2. Order criteria summary.
  const hasOrderContext = Object.keys(c).length > 0;
  const orderSummary = hasOrderContext
    ? `
【${isRental ? "入居希望者の賃貸ニーズ・ご要望" : "顧客の購入ニーズ・ご要望"}】
・案件名: ${c.orderName || (isRental ? "借主指定条件" : "買主指定条件")}
・希望エリア: ${c.wards && c.wards.length > 0 ? c.wards.join("、") : "都内近郊"}
${
  isRental
    ? `・ご予算(賃料): ${c.rentMin || c.rentMax ? `${c.rentMin || 0}万円/月 〜 ${c.rentMax ? `${c.rentMax}万円/月` : "上限なし"}` : "指定なし"}\n・敷金上限: ${c.maxDeposit != null ? `${c.maxDeposit}万円` : "指定なし"}\n・礼金上限: ${c.maxKeyMoney != null ? `${c.maxKeyMoney}万円` : "指定なし"}${c.petsRequired ? "\n・ペット可の物件を希望" : ""}`
    : `・ご予算: ${c.priceMin || c.priceMax ? `${c.priceMin || 0}万円 〜 ${c.priceMax ? `${c.priceMax}万円` : "上限なし"}` : "指定なし"}\n・希望利回り: ${c.minYield ? `${c.minYield}% 以上` : "指定なし"}`
}
・駅徒歩制限: ${c.walkMinutesMax ? `徒歩${c.walkMinutesMax}分以内` : "指定なし"}
・前面道路幅員: ${c.minRoadWidth ? `${c.minRoadWidth}m以上` : "指定なし"}
・希望物件種別: ${c.propertyTypes && c.propertyTypes.length > 0 ? c.propertyTypes.join("、") : "指定なし"}${c.ownerChange ? "（オーナーチェンジ／賃貸中のままの売却を希望）" : ""}
・希望専有／建物面積: ${c.areaMin || c.areaMax ? `${c.areaMin || 0}㎡ 〜 ${c.areaMax ? `${c.areaMax}㎡` : "上限なし"}` : "指定なし"}
・希望構造: ${c.structureTypes && c.structureTypes.length > 0 ? c.structureTypes.join("、") : "指定なし"}
・築年数条件: ${c.maxBuildAge ? `築${c.maxBuildAge}年以内` : "指定なし"}
・こだわり条件: ${
        [
          c.excludeFirstFloor ? "1階不可" : "",
          c.minElevators ? `EV${c.minElevators}機以上` : "",
          c.minTotalUnits ? `総戸数${c.minTotalUnits}戸以上` : "",
          c.specialRequirements || "",
        ]
          .filter(Boolean)
          .join(" / ") || "特になし"
      }
`.trim()
    : "【顧客ニーズ】一般的な投資用不動産として評価を行ってください。";

  // 3. Nearby facilities via Google Places, cached per address for 30 days —
  // amenities within 500m of a fixed address don't move week to week, so
  // re-geocoding on every 再評価 click is pure waste.
  let nearbyInfo = "";
  let nearbyTotalCount: number | null = null;
  // Surfaced to the UI (and stored on the match) so a failed lookup shows up as
  // "this comparison didn't run" instead of silently dropping the component.
  const dataWarnings: string[] = [];
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  if (placesKey && args.address) {
    const addressKey = String(args.address).trim();
    try {
      const cached = await getPlacesCache(addressKey);
      if (cached && Date.now() - (cached.fetchedAt as number) < CACHE_TTL_MS) {
        nearbyInfo = cached.nearbyInfo || "";
        nearbyTotalCount = cached.nearbyTotalCount ?? null;
      } else {
        const geoQuery = encodeURIComponent(`${args.address} ${args.ward || ""} 東京`);
        const geoRes = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${geoQuery}&key=${placesKey}`,
        );
        const geoData: any = await geoRes.json();
        if (geoData.status && !["OK", "ZERO_RESULTS"].includes(geoData.status)) {
          throw new Error(
            `Geocoding failed: ${geoData.status}` +
              (geoData.error_message ? ` — ${geoData.error_message}` : ""),
          );
        }
        const loc = geoData.results?.[0]?.geometry?.location;

        if (loc) {
          const results: string[] = [];
          let countSum = 0;
          for (const { types, label } of NEARBY_CATEGORIES) {
            const { count, names } = await searchNearby(placesKey, loc, types);
            countSum += count;
            if (count > 0) {
              results.push(`・${label}: 徒歩5分圏内に${count}件（主要: ${names.slice(0, 3).join("、")}）`);
            }
          }
          nearbyTotalCount = countSum;
          if (results.length > 0) {
            nearbyInfo = "\n\n【周辺インフラ環境（徒歩5分圏内）】\n" + results.join("\n");
          }
        }

        await savePlacesCache({
          address: addressKey,
          nearbyTotalCount: nearbyTotalCount ?? undefined,
          nearbyInfo,
          fetchedAt: Date.now(),
        });
      }
    } catch (e) {
      console.error("[Places API] Error:", e);
      dataWarnings.push("周辺施設データの取得に失敗したため、この項目は評価から除外されています。");
    }
  }

  // 4. MLIT transaction history, cached per (ward, year) for 30 days —
  // reinfolib publishes quarterly. The cache stores every transaction type for
  // the ward/year so it is reusable across listings of any property type;
  // filtering to this listing's type happens below.
  let historicalInfo = "";
  let marketAvgPrice: number | null = null;
  let comparables: any[] = [];
  const reinfolibKey = process.env.REINFOLIB_API_KEY;
  if (reinfolibKey && args.ward) {
    // Listing `ward` is inconsistent (proper names, raw MLIT city codes like
    // "13212", blanks, truncated forms like "京都町田市"). A raw-map lookup
    // silently returned undefined for ~28% of listings.
    const cityCode = wardCityCode(args.ward);
    if (!cityCode) {
      dataWarnings.push(`「${args.ward}」の区を特定できなかったため、取引相場データを取得できませんでした。`);
    } else {
      try {
        // Averaging land trades in with condo trades produced a market price
        // meaningless for either — filter to the MLIT type matching this listing.
        const targetType = mlitTypeForListing(args.propertyType);
        const currentYear = new Date().getFullYear();
        const yearData: Record<string, any[]> = {};
        for (const year of [currentYear - 1, currentYear - 2]) {
          const cached = await getMlitCache(args.ward, year);
          let items: any[];
          if (cached && Date.now() - (cached.fetchedAt as number) < CACHE_TTL_MS) {
            items = cached.comparables || [];
          } else {
            const mlitUrl = `https://www.reinfolib.mlit.go.jp/ex-api/external/XIT001?year=${year}&area=13&city=${cityCode}&language=ja`;
            const mlitRes = await fetch(mlitUrl, {
              headers: { "Ocp-Apim-Subscription-Key": reinfolibKey },
            });
            if (!mlitRes.ok) throw new Error(`MLIT API HTTP ${mlitRes.status}`);
            const mlitData: any = await mlitRes.json();
            items = (mlitData.data || [])
              .filter((i: any) => i.TradePrice)
              .map((i: any) => ({
                type: i.Type,
                district: i.DistrictName,
                station: i.NearestStation,
                walkMinutes: i.TimeToNearestStation,
                price: Math.round(parseFloat(i.TradePrice.replace(/,/g, "")) / 10000),
                area: i.Area ? parseFloat(i.Area) : null,
                buildYear: i.BuildingYear,
                structure: i.Structure,
                period: i.Period,
              }))
              .slice(0, 200); // bounded snapshot, refreshed wholesale, not appended to
            await saveMlitCache({ ward: args.ward, year, comparables: items, fetchedAt: Date.now() });
          }
          yearData[String(year)] = items.filter((i: any) => i.type === targetType);
        }

        const lines: string[] = [];
        const allPrices: number[] = [];
        const allItems: any[] = [];
        for (const [year, items] of Object.entries(yearData)) {
          if (items.length > 0) {
            const prices = items.map((i: any) => i.price);
            allPrices.push(...prices);
            allItems.push(...items);
            const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
            const min = Math.round(Math.min(...prices));
            const max = Math.round(Math.max(...prices));
            lines.push(
              `・${year}年: ${items.length}件の取引（${targetType}）| 平均価格: ${avg.toLocaleString()}万円 (範囲: ${min.toLocaleString()}〜${max.toLocaleString()}万円)`,
            );
          }
        }
        if (allPrices.length > 0) {
          marketAvgPrice = Math.round(allPrices.reduce((a, b) => a + b, 0) / allPrices.length);
        }
        if (lines.length > 0) {
          historicalInfo =
            `\n\n【${args.ward}における国土交通省の実取引相場データ（${targetType}）】\n` + lines.join("\n");
        }

        // Similar sold properties, closest in size, so a human (and the model)
        // can see WHICH comps back the price call instead of one averaged number.
        const targetArea = args.landSize || args.area;
        if (allItems.length > 0) {
          comparables = allItems
            .filter((i: any) => i.area != null)
            .sort((a: any, b: any) =>
              targetArea ? Math.abs(a.area - targetArea) - Math.abs(b.area - targetArea) : b.price - a.price,
            )
            .slice(0, 5);
        }
        if (allItems.length === 0) {
          dataWarnings.push(
            `「${args.ward}」の直近2年の${targetType}取引データが見つからず、市場価格との比較なしで評価されています。`,
          );
        }

        if (comparables.length > 0) {
          const compLines = comparables.map((cItem: any) => {
            const areaTxt = cItem.area != null ? `${cItem.area}㎡` : "面積不明";
            const stationTxt = cItem.station
              ? `${cItem.station}駅${cItem.walkMinutes ? ` 徒歩${cItem.walkMinutes}分` : ""}`
              : "最寄駅不明";
            return `・${cItem.period || ""} ${cItem.district || ""} | ${cItem.price.toLocaleString()}万円 | ${areaTxt} | 築${cItem.buildYear || "不明"} | ${stationTxt}`;
          });
          historicalInfo +=
            `\n\n【類似取引事例（面積が近い順・上位${comparables.length}件）】\n` + compLines.join("\n");
        }
      } catch (e) {
        console.error("[MLIT API] Error:", e);
        dataWarnings.push("国土交通省の取引相場データの取得に失敗したため、この項目は評価から除外されています。");
      }
    }
  }

  // 5. Score deterministically, BEFORE the LLM call. The model is told the
  // verdict and writes narrative to match it, rather than inventing a number we
  // then trust.
  const assessment = computeMatchScore(args, c, {
    marketAvgPrice,
    amenityCount: nearbyTotalCount,
  });
  const score = assessment.score;

  const verdictBrief = [
    `【確定スコア】${score}点（この数値は社内査定ロジックによる確定値です）`,
    assessment.disqualifiers.length
      ? `【致命的な不適合】\n${assessment.disqualifiers.map((d: any) => `・${d.reason}`).join("\n")}`
      : "【致命的な不適合】なし",
    assessment.unverified.length
      ? `【要確認事項（顧客条件に関わるが物件資料に記載なし）】\n${assessment.unverified.map((u: string) => `・${u}`).join("\n")}`
      : "【要確認事項】特になし",
  ].join("\n\n");

  const fullPrompt = `
あなたは東京の不動産投資ファンドおよび大手売買仲介のトップブローカー（査定責任者）です。
以下の【顧客の購入ニーズ】、【物件概要】、【周辺インフラ環境】、【国土交通省の成約相場データ】を精密に比較対照し、プロの投資判断および顧客提案用の評価レポートを作成してください。

${orderSummary}

${propertySummary}
${nearbyInfo}
${historicalInfo}

${verdictBrief}

【出力フォーマット指示】
必ず以下の4つの見出し（①〜④）をそのまま使用し、プロの不動産実務者としての視点と客観的なデータに基づいてわかりやすく記述してください。

① 顧客ニーズ適合度
（顧客の希望条件「価格、利回り、エリア、駅徒歩、道路幅員、構造、階数、こだわり等」に対する当物件の合致状況を明記）

② 物件の強み・投資メリット
（立地、資産性、周辺環境、収益性、将来の出口戦略など）

③ 留意点・主要リスク
（道路条件、耐震・築年数、法令制限、設備・管理面などの検討事項）

④ プロの総合アドバイス・提案方針
（買主顧客へ提示する際のポイントや交渉戦略のまとめ）

※ 採点は既に確定しています。点数を自分で計算・変更・出力しないでください。
※ 上記【確定スコア】${score}点と矛盾しない論調で記述してください（低評価なら明確に低評価として、率直に書くこと）。
※【致命的な不適合】がある場合は、①と③で必ず明示し、他の長所で相殺できない旨を明記してください。
※【要確認事項】は③に「現地調査・売主資料での確認が必要な項目」として列挙してください。推測で埋めないこと。
`.trim();

  // Built once, up front, so every return path below (success, a Rax AI error
  // payload, or a thrown network error) has the same shape to persist and
  // return. This used to happen only on the success path, so any Rax AI hiccup
  // threw away the already-computed score and left the listing looking
  // permanently "unevaluated".
  const scoreDetail = {
    fitPct: assessment.fitPct,
    marketPct: assessment.marketPct,
    completeness: assessment.completeness,
    disqualifiers: assessment.disqualifiers,
    unverified: assessment.unverified,
    breakdown: assessment.breakdown,
    marketAvgPrice,
    amenityCount: nearbyTotalCount,
    comparables,
    dataWarnings,
  };

  /** Persist the deterministic score even when the AI narrative fails. */
  const persistScore = async (evaluationText: string) => {
    if (!args.matchId) return;
    try {
      // One patch, not three round trips — ownership was checked up front.
      await db.patch("matching", args.matchId, {
        evaluation: evaluationText,
        score,
        scoreDetail,
      });
    } catch (dbErr) {
      console.error("[Rax AI] DB save failed:", dbErr);
    }
  };

  try {
    const data = await callRaxChat(apiKey, {
      model: "rax-4.0",
      messages: [
        {
          role: "system",
          content:
            "あなたは東京の不動産投資ファンドおよび売買仲介のトップブローカー（査定責任者）です。買主顧客の条件、国土交通省の成約相場データ、周辺インフラ環境を元に、プロの厳格な視点で評価レポートを作成してください。点数は社内査定ロジックで既に確定しているため、あなたが採点する必要はありません。与えられた確定スコアと整合する論調で、根拠を具体的に記述することに専念してください。不明な項目は推測せず「要確認」と明記してください。自然な日本語のみで記述し、「アrea」のような英字混在表記は絶対に使わず「エリア」と表記してください。",
        },
        { role: "user", content: fullPrompt },
      ],
      temperature: 0.7,
      max_tokens: 2500,
      stream: false,
    });

    if (data.error) {
      console.error("[Rax AI] API error:", data.error);
      const message = data.error.message || JSON.stringify(data.error);
      const fallback = `AI解説の生成に失敗しました（${message}）。スコアは社内査定ロジックによる確定値です。\n\n【プロの総合投資スコア: ${score}点】`;
      await persistScore(fallback);
      return { error: message, evaluation: fallback, score, scoreDetail };
    }
    let evaluation = data.choices?.[0]?.message?.content || "評価レスポンスなし";
    evaluation = evaluation.replace(/アrea/gi, "エリア").replace(/A-rea/gi, "エリア");

    // The score is computed in code, NOT read back from the model. This used to
    // parse 【プロの総合投資スコア: XX点】 out of the model's own prose, which
    // made the deterministic scorer dead code and saved a temperature-0.7
    // sample: byte-identical inputs measured 82 and then 72, which is what
    // produced the phantom 98 -> 88 -> 98 "regressions".
    const scoreTagPattern = /\n*【プロの総合投資スコア[：:\s]*\d{1,3}点?】\s*$/;
    const strayScore = evaluation.match(scoreTagPattern);
    if (strayScore) evaluation = evaluation.replace(scoreTagPattern, "");
    evaluation = `${evaluation.trim()}\n\n【プロの総合投資スコア: ${score}点】`;

    console.log(
      `[Broker score] match=${args.matchId || "?"} score=${score} ` +
        `fit=${assessment.fitPct?.toFixed(2) ?? "n/a"} market=${assessment.marketPct?.toFixed(2) ?? "n/a"} ` +
        `completeness=${assessment.completeness} marketAvg=${marketAvgPrice ?? "none"} ` +
        `amenities=${nearbyTotalCount ?? "none"}` +
        (strayScore ? ` (model also guessed ${strayScore[0].replace(/\D/g, "")}, discarded)` : ""),
      JSON.stringify({
        disqualifiers: assessment.disqualifiers,
        unverified: assessment.unverified,
        requirement: assessment.breakdown.requirement,
        market: assessment.breakdown.market,
      }),
    );

    await persistScore(evaluation);

    // scoreDetail is surfaced so the UI can show WHY a listing scored as it did,
    // and so regressions are diagnosable without re-running the model.
    return { evaluation, score, model: data.model, scoreDetail };
  } catch (err) {
    console.error("[Rax AI] Request failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    // The score no longer depends on the model, so persist and return it even
    // when the narrative call fails — a listing without prose still ranks
    // correctly, and no longer looks "unevaluated".
    const fallback = `AI解説の生成に失敗しました（${message}）。スコアは社内査定ロジックによる確定値です。\n\n【プロの総合投資スコア: ${score}点】`;
    await persistScore(fallback);
    return { error: message, evaluation: fallback, score, scoreDetail };
  }
}));
