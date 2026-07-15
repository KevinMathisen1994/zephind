import { action } from "./_generated/server.js";
import { v } from "convex/values";
import { api, internal } from "./_generated/api.js";

export const evaluateListing = action({
  args: {
    matchId: v.optional(v.string()),
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
    const apiKey = process.env.RAX_API_KEY;
    if (!apiKey) {
      return { error: "RAX_API_KEY not configured" };
    }

    const prompt = `以下の東京の不動産物件について、投資判断に役立つ評価を3〜5行の日本語で書いてください。

所在地: ${args.address || ""} ${args.ward || ""}
価格: ${args.price ? `${args.price}万円` : "未記載"}
土地面積: ${args.landSize ? `${args.landSize}㎡` : "未記載"}
${args.buildingCoverageRatio ? `建ぺい率: ${args.buildingCoverageRatio}%` : ""}
${args.floorAreaRatio ? `容積率: ${args.floorAreaRatio}%` : ""}
${args.station ? `最寄駅: ${args.station} 徒歩${args.walkMinutes || "?"}分` : ""}
${args.buildYear ? `築年: ${args.buildYear}年` : ""}

指示：
- 日本語のみで書くこと。英語は絶対に使わない。
- 番号や箇条書きは使わない。
- 自然な文章で、不動産の専門家が書いたように。
- 投資価値、立地、周辺環境、リスクについて触れる。
- 最後に「総評: まとめ」のように短く締めくくること。`;

    // Fetch nearby places from Google Places API
    let nearbyInfo = "";
    const placesKey = process.env.GOOGLE_PLACES_API_KEY;

    console.log("PLACES KEY >>>", !!placesKey, args.address, args.ward)
    if (placesKey && args.address) {
      try {
        console.log("TRY!!!!")
        // Geocode address to lat/lng
        const geoQuery = encodeURIComponent(`${args.address} ${args.ward || ""} 東京`);

                console.log("geoQuery!!!!", geoQuery)
        const geoRes = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${geoQuery}&key=${placesKey}`
        );

                console.log("geoRes!!!!", geoRes)
        const geoData = await geoRes.json();

                        console.log("geoData!!!!", geoData)

                        
        const loc = geoData.results?.[0]?.geometry?.location;

                              console.log("loc!!!!", loc)

        if (loc) {
          // Search nearby places by type
          const types = ["restaurant", "lodging", "train_station", "park", "supermarket", "convenience_store"];
          const results = [];
          for (const type of types) {
            const placesRes = await fetch(
              `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${loc.lat},${loc.lng}&radius=500&type=${type}&language=ja&key=${placesKey}`
            );
            const placesData = await placesRes.json();
            console.log("placesData >>>", placesData)
            const count = placesData.results?.length || 0;
            if (count > 0) {
              const names = placesData.results.slice(0, 3).map((r) => r.name).join("、");
              results.push(`${type === "lodging" ? "ホテル" : type === "train_station" ? "駅" : type === "convenience_store" ? "コンビニ" : type}: ${count}件（例: ${names}）`);
            }
          }
          if (results.length > 0) {
            nearbyInfo = "\n\n周辺施設（徒歩5分圏内）:\n" + results.join("\n");
          }
        }
      } catch (e) {
        console.error("[Places API] Error:", e);
      }
    }

    // Fetch historical transaction data from MLIT API
    let historicalInfo = "";
    const reinfolibKey = process.env.REINFOLIB_API_KEY;
    if (reinfolibKey && args.ward) {
      console.log(`[MLIT] Fetching historical data for ${args.ward}...`);
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
        const cityCode = wardCodeMap[args.ward];
        if (cityCode) {
          console.log(`[MLIT] City code: ${cityCode}`);
          const currentYear = new Date().getFullYear();
          const yearData = {};
          for (const year of [currentYear - 1, currentYear - 2]) {
            const mlitUrl = `https://www.reinfolib.mlit.go.jp/ex-api/external/XIT001?year=${year}&area=13&city=${cityCode}&language=ja`;
            console.log(`[MLIT] Fetching ${year}...`);
            const mlitRes = await fetch(mlitUrl, {
              headers: { "Ocp-Apim-Subscription-Key": reinfolibKey },
            });
            const mlitData = await mlitRes.json();
            console.log(`[MLIT] ${year}: status=${mlitData.status} items=${mlitData.data?.length || 0}`);
            const items = mlitData.data || [];
            const landPrices = items
              .filter((i) => i.Type === "宅地(土地)" && i.TradePrice)
              .map((i) => parseFloat(i.TradePrice.replace(/,/g, "")) / 10000);
            console.log(`[MLIT] ${year}: ${landPrices.length} land transactions found`);
            yearData[String(year)] = {
              prices: landPrices,
              count: landPrices.length,
            };
          }
          const lines = [];
          for (const [year, data] of Object.entries(yearData)) {
            if (data.count > 0) {
              const avg = Math.round(data.prices.reduce((a, b) => a + b, 0) / data.count);
              const min = Math.round(Math.min(...data.prices));
              const max = Math.round(Math.max(...data.prices));
              lines.push(`${year}年: ${data.count}件の取引 | 平均${avg}万円 | 範囲${min}〜${max}万円`);
            }
          }
          if (lines.length > 0) {
            historicalInfo = `\n\n【${args.ward}の過去の土地取引実績】\n` + lines.join("\n");
            console.log(`[MLIT] Added to prompt: ${lines.join(" | ")}`);
          } else {
            console.log(`[MLIT] No land transaction data found for ${args.ward}`);
          }
        } else {
          console.log(`[MLIT] No city code mapping for ward: ${args.ward}`);
        }
      } catch (e) {
        console.error("[MLIT API] Error:", e);
      }
    } else {
      console.log(`[MLIT] Skipped: key=${!!reinfolibKey} ward=${args.ward}`);
    }

    const fullPrompt = prompt + nearbyInfo + historicalInfo;

    try {
      const response = await fetch("https://ai.raxcore.dev/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "rax-4.0",
          messages: [
            { role: "system", content: "あなたは東京の不動産アナリストです。周辺施設の情報も考慮して評価してください。日本語のみで回答してください。" },
            { role: "user", content: fullPrompt },
          ],
          temperature: 0.8,
          max_tokens: 2000,
        }),
      });

      const data = await response.json();
      if (data.error) {
        console.error("[Rax AI] API error:", data.error);
        return { error: data.error.message || JSON.stringify(data.error) };
      }
      let evaluation = data.choices?.[0]?.message?.content || "No response";

      // Calculate score from property data
      let score = 30; // baseline

      // Walk minutes: 0-25 points (lower = better)
      if (args.walkMinutes != null) {
        score += Math.max(0, 25 - args.walkMinutes * 2);
      }

      // Price per sqm (万円/㎡): 0-20 points (lower = better)
      if (args.price && args.landSize) {
        const ppsqm = args.price / args.landSize;
        if (ppsqm < 40) score += 20;
        else if (ppsqm < 60) score += 16;
        else if (ppsqm < 80) score += 12;
        else if (ppsqm < 100) score += 8;
        else if (ppsqm < 130) score += 4;
      }

      // Land size: 0-15 points (larger = better)
      if (args.landSize) {
        if (args.landSize > 300) score += 15;
        else if (args.landSize > 150) score += 12;
        else if (args.landSize > 80) score += 8;
        else if (args.landSize > 40) score += 4;
      }

      // BCR/FAR utilization: 0-10 points
      if (args.floorAreaRatio) {
        if (args.floorAreaRatio >= 400) score += 10;
        else if (args.floorAreaRatio >= 300) score += 7;
        else if (args.floorAreaRatio >= 200) score += 4;
        else if (args.floorAreaRatio >= 150) score += 2;
      }

      // Ward premium: 0-20 points
      const premiumWards = ["港区", "千代田区", "中央区", "渋谷区", "新宿区", "文京区"];
      const goodWards = ["目黒区", "品川区", "世田谷区", "杉並区", "中野区", "豊島区"];
      if (args.ward) {
        if (premiumWards.includes(args.ward)) score += 20;
        else if (goodWards.includes(args.ward)) score += 10;
        else score += 5;
      }

      score = Math.min(95, Math.max(5, Math.round(score)));
      evaluation = evaluation.replace(/\n*評価[：:].*$/, "") + `\n\n評価: ${score}`;
      console.log(`[Rax AI] Calculated score: ${score}/100`);
      console.log(`[Rax AI] Got evaluation (${evaluation.length} chars) for ${args.address || args.ward || "?"}`);

      // Save to DB if matchId provided
      if (args.matchId) {
        try {
          await ctx.runMutation(internal.matching.saveEvaluation, {
            matchId: args.matchId,
            evaluation,
          });
          // Also save the parsed score
          if (score !== null) {
            await ctx.runMutation(api.matching.saveScore, {
              matchId: args.matchId,
              score,
            });
          }
          console.log(`[Rax AI] Saved to DB for match ${args.matchId}`);
        } catch (dbErr) {
          console.error("[Rax AI] DB save failed:", dbErr);
        }
      }

      return { evaluation, score, model: data.model };
    } catch (err) {
      console.error("[Rax AI] Request failed:", err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
});
