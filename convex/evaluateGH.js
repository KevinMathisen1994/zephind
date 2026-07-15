import { action } from "./_generated/server.js";
import { v } from "convex/values";
import { api, internal } from "./_generated/api.js";

const GH_MODELS = ["gpt-4o-mini", "gpt-4o", "DeepSeek-V3"];

export const evaluateWithGH = action({
  args: {
    matchId: v.optional(v.string()),
    model: v.string(),
    address: v.optional(v.string()),
    ward: v.optional(v.string()),
    price: v.optional(v.number()),
    landSize: v.optional(v.number()),
    buildingCoverageRatio: v.optional(v.number()),
    floorAreaRatio: v.optional(v.number()),
    walkMinutes: v.optional(v.number()),
    station: v.optional(v.string()),
    buildYear: v.optional(v.number()),
    roadWidth: v.optional(v.number()),
    frontage: v.optional(v.number()),
    rooms: v.optional(v.number()),
    layout: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.GITHUB_MODELS_KEY;
    if (!apiKey) {
      return { error: "GITHUB_MODELS_KEY not configured. Get one free at https://github.com/settings/tokens (no scopes needed)" };
    }

    const { model, ...property } = args;
    const modelName = model || "gpt-4o-mini";

    const prompt = buildPrompt(property);
    const fullPrompt = prompt + await fetchNearby(property) + await fetchHistorical(property);

    try {
      const response = await fetch("https://models.inference.ai.azure.com/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: "system", content: "あなたは東京の不動産アナリストです。日本語のみで回答してください。" },
            { role: "user", content: fullPrompt },
          ],
          temperature: 0.8,
          max_tokens: 2000,
        }),
      });

      const data = await response.json();
      if (data.error) {
        console.error("[GH] API error:", data.error);
        return { error: data.error.message || JSON.stringify(data.error) };
      }

      const evaluation = data.choices?.[0]?.message?.content || "No response";
      const score = calcScore(property);
      const finalEval = evaluation.replace(/\n*評価[：:].*$/, "") + `\n\n評価: ${score}`;

      if (property.matchId) {
        try {
          await ctx.runMutation(internal.matching.saveEvaluation, { matchId: property.matchId, evaluation: finalEval });
          await ctx.runMutation(api.matching.saveScore, { matchId: property.matchId, score });
        } catch (dbErr) { console.error("[GH] DB save failed:", dbErr); }
      }

      return { evaluation: finalEval, score, model: modelName };
    } catch (err) {
      console.error("[GH] Request failed:", err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// Shared helpers
function buildPrompt(p) {
  return `以下の東京の不動産物件について、投資判断に役立つ評価を3〜5行の日本語で書いてください。

所在地: ${p.address || ""} ${p.ward || ""}
価格: ${p.price ? `${p.price}万円` : "未記載"}
土地面積: ${p.landSize ? `${p.landSize}㎡` : "未記載"}
${p.buildingCoverageRatio ? `建ぺい率: ${p.buildingCoverageRatio}%` : ""}
${p.floorAreaRatio ? `容積率: ${p.floorAreaRatio}%` : ""}
${p.station ? `最寄駅: ${p.station} 徒歩${p.walkMinutes || "?"}分` : ""}
${p.buildYear ? `築年: ${p.buildYear}年` : ""}

指示：
- 日本語のみで書くこと。英語は絶対に使わない。
- 番号や箇条書きは使わない。
- 自然な文章で、不動産の専門家が書いたように。
- 投資価値、立地、周辺環境、リスクについて触れる。
- 最後に「総評: まとめ」のように短く締めくくること。`;
}

async function fetchNearby(p) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !p.address) return "";
  try {
    const geoQuery = encodeURIComponent(`${p.address} ${p.ward || ""} 東京`);
    const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${geoQuery}&key=${key}`);
    const geoData = await geoRes.json();
    const loc = geoData.results?.[0]?.geometry?.location;
    if (!loc) return "";
    const types = ["restaurant", "train_station", "park", "supermarket", "convenience_store"];
    const results = [];
    for (const type of types) {
      const placesRes = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${loc.lat},${loc.lng}&radius=500&type=${type}&language=ja&key=${key}`);
      const placesData = await placesRes.json();
      const count = placesData.results?.length || 0;
      if (count > 0) {
        const names = placesData.results.slice(0, 3).map((r) => r.name).join("、");
        results.push(`${type === "train_station" ? "駅" : type === "convenience_store" ? "コンビニ" : type}: ${count}件（例: ${names}）`);
      }
    }
    if (results.length > 0) return "\n\n周辺施設（徒歩5分圏内）:\n" + results.join("\n");
  } catch { /* ignore */ }
  return "";
}

