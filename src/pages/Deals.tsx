import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import {
  Handshake,
  Users,
  Search,
  CheckCircle2,
  Clock,
  TrendingUp,
  MapPin,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Trash2,
  FileText,
  Phone,
  Mail,
  Award,
} from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";

export default function DealsPage() {
  const deals = useQuery(api.deals.list);
  const updateDealStatus = useMutation(api.deals.updateStatus);
  const removeDeal = useMutation(api.deals.remove);

  const [activeStage, setActiveStage] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [expandedDealId, setExpandedDealId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedDealId(expandedDealId === id ? null : id);
  };

  const handleStatusChange = async (id: Id<"deals">, newStatus: string) => {
    await updateDealStatus({ id, status: newStatus });
  };

  const handleDelete = async (id: Id<"deals">) => {
    if (confirm("この提案案件を削除してもよろしいですか？")) {
      await removeDeal({ id });
    }
  };

  const filteredDeals = (deals || []).filter((d) => {
    if (activeStage !== "all" && d.status !== activeStage) return false;
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    return (
      d.title?.toLowerCase().includes(q) ||
      d.customerName?.toLowerCase().includes(q) ||
      d.customerEmail?.toLowerCase().includes(q) ||
      d.customMessage?.toLowerCase().includes(q)
    );
  });

  const totalDeals = deals?.length ?? 0;
  const proposedCount = deals?.filter((d) => d.status === "proposed").length ?? 0;
  const negotiatingCount =
    deals?.filter((d) => d.status === "negotiating").length ?? 0;
  const closedWonCount =
    deals?.filter((d) => d.status === "closed_won").length ?? 0;
  const closedLostCount =
    deals?.filter((d) => d.status === "closed_lost").length ?? 0;

  // Calculate closed volume
  const closedWonVolume = (deals || [])
    .filter((d) => d.status === "closed_won")
    .reduce((sum, d) => {
      const listings = d.listings || [];
      const dealVolume = listings.reduce(
        (lSum: number, l: { price?: number }) => lSum + (l.price || 0),
        0,
      );
      return sum + dealVolume;
    }, 0);

  return (
    <div className="p-6 md:p-10 space-y-8 max-w-7xl mx-auto">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 md:p-8 rounded-2xl border border-slate-200/80 shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs tracking-wider uppercase mb-1">
            <Handshake className="w-4 h-4 text-emerald-600" />
            成約トラッキング
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
            案件・提案管理 
          </h1>
          <p className="text-base text-slate-500 mt-1 leading-relaxed">
            買主への物件提案履歴、交渉ステータス、成約完了案件を統合管理します
          </p>
        </div>
      </div>

      {/* KPI Overview Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
        <div className="bg-white p-3 md:p-5 rounded-xl md:rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-2 md:gap-4">
          <div className="p-2 md:p-3.5 rounded-lg md:rounded-xl bg-emerald-50 text-emerald-700 shrink-0">
            <Handshake className="w-4 h-4 md:w-6 md:h-6" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] md:text-xs font-semibold text-slate-400 truncate">
              総提案案件数
            </div>
            <div className="text-lg md:text-2xl font-black text-slate-900 font-data tracking-tight truncate">
              {deals === undefined ? (
                <Skeleton className="h-6 md:h-7 w-10 md:w-12" />
              ) : (
                totalDeals
              )}
            </div>
          </div>
        </div>

        <div className="bg-white p-3 md:p-5 rounded-xl md:rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-2 md:gap-4">
          <div className="p-2 md:p-3.5 rounded-lg md:rounded-xl bg-amber-50 text-amber-600 shrink-0">
            <Clock className="w-4 h-4 md:w-6 md:h-6" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] md:text-xs font-semibold text-slate-400 truncate">
              交渉中案件数
            </div>
            <div className="text-lg md:text-2xl font-black text-slate-900 font-data tracking-tight truncate">
              {deals === undefined ? (
                <Skeleton className="h-6 md:h-7 w-10 md:w-12" />
              ) : (
                negotiatingCount
              )}
            </div>
          </div>
        </div>

        <div className="bg-white p-3 md:p-5 rounded-xl md:rounded-2xl border border-emerald-300 shadow-md bg-emerald-50/30 flex items-center gap-2 md:gap-4">
          <div className="p-2 md:p-3.5 rounded-lg md:rounded-xl bg-emerald-700 text-white shrink-0 shadow-md shadow-emerald-700/20">
            <Award className="w-4 h-4 md:w-6 md:h-6" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] md:text-xs font-extrabold text-emerald-900 uppercase truncate">
              成約完了数
            </div>
            <div className="text-lg md:text-2xl font-black text-emerald-900 font-data tracking-tight truncate">
              {deals === undefined ? (
                <Skeleton className="h-6 md:h-7 w-10 md:w-12" />
              ) : (
                closedWonCount
              )}
            </div>
          </div>
        </div>

        <div className="bg-white p-3 md:p-5 rounded-xl md:rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-2 md:gap-4">
          <div className="p-2 md:p-3.5 rounded-lg md:rounded-xl bg-purple-50 text-purple-600 shrink-0">
            <TrendingUp className="w-4 h-4 md:w-6 md:h-6" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] md:text-xs font-semibold text-slate-400 truncate">
              成約案件 取引金額
            </div>
            <div className="text-sm md:text-xl font-black text-slate-900 font-data tracking-tight truncate">
              {deals === undefined ? (
                <Skeleton className="h-6 md:h-7 w-14 md:w-16" />
              ) : (
                `${closedWonVolume.toLocaleString()} 万円`
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stage Filter Tabs & Search Bar */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
        {/* Stage Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-bold w-full md:w-auto">
          {[
            { key: "all", label: `全件 (${totalDeals})` },
            { key: "proposed", label: `提案中 (${proposedCount})` },
            { key: "negotiating", label: `交渉中 (${negotiatingCount})` },
            { key: "closed_won", label: `✓ 成約完了 (${closedWonCount})` },
            { key: "closed_lost", label: `見送り (${closedLostCount})` },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveStage(tab.key)}
              className={`px-3.5 py-1.5 rounded-lg transition-all ${
                activeStage === tab.key
                  ? tab.key === "closed_won"
                    ? "bg-emerald-700 text-white shadow-xs font-black"
                    : "bg-white text-slate-900 shadow-xs font-extrabold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="件名・顧客名で検索..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700 transition-all"
          />
        </div>
      </div>

      {/* Deal Cards List */}
      {deals === undefined ? (
        <div className="space-y-4">
          {[1, 2].map((n) => (
            <Skeleton key={n} className="h-36 w-full rounded-2xl" />
          ))}
        </div>
      ) : filteredDeals.length === 0 ? (
        <Card className="border border-slate-200/80 rounded-2xl bg-white">
          <CardContent className="p-12 text-center">
            <Handshake className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-base font-bold text-slate-700">
              該当する提案案件がありません
            </p>
            <p className="text-sm text-slate-400 mt-1">
              買主オーダー画面から「顧客へ物件を提案・メール送信」を行うと提案案件が自動登録されます。
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredDeals.map((deal) => {
            const isExpanded = expandedDealId === deal._id;
            const listings = deal.listings || [];
            const isWon = deal.status === "closed_won";
            return (
              <Card
                key={deal._id}
                className={`bg-white border shadow-sm rounded-2xl overflow-hidden transition-all duration-200 ${
                  isWon
                    ? "border-emerald-300 bg-emerald-50/20"
                    : "border-slate-200/80 hover:border-slate-300"
                }`}
              >
                <CardHeader className="p-6 border-b border-slate-100 bg-slate-50/50">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <CardTitle className="text-lg md:text-xl font-extrabold text-slate-900 tracking-tight truncate">
                          {deal.title}
                        </CardTitle>

                        {/* Stage Badge */}
                        {deal.status === "closed_won" ? (
                          <Badge className="bg-emerald-700 text-white font-extrabold text-xs px-3 py-1 shadow-sm">
                            <Award className="w-3.5 h-3.5 mr-1" />
                            成約完了
                          </Badge>
                        ) : deal.status === "negotiating" ? (
                          <Badge className="bg-amber-100 text-amber-900 border border-amber-300 font-extrabold text-xs px-3 py-1">
                            <Clock className="w-3.5 h-3.5 mr-1" />
                            交渉中
                          </Badge>
                        ) : deal.status === "closed_lost" ? (
                          <Badge className="bg-slate-200 text-slate-700 font-bold text-xs px-3 py-1">
                            見送り
                          </Badge>
                        ) : (
                          <Badge className="bg-emerald-100 text-emerald-900 border border-emerald-300 font-extrabold text-xs px-3 py-1">
                            提案中
                          </Badge>
                        )}

                        <span className="text-xs font-semibold text-slate-400">
                          {deal.createdAt ? new Date(deal.createdAt).toLocaleDateString("ja-JP") : "日付不明"} 提案
                        </span>
                      </div>

                      {/* Customer Info */}
                      <div className="flex flex-wrap items-center gap-4 text-xs font-bold text-slate-700">
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5 text-emerald-700" />
                          顧客: {deal.customerName || "お客様"}
                        </span>
                        {deal.customerPhone && (
                          <span className="flex items-center gap-1 text-slate-600 font-semibold">
                            <Phone className="w-3 h-3 text-slate-400" />
                            {deal.customerPhone}
                          </span>
                        )}
                        {deal.customerEmail && (
                          <span className="flex items-center gap-1 text-slate-600 font-semibold">
                            <Mail className="w-3 h-3 text-slate-400" />
                            {deal.customerEmail}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Interactive Stage Transition Controls */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {deal.status !== "closed_won" && (
                        <Button
                          size="sm"
                          onClick={() => handleStatusChange(deal._id, "closed_won")}
                          className="h-9 px-4 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl shadow-md shadow-emerald-700/20 gap-1.5"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          成約完了にする
                        </Button>
                      )}

                      {deal.status !== "negotiating" && deal.status !== "closed_won" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStatusChange(deal._id, "negotiating")}
                          className="h-9 px-3 text-xs font-bold border-amber-200 text-amber-800 hover:bg-amber-50 rounded-xl gap-1"
                        >
                          <Clock className="w-3.5 h-3.5 text-amber-600" />
                          交渉中にする
                        </Button>
                      )}

                      {deal.status === "closed_won" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStatusChange(deal._id, "proposed")}
                          className="h-9 px-3 text-xs font-bold border-slate-200 text-slate-700 rounded-xl"
                        >
                          ステータスを戻す
                        </Button>
                      )}

                      <button
                        onClick={() => handleDelete(deal._id)}
                        className="p-2 text-slate-400 hover:text-red-600 transition-colors rounded-lg hover:bg-slate-100"
                        title="削除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-6 space-y-4">
                  {/* Agent Notes / Custom Message */}
                  {deal.customMessage && (
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/70 text-xs font-medium text-slate-700 leading-relaxed whitespace-pre-wrap">
                      <FileText className="w-3.5 h-3.5 text-emerald-700 inline mr-1.5" />
                      {deal.customMessage}
                    </div>
                  )}

                  {/* Proposed Properties Accordion */}
                  <div>
                    <div
                      onClick={() => toggleExpand(deal._id)}
                      className="flex items-center justify-between cursor-pointer py-2 text-xs font-extrabold text-slate-600 hover:text-slate-900 border-b border-slate-100"
                    >
                      <span>
                        提案物件一覧 ({listings.length}件)
                      </span>
                      <div className="flex items-center gap-1 text-slate-400">
                        {isExpanded ? (
                          <>
                            折りたたむ
                            <ChevronUp className="w-4 h-4" />
                          </>
                        ) : (
                          <>
                            表示する
                            <ChevronDown className="w-4 h-4" />
                          </>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="pt-3 space-y-2.5 animate-in fade-in duration-200">
                        {listings.map((l: { address?: string; price?: number; landSize?: number; walkMinutes?: number; propertyType?: string; score?: number; url?: string }, idx: number) => (
                          <div
                            key={idx}
                            className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                          >
                            <div className="space-y-1">
                              <div className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                                <MapPin className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                {l.address}
                              </div>
                              <div className="text-slate-500 font-semibold flex flex-wrap items-center gap-3">
                                {l.price && (
                                  <span className="font-black text-slate-900 font-data">
                                    {l.price.toLocaleString()} 万円
                                  </span>
                                )}
                                {l.landSize && <span>{l.landSize} ㎡</span>}
                                {l.walkMinutes !== undefined && (
                                  <span>徒歩{l.walkMinutes}分</span>
                                )}
                                {l.propertyType && (
                                  <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-700">
                                    {l.propertyType}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              {l.score !== undefined && (
                                <Badge className="bg-emerald-100 text-emerald-900 border border-emerald-300 font-black text-xs">
                                  評価 {l.score}点
                                </Badge>
                              )}
                              {l.url && (
                                <a
                                  href={l.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 font-bold hover:bg-emerald-100 transition-colors"
                                >
                                  ポータル
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}