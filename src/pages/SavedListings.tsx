import { useMemo, useState } from "react";
import { useApiQuery as useQuery, useApiMutation as useMutation } from "../hooks/useApi";
import { api } from "../lib/api";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import {
  Star,
  MapPin,
  Train,
  Ruler,
  ExternalLink,
  Trash2,
  StickyNote,
  Search,
  Clock,
  Send,
  CheckSquare,
  Square,
} from "lucide-react";
import type { Id } from "../lib/dataModel";
import { formatJaDate, formatJaDateTime } from "../lib/dateFormat";
import { ProposalModal, type ProposalItem } from "../components/ProposalModal";

export default function SavedListingsPage() {
  const saved = useQuery(api.savedListings.list);
  const removeSaved = useMutation(api.savedListings.remove);
  const setNote = useMutation(api.savedListings.setNote);

  const [search, setSearch] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  /** Ticked for the proposal mail. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showProposal, setShowProposal] = useState(false);

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const filtered = useMemo(() => {
    if (!saved) return undefined;
    const q = search.trim().toLowerCase();
    if (!q) return saved;
    return saved.filter((row) =>
      [row.address, row.ward, row.propertyType, row.orderName, row.note, row.source]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q)),
    );
  }, [saved, search]);

  const totalValue = (saved ?? []).reduce((sum, row) => sum + (row.price ?? 0), 0);

  const proposalItems: ProposalItem[] = (saved ?? []).map((row) => ({
    id: row._id,
    listingId: row.listingId,
    address: row.address,
    ward: row.ward,
    price: row.price,
    size: row.area ?? row.landSize,
    station: row.station,
    walkMinutes: row.walkMinutes,
    url: row.url,
    source: row.source,
    propertyType: row.propertyType,
    score: row.score,
  }));

  const startEditingNote = (id: string, current?: string) => {
    setEditingNoteId(id);
    setNoteDraft(current ?? "");
  };

  const saveNote = async (id: string) => {
    await setNote({ id: id as Id<"savedListings">, note: noteDraft });
    setEditingNoteId(null);
  };

  return (
    <div className="page-shell">
      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <div className="eyebrow-pill">Saved Listings</div>
          <h1 className="page-title">保存物件</h1>
          <p className="page-subtitle">
            検索結果で★を付けた物件の一覧です。元の検索条件やオーダーを更新しても保存された状態が維持されます。
          </p>
        </div>

        {(saved?.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-60">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="住所・種別・メモで絞り込み"
                className="field pl-9"
              />
            </div>

            <Button
              onClick={() => setShowProposal(true)}
              disabled={selected.size === 0}
              size="lg"
            >
              <Send className="h-4 w-4" />
              顧客へ提案・送信
              {selected.size > 0 && (
                <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold tabular-nums">
                  {selected.size}
                </span>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* ── Summary Bento ── */}
      {(saved?.length ?? 0) > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <div className="kpi-card">
            <div className="flex items-start justify-between gap-2">
              <span className="stat-label">保存件数</span>
              <span className="kpi-icon bg-[var(--warning-soft)] text-[var(--warning)]">
                <Star className="h-[15px] w-[15px] fill-current" />
              </span>
            </div>
            <div className="stat-value">{saved?.length ?? 0}</div>
          </div>

          <div className="kpi-card">
            <div className="flex items-start justify-between gap-2">
              <span className="stat-label">合計価格</span>
              <span className="kpi-icon bg-[var(--brand-soft)] text-[var(--brand)]">
                <Ruler className="h-[15px] w-[15px]" />
              </span>
            </div>
            <div className="stat-value">
              {totalValue.toLocaleString()}
              <span className="ml-1 font-sans text-xs font-semibold tracking-normal text-[var(--text-muted)]">
                万円
              </span>
            </div>
          </div>

          <div className="kpi-card">
            <div className="flex items-start justify-between gap-2">
              <span className="stat-label">メモ付き物件</span>
              <span className="kpi-icon bg-[var(--info-soft)] text-[var(--info)]">
                <StickyNote className="h-[15px] w-[15px]" />
              </span>
            </div>
            <div className="stat-value">
              {(saved ?? []).filter((r) => r.note?.trim()).length}
            </div>
          </div>
        </div>
      )}

      {/* ── List ── */}
      {filtered === undefined ? (
        <div className="space-y-4">
          {[1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-32 w-full rounded-3xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-16 border border-[var(--border-subtle)] rounded-3xl bg-white text-center shadow-xs">
          <Star className="w-12 h-12 text-[var(--text-muted)]/30 mx-auto mb-4" />
          <p className="text-base font-bold text-[var(--text-secondary)]">
            {saved && saved.length > 0
              ? "条件に一致する保存物件がありません"
              : "保存された物件がありません"}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1.5 font-medium">
            {saved && saved.length > 0
              ? "検索条件を変更してください。"
              : "「物件検索」の抽出物件一覧で★を押すと、ここに追加されます。"}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((row) => (
            <div
              key={row._id}
              className="bg-white rounded-2xl border border-[var(--border-subtle)] p-5 space-y-3.5 shadow-xs hover:border-[var(--border-default)] hover:shadow-sm transition-all duration-200"
            >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="min-w-0 space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => toggleSelected(row._id)}
                        className="shrink-0 cursor-pointer transition-transform active:scale-95"
                        title="提案メールに含める"
                        aria-label="提案メールに含める"
                        aria-pressed={selected.has(row._id)}
                      >
                        {selected.has(row._id) ? (
                          <CheckSquare className="w-5 h-5 text-[var(--brand)]" />
                        ) : (
                          <Square className="w-5 h-5 text-[var(--border-strong)]" />
                        )}
                      </button>
                      <MapPin className="w-4 h-4 text-[var(--brand)] shrink-0" />
                      <span className="text-base font-extrabold text-[var(--text-primary)] tracking-tight">
                        {row.address || "住所不明"}
                      </span>
                      {row.source && (
                        <Badge variant="brand">
                          {row.source}
                        </Badge>
                      )}
                      {row.propertyType && (
                        <Badge variant="neutral">
                          {row.propertyType}
                        </Badge>
                      )}
                      {row.score !== undefined && (
                        <Badge variant="emerald" className="font-extrabold font-data">
                          評価 {row.score}点
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs font-semibold text-[var(--text-secondary)]">
                      {row.price !== undefined && (
                        <span className="text-lg font-black text-[var(--text-primary)] font-data">
                          {row.price.toLocaleString()}
                          <span className="text-xs font-bold ml-1 text-[var(--text-muted)]">
                            万円
                          </span>
                        </span>
                      )}
                      {(row.area ?? row.landSize) !== undefined && (
                        <span className="flex items-center gap-1">
                          <Ruler className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                          {row.area ?? row.landSize}㎡
                        </span>
                      )}
                      {row.station && (
                        <span className="flex items-center gap-1">
                          <Train className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                          {row.station}
                          {row.walkMinutes !== undefined ? ` 徒歩${row.walkMinutes}分` : ""}
                        </span>
                      )}
                      {row.postedAt !== undefined && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                          {row.postedDateKind === "updated" ? "情報更新日" : "掲載日"}{" "}
                          {formatJaDate(row.postedAt)}
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] font-medium text-[var(--text-muted)]">
                      {row.orderName ? `検索条件: ${row.orderName} ・ ` : ""}
                      保存日時: {formatJaDateTime(row.savedAt)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {row.url && (
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-[var(--border-default)] text-[var(--brand)] font-bold text-xs shadow-xs hover:bg-[var(--brand-soft)] transition-colors"
                      >
                        掲載ページ
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startEditingNote(row._id, row.note)}
                      title="メモを編集"
                      className="rounded-xl"
                    >
                      <StickyNote className="w-3.5 h-3.5" />
                      メモ
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-xl hover:text-red-600 hover:bg-red-50"
                      onClick={() => removeSaved({ id: row._id })}
                      title="保存物件から削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      削除
                    </Button>
                  </div>
                </div>

                {editingNoteId === row._id ? (
                  <div className="space-y-2.5 pt-2 border-t border-[var(--border-subtle)]">
                    <textarea
                      rows={3}
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="この物件についてのメモ（確認事項、買主の反応など）"
                      className="w-full p-3.5 bg-[var(--bg-page-subtle)] border border-[var(--border-default)] rounded-xl text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus-brand leading-relaxed"
                    />
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={() => saveNote(row._id)}>
                        メモを保存
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingNoteId(null)}
                      >
                        キャンセル
                      </Button>
                    </div>
                  </div>
                ) : (
                  row.note?.trim() && (
                    <div className="p-3.5 rounded-xl bg-[var(--bg-page-subtle)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                      <StickyNote className="w-3.5 h-3.5 text-[var(--brand)] inline mr-1.5" />
                      {row.note}
                    </div>
                  )
                )}
              </div>
          ))}
        </div>
      )}

      {showProposal && (
        <ProposalModal
          items={proposalItems}
          initialSelectedIds={selected}
          contextName="保存物件"
          onClose={() => setShowProposal(false)}
        />
      )}
    </div>
  );
}

