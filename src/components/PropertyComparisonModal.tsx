import {
  X,
  Sparkles,
  Award,
  Building2,
  Train,
  Ruler,
  Calendar,
  Layers,
  MapPin,
  ExternalLink,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import type { Doc } from "../lib/dataModel";

export interface ComparisonListing {
  matchId: string;
  listing: Doc<"listings">;
  score?: number;
  evaluation?: string;
  orderName?: string;
  marketAvgPricePerSqm?: number | null;
}

interface PropertyComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  listings: ComparisonListing[];
  orderName?: string;
}

export function PropertyComparisonModal({
  isOpen,
  onClose,
  listings,
  orderName,
}: PropertyComparisonModalProps) {
  if (!isOpen || listings.length === 0) return null;

  // Calculate comparative analytics
  const bestScore = Math.max(...listings.map((l) => l.score ?? 0));
  const bestYield = Math.max(
    ...listings.map((l) => l.listing.yield || l.listing.grossYield || 0),
  );
  const bestWalk = Math.min(
    ...listings.map((l) => l.listing.walkMinutes ?? 999),
  );

  // Lowest price per sqm
  const ppsmList = listings.map((l) => {
    const area = l.listing.area || l.listing.landSize || 0;
    const price = l.listing.price || 0;
    return area > 0 && price > 0 ? price / area : null;
  });
  const validPpsm = ppsmList.filter((p): p is number => p !== null);
  const bestPpsm = validPpsm.length > 0 ? Math.min(...validPpsm) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-6xl max-h-[92vh] flex flex-col rounded-2xl bg-[var(--bg-surface)] shadow-2xl border border-[var(--border-subtle)] overflow-hidden">
        {/* Header — light paper, same masthead language as the rest of the app */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-page-subtle)]">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 shrink-0 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand)]">
              <Sparkles className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold tracking-tight text-[var(--text-primary)]">
                  物件の比較
                </h2>
                <Badge variant="neutral" className="text-[13.5px] font-bold">
                  {listings.length}件を比較中
                </Badge>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {orderName ? `「${orderName}」の希望条件に沿った` : ""}
                利回り・相場との差・駅からの距離を並べて比べます
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 shrink-0 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer"
            aria-label="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* AI Deal Verdict Banner */}
          <div className="rounded-xl border border-emerald-200 bg-linear-to-br from-emerald-50/80 via-white to-emerald-50/50 p-4 shadow-2xs">
            <div className="flex items-center gap-2 mb-3">
              <Award className="w-4 h-4 text-emerald-700" />
              <span className="text-xs font-bold text-emerald-950 uppercase tracking-wider">
                AIによる比較判定とおすすめ
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Best Yield */}
              <div className="p-3 rounded-lg bg-white border border-emerald-100 shadow-2xs">
                <div className="text-[14px] font-bold text-slate-500 flex items-center justify-between">
                  <span>利回りが最も高い物件</span>
                </div>
                <div className="text-sm font-black text-emerald-800 mt-1">
                  {bestYield > 0 ? (
                    <>
                      物件
                      {listings.findIndex(
                        (l) =>
                          (l.listing.yield || l.listing.grossYield || 0) ===
                          bestYield,
                      ) + 1}
                      <span className="ml-1 text-xs font-bold text-emerald-600">
                        ({bestYield}%)
                      </span>
                    </>
                  ) : (
                    "該当なし"
                  )}
                </div>
                <div className="text-[13.5px] text-slate-500 mt-0.5 truncate">
                  {bestYield > 0
                    ? listings.find(
                        (l) =>
                          (l.listing.yield || l.listing.grossYield || 0) ===
                          bestYield,
                      )?.listing.title || "利回りを重視する方向け"
                    : "—"}
                </div>
              </div>

              {/* Best Value / Ppsm */}
              <div className="p-3 rounded-lg bg-white border border-emerald-100 shadow-2xs">
                <div className="text-[14px] font-bold text-slate-500 flex items-center justify-between">
                  <span>平米単価が最も安い物件</span>
                </div>
                <div className="text-sm font-black text-emerald-800 mt-1">
                  {bestPpsm !== null ? (
                    <>
                      物件{ppsmList.indexOf(bestPpsm) + 1}
                      <span className="ml-1 text-xs font-bold text-emerald-600">
                        ({Math.round(bestPpsm * 10) / 10}万円/㎡)
                      </span>
                    </>
                  ) : (
                    "該当なし"
                  )}
                </div>
                <div className="text-[13.5px] text-slate-500 mt-0.5 truncate">
                  {bestPpsm !== null
                    ? listings[ppsmList.indexOf(bestPpsm)]?.listing.title ||
                      "割安に購入できる可能性がある物件"
                    : "—"}
                </div>
              </div>

              {/* Best Location */}
              <div className="p-3 rounded-lg bg-white border border-emerald-100 shadow-2xs">
                <div className="text-[14px] font-bold text-slate-500 flex items-center justify-between">
                  <span>駅に最も近い物件</span>
                </div>
                <div className="text-sm font-black text-emerald-800 mt-1">
                  {bestWalk < 999 ? (
                    <>
                      物件
                      {listings.findIndex(
                        (l) => l.listing.walkMinutes === bestWalk,
                      ) + 1}
                      <span className="ml-1 text-xs font-bold text-emerald-600">
                        (徒歩{bestWalk}分)
                      </span>
                    </>
                  ) : (
                    "該当なし"
                  )}
                </div>
                <div className="text-[13.5px] text-slate-500 mt-0.5 truncate">
                  {bestWalk < 999
                    ? `${listings.find((l) => l.listing.walkMinutes === bestWalk)?.listing.station || "最寄駅"} 徒歩至近で空室リスクが低い`
                    : "—"}
                </div>
              </div>
            </div>
          </div>

          {/* Side-by-Side Comparison Columns */}
          <div className="overflow-x-auto pb-2">
            <div
              className="grid gap-4 min-w-[720px]"
              style={{
                gridTemplateColumns: `repeat(${listings.length}, minmax(280px, 1fr))`,
              }}
            >
              {listings.map((item, idx) => {
                const l = item.listing;
                const area = l.area || l.landSize || 0;
                const ppsm =
                  area > 0 && l.price
                    ? Math.round((l.price / area) * 10) / 10
                    : null;
                const currentYield = l.yield || l.grossYield;
                const isBestScore = item.score !== undefined && item.score === bestScore;

                // Market discount calculation if benchmark is provided
                const marketAvgPpsm = item.marketAvgPricePerSqm || l.mlitBenchmark;
                const hasMarketComp = marketAvgPpsm != null && ppsm != null;
                const discountPct = hasMarketComp
                  ? Math.round(((marketAvgPpsm - ppsm) / marketAvgPpsm) * 100)
                  : null;

                return (
                  <div
                    key={item.matchId}
                    className={`flex flex-col rounded-2xl border bg-white overflow-hidden transition-all duration-200 shadow-xs ${
                      isBestScore
                        ? "border-emerald-500 ring-2 ring-emerald-500/20"
                        : "border-slate-200"
                    }`}
                  >
                    {/* Card Top Banner */}
                    <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="flex items-center justify-center w-6 h-6 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-xs font-bold">
                          {idx + 1}
                        </span>
                        <span className="text-xs font-bold text-slate-700">
                          物件 {idx + 1}
                        </span>
                      </div>

                      {item.score !== undefined && (
                        <div
                          className={`flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-black border ${
                            item.score >= 80
                              ? "bg-emerald-100 text-emerald-900 border-emerald-300 shadow-2xs"
                              : item.score >= 60
                                ? "bg-green-100 text-green-900 border-green-300"
                                : "bg-amber-100 text-amber-900 border-amber-300"
                          }`}
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>{item.score}点</span>
                        </div>
                      )}
                    </div>

                    {/* Image / Thumbnail */}
                    <div className="relative h-40 bg-slate-100 overflow-hidden">
                      {l.images && l.images[0] ? (
                        <img
                          src={l.images[0]}
                          alt={l.title || "物件写真"}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 bg-slate-100">
                          <Building2 className="w-10 h-10 opacity-30 mb-1" />
                          <span className="text-[14px] font-bold">写真未登録</span>
                        </div>
                      )}
                      <div className="absolute top-2 left-2 flex flex-wrap gap-1">
                        {l.source && (
                          <Badge className="border border-[var(--border-subtle)] bg-white/90 text-slate-700 backdrop-blur-xs text-[12.5px] font-bold">
                            {l.source === "email" ? "メール" : l.source}
                          </Badge>
                        )}
                        {l.propertyType && (
                          <Badge className="bg-emerald-700/85 backdrop-blur-xs text-white text-[12.5px] font-bold">
                            {l.propertyType}
                          </Badge>
                        )}
                      </div>
                      {discountPct !== null && discountPct > 5 && (
                        <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-amber-500 text-slate-950 font-black text-[13.5px] shadow-sm flex items-center gap-1">
                          <Sparkles className="w-3 h-3 fill-slate-950" />
                          相場比 -{discountPct}% 割安
                        </div>
                      )}
                    </div>

                    {/* Title & Core Price */}
                    <div className="p-4 border-b border-slate-100">
                      <h3
                        className="text-xs font-bold text-slate-900 line-clamp-2 min-h-8"
                        title={l.title || l.address}
                      >
                        {l.title || l.address || "非公開物件"}
                      </h3>

                      <div className="mt-2.5 flex items-baseline justify-between">
                        <div>
                          <div className="text-[13.5px] font-bold text-slate-400">
                            販売価格
                          </div>
                          <div className="text-xl font-black text-emerald-700 font-data">
                            {l.price
                              ? `${l.price.toLocaleString()} 万円`
                              : l.rent
                                ? `${l.rent.toLocaleString()} 万円/月`
                                : "価格相談"}
                          </div>
                        </div>

                        {currentYield && (
                          <div className="text-right">
                            <div className="text-[13.5px] font-bold text-slate-400">
                              利回り
                            </div>
                            <div className="text-base font-extrabold text-amber-600 font-data">
                              {currentYield}%
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Comparison Metrics Grid */}
                    <div className="p-4 space-y-3.5 flex-1 text-xs">
                      {/* Price per sqm */}
                      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                        <span className="text-slate-500 font-bold flex items-center gap-1.5">
                          <Ruler className="w-3.5 h-3.5 text-slate-400" />
                          平米単価
                        </span>
                        <div className="text-right">
                          <span className="font-extrabold text-slate-900 font-data">
                            {ppsm ? `${ppsm} 万円/㎡` : "—"}
                          </span>
                          {hasMarketComp && (
                            <div
                              className={`text-[13.5px] font-bold ${discountPct! > 0 ? "text-emerald-700" : "text-rose-600"}`}
                            >
                              区相場: {marketAvgPpsm}万 (
                              {discountPct! > 0 ? `-${discountPct}%` : `+${Math.abs(discountPct!)}%`}
                              )
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Area */}
                      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                        <span className="text-slate-500 font-bold flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-slate-400" />
                          面積・間取り
                        </span>
                        <div className="text-right">
                          <span className="font-extrabold text-slate-900 font-data">
                            {area ? `${area} ㎡` : "—"}
                          </span>
                          {l.layout && (
                            <span className="text-[14px] font-semibold text-slate-500 ml-1.5">
                              ({l.layout})
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Station Access */}
                      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                        <span className="text-slate-500 font-bold flex items-center gap-1.5">
                          <Train className="w-3.5 h-3.5 text-slate-400" />
                          最寄り駅
                        </span>
                        <div className="text-right max-w-[140px] truncate">
                          <span className="font-extrabold text-slate-900">
                            {l.station || "—"}
                          </span>
                          {l.walkMinutes !== undefined && (
                            <span className="text-emerald-700 font-bold ml-1">
                              徒歩{l.walkMinutes}分
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Location */}
                      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                        <span className="text-slate-500 font-bold flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          所在地
                        </span>
                        <span
                          className="font-semibold text-slate-800 text-right max-w-[150px] truncate"
                          title={l.address}
                        >
                          {l.address || l.ward || "—"}
                        </span>
                      </div>

                      {/* Age & Structure */}
                      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                        <span className="text-slate-500 font-bold flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          築年数・構造
                        </span>
                        <span className="font-semibold text-slate-800 text-right">
                          {l.buildYear ? `${l.buildYear}年築` : "—"}
                          {l.structure || l.buildingStructure
                            ? ` (${l.structure || l.buildingStructure})`
                            : ""}
                        </span>
                      </div>

                      {/* Floor */}
                      {l.floor !== undefined && (
                        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                          <span className="text-slate-500 font-bold">階数</span>
                          <span className="font-semibold text-slate-800">
                            {l.floor}階
                          </span>
                        </div>
                      )}

                      {/* AI Evaluation snippet */}
                      {item.evaluation && (
                        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-[14px] text-slate-600 line-clamp-3 leading-relaxed">
                          <span className="font-bold text-slate-800">
                            AI分析:
                          </span>{" "}
                          {item.evaluation}
                        </div>
                      )}
                    </div>

                    {/* Bottom Action */}
                    <div className="p-3 bg-slate-50/70 border-t border-slate-100 mt-auto">
                      {l.url ? (
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-bold text-slate-700 transition-colors shadow-2xs"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                          元サイトで物件詳細を見る
                        </a>
                      ) : (
                        <div className="text-center text-[14px] text-slate-400 py-1">
                          リンクなし
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-page-subtle)]">
          <Button size="sm" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </div>
    </div>
  );
}