async function fetchHistorical(p) {
  const key = process.env.REINFOLIB_API_KEY;
  if (!key || !p.ward) return "";
  const wardCodeMap = {
    "千代田区": "13101", "中央区": "13102", "港区": "13103", "新宿区": "13104",
    "文京区": "13105", "台東区": "13106", "墨田区": "13107", "江東区": "13108",
    "品川区": "13109", "目黒区": "13110", "大田区": "13111", "世田谷区": "13112",
    "渋谷区": "13113", "中野区": "13114", "杉並区": "13115", "豊島区": "13116",
    "北区": "13117", "荒川区": "13118", "板橋区": "13119", "練馬区": "13120",
    "足立区": "13121", "葛飾区": "13122", "江戸川区": "13123",
  };
  const cityCode = wardCodeMap[p.ward];
  if (!cityCode) return "";
  try {
    const currentYear = new Date().getFullYear();
    const lines = [];
    for (const year of [currentYear - 1, currentYear - 2]) {
      const mlitRes = await fetch(`https://www.reinfolib.mlit.go.jp/ex-api/external/XIT001?year=${year}&area=13&city=${cityCode}&language=ja`, {
        headers: { "Ocp-Apim-Subscription-Key": key },
      });
      const mlitData = await mlitRes.json();
      const items = mlitData.data || [];
      const landPrices = items.filter((i) => i.Type === "宅地(土地)" && i.TradePrice).map((i) => parseFloat(i.TradePrice.replace(/,/g, "")) / 10000);
      if (landPrices.length > 0) {
        const avg = Math.round(landPrices.reduce((a, b) => a + b, 0) / landPrices.length);
        const min = Math.round(Math.min(...landPrices));
        const max = Math.round(Math.max(...landPrices));
        lines.push(`${year}年: ${landPrices.length}件の取引 | 平均${avg}万円 | 範囲${min}〜${max}万円`);
      }
    }
    if (lines.length > 0) return `\n\n【${p.ward}の過去の土地取引実績】\n` + lines.join("\n");
  } catch { /* ignore */ }
  return "";
}

function calcScore(p) {
  let score = 30;
  if (p.walkMinutes != null) score += Math.max(0, 25 - p.walkMinutes * 2);
  if (p.price && p.landSize) {
    const ppsqm = p.price / p.landSize;
    if (ppsqm < 40) score += 20; else if (ppsqm < 60) score += 16; else if (ppsqm < 80) score += 12; else if (ppsqm < 100) score += 8; else if (ppsqm < 130) score += 4;
  }
  if (p.landSize) {
    if (p.landSize > 300) score += 15; else if (p.landSize > 150) score += 12; else if (p.landSize > 80) score += 8; else if (p.landSize > 40) score += 4;
  }
  if (p.floorAreaRatio) {
    if (p.floorAreaRatio >= 400) score += 10; else if (p.floorAreaRatio >= 300) score += 7; else if (p.floorAreaRatio >= 200) score += 4; else if (p.floorAreaRatio >= 150) score += 2;
  }
  const premiumWards = ["港区", "千代田区", "中央区", "渋谷区", "新宿区", "文京区"];
  const goodWards = ["目黒区", "品川区", "世田谷区", "杉並区", "中野区", "豊島区"];
  if (p.ward) {
    if (premiumWards.includes(p.ward)) score += 20; else if (goodWards.includes(p.ward)) score += 10; else score += 5;
  }
  return Math.min(95, Math.max(5, Math.round(score)));
}
