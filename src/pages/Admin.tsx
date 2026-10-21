import { useState, useMemo } from "react";
// Aliased so the call sites below read unchanged. useAction and useMutation
// are the same hook now: both just POST to the backend.
import {
  useApiQuery as useQuery,
  useApiMutation as useMutation,
  useApiMutation as useAction,
} from "../hooks/useApi";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { wardLabelToCode } from "../lib/tokyoWards";
import { Play, RefreshCw, Database, Trash2, Sliders, ShieldCheck, ExternalLink } from "lucide-react";
import type { Doc, Id } from "../lib/dataModel";
import { formatJaDateTime } from "../lib/dateFormat";

const SOURCE_LABELS: Record<string, string> = {
  athome: "At Home",
  hatomark: "鳩マーク",
  kenbiya: "健美家",
  rakuten: "楽天不動産",
  suumo: "SUUMO",
  homes: "LIFULL HOME'S",
  nomu: "ノムコム",
  nomu_pro: "ノムコム・プロ",
  mitsui: "三井のリハウス",
  stepon: "住友不動産ステップ",
  tokyu: "東急リバブル",
  mizuho: "みずほ不動産販売",
  mitsubishi_ufj: "三菱UFJ不動産販売",
  odakyu: "小田急不動産仲介",
  keio: "京王不動産仲介",
  asahi: "朝日住宅",
  haseko: "長谷工不動産",
  daikyo: "大京穴吹不動産",
  tokyotatemono: "東京建物不動産販売",
};

type WorkflowRun = {
  id: number;
  status: string | null;
  conclusion: string | null;
  created_at: string | null;
  html_url: string | null;
};

const SCRAPE_STARTED_MESSAGE =
  "検索を開始しました。完了まで数分かかります。結果は自動で表示されます。";

const RUN_STATUS_LABELS: Record<string, string> = {
  queued: "待機中",
  in_progress: "実行中",
  completed: "完了",
  waiting: "待機中",
  requested: "リクエスト済み",
  pending: "保留中",
};

const RUN_CONCLUSION_LABELS: Record<string, string> = {
  success: "成功",
  failure: "失敗",
  cancelled: "キャンセル",
  skipped: "スキップ",
  timed_out: "タイムアウト",
  action_required: "要対応",
};

/**
 * `coverage` is a jsonb blob (per-field fill rates the health check writes), so
 * it arrives untyped. One narrowing here beats casting at each use.
 */
function coverageOf(h: Doc<"scraperHealth"> | undefined) {
  return (h?.coverage as { field: string; present: number; pct: number }[] | undefined) ?? [];
}

