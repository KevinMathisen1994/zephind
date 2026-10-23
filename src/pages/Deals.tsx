import { useState } from "react";
import { useApiQuery as useQuery, useApiMutation as useMutation } from "../hooks/useApi";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
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
  RotateCcw,
} from "lucide-react";
import type { Id } from "../lib/dataModel";
import { formatJaDate } from "../lib/dateFormat";

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
    <div className="page-shell">
      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <div className="eyebrow-pill">Pipeline & Deals</div>
          <h1 className="page-title">案件・提案管理</h1>
          <p className="page-subtitle">
            買主への物件提案履歴、交渉ステータス、成約完了案件を統合管理します
          </p>
        </div>
      </div>

      {/* ── KPI Financial Bento Grid ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { icon: Handshake, color: "var(--brand)", bg: "var(--brand-soft)", label: "総提案案件数", value: totalDeals, loading: deals === undefined },
          { icon: Clock, color: "var(--warning)", bg: "var(--warning-soft)", label: "交渉中案件数", value: negotiatingCount, loading: deals === undefined },
          { icon: Award, color: "var(--brand)", bg: "var(--brand-soft)", label: "成約完了数", value: closedWonCount, loading: deals === undefined, highlight: true },
          { icon: TrendingUp, color: "var(--info)", bg: "var(--info-soft)", label: "成約取引総額", value: `${closedWonVolume.toLocaleString()} 万円`, loading: deals === undefined, valueSmall: true },
        ].map((kpi, i) => (
          <div key={i} className="kpi-card">
            <div className="flex items-start justify-between gap-2">
              <span className={`stat-label ${kpi.highlight ? "text-[var(--brand)]" : ""}`}>
                {kpi.label}
              </span>
              <span
                className={`kpi-icon ${kpi.highlight ? "bg-[#0d3f26] text-white" : ""}`}
                style={kpi.highlight ? {} : { background: kpi.bg, color: kpi.color }}
              >
                <kpi.icon className="h-[15px] w-[15px]" />
              </span>
            </div>
            {kpi.loading ? (
              <Skeleton className="h-7 w-20" />
            ) : (
              <div className={`stat-value ${kpi.valueSmall ? "text-xl" : ""}`}>
                {kpi.value}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Filter Island & Search ── */}
      <div className="toolbar items-stretch md:items-center">
        <div className="pill-group w-full md:w-auto">
          {[
            { key: "all", label: `全件 (${totalDeals})` },
            { key: "proposed", label: `提案中 (${proposedCount})` },
            { key: "negotiating", label: `交渉中 (${negotiatingCount})` },
            { key: "closed_won", label: `✓ 成約 (${closedWonCount})` },
            { key: "closed_lost", label: `見送り (${closedLostCount})` },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveStage(tab.key)}
              className={`pill cursor-pointer ${activeStage === tab.key ? (tab.key === "closed_won" ? "bg-[var(--brand)] text-white shadow-xs" : "pill-active") : "pill-inactive"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative w-full md:ml-auto md:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="件名・顧客名で検索..."
            className="field pl-9"
          />
        </div>
      </div>

      {/* Deal Cards List */}
      {deals === undefined ? (
        <div className="space-y-5">
          {[1, 2].map((n) => (
            <Skeleton key={n} className="h-44 w-full rounded-3xl" />
          ))}
        </div>
      ) : filteredDeals.length === 0 ? (
        <div className="p-16 border border-[var(--border-subtle)] rounded-3xl bg-white text-center shadow-xs">
          <Handshake className="w-12 h-12 text-[var(--text-muted)]/30 mx-auto mb-4" />
          <p className="text-base font-bold text-[var(--text-secondary)]">
            該当する提案案件がありません
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1.5 font-medium">
            買主オーダー画面から「顧客へ物件を提案・メール送信」を行うと提案案件が自動登録されます。
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredDeals.map((deal) => {
            const isExpanded = expandedDealId === deal._id;
            const listings = deal.listings || [];
            const isWon = deal.status === "closed_won";
            return (
              <div
                key={deal._id}
                className={`bg-white rounded-2xl border border-[var(--border-subtle)] p-6 space-y-4 shadow-xs hover:border-[var(--border-default)] hover:shadow-sm transition-all duration-200 ${
                  isWon ? "border-[var(--brand-border)] bg-gradient-to-br from-white to-[var(--brand-soft)]/20" : ""
                }`}
              >
                  {/* Top Row: Title + Customer + Actions */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h3 className="text-base md:text-lg font-extrabold text-[var(--text-primary)] tracking-tight">
                          {deal.title}
                        </h3>
                        {deal.status === "closed_won" ? (
                          <Badge variant="emerald" className="font-extrabold gap-1 py-1 px-3">
                            <Award className="w-3.5 h-3.5" />成約完了
                          </Badge>
                        ) : deal.status === "negotiating" ? (
                          <Badge variant="amber" className="font-extrabold gap-1 py-1 px-3">
                            <Clock className="w-3.5 h-3.5" />交渉中
                          </Badge>
                        ) : deal.status === "closed_lost" ? (
                          <Badge variant="neutral" className="py-1 px-3">見送り</Badge>
                        ) : (
                          <Badge variant="brand" className="font-bold py-1 px-3">提案中</Badge>
                        )}
                        <span className="text-[14px] font-semibold text-[var(--text-muted)] font-data">
                          {deal.createdAt ? formatJaDate(deal.createdAt) : "日付不明"} 提案
                        </span>
                      </div>

                      {/* Customer info pills */}
                      <div className="flex flex-wrap items-center gap-3.5 text-xs font-bold text-[var(--text-secondary)]">
                        <span className="flex items-center gap-1.5 bg-[var(--bg-page-subtle)] px-2.5 py-1 rounded-lg border border-[var(--border-subtle)]">
                          <Users className="w-3.5 h-3.5 text-[var(--brand)]" />
                          顧客: {deal.customerName || "お客様"}
                        </span>
                        {deal.customerPhone && (
                          <span className="flex items-center gap-1.5 font-semibold text-[var(--text-muted)]">
                            <Phone className="w-3.5 h-3.5" />
                            {deal.customerPhone}
                          </span>
                        )}
                        {deal.customerEmail && (
                          <span className="flex items-center gap-1.5 font-semibold text-[var(--text-muted)]">
                            <Mail className="w-3.5 h-3.5" />
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
                          className="h-9 px-4 text-xs font-extrabold gap-1.5 shadow-[0_2px_10px_rgba(22,101,3,0.2)]"
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
                          className="h-9 px-3 text-xs font-bold border-amber-300 text-amber-900 bg-amber-50/60 hover:bg-amber-100 gap-1.5"
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
                          className="h-9 px-3 text-xs font-bold text-[var(--text-secondary)] gap-1.5"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                          ステータスを戻す
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(deal._id)}
                        className="h-9 w-9 rounded-xl text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50"
                        title="削除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="pt-4 space-y-4">
                    {deal.customMessage && (
                      <div className="p-4 rounded-2xl bg-[var(--bg-page-subtle)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                        <FileText className="w-3.5 h-3.5 text-[var(--brand)] inline mr-1.5" />
                        {deal.customMessage}
                      </div>
                    )}

                    {/* Proposed Properties Accordion */}
                    <div>
                      <button
                        onClick={() => toggleExpand(deal._id)}
                        className="w-full flex items-center justify-between cursor-pointer py-2 text-xs font-extrabold text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-b border-[var(--border-subtle)] transition-colors"
                      >
                        <span className="flex items-center gap-1.5">
                          提案物件一覧 ({listings.length}件)
                        </span>
                        <div className="flex items-center gap-1 text-[var(--text-muted)]">
                          {isExpanded ? (
                            <>
                              <span>折りたたむ</span>
                              <ChevronUp className="w-4 h-4" />
                            </>
                          ) : (
                            <>
                              <span>詳細を表示</span>
                              <ChevronDown className="w-4 h-4" />
                            </>
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="pt-3.5 space-y-3 animate-in fade-in duration-200">
                          {listings.map((l: { address?: string; price?: number; landSize?: number; walkMinutes?: number; propertyType?: string; score?: number; url?: string }, idx: number) => (
                            <div
                              key={idx}
                              className="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-page-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                            >
                              <div className="space-y-1 min-w-0">
                                <div className="font-extrabold text-[var(--text-primary)] text-sm flex items-center gap-2 truncate">
                                  <MapPin className="w-3.5 h-3.5 text-[var(--brand)] shrink-0" />
                                  {l.address}
                                </div>
                                <div className="text-[var(--text-muted)] font-semibold flex flex-wrap items-center gap-3">
                                  {l.price && (
                                    <span className="font-black text-[var(--text-primary)] font-data text-sm">
                                      {l.price.toLocaleString()} 万円
                                    </span>
                                  )}
                                  {l.landSize && <span>{l.landSize} ㎡</span>}
                                  {l.walkMinutes !== undefined && (
                                    <span>徒歩{l.walkMinutes}分</span>
                                  )}
                                  {l.propertyType && (
                                    <Badge variant="neutral">{l.propertyType}</Badge>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2.5 shrink-0">
                                {l.score !== undefined && (
                                  <Badge variant="brand" className="font-black font-data px-2.5 py-1">
                                    評価 {l.score}点
                                  </Badge>
                                )}
                                {l.url && (
                                  <a
                                    href={l.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[var(--border-default)] text-[var(--brand)] text-xs font-bold shadow-xs hover:bg-[var(--brand-soft)] transition-colors"
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
                  </div>
                </div>
            );
          })}
        </div>
      )}
    </div>
  );
}