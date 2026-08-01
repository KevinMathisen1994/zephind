import { useState, useMemo } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
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
import { Play, RefreshCw, Database, Trash2, Sliders, ShieldCheck } from "lucide-react";
import type { Doc, Id } from "../../convex/_generated/dataModel";

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
  "スクレイピングを開始しました。完了まで数分かかります。結果は自動で表示されます。";

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
  const listings = useQuery(api.listings.list, {});
  const orders = useQuery(api.orders.list);
  const deleteListing = useMutation(api.listings.remove);
  // Scraping runs on GitHub Actions now — see convex/scrapeTrigger.js.
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

  // The scraper health probe below talks to scraper-service over HTTP, which only
  // exists on a developer's own machine (VITE_SCRAPER_URL is baked in at build
  // time as http://localhost:3001). Gating on DEV keeps that URL — and the
  // buttons that would silently fail on it — out of the deployed app entirely.
  const isDev = import.meta.env.DEV;
  const scraperUrl = isDev ? (import.meta.env.VITE_SCRAPER_URL as string) : "";

  /**
   * Manual scrape.
   *
   * WAS: fetch(scraperUrl + "/scrape"), then this component wrote every returned
   * listing and match into Convex. Unreachable from anything but the dev laptop.
   *
   * NOW: dispatches .github/workflows/scrape.yml through convex/scrapeTrigger.js.
   * The runner scrapes AND persists (scraper-service/src/cli.ts ->
   * convex/ingest.js), including matching against every order, so the order
   * criteria this function used to assemble and forward are no longer needed —
   * cli.ts reads them from Convex itself.
   *
   * This is asynchronous: a successful return means GitHub queued the run, not
   * that data exists. The table below fills in on its own via useQuery.
   */
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
      // Best-effort: show the run that was just queued. A failure here says
      // nothing about the dispatch, which already succeeded, so it is swallowed.
      void refreshRuns();
    } catch (err) {
      setScrapeStatus(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      // The dispatch is over even though the run is not; leaving the button
      // spinning would be waiting for an event that never reaches this browser.
      setIsScraping(false);
    }
  };

  /** Recent workflow runs, so the board can show queued / in-progress / done. */
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

  // Checks scrapers one at a time and persists each result as it lands, so the
  // board fills in progressively. A single request for all 19 would take
  // minutes and time out in the browser.
  //
  // LOCAL ONLY. This probes scraper-service directly over HTTP; there is no
  // hosted scraper to probe, so outside `npm run dev` the buttons that call this
  // are not rendered at all. The board itself still shows the last results any
  // developer recorded, because those live in Convex (api.scraperHealth.list).
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
          // A failure to even reach the service is itself a reportable status.
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
      {/* Header */}
      <div className="bg-white p-6 md:p-8 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs tracking-wider uppercase mb-1">
            <Sliders className="w-4 h-4 text-emerald-600" />
            システム＆スクレイパー設定
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
            スクレイピング・データ管理
          </h1>
          <p className="text-base text-slate-500 mt-1 leading-relaxed">
            全14不動産ポータルからの手動データ収集、バックエンド接続状態のモニタリング
          </p>
        </div>
      </div>

      {/* Scraper Health Board */}
      <Card className="bg-white border border-slate-200/80 shadow-sm rounded-2xl">
        <CardHeader className="p-6 border-b border-slate-100">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg font-extrabold text-slate-900">
                <ShieldCheck className="w-5 h-5 text-emerald-700" />
                スクレイパー稼働状況
              </CardTitle>
              <p className="text-sm text-slate-500 mt-1">
                各ポータルのHTML/CSS変更による取得停止を検知します（検査エリア: 杉並区）
              </p>
            </div>
            <div className="flex items-center gap-2">
              {healthProgress && (
                <span className="text-sm font-medium text-slate-600">{healthProgress}</span>
              )}
              {isDev ? (
                <Button
                  onClick={() => runHealthCheck()}
                  disabled={isCheckingHealth}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl"
                >
                  {isCheckingHealth ? (
                    <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />検査中...</>
                  ) : (
                    <><ShieldCheck className="w-4 h-4 mr-2" />全スクレイパー検査</>
                  )}
                </Button>
              ) : (
                <span className="text-xs font-bold text-slate-500 bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 leading-relaxed max-w-sm">
                  検査の実行はローカル開発環境専用です（スクレイパーサービスに直接接続するため）。以下は最後に記録された結果です。
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            <Badge className="bg-emerald-100 text-emerald-800 font-bold px-3 py-1">
              正常 {healthSummary.ok}
            </Badge>
            <Badge className="bg-amber-100 text-amber-800 font-bold px-3 py-1">
              要確認 {healthSummary.degraded}
            </Badge>
            <Badge className="bg-red-100 text-red-800 font-bold px-3 py-1">
              停止 {healthSummary.broken}
            </Badge>
            <Badge className="bg-slate-100 text-slate-600 font-bold px-3 py-1">
              未検査 {healthSummary.unchecked}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {Object.keys(SOURCE_LABELS).map((src) => {
              const h = healthBySource[src];
              const isChecking = checkingSource === src;
              const tone =
                !h ? "border-slate-200 bg-slate-50"
                : h.status === "ok" ? "border-emerald-200 bg-emerald-50/60"
                : h.status === "degraded" ? "border-amber-200 bg-amber-50/60"
                : "border-red-200 bg-red-50/60";

              return (
                <div key={src} className={`rounded-xl border p-4 ${tone} ${isChecking ? "ring-2 ring-emerald-400" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 truncate">
                          {SOURCE_LABELS[src]}
                        </span>
                        {isChecking ? (
                          <Badge className="bg-emerald-600 text-white text-xs font-bold">
                            検査中
                          </Badge>
                        ) : !h ? (
                          <Badge className="bg-slate-200 text-slate-600 text-xs font-bold">未検査</Badge>
                        ) : h.status === "ok" ? (
                          <Badge className="bg-emerald-600 text-white text-xs font-bold">正常</Badge>
                        ) : h.status === "degraded" ? (
                          <Badge className="bg-amber-500 text-white text-xs font-bold">要確認</Badge>
                        ) : (
                          <Badge className="bg-red-600 text-white text-xs font-bold">停止</Badge>
                        )}
                      </div>

                      {h && (
                        <div className="text-xs text-slate-600 mt-1 font-medium">
                          {h.listingCount}件取得
                          {h.durationMs != null && ` ・ ${(h.durationMs / 1000).toFixed(1)}秒`}
                          {h.checkedAt && ` ・ ${new Date(h.checkedAt).toLocaleString("ja-JP")}`}
                        </div>
                      )}

                      {h?.issues?.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {h.issues.map((iss: string, i: number) => (
                            <li key={i} className="text-xs text-slate-700 leading-snug">
                              ・{iss}
                            </li>
                          ))}
                        </ul>
                      )}

                      {h?.coverage?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {h.coverage.map((c: { field: string; present: number; pct: number }) => (
                            <span
                              key={c.field}
                              title={`${c.field}: ${c.present}/${h.listingCount}`}
                              className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                c.pct >= 80 ? "bg-emerald-100 text-emerald-700"
                                : c.pct >= 50 ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700"
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
                        className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-bold rounded-lg px-2 py-1 h-auto shrink-0"
                      >
                        再検査
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Scraper Controls */}
        <Card className="md:col-span-2 bg-white border border-slate-200/80 shadow-sm rounded-2xl">
          <CardHeader className="p-6 border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-lg font-extrabold text-slate-900">
              <Play className="w-5 h-5 text-emerald-700" />
              手動スクレイパー実行コントロール
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-5">
            <div className="space-y-2">
              <Label className="text-sm font-bold text-slate-700">スキャン対象エリア（オーダー登録エリア）</Label>
              <div className="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                {targetWards.length === 0 ? (
                  <span className="text-sm text-slate-500 font-medium">
                    現在オーダーにエリアが指定されていません（デフォルト: 新宿区 13104）
                  </span>
                ) : (
                  targetWards.map((w) => (
                    <Badge key={w} className="bg-emerald-100 text-emerald-800 text-xs px-3 py-1 font-bold">
                      {w}
                    </Badge>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-bold text-slate-700">
                収集対象ポータルサイト <span className="text-xs text-slate-400 font-normal">（複数選択で並列収集）</span>
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
                      className={`px-3 py-2 rounded-xl text-xs font-bold transition-all duration-150 ${
                        isChecked
                          ? "bg-emerald-700 text-white shadow-sm"
                          : "bg-white text-slate-700 border border-slate-200 hover:border-slate-300"
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
              className="w-full h-12 text-base font-bold gap-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl shadow-lg shadow-emerald-700/20"
            >
              {isScraping ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <Play className="w-5 h-5" />
              )}
              {isScraping ? "リクエスト送信中..." : "手動スクレイピング開始"}
            </Button>

            <p className="text-xs text-slate-500 leading-relaxed">
              実行は GitHub Actions 上で行われます。開始後はこの画面を閉じても処理は継続し、
              結果は Convex に直接保存されて自動的に反映されます。
            </p>

            {scrapeStatus && (
              <div
                className={`p-4 rounded-xl text-sm font-semibold leading-relaxed ${
                  scrapeStatus.startsWith("エラー")
                    ? "bg-red-50 text-red-700 border border-red-200"
                    : scrapeStatus.startsWith("スクレイピングを開始")
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                    : "bg-slate-100 text-slate-800"
                }`}
              >
                {scrapeStatus}
              </div>
            )}

            {/* Run status. getRecentRuns is an ACTION (Convex queries cannot
                fetch), so this does NOT update reactively — it is refreshed on
                demand and once right after a dispatch. */}
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-bold text-slate-700">最近の実行状況</Label>
                <Button
                  onClick={() => void refreshRuns()}
                  disabled={isLoadingRuns}
                  className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-bold rounded-lg px-3 py-1 h-auto"
                >
                  {isLoadingRuns ? (
                    <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />取得中</>
                  ) : (
                    <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />更新</>
                  )}
                </Button>
              </div>

              {runsError ? (
                <div className="p-3 rounded-xl text-xs font-semibold leading-relaxed bg-red-50 text-red-700 border border-red-200">
                  {runsError}
                </div>
              ) : runs.length === 0 ? (
                <p className="text-xs text-slate-500 font-medium">
                  「更新」を押すと GitHub Actions の実行履歴を取得します。
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {runs.map((run) => (
                    <li
                      key={run.id}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-100"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-800">
                          {RUN_STATUS_LABELS[run.status ?? ""] || run.status || "不明"}
                          {run.conclusion &&
                            ` ・ ${RUN_CONCLUSION_LABELS[run.conclusion] || run.conclusion}`}
                        </div>
                        <div className="text-[11px] text-slate-500 font-medium truncate">
                          {run.created_at
                            ? new Date(run.created_at).toLocaleString("ja-JP")
                            : "—"}
                        </div>
                      </div>
                      {run.html_url && (
                        <a
                          href={run.html_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-bold text-emerald-700 hover:underline shrink-0"
                        >
                          ログを見る
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {/* System Status Card */}
        <Card className="bg-white border border-slate-200/80 shadow-sm rounded-2xl">
          <CardHeader className="p-6 border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-lg font-extrabold text-slate-900">
              <Database className="w-5 h-5 text-emerald-700" />
              システム接続ステータス
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            {/* Was: green "稼働中" purely because the VITE_SCRAPER_URL env var was
                non-empty — it said Active on a phone that could not reach the
                scraper at all. Scraping now runs on GitHub Actions, so name that
                instead of asserting a health we do not measure. */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-sm font-bold text-slate-700">スクレイピング実行環境</span>
              <Badge className="bg-emerald-700 text-white font-bold text-xs">
                GitHub Actions
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-sm font-bold text-slate-700">Convex DB</span>
              <Badge className="bg-emerald-700 text-white font-bold text-xs">接続済み</Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-sm font-bold text-slate-700">全登録物件数</span>
              <span className="font-extrabold text-base text-slate-900 font-data">
                {listings === undefined ? <Skeleton className="h-5 w-12" /> : `${listings.length} 件`}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-sm font-bold text-slate-700">セキュリティ認証</span>
              <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                <ShieldCheck className="w-4 h-4 text-emerald-700" />
                保護済み
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Database Scraped Listings Master Table */}
      <Card className="bg-white border border-slate-200/80 shadow-sm rounded-2xl overflow-hidden">
        <CardHeader className="p-6 border-b border-slate-100">
          <CardTitle className="text-lg font-extrabold text-slate-900 flex items-center justify-between">
            <span>物件マスターデータベース ({manualListings.length} 件)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="text-xs font-bold text-slate-700 py-3">物件所在地</TableHead>
                <TableHead className="text-xs font-bold text-slate-700">区</TableHead>
                <TableHead className="text-xs font-bold text-slate-700">価格 (万円)</TableHead>
                <TableHead className="text-xs font-bold text-slate-700">面積 (㎡)</TableHead>
                <TableHead className="text-xs font-bold text-slate-700">取得ソース</TableHead>
                <TableHead className="text-xs font-bold text-slate-700">ステータス</TableHead>
                <TableHead className="text-xs font-bold text-slate-700 text-right pr-6">操作</TableHead>
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
                  <TableCell colSpan={7} className="text-center py-12 text-slate-400 font-medium">
                    登録されている物件がありません。「手動スクレイピング開始」を実行してください。
                  </TableCell>
                </TableRow>
              ) : (
                manualListings.slice(0, 30).map((listing) => (
                  <TableRow key={listing._id} className="hover:bg-slate-50/80 transition-colors">
                    <TableCell className="font-bold text-slate-900 max-w-[240px] truncate text-sm">
                      {listing.address || "—"}
                    </TableCell>
                    <TableCell className="text-sm font-semibold text-slate-700">
                      {listing.ward || "—"}
                    </TableCell>
                    <TableCell className="font-data text-sm font-extrabold text-emerald-700">
                      {listing.price ? listing.price.toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="font-data text-sm font-semibold text-slate-700">
                      {listing.area ? listing.area.toFixed(1) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge className="bg-emerald-100 text-emerald-900 border border-emerald-200 font-bold text-[11px]">
                        {SOURCE_LABELS[listing.source || ""] || listing.source || "手動"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-[11px] font-bold ${
                          listing.status === "new"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {listing.status === "new" ? "新着" : listing.status || "一般"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <button
                        onClick={() => handleDeleteListing(listing._id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 transition-colors rounded-lg hover:bg-slate-100"
                        title="物件を削除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}