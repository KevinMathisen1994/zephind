import { useEffect, useMemo, useRef, useState } from "react";
import { Mail as MailIcon, Paperclip, Search, ExternalLink, SlidersHorizontal, RefreshCw, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery as useQuery, useApiMutation as useAction, SKIP } from "../hooks/useApi";
import { api } from "../lib/api";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import { formatMan } from "../lib/utils";
import { formatJaDateTime } from "../lib/dateFormat";
import { base64ToBytes, openAttachmentBytes, pdfAttachments, readMailPdfTexts } from "../lib/mailPdf";
import { MailRulesModal } from "../components/MailRulesModal";
import { EmailHtmlFrame } from "../components/EmailHtmlFrame";
import { runMailSync } from "../lib/mailSync";

type Attachment = { id?: string; filename: string; mimeType: string; size: number };
type Listing = Record<string, unknown>;
type StoredMail = {
  provider: string;
  id: string;
  subject?: string;
  from?: string;
  receivedAt?: number;
  attachments: Attachment[];
  filtered: boolean;
  filterReason: string | null;
  listings: Listing[];
  reason?: string;
  engine?: string;
};

type Filter = "all" | "listings" | "none" | "filtered";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "listings", label: "物件あり" },
  { key: "none", label: "物件なし" },
  { key: "filtered", label: "除外" },
];

const ENGINE_LABEL: Record<string, string> = {
  rules: "ルール", gemini: "Gemini", groq: "Groq", stored: "既存", none: "—",
};

const keyOf = (m: { provider: string; id: string }) => `${m.provider}:${m.id}`;
const verdictOf = (m: StoredMail): Filter => (m.filtered ? "filtered" : m.listings.length > 0 ? "listings" : "none");

