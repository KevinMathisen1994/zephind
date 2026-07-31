import { action } from "./_generated/server.js";
import { v } from "convex/values";
import { api } from "./_generated/api.js";
import { computeMatchScore, wardCityCode } from "./lib/scoring.js";

// Scoring logic lives in ./lib/scoring.js so it can be unit-tested with plain
// `node`, outside the Convex runtime. See that file for the layered model.

export const evaluateListing = action({
  args: {
    matchId: v.optional(v.string()),
    // Property Details
    address: v.optional(v.string()),
    ward: v.optional(v.string()),
    price: v.optional(v.number()),
    landSize: v.optional(v.number()),
    area: v.optional(v.number()),
    buildingCoverageRatio: v.optional(v.number()),
    floorAreaRatio: v.optional(v.number()),
    walkMinutes: v.optional(v.number()),
    station: v.optional(v.string()),
    buildYear: v.optional(v.number()),
    roadWidth: v.optional(v.number()),
    frontage: v.optional(v.number()),
    rooms: v.optional(v.number()),
    layout: v.optional(v.string()),
    propertyType: v.optional(v.string()),
    description: v.optional(v.string()),
    yield: v.optional(v.number()),
    structure: v.optional(v.string()),
    floor: v.optional(v.number()),
    totalUnits: v.optional(v.number()),
    elevators: v.optional(v.number()),

    // Order Criteria (Buyer Requirements)
    orderCriteria: v.optional(
      v.object({
        orderName: v.optional(v.string()),
        wards: v.optional(v.array(v.string())),
        priceMin: v.optional(v.number()),
        priceMax: v.optional(v.number()),
        areaMin: v.optional(v.number()),
        areaMax: v.optional(v.number()),
        landSizeMin: v.optional(v.number()),
        landSizeMax: v.optional(v.number()),
        minYield: v.optional(v.number()),
        maxYield: v.optional(v.number()),
        walkMinutesMax: v.optional(v.number()),
        minRoadWidth: v.optional(v.number()),
        propertyTypes: v.optional(v.array(v.string())),
        structureTypes: v.optional(v.array(v.string())),
        maxBuildAge: v.optional(v.number()),
        minBuildYear: v.optional(v.number()),
        excludeFirstFloor: v.optional(v.boolean()),
        maxFloor: v.optional(v.number()),
        minElevators: v.optional(v.number()),
        minTotalUnits: v.optional(v.number()),
        specialRequirements: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.RAX_API_KEY;
    if (!apiKey) {
      return { error: "RAX_API_KEY not configured" };
    }

    const c = args.orderCriteria || {};

    // 1. Construct Property Summary
    const propertySummary = `
【物件概要】
・所在地: ${args.address || ""} ${args.ward || ""}
・価格: ${args.price ? `${args.price.toLocaleString()}万円` : "未記載"}
・想定利回り: ${args.yield ? `${args.yield}%` : "要確認"}
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

    // 2. Construct Order Criteria Summary
    const hasOrderContext = Object.keys(c).length > 0;
    const orderSummary = hasOrderContext
      ? `
【顧客の購入ニーズ・ご要望】
・案件名: ${c.orderName || "買主指定条件"}
・希望エリア: ${c.wards && c.wards.length > 0 ? c.wards.join("、") : "都内近郊"}
・ご予算: ${c.priceMin || c.priceMax ? `${c.priceMin || 0}万円 〜 ${c.priceMax ? `${c.priceMax}万円` : "上限なし"}` : "指定なし"}
・希望利回り: ${c.minYield ? `${c.minYield}% 以上` : "指定なし"}
・駅徒歩制限: ${c.walkMinutesMax ? `徒歩${c.walkMinutesMax}分以内` : "指定なし"}
・前面道路幅員: ${c.minRoadWidth ? `${c.minRoadWidth}m以上` : "指定なし"}
・希望物件種別: ${c.propertyTypes && c.propertyTypes.length > 0 ? c.propertyTypes.join("、") : "指定なし"}
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

    // 3. Fetch Nearby Facilities via Google Places API
    let nearbyInfo = "";
    let nearbyTotalCount = null;
    const placesKey = process.env.GOOGLE_PLACES_API_KEY;
    if (placesKey && args.address) {
      try {
        const geoQuery = encodeURIComponent(
          `${args.address} ${args.ward || ""} 東京`,
        );
        const geoRes = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${geoQuery}&key=${placesKey}`,
        );
        const geoData = await geoRes.json();
        const loc = geoData.results?.[0]?.geometry?.location;

        if (loc) {
          const types = [
            "restaurant",
            "lodging",
            "train_station",
            "park",
            "supermarket",
            "convenience_store",
          ];
          const results = [];
          let countSum = 0;
          for (const type of types) {
            const placesRes = await fetch(
              `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${loc.lat},${loc.lng}&radius=500&type=${type}&language=ja&key=${placesKey}`,
            );
            const placesData = await placesRes.json();
            const count = placesData.results?.length || 0;
            countSum += count;
            if (count > 0) {
              const names = placesData.results
                .slice(0, 3)
                .map((r) => r.name)
                .join("、");
              const label =
                type === "lodging"
                  ? "ホテル"
                  : type === "train_station"
                    ? "駅"
                    : type === "convenience_store"
                      ? "コンビニ"
                      : type === "supermarket"
                        ? "スーパー"
                        : type === "restaurant"
                          ? "飲食店"
                          : "公園";
              results.push(
                `・${label}: 徒歩5分圏内に${count}件（主要: ${names}）`,
              );
            }
          }
          nearbyTotalCount = countSum;
          if (results.length > 0) {
            nearbyInfo =
              "\n\n【周辺インフラ環境（徒歩5分圏内）】\n" + results.join("\n");
          }
        }
      } catch (e) {
        console.error("[Places API] Error:", e);
      }
    }

    // 4. Fetch Historical MLIT Transaction Data
    let historicalInfo = "";
    let marketAvgPrice = null; // used later as a real-comp signal in scoring
    const reinfolibKey = process.env.REINFOLIB_API_KEY;
    if (reinfolibKey && args.ward) {
      try {
        // Listing `ward` is inconsistent in this dataset (proper names, raw MLIT
        // city codes like "13212", blanks, and truncated forms like "京都町田市").
        // A raw-map lookup silently returned undefined for ~28% of listings, so
        // the comps block never ran and marketAvgPrice stayed null for them.
        const cityCode = wardCityCode(args.ward);
        if (cityCode) {
          const currentYear = new Date().getFullYear();
          const yearData = {};
          for (const year of [currentYear - 1, currentYear - 2]) {
            const mlitUrl = `https://www.reinfolib.mlit.go.jp/ex-api/external/XIT001?year=${year}&area=13&city=${cityCode}&language=ja`;
            const mlitRes = await fetch(mlitUrl, {
              headers: { "Ocp-Apim-Subscription-Key": reinfolibKey },
            });
            const mlitData = await mlitRes.json();
            const items = mlitData.data || [];
            const landPrices = items
              .filter((i) => i.TradePrice)
              .map((i) => parseFloat(i.TradePrice.replace(/,/g, "")) / 10000);
            yearData[String(year)] = {
              prices: landPrices,
              count: landPrices.length,
            };
          }
          const lines = [];
          const allPrices = [];
          for (const [year, data] of Object.entries(yearData)) {
            if (data.count > 0) {
              allPrices.push(...data.prices);
              const avg = Math.round(
                data.prices.reduce((a, b) => a + b, 0) / data.count,
              );
              const min = Math.round(Math.min(...data.prices));
              const max = Math.round(Math.max(...data.prices));
              lines.push(
                `・${year}年: ${data.count}件の取引 | 平均価格: ${avg.toLocaleString()}万円 (範囲: ${min.toLocaleString()}〜${max.toLocaleString()}万円)`,
              );
            }
          }
          if (allPrices.length > 0) {
            marketAvgPrice = Math.round(
              allPrices.reduce((a, b) => a + b, 0) / allPrices.length,
            );
          }
          if (lines.length > 0) {
            historicalInfo =
              `\n\n【${args.ward}における国土交通省の実取引相場データ】\n` +
              lines.join("\n");
          }
        }
      } catch (e) {
        console.error("[MLIT API] Error:", e);
      }
    }

    // 5. Score deterministically, BEFORE the LLM call. The model is told the
    // verdict and writes the narrative to match it, rather than inventing a
    // number we then trust.
    const assessment = computeMatchScore(args, c, {
      marketAvgPrice,
      amenityCount: nearbyTotalCount,
    });
    const score = assessment.score;

    const verdictBrief = [
      `【確定スコア】${score}点（この数値は社内査定ロジックによる確定値です）`,
      assessment.disqualifiers.length
        ? `【致命的な不適合】\n${assessment.disqualifiers.map((d) => `・${d.reason}`).join("\n")}`
        : "【致命的な不適合】なし",
      assessment.unverified.length
        ? `【要確認事項（顧客条件に関わるが物件資料に記載なし）】\n${assessment.unverified.map((u) => `・${u}`).join("\n")}`
        : "【要確認事項】特になし",
    ].join("\n\n");

    // 6. Construct Professional AI Broker Prompt
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

    try {
      const response = await fetch(
        "https://ai.raxcore.dev/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
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
          }),
        },
      );

      const data = await response.json();
      if (data.error) {
        console.error("[Rax AI] API error:", data.error);
        return { error: data.error.message || JSON.stringify(data.error) };
      }
      let evaluation =
        data.choices?.[0]?.message?.content || "評価レスポンスなし";
      evaluation = evaluation
        .replace(/アrea/gi, "エリア")
        .replace(/A-rea/gi, "エリア");

      // 6. The score is computed in code, NOT read back from the model.
      //
      // This used to parse 【プロの総合投資スコア: XX点】 out of the model's own
      // prose and only fall back to the deterministic scorer when that regex
      // failed. Since the model reliably emits the tag, the scorer never ran —
      // every past "scoring fix" edited dead code. Worse, the saved number was a
      // temperature-0.7 sample: byte-identical inputs measured 82 and then 72,
      // which is what produced the phantom 98 -> 88 -> 98 "regressions".
      // The model now writes narrative only; `assessment.score` is the score.
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

      // Save to DB if matchId provided
      if (args.matchId) {
        try {
          await ctx.runMutation(api.matching.saveEvaluation, {
            matchId: args.matchId,
            evaluation,
          });
          await ctx.runMutation(api.matching.saveScore, {
            matchId: args.matchId,
            score,
          });
        } catch (dbErr) {
          console.error("[Rax AI] DB save failed:", dbErr);
        }
      }

      return {
        evaluation,
        score,
        model: data.model,
        // Surfaced so the UI can show *why* a listing scored as it did, and so
        // regressions are diagnosable without re-running the model.
        scoreDetail: {
          fitPct: assessment.fitPct,
          marketPct: assessment.marketPct,
          completeness: assessment.completeness,
          disqualifiers: assessment.disqualifiers,
          unverified: assessment.unverified,
          breakdown: assessment.breakdown,
          marketAvgPrice,
          amenityCount: nearbyTotalCount,
        },
      };
    } catch (err) {
      console.error("[Rax AI] Request failed:", err);
      // The score no longer depends on the model, so return it even when the
      // narrative call fails — a listing without prose still ranks correctly.
      return { error: err instanceof Error ? err.message : String(err), score };
    }
  },
});