export default function AdminPage() {
  const [scrapeSources, setScrapeSources] = useState<Set<string>>(new Set(["athome"]));
  const toggleSource = (src: string) => setScrapeSources(prev => {
    const next = new Set(prev);
    if (next.has(src)) { if (next.size > 1) next.delete(src); }
    else next.add(src);
    return next;
  });
  const [scrapeStatus, setScrapeStatus] = useState<string>("");
  const [isScraping, setIsScraping] = useState(false);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [runsError, setRunsError] = useState<string>("");
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const listings = useQuery(api.listings.list, { limit: 300 });
  const orders = useQuery(api.orders.list);
  const deleteListing = useMutation(api.listings.remove);
  const triggerScrape = useAction(api.scrapeTrigger.triggerScrape);
  const getRecentRuns = useAction(api.scrapeTrigger.getRecentRuns);

  const scraperHealth = useQuery(api.scraperHealth.list);
  const recordHealth = useMutation(api.scraperHealth.record);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [healthProgress, setHealthProgress] = useState<string>("");
  const [checkingSource, setCheckingSource] = useState<string | null>(null);

  const targetWards = useMemo(() => {
    if (!orders) return [];
    const wardSet = new Set<string>();
    for (const o of orders) {
      if (o.ward) wardSet.add(o.ward);
      if (o.wards && Array.isArray(o.wards)) {
        for (const w of o.wards) wardSet.add(w);
      }
    }
    return Array.from(wardSet).sort();
  }, [orders]);

  const targetCodes = useMemo(() => {
    return targetWards
      .map((label) => wardLabelToCode(label))
      .filter(Boolean) as string[];
  }, [targetWards]);

  const isDev = import.meta.env.DEV;
  const scraperUrl = isDev ? (import.meta.env.VITE_SCRAPER_URL as string) : "";

  const handleScrape = async () => {
    setIsScraping(true);
    const codes = targetCodes.length > 0 ? targetCodes : ["13104"];
    const sourcesParam = Array.from(scrapeSources).join(",");
    setScrapeStatus(`スクレイピングをリクエスト中... 対象: ${codes.length}区`);

    try {
      const result = (await triggerScrape({
        areas: codes.join(","),
        sources: sourcesParam,
      })) as { ok?: boolean; error?: string } | undefined;

      if (!result || result.error) {
        setScrapeStatus(
          `エラー: ${result?.error ?? "スクレイピングを開始できませんでした（応答がありません）"}`,
        );
        return;
      }

      setScrapeStatus(SCRAPE_STARTED_MESSAGE);
      void refreshRuns();
    } catch (err) {
      setScrapeStatus(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsScraping(false);
    }
  };

  const refreshRuns = async () => {
    setIsLoadingRuns(true);
    try {
      const result = (await getRecentRuns({})) as
        | { runs?: WorkflowRun[]; error?: string }
        | undefined;
      if (!result || result.error) {
        setRunsError(result?.error ?? "実行状況を取得できませんでした");
        setRuns([]);
        return;
      }
      setRunsError("");
      setRuns(result.runs ?? []);
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : String(err));
      setRuns([]);
    } finally {
      setIsLoadingRuns(false);
    }
  };

  const handleDeleteListing = async (id: Id<"listings">) => {
    await deleteListing({ id });
  };

  const runHealthCheck = async (only?: string) => {
    if (!isDev) return;
    const sources = only ? [only] : Object.keys(SOURCE_LABELS);
    setIsCheckingHealth(true);
    try {
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        setCheckingSource(src);
        setHealthProgress(
          `検査中 ${i + 1}/${sources.length}: ${SOURCE_LABELS[src] || src}`,
        );
        try {
          const res = await fetch(
            `${scraperUrl}/health/scrapers?source=${encodeURIComponent(src)}`,
          );
          const data = await res.json();
          const r = data.results?.[0];
          if (r) {
            await recordHealth({
              source: r.source,
              label: r.label,
              status: r.status,
              listingCount: r.listingCount,
              durationMs: r.durationMs,
              areaCode: r.areaCode,
              checkedAt: r.checkedAt,
              issues: r.issues ?? [],
              coverage: r.coverage ?? [],
              sample: r.sample ?? null,
              error: r.error ?? undefined,
            });
          }
        } catch (err) {
          await recordHealth({
            source: src,
            label: SOURCE_LABELS[src] || src,
            status: "broken",
            listingCount: 0,
            checkedAt: Date.now(),
            issues: [
              `スクレイパーサービスに接続できません: ${err instanceof Error ? err.message : String(err)}`,
            ],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      setHealthProgress("検査完了");
    } finally {
      setIsCheckingHealth(false);
      setCheckingSource(null);
    }
  };

  const healthBySource = useMemo(() => {
    const m: Record<string, Doc<"scraperHealth">> = {};
    for (const h of scraperHealth ?? []) m[h.source] = h;
    return m;
  }, [scraperHealth]);

  const healthSummary = useMemo(() => {
    const rows = scraperHealth ?? [];
    return {
      ok: rows.filter((r) => r.status === "ok").length,
      degraded: rows.filter((r) => r.status === "degraded").length,
      broken: rows.filter((r) => r.status === "broken").length,
      unchecked: Object.keys(SOURCE_LABELS).length - rows.length,
    };
  }, [scraperHealth]);

  const manualListings = listings?.filter((l) => [...scrapeSources].some(s => l.source === s)) ?? listings ?? [];

  return (
    <div className="p-6 md:p-10 space-y-8 max-w-7xl mx-auto">
      {/* ── Header ── */}
      <div className="page-header flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="eyebrow-pill mb-2.5">
            <Sliders className="w-3.5 h-3.5" />
            システム＆スクレイパー設定
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-[var(--text-primary)]">
            スクレイピング・データ管理
          </h1>
          <p className="text-sm text-[var(--text-muted)] font-medium mt-1 max-w-xl leading-relaxed">
            全19不動産ポータルからの手動データ収集、バックエンド接続状態のリアルタイムモニタリング
          </p>
        </div>
      </div>

      {/* ── Scraper Health Board ── */}
      <div className="bg-white rounded-2xl border border-[var(--border-subtle)] p-6 space-y-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
          <div>
            <h2 className="flex items-center gap-2.5 text-lg font-extrabold text-[var(--text-primary)]">
              <ShieldCheck className="w-5 h-5 text-[var(--brand)]" />
              スクレイパー稼働状況
            </h2>
            <p className="text-xs text-[var(--text-muted)] font-medium mt-1">
              各ポータルのHTML/CSS構造変更による取得停止を自動検知します（検査エリア: 杉並区）
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            {healthProgress && (
              <span className="text-xs font-bold text-[var(--text-secondary)]">{healthProgress}</span>
            )}
            {isDev ? (
              <Button
                onClick={() => runHealthCheck()}
                disabled={isCheckingHealth}
                size="sm"
                className="rounded-xl shadow-xs"
              >
                {isCheckingHealth ? (
                  <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />検査中...</>
                ) : (
                  <><ShieldCheck className="w-3.5 h-3.5 mr-1.5" />全スクレイパー検査</>
                )}
              </Button>
            ) : (
              <span className="text-[11px] font-bold text-[var(--text-muted)] bg-[var(--bg-page-subtle)] border border-[var(--border-subtle)] rounded-xl px-3 py-1.5 leading-relaxed max-w-sm">
                ローカル環境で直接検査実行可能（以下は最新記録です）
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="emerald" className="px-3 py-1 font-bold">
            正常 {healthSummary.ok}
          </Badge>
          <Badge variant="amber" className="px-3 py-1 font-bold">
            要確認 {healthSummary.degraded}
          </Badge>
          <Badge variant="destructive" className="px-3 py-1 font-bold">
            停止 {healthSummary.broken}
          </Badge>
          <Badge variant="neutral" className="px-3 py-1 font-bold">
            未検査 {healthSummary.unchecked}
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          {Object.keys(SOURCE_LABELS).map((src) => {
            const h = healthBySource[src];
            const isChecking = checkingSource === src;
            const tone =
              !h ? "border-[var(--border-subtle)] bg-[var(--bg-page-subtle)]"
              : h.status === "ok" ? "border-emerald-200/80 bg-emerald-50/40"
              : h.status === "degraded" ? "border-amber-200/80 bg-amber-50/40"
              : "border-red-200/80 bg-red-50/40";

            return (
              <div key={src} className={`rounded-2xl border p-4 transition-all ${tone} ${isChecking ? "ring-2 ring-[var(--brand)]" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-extrabold text-[var(--text-primary)] text-sm truncate">
                        {SOURCE_LABELS[src]}
                      </span>
                      {isChecking ? (
                        <Badge variant="brand" className="text-xs">
                          検査中
                        </Badge>
                      ) : !h ? (
                        <Badge variant="neutral" className="text-xs">未検査</Badge>
                      ) : h.status === "ok" ? (
                        <Badge variant="emerald" className="text-xs">正常</Badge>
                      ) : h.status === "degraded" ? (
                        <Badge variant="amber" className="text-xs">要確認</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-xs">停止</Badge>
                      )}
                    </div>

                    {h && (
                      <div className="text-xs text-[var(--text-secondary)] mt-1 font-semibold">
                        {h.listingCount}件取得
                        {h.durationMs != null && ` ・ ${(h.durationMs / 1000).toFixed(1)}秒`}
                        {h.checkedAt && ` ・ ${formatJaDateTime(h.checkedAt)}`}
                      </div>
                    )}

                    {(h?.issues?.length ?? 0) > 0 && (
                      <ul className="mt-2 space-y-1">
                        {h.issues!.map((iss: string, i: number) => (
                          <li key={i} className="text-xs text-[var(--text-secondary)] leading-snug">
                            ・{iss}
                          </li>
                        ))}
                      </ul>
                    )}

                    {coverageOf(h).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {coverageOf(h).map((c) => (
                          <span
                            key={c.field}
                            title={`${c.field}: ${c.present}/${h.listingCount}`}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                              c.pct >= 80 ? "bg-emerald-100 text-emerald-800"
                              : c.pct >= 50 ? "bg-amber-100 text-amber-800"
                              : "bg-red-100 text-red-800"
                            }`}
                          >
                            {c.field} {c.pct}%
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {isDev && (
                    <Button
                      onClick={() => runHealthCheck(src)}
                      disabled={isCheckingHealth}
                      variant="outline"
                      size="sm"
                      className="text-xs font-bold rounded-xl shrink-0 h-8"
                    >
                      再検査
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Scraper Controls */}
        <div className="md:col-span-2 bg-white rounded-2xl border border-[var(--border-subtle)] p-6 space-y-5 shadow-xs">
          <div className="pb-3 border-b border-[var(--border-subtle)]">
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-[var(--text-primary)]">
              <Play className="w-5 h-5 text-[var(--brand)]" />
              手動スクレイパー実行コントロール
            </h2>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">スキャン対象エリア（オーダー登録エリア）</Label>
            <div className="flex flex-wrap gap-2 p-3 bg-[var(--bg-page-subtle)] rounded-2xl border border-[var(--border-subtle)]">
              {targetWards.length === 0 ? (
                <span className="text-xs text-[var(--text-muted)] font-medium">
                  現在オーダーにエリアが指定されていません（デフォルト: 新宿区 13104）
                </span>
              ) : (
                targetWards.map((w) => (
                  <Badge key={w} variant="brand" className="px-3 py-1 font-bold">
                    {w}
                  </Badge>
                ))
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
              収集対象ポータルサイト <span className="text-xs text-[var(--text-muted)] font-normal">（複数選択で並列収集）</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {[
                { id: "athome", label: "At Home" },
                { id: "suumo", label: "SUUMO" },
                { id: "homes", label: "LIFULL HOME'S" },
                { id: "hatomark", label: "鳩マーク" },
                { id: "kenbiya", label: "健美家" },
                { id: "rakuten", label: "楽天不動産" },
                { id: "nomu", label: "ノムコム" },
                { id: "nomu_pro", label: "ノムコム・プロ" },
                { id: "mitsui", label: "三井のリハウス" },
                { id: "stepon", label: "住友不動産ステップ" },
                { id: "tokyu", label: "東急リバブル" },
                { id: "mizuho", label: "みずほ不動産販売" },
                { id: "mitsubishi_ufj", label: "三菱UFJ不動産販売" },
                { id: "odakyu", label: "小田急不動産仲介" },
                { id: "keio", label: "京王不動産仲介" },
                { id: "asahi", label: "朝日住宅" },
                { id: "haseko", label: "長谷工不動産" },
                { id: "daikyo", label: "大京穴吹不動産" },
                { id: "tokyotatemono", label: "東京建物不動産販売" },
              ].map(({ id, label }) => {
                const isChecked = scrapeSources.has(id);
                return (
                  <button
                    type="button"
                    key={id}
                    onClick={() => toggleSource(id)}
                    className={`px-3 py-2 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
                      isChecked
                        ? "bg-[var(--brand)] text-white shadow-xs"
                        : "bg-white text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <Button
            onClick={handleScrape}
            disabled={isScraping}
            size="lg"
            className="w-full h-12 text-base font-extrabold gap-2 rounded-2xl shadow-[0_4px_16px_rgba(22,101,3,0.25)]"
          >
            {isScraping ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <Play className="w-5 h-5" />
            )}
            {isScraping ? "リクエスト送信中..." : "手動スクレイピング開始"}
          </Button>

          <p className="text-xs text-[var(--text-muted)] font-medium leading-relaxed">
            実行は GitHub Actions 上で行われます。開始後はこの画面を閉じても処理は継続し、
            結果は Convex に直接保存されて自動的に反映されます。
          </p>

          {scrapeStatus && (
            <div
              className={`p-4 rounded-2xl text-xs font-bold leading-relaxed ${
                scrapeStatus.startsWith("エラー")
                  ? "bg-red-50 text-red-700 border border-red-200"
                  : scrapeStatus.startsWith("検索を開始")
                  ? "bg-[var(--brand-soft)] text-[var(--brand)] border border-[var(--brand-border)]"
                  : "bg-[var(--bg-page-subtle)] text-[var(--text-primary)] border border-[var(--border-subtle)]"
              }`}
            >
              {scrapeStatus}
            </div>
          )}

          {/* Run status */}
          <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">最近の実行状況</Label>
              <Button
                onClick={() => void refreshRuns()}
                disabled={isLoadingRuns}
                variant="outline"
                size="sm"
                className="rounded-xl h-8 text-xs font-bold"
              >
                {isLoadingRuns ? (
                  <><RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />取得中</>
                ) : (
                  <><RefreshCw className="w-3.5 h-3.5 mr-1" />履歴更新</>
                )}
              </Button>
            </div>

            {runsError ? (
              <div className="p-3 rounded-xl text-xs font-bold leading-relaxed bg-red-50 text-red-700 border border-red-200">
                {runsError}
              </div>
            ) : runs.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] font-medium">
                「履歴更新」を押すと GitHub Actions の最新実行履歴を取得します。
              </p>
            ) : (
              <ul className="space-y-2">
                {runs.map((run) => (
                  <li
                    key={run.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-[var(--bg-page-subtle)] border border-[var(--border-subtle)]"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold text-[var(--text-primary)]">
                        {RUN_STATUS_LABELS[run.status ?? ""] || run.status || "不明"}
                        {run.conclusion &&
                          ` ・ ${RUN_CONCLUSION_LABELS[run.conclusion] || run.conclusion}`}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] font-medium truncate mt-0.5">
                        {run.created_at
                          ? formatJaDateTime(new Date(run.created_at).getTime())
                          : "—"}
                      </div>
                    </div>
                    {run.html_url && (
                      <a
                        href={run.html_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-bold text-[var(--brand)] hover:underline shrink-0"
                      >
                        ログを見る
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* System Status Card */}
        <div className="bg-white rounded-2xl border border-[var(--border-subtle)] p-6 space-y-4 shadow-xs">
          <div className="pb-3 border-b border-[var(--border-subtle)]">
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-[var(--text-primary)]">
              <Database className="w-5 h-5 text-[var(--brand)]" />
              システム接続ステータス
            </h2>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[var(--bg-page-subtle)] border border-[var(--border-subtle)]">
              <span className="text-xs font-bold text-[var(--text-secondary)]">スクレイピング環境</span>
              <Badge variant="brand" className="font-bold">
                GitHub Actions
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[var(--bg-page-subtle)] border border-[var(--border-subtle)]">
              <span className="text-xs font-bold text-[var(--text-secondary)]">Convex リアルタイム DB</span>
              <Badge variant="emerald" className="font-bold">接続済み</Badge>
            </div>
            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[var(--bg-page-subtle)] border border-[var(--border-subtle)]">
              <span className="text-xs font-bold text-[var(--text-secondary)]">全登録物件数</span>
              <span className="font-extrabold text-base text-[var(--text-primary)] font-data">
                {listings === undefined ? <Skeleton className="h-5 w-12 rounded-lg" /> : `${listings.length} 件`}
              </span>
            </div>
            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[var(--bg-page-subtle)] border border-[var(--border-subtle)]">
              <span className="text-xs font-bold text-[var(--text-secondary)]">認証ガード</span>
              <span className="text-xs font-bold text-[var(--brand)] flex items-center gap-1">
                <ShieldCheck className="w-4 h-4 text-[var(--brand)]" />
                保護済み
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Database Scraped Listings Master Table */}
      <div className="bg-white rounded-2xl border border-[var(--border-subtle)] p-6 space-y-4 shadow-xs">
        <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-extrabold text-[var(--text-primary)]">
            物件マスターデータベース ({manualListings.length} 件)
          </h2>
        </div>
          <div className="overflow-x-auto rounded-2xl border border-[var(--border-subtle)]">
            <Table>
              <TableHeader className="bg-[var(--bg-page-subtle)]">
                <TableRow>
                  <TableHead className="text-xs font-extrabold text-[var(--text-secondary)] py-3">物件所在地</TableHead>
                  <TableHead className="text-xs font-extrabold text-[var(--text-secondary)]">区</TableHead>
                  <TableHead className="text-xs font-extrabold text-[var(--text-secondary)]">価格 (万円)</TableHead>
                  <TableHead className="text-xs font-extrabold text-[var(--text-secondary)]">面積 (㎡)</TableHead>
                  <TableHead className="text-xs font-extrabold text-[var(--text-secondary)]">取得ソース</TableHead>
                  <TableHead className="text-xs font-extrabold text-[var(--text-secondary)]">ステータス</TableHead>
                  <TableHead className="text-xs font-extrabold text-[var(--text-secondary)] text-right pr-6">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listings === undefined ? (
                  <>
                    <TableRow>
                      <TableCell colSpan={7} className="p-4">
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={7} className="p-4">
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  </>
                ) : manualListings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-[var(--text-muted)] font-medium text-xs">
                      登録されている物件がありません。「手動検索開始」を実行してください。
                    </TableCell>
                  </TableRow>
                ) : (
                  manualListings.slice(0, 30).map((listing) => (
                    <TableRow key={listing._id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                      <TableCell className="font-bold text-[var(--text-primary)] max-w-[240px] truncate text-sm">
                        {listing.address || "—"}
                      </TableCell>
                      <TableCell className="text-xs font-semibold text-[var(--text-secondary)]">
                        {listing.ward || "—"}
                      </TableCell>
                      <TableCell className="font-data text-sm font-extrabold text-[var(--brand)]">
                        {listing.price ? listing.price.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="font-data text-xs font-semibold text-[var(--text-secondary)]">
                        {listing.area ? listing.area.toFixed(1) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="brand">
                          {SOURCE_LABELS[listing.source || ""] || listing.source || "手動"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={listing.status === "new" ? "emerald" : "neutral"}
                        >
                          {listing.status === "new" ? "新着" : listing.status || "一般"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteListing(listing._id)}
                          className="h-8 w-8 rounded-xl text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50"
                          title="物件を削除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
    </div>
  );
}