const num = (v: unknown) => (typeof v === "number" ? v : undefined);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export default function MailPage() {
  const mails = useQuery(api.mailIngest.inspectRecentMail, { limit: 500, daysBack: 90 }) as StoredMail[] | undefined;
  const getAttachmentData = useAction(api.mailIngest.getAttachmentData);
  const savePdfTexts = useAction(api.mailIngest.savePdfTexts);

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // PDF text read in the browser, by message key, for rows the sync stored without it.
  const [clientPdfTexts, setClientPdfTexts] = useState<Record<string, string[]>>({});
  const [showRules, setShowRules] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const mailAccounts = useQuery(api.mailIngestData.myAccounts);
  const syncNow = useAction(api.mailIngest.syncNow);
  type Account = { _id: string; provider: string; email?: string; needsReconnect?: boolean; lastError?: string };
  const accounts = (mailAccounts ?? []) as Account[];
  const canSync = accounts.some((a) => !a.needsReconnect);
  const broken = accounts.filter((a) => a.needsReconnect);
  const startOAuth = useAction(api.mailIngest.startOAuth);
  const queryClient = useQueryClient();
  const [reconnecting, setReconnecting] = useState(false);

  // Same popup flow as the 物件検索 page; the account list is refetched when the popup closes.
  const handleReconnect = async (provider: string) => {
    setReconnecting(true);
    try {
      const { url } = (await startOAuth({ provider, redirectTo: window.location.href })) as { url: string };
      const popup = window.open(url, "zephind-mail-oauth", "width=520,height=680");
      if (!popup) return window.location.assign(url);
      const timer = window.setInterval(() => {
        if (!popup.closed) return;
        window.clearInterval(timer);
        setReconnecting(false);
        void queryClient.invalidateQueries({ queryKey: ["mail.accounts"] });
      }, 500);
    } catch (err) {
      setReconnecting(false);
      setNotice({ text: `再接続を開始できませんでした: ${err instanceof Error ? err.message : String(err)}`, error: true });
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const { text, failed } = await runMailSync(syncNow, (progress) => setNotice({ text: progress }));
      setNotice({ text, error: failed });
    } catch (err) {
      setNotice({ text: `同期に失敗しました: ${err instanceof Error ? err.message : String(err)}`, error: true });
    } finally {
      setSyncing(false);
    }
  };

  const visible = useMemo(() => {
    if (!mails) return undefined;
    const q = search.trim().toLowerCase();
    return mails.filter(
      (m) =>
        (filter === "all" || verdictOf(m) === filter) &&
        (!q || [m.subject, m.from].some((f) => f?.toLowerCase().includes(q))),
    );
  }, [mails, filter, search]);

  // Fades show only where there is more to scroll, so the first and last rows aren't dimmed for nothing.
  const listRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ top: false, bottom: false });
  const updateFade = () => {
    const el = listRef.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setFade((f) => (f.top === top && f.bottom === bottom ? f : { top, bottom }));
  };
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => updateFade());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // The box keeps its height when the list changes (tab, search), so re-check after the new rows render.
  useEffect(() => {
    const id = requestAnimationFrame(updateFade);
    return () => cancelAnimationFrame(id);
  }, [visible]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: mails?.length ?? 0, listings: 0, none: 0, filtered: 0 };
    for (const m of mails ?? []) c[verdictOf(m)]++;
    return c;
  }, [mails]);

  const selected = visible?.find((m) => keyOf(m) === selectedKey) ?? null;
  const detail = useQuery(
    api.mailIngest.inspectMailDetail,
    selected ? { provider: selected.provider, messageId: selected.id } : SKIP,
  ) as { bodyText: string; bodyHtml?: string; pdfTexts: string[] } | undefined;

  useEffect(() => {
    if (!selected || !detail || detail.pdfTexts?.length) return;
    const key = keyOf(selected);
    if (clientPdfTexts[key] || pdfAttachments(selected.attachments).length === 0) return;
    void readMailPdfTexts(selected.provider, selected.id, selected.attachments, getAttachmentData, (texts) =>
      setClientPdfTexts((prev) => ({ ...prev, [key]: texts })),
    ).then(({ texts, ok }) => {
      // Only a complete read is saved, so a failed download retries on the next open.
      if (ok) {
        savePdfTexts({ provider: selected.provider, messageId: selected.id, pdfTexts: texts }).catch((e: unknown) =>
          console.warn("savePdfTexts failed", e),
        );
      }
    });
  }, [selected, detail, clientPdfTexts, getAttachmentData, savePdfTexts]);

  const pdfTexts = detail?.pdfTexts?.length ? detail.pdfTexts : selected ? clientPdfTexts[keyOf(selected)] : undefined;

  const openAttachment = async (m: StoredMail, a: Attachment) => {
    if (!a.id) return;
    // Opened before the await so the popup blocker treats it as user-initiated.
    const win = window.open("about:blank", "_blank");
    try {
      const res = await getAttachmentData({
        provider: m.provider, messageId: m.id, attachmentId: a.id, mimeType: a.mimeType, filename: a.filename,
      });
      if (!res?.base64) throw new Error("empty attachment");
      openAttachmentBytes(base64ToBytes(res.base64), res.mimeType || a.mimeType, a.filename, win);
    } catch (err) {
      win?.close();
      alert(`添付ファイルを開けませんでした: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">受信メール</h1>
          <p className="page-subtitle">
            同期済みの業者メールと、そこから抽出した物件情報です（過去90日）。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRules(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--border-subtle)] bg-white text-[13.5px] font-bold text-[var(--text-secondary)] hover:border-[var(--border-default)]"
          >
            <SlidersHorizontal className="w-4 h-4" />
            取り込み設定
          </button>
          <button
            onClick={() => void handleSync()}
            disabled={syncing || !canSync}
            title={canSync ? undefined : broken.length ? "メールアカウントを再接続してください" : "メール連携は「物件検索」画面で接続してください"}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--brand)] text-white text-[13.5px] font-bold hover:opacity-90 disabled:opacity-50"
          >
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            今すぐ同期
          </button>
        </div>
      </div>

      {broken.map((a) => (
        <div
          key={a._id}
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-800 flex flex-col sm:flex-row sm:items-center gap-2"
        >
          <p className="flex-1">
            <strong>{a.provider === "gmail" ? "Gmail" : "Outlook"}（{a.email}）の再接続が必要です。</strong>
            同期できません。{a.lastError ? `（${a.lastError}）` : ""}
          </p>
          <button
            onClick={() => void handleReconnect(a.provider)}
            disabled={reconnecting}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-red-200 font-bold hover:border-red-400 disabled:opacity-50"
          >
            {reconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            再接続
          </button>
        </div>
      ))}

      {notice && (
        <p
          role="status"
          className={`whitespace-pre-line text-[13.5px] font-bold ${notice.error ? "text-red-700" : "text-[var(--brand)]"}`}
        >
          {notice.text}
        </p>
      )}

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="表示するメール">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-full text-[13.5px] font-bold border transition-colors ${
                filter === f.key
                  ? "bg-[var(--brand)] text-white border-[var(--brand)]"
                  : "bg-white text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-default)]"
              }`}
            >
              {f.label} <span className="opacity-70">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72 sm:ml-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="件名・差出人で絞り込み"
            aria-label="件名・差出人で絞り込み"
            className="field pl-9"
          />
        </div>
      </div>

      {filter === "filtered" && (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-page-subtle)] px-4 py-3 text-[13.5px] text-[var(--text-secondary)] flex flex-col sm:flex-row sm:items-center gap-2">
          <p className="flex-1">
            これらのメールは<strong>取り込み設定</strong>（必須ワード・除外ワード・送信者・添付の有無）に合わなかったため、物件の抽出を行っていません。
            必須ワードは件名と本文だけで判定し、PDFの中身は見ません。設定を変えると、次回の同期で再判定されます。
          </p>
          <button
            onClick={() => setShowRules(true)}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[var(--border-subtle)] font-bold hover:border-[var(--brand)]"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            設定を開く
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] items-start">
        <div className="relative bg-white rounded-2xl border border-[var(--border-subtle)] shadow-xs overflow-hidden">
        <div
          ref={listRef}
          onScroll={updateFade}
          className="lg:max-h-[calc(100vh-240px)] scroll-visible"
        >
          {visible === undefined ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4].map((n) => <Skeleton key={n} className="h-16 w-full rounded-xl" />)}
            </div>
          ) : visible.length === 0 ? (
            <div className="p-10 text-center">
              <MailIcon className="w-10 h-10 text-[var(--text-muted)]/30 mx-auto mb-3" />
              <p className="text-sm font-bold text-[var(--text-secondary)]">
                {mails && mails.length > 0 ? "該当するメールがありません" : "同期済みのメールがありません"}
              </p>
              {mails?.length === 0 && (
                <p className="text-xs text-[var(--text-muted)] mt-1">「今すぐ同期」でメールを取り込んでください。</p>
              )}
            </div>
          ) : (
            <ul>
              {visible.map((m) => {
                const k = keyOf(m);
                const v = verdictOf(m);
                return (
                  <li key={k}>
                    <button
                      onClick={() => setSelectedKey(k)}
                      aria-current={k === selectedKey}
                      className={`w-full text-left px-4 py-3 border-b border-[var(--border-subtle)] transition-colors ${
                        k === selectedKey ? "bg-[var(--bg-page-subtle)]" : "hover:bg-[var(--bg-page-subtle)]/60"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex-1 truncate text-[14px] font-bold text-[var(--text-primary)]">
                          {m.subject || "(件名なし)"}
                        </span>
                        {m.attachments.length > 0 && (
                          <Paperclip className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]" aria-label="添付あり" />
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
                        <span className="truncate flex-1">{m.from}</span>
                        <span className="shrink-0">{formatJaDateTime(m.receivedAt)}</span>
                      </div>
                      <div className="mt-1.5">
                        {v === "listings" && <Badge variant="emerald">物件 {m.listings.length}件</Badge>}
                        {v === "none" && <Badge variant="secondary">物件なし</Badge>}
                        {v === "filtered" && <Badge variant="outline">除外</Badge>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
          {/* right-2 leaves the scrollbar unfaded. */}
          <div
            aria-hidden
            className={`pointer-events-none absolute top-0 left-0 right-2 h-20 bg-gradient-to-b from-white from-30% to-transparent transition-opacity ${fade.top ? "opacity-100" : "opacity-0"}`}
          />
          <div
            aria-hidden
            className={`pointer-events-none absolute bottom-0 left-0 right-2 h-20 bg-gradient-to-t from-white from-30% to-transparent transition-opacity ${fade.bottom ? "opacity-100" : "opacity-0"}`}
          />
        </div>

        <div className="bg-white rounded-2xl border border-[var(--border-subtle)] shadow-xs p-5 min-w-0">
          {!selected ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-16">左の一覧からメールを選択してください。</p>
          ) : (
            <MailDetail
              key={keyOf(selected)}
              mail={selected}
              bodyText={detail?.bodyText}
              bodyHtml={detail?.bodyHtml}
              pdfTexts={pdfTexts}
              onOpenAttachment={(a) => openAttachment(selected, a)}
            />
          )}
        </div>
      </div>

      {showRules && (
        <MailRulesModal
          onClose={() => setShowRules(false)}
          onSaved={() => setNotice({ text: "取り込み設定を保存しました。「今すぐ同期」を押すと、除外済みのメールも新しい設定で再判定されます。" })}
          onError={(message) => setNotice({ text: message, error: true })}
        />
      )}
    </div>
  );
}

function MailDetail({
  mail, bodyText, bodyHtml, pdfTexts, onOpenAttachment,
}: {
  mail: StoredMail;
  bodyText?: string;
  bodyHtml?: string;
  pdfTexts?: string[];
  onOpenAttachment: (a: Attachment) => void;
}) {
  const pdfs = pdfAttachments(mail.attachments);
  const [asText, setAsText] = useState(false);
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[18px] font-bold text-[var(--text-primary)] break-words">{mail.subject || "(件名なし)"}</h2>
        <p className="mt-1 text-[13.5px] text-[var(--text-muted)] break-all">
          {mail.from} ・ {formatJaDateTime(mail.receivedAt)}
        </p>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          {mail.filtered
            ? `設定により除外: ${mail.filterReason ?? ""}`
            : // reason is the rules pass's verdict; once a model extracted, it contradicts the result, so only engine shows.
              mail.engine === "gemini" || mail.engine === "groq"
              ? `抽出: ${ENGINE_LABEL[mail.engine]}`
              : `判定: ${mail.reason ?? "—"} ・ 抽出: ${ENGINE_LABEL[mail.engine ?? ""] ?? mail.engine ?? "—"}`}
        </p>
      </div>

      {mail.listings.length > 0 && (
        <section>
          <h3 className="text-[14px] font-bold text-[var(--text-secondary)] mb-2">抽出した物件（{mail.listings.length}件）</h3>
          <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
            <table className="w-full text-[13.5px]">
              <thead className="bg-[var(--bg-page-subtle)] text-[var(--text-secondary)]">
                <tr>
                  {["物件名", "所在地", "種別", "価格", "利回り", "面積", "土地", "最寄駅", "築年", "構造"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 text-left font-bold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mail.listings.map((l, i) => {
                  const price = num(l.price);
                  const yld = num(l.yield);
                  const area = num(l.area);
                  const land = num(l.landSize);
                  const walk = num(l.walkMinutes);
                  return (
                    <tr key={i} className="border-t border-[var(--border-subtle)] align-top">
                      <td className="px-3 py-2 font-bold min-w-[140px]">{str(l.title) ?? "—"}</td>
                      <td className="px-3 py-2 min-w-[160px]">{str(l.address) ?? "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{str(l.propertyType) ?? "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{price != null ? `${formatMan(price)}円` : "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{yld != null ? `${yld}%` : "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{area != null ? `${area}㎡` : "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{land != null ? `${land}㎡` : "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {str(l.station) ? `${str(l.station)}${walk != null ? ` 徒歩${walk}分` : ""}` : "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{num(l.buildYear) ?? "—"}</td>
                      <td className="px-3 py-2 min-w-[120px]">{str(l.structure) ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {mail.attachments.length > 0 && (
        <section>
          <h3 className="text-[14px] font-bold text-[var(--text-secondary)] mb-2">添付ファイル</h3>
          <div className="flex flex-wrap gap-2">
            {mail.attachments.map((a, i) => (
              <button
                key={a.id || i}
                onClick={() => onOpenAttachment(a)}
                disabled={!a.id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[13.5px] hover:border-[var(--brand)] disabled:opacity-50"
              >
                <Paperclip className="w-3.5 h-3.5" />
                <span className="truncate max-w-[220px]">{a.filename || "(名前なし)"}</span>
                <span className="text-[var(--text-muted)]">{a.size ? `${Math.round(a.size / 1024)}KB` : ""}</span>
                <ExternalLink className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[14px] font-bold text-[var(--text-secondary)]">本文</h3>
          {bodyHtml && (
            <button
              onClick={() => setAsText((v) => !v)}
              className="text-[13px] font-bold text-[var(--brand)] hover:underline"
            >
              {asText ? "元の表示に戻す" : "テキストで表示"}
            </button>
          )}
        </div>
        {bodyHtml && !asText ? (
          <EmailHtmlFrame html={bodyHtml} />
        ) : (
          // Proportional font and pre-wrap: plain-text mail keeps its own line breaks and spacing, as in Gmail.
          <div className="font-sans text-[14px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] bg-[var(--bg-page-subtle)] rounded-xl p-4 max-h-[520px] overflow-y-auto text-[var(--text-primary)]">
            {bodyText === undefined ? "読み込み中…" : bodyText || "(本文なし)"}
          </div>
        )}
      </section>

      {pdfs.length > 0 &&
        (pdfTexts ?? pdfs.map(() => "読み込み中…")).map((t, i) => (
          <section key={i}>
            <h3 className="text-[14px] font-bold text-[var(--text-secondary)] mb-2">
              PDF {i + 1} のテキスト{pdfs[i] ? `（${pdfs[i].filename}）` : ""}
            </h3>
            <pre className="text-[14px] leading-relaxed whitespace-pre-wrap break-all bg-[var(--bg-page-subtle)] rounded-xl p-3 max-h-96 overflow-y-auto text-[var(--text-secondary)]">
              {t || "(テキストを抽出できませんでした)"}
            </pre>
          </section>
        ))}
    </div>
  );
}
