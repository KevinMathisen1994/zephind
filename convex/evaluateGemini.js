import { action } from "./_generated/server.js";
import { v } from "convex/values";
import { api, internal } from "./_generated/api.js";

export const evaluateWithGemini = action({
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
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { error: "GEMINI_API_KEY not configured" };
    }

    const { model, ...property } = args;
    const modelName = model || "gemini-2.5-flash";

    const prompt = `以下の東京の不動産物件について、投資判断に役立つ評価を3〜5行の日本語で書いてください。

所在地: ${property.address || ""} ${property.ward || ""}
価格: ${property.price ? `${property.price}万円` : "未記載"}
土地面積: ${property.landSize ? `${property.landSize}㎡` : "未記載"}
${property.buildingCoverageRatio ? `建ぺい率: ${property.buildingCoverageRatio}%` : ""}
${property.floorAreaRatio ? `容積率: ${property.floorAreaRatio}%` : ""}
${property.station ? `最寄駅: ${property.station} 徒歩${property.walkMinutes || "?"}分` : ""}
${property.buildYear ? `築年: ${property.buildYear}年` : ""}

指示：
- 日本語のみで書くこと。英語は絶対に使わない。
- 番号や箇条書きは使わない。
- 自然な文章で、不動産の専門家が書いたように。
- 投資価値、立地、周辺環境、リスクについて触れる。
- 最後に「総評: まとめ」のように短く締めくくること。`;

    // Fetch nearby places from Google Places API
    let nearbyInfo = "";
    const placesKey = process.env.GOOGLE_PLACES_API_KEY;
    if (placesKey && property.address) {
      try {
        const geoQuery = encodeURIComponent(`${property.address} ${property.ward || ""} 東京`);
        const geoRes = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${geoQuery}&key=${placesKey}`
        );
        const geoData = await geoRes.json();
        const loc = geoData.results?.[0]?.geometry?.location;
        if (loc) {
          const types = ["restaurant", "train_station", "park", "supermarket", "convenience_store"];
          const results = [];
          for (const type of types) {
            const placesRes = await fetch(
              `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${loc.lat},${loc.lng}&radius=500&type=${type}&language=ja&key=${placesKey}`
            );
            const placesData = await placesRes.json();
            const count = placesData.results?.length || 0;
            if (count > 0) {
              const names = placesData.results.slice(0, 3).map((r) => r.name).join("、");
              results.push(`${type === "train_station" ? "駅" : type === "convenience_store" ? "コンビニ" : type}: ${count}件（例: ${names}）`);
            }
          }
          if (results.length > 0) {
            nearbyInfo = "\n\n周辺施設（徒歩5分圏内）:\n" + results.join("\n");
          }
        }
      } catch (e) {
        console.error("[Gemini Places] Error:", e);
      }
    }

    // Fetch historical transaction data from MLIT API
    let historicalInfo = "";
    const reinfolibKey = process.env.REINFOLIB_API_KEY;
    if (reinfolibKey && property.ward) {
      try {
        const wardCodeMap = {
          "千代田区": "13101", "中央区": "13102", "港区": "13103",
          "新宿区": "13104", "文京区": "13105", "台東区": "13106",
          "墨田区": "13107", "江東区": "13108", "品川区": "13109",
          "目黒区": "13110", "大田区": "13111", "世田谷区": "13112",
          "渋谷区": "13113", "中野区": "13114", "杉並区": "13115",
          "豊島区": "13116", "北区": "13117", "荒川区": "13118",
          "板橋区": "13119", "練馬区": "13120", "足立区": "13121",
          "葛飾区": "13122", "江戸川区": "13123",
        };
        const cityCode = wardCodeMap[property.ward];
        if (cityCode) {
          console.log(`[Gemini MLIT] Fetching for ${property.ward}...`);
          const currentYear = new Date().getFullYear();
          const lines = [];
          for (const year of [currentYear - 1, currentYear - 2]) {
            const mlitUrl = `https://www.reinfolib.mlit.go.jp/ex-api/external/XIT001?year=${year}&area=13&city=${cityCode}&language=ja`;
            const mlitRes = await fetch(mlitUrl, {
              headers: { "Ocp-Apim-Subscription-Key": reinfolibKey },
            });
            const mlitData = await mlitRes.json();
            const items = mlitData.data || [];
            const landPrices = items
              .filter((i) => i.Type === "宅地(土地)" && i.TradePrice)
              .map((i) => parseFloat(i.TradePrice.replace(/,/g, "")) / 10000);
            if (landPrices.length > 0) {
              const avg = Math.round(landPrices.reduce((a, b) => a + b, 0) / landPrices.length);
              const min = Math.round(Math.min(...landPrices));
              const max = Math.round(Math.max(...landPrices));
              lines.push(`${year}年: ${landPrices.length}件の取引 | 平均${avg}万円 | 範囲${min}〜${max}万円`);
            }
          }
          if (lines.length > 0) {
            historicalInfo = `\n\n【${property.ward}の過去の土地取引実績】\n` + lines.join("\n");
          }
        }
      } catch (e) {
        console.error("[Gemini MLIT] Error:", e);
      }
    }

    const fullPrompt = prompt + nearbyInfo + historicalInfo;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: fullPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 2000,
          },
        }),
      });

      const data = await response.json();
      if (data.error) {
        console.error("[Gemini] API error:", data.error);
        return { error: data.error.message || JSON.stringify(data.error) };
      }

      const evaluation = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response";

      // Calculate score from property data (same logic as Rax)
      let score = 30;
      if (property.walkMinutes != null) {
        score += Math.max(0, 25 - property.walkMinutes * 2);
      }
      if (property.price && property.landSize) {
        const ppsqm = property.price / property.landSize;
        if (ppsqm < 40) score += 20;
        else if (ppsqm < 60) score += 16;
        else if (ppsqm < 80) score += 12;
        else if (ppsqm < 100) score += 8;
        else if (ppsqm < 130) score += 4;
      }
      if (property.landSize) {
        if (property.landSize > 300) score += 15;
        else if (property.landSize > 150) score += 12;
        else if (property.landSize > 80) score += 8;
        else if (property.landSize > 40) score += 4;
      }
      if (property.floorAreaRatio) {
        if (property.floorAreaRatio >= 400) score += 10;
        else if (property.floorAreaRatio >= 300) score += 7;
        else if (property.floorAreaRatio >= 200) score += 4;
        else if (property.floorAreaRatio >= 150) score += 2;
      }
      const premiumWards = ["港区", "千代田区", "中央区", "渋谷区", "新宿区", "文京区"];
      const goodWards = ["目黒区", "品川区", "世田谷区", "杉並区", "中野区", "豊島区"];
      if (property.ward) {
        if (premiumWards.includes(property.ward)) score += 20;
        else if (goodWards.includes(property.ward)) score += 10;
        else score += 5;
      }
      score = Math.min(95, Math.max(5, Math.round(score)));

      const finalEval = evaluation.replace(/\n*評価[：:].*$/, "") + `\n\n評価: ${score}`;
      console.log(`[Gemini] Score: ${score}/100 for ${property.address || property.ward || "?"} (model: ${modelName})`);

      // Save to DB
      if (property.matchId) {
        try {
          await ctx.runMutation(internal.matching.saveEvaluation, {
            matchId: property.matchId,
            evaluation: finalEval,
          });
          await ctx.runMutation(api.matching.saveScore, {
            matchId: property.matchId,
            score,
          });
        } catch (dbErr) {
          console.error("[Gemini] DB save failed:", dbErr);
        }
      }

      return { evaluation: finalEval, score, model: modelName };
    } catch (err) {
      console.error("[Gemini] Request failed:", err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
});
