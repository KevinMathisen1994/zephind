import { useState, useEffect } from "react";
import { useApiQuery as useQuery, useApiMutation as useMutation } from "../hooks/useApi";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  X,
  Mail,
  Copy,
  Check,
  Send,
  FileText,
  Users,
  CheckSquare,
  Square,
  Settings,
  Search,
} from "lucide-react";
import {
  DEFAULT_EMAIL_SIGNATURE,
  withSignature,
} from "../lib/emailSignature";

/**
 * One proposable property, flattened.
 *
 * The modal used to take `matching` rows plus a listings lookup, which tied the
 * whole email flow — signature, sending, deal saving — to the Orders
 * page. 保存物件 needs the same flow over rows that are NOT matches (they are
 * snapshots, and their listing may no longer exist), so each caller flattens its
 * own data into this shape and the modal stays the single place email lives.
 */
export interface ProposalItem {
  /** Stable id within the caller's list (match id, saved-row id, …). */
  id: string;
  listingId?: string;
  address?: string;
  ward?: string;
  price?: number;
  /** 土地面積 or 専有面積 — whichever the caller considers the headline figure. */
  size?: number;
  station?: string;
  walkMinutes?: number;
  url?: string;
  source?: string;
  propertyType?: string;
  score?: number;
  evaluation?: string;
}

interface ProposalModalProps {
  /** Everything proposable, already flattened by the caller. */
  items: ProposalItem[];
  /** Ticked before opening. When non-empty the picker below starts collapsed —
   *  re-listing what the user just chose is redundant, but it stays reachable. */
  initialSelectedIds?: Set<string>;
  /** Names the proposal in the default message and the saved deal. */
  contextName?: string;
  /** Present only when the proposal came from an order; the deal records it. */
  orderId?: string;
  /** Pre-selects the customer (an order carries one; 保存物件 does not). */
  defaultCustomerId?: string;
  onClose: () => void;
}

const SectionHeader = ({
  step,
  icon: Icon,
  title,
  action,
}: {
  step: number;
  icon: typeof Users;
  title: string;
  action?: React.ReactNode;
}) => (
  <div className="flex flex-wrap items-center justify-between gap-2">
    <div className="flex items-center gap-2.5">
      <span className="w-5 h-5 rounded-full bg-[var(--brand)] text-white text-[10px] font-black flex items-center justify-center shrink-0 shadow-xs">
        {step}
      </span>
      <Icon className="w-4 h-4 text-[var(--brand)]" />
      <span className="text-xs font-extrabold text-[var(--text-primary)] uppercase tracking-wider">
        {title}
      </span>
    </div>
    {action}
  </div>
);

export const ProposalModal = ({
  items,
  initialSelectedIds,
  contextName,
  orderId,
  defaultCustomerId,
  onClose,
}: ProposalModalProps) => {
  const customers = useQuery(api.customers.list);
  const createDeal = useMutation(api.deals.create);
  // The mail signature, stored per ACCOUNT rather than per browser. `undefined`
  // while the query is in flight, `null` when nothing is saved yet.
  const emailSettings = useQuery(api.emailSettings.get);
  const saveEmailSettings = useMutation(api.emailSettings.save);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(
    defaultCustomerId || "",
  );
  // Seed from what was ticked in the results list. Filtered against the current
  // matches so a stale id (listing removed since ticking) cannot select nothing.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    if (!initialSelectedIds?.size) return new Set();
    // Filtered against the current items so a stale id cannot select nothing.
    return new Set(items.map((i) => i.id).filter((id) => initialSelectedIds.has(id)));
  });
  const [showPicker, setShowPicker] = useState<boolean>(!initialSelectedIds?.size);
  const [listingSearch, setListingSearch] = useState<string>("");
  const [emailSubject, setEmailSubject] = useState<string>("");
  const [emailBody, setEmailBody] = useState<string>("");
  const [isUserEditedBody, setIsUserEditedBody] = useState<boolean>(false);
  const [isUserEditedSubject, setIsUserEditedSubject] =
    useState<boolean>(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);

  /**
   * The signature is DERIVED, not copied into state by an effect: the saved row
   * arrives asynchronously, so seeding a field from it raced with typing. A draft
   * that simply overrides the stored value has no race and needs no effect.
   */
  const [signatureDraft, setSignatureDraft] = useState<string | undefined>();
  const signature =
    signatureDraft ?? emailSettings?.signature ?? DEFAULT_EMAIL_SIGNATURE;

  const [settingsSaved, setSettingsSaved] = useState(false);

  const saveSettings = async () => {
    try {
      await saveEmailSettings({ signature });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2500);
      setShowConfigModal(false);
    } catch (err) {
      // Saving must not fail silently — the whole point is that the signature
      // outlives this browser.
      setFormError(
        `設定を保存できませんでした: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const selectedCustomer = customers?.find((c) => c._id === selectedCustomerId);

  const toggleSelectMatch = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const selectAll = () => {
    setSelectedIds(new Set(items.map((i) => i.id)));
  };

  const selectedListingsData = items.filter((item) => selectedIds.has(item.id));

  // Construct Email Subject & Body
  const clientName = selectedCustomer?.name || contextName || "お客様";

  const buildGeneratedSubject = () =>
    `【物件ご提案】${clientName}様 ご希望条件に適合するおすすめ物件のご案内`;

  const buildGeneratedBody = () => {
    const lines = [
      `${clientName} 様`,
      "",
      "いつもお世話になっております。",
      "ご希望条件に適合するおすすめの物件情報を厳選してご案内いたします。",
      "",
      "--------------------------------------------------",
      `■ ご提案物件一覧 (全${selectedListingsData.length}件)`,
      "--------------------------------------------------",
      "",
      // NOTHING here identifies where the listing came from.
      //
      // 評価スコア is our own internal ranking — a number the buyer cannot
      // interpret and that invites argument about a figure we never intended to
      // publish. 詳細URL points at the LISTING PORTAL, i.e. straight at the
      // seller's agent, which would route the enquiry around us. Both are kept on
      // the saved deal for our own records; neither goes to the customer. The
      // portal name (l.source) is left out for the same reason.
      ...selectedListingsData.flatMap((l, idx) => [
        `【物件${idx + 1}】${l.address} ${l.propertyType ? `(${l.propertyType})` : ""}`,
        `・価格: ${l.price ? `${l.price.toLocaleString()} 万円` : "要確認"}`,
        `・面積: ${l.size ? `${l.size} ㎡` : "要確認"}`,
        `・アクセス: ${l.station || ""} ${l.walkMinutes !== undefined ? `(徒歩${l.walkMinutes}分)` : ""}`,
        "",
      ]),
      "--------------------------------------------------",
      "ご興味のある物件や、ご内見・詳細資料（公図・測量図等）のご要望がございましたら、",
      "本メールへのご返信、またはお電話にてお気軽にご連絡くださいませ。",
      "",
      "引き続き何卒よろしくお願い申し上げます。",
    ].filter((line) => line !== "");
    // 会社所在地・名称・連絡先・宅建番号・取引態様 は署名として自動で付きます。
    // 文言は「メール設定」から編集できます。
    return withSignature(lines.join("\n"), signature);
  };

  useEffect(() => {
    if (!isUserEditedSubject) {
      setEmailSubject(buildGeneratedSubject());
    }
    if (!isUserEditedBody) {
      setEmailBody(buildGeneratedBody());
    }
    // `signature` is in here so the body picks up the saved signature the moment
    // the settings query resolves (and after an edit in the settings dialog).
  }, [selectedCustomerId, selectedIds, signature]);

  const handleResetTemplate = () => {
    setEmailSubject(buildGeneratedSubject());
    setEmailBody(buildGeneratedBody());
    setIsUserEditedSubject(false);
    setIsUserEditedBody(false);
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(`件名: ${emailSubject}\n\n${emailBody}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleOpenMailto = () => {
    const mailtoUrl = `mailto:${encodeURIComponent(selectedCustomer?.email || "")}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
    window.location.href = mailtoUrl;
  };

  const handleSaveDeal = async () => {
    setSaving(true);
    try {
      await createDeal({
        title: `${clientName}様への物件提案 (${selectedListingsData.length}件)`,
        customerId: selectedCustomer?._id,
        customerName: selectedCustomer?.name || clientName,
        customerEmail: selectedCustomer?.email,
        customerPhone: selectedCustomer?.phone,
        // 保存物件 proposals have no order behind them; the deal then records
        // only the customer and the properties.
        orderId: orderId,
        orderName: contextName,
        listings: selectedListingsData,
        // The mail as sent. This used to be the separate 添え状 field, which no
        // longer exists — the body itself is editable, so storing it records
        // exactly what the customer received.
        customMessage: emailBody,
        status: "proposed",
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to save deal:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-ambient border border-[var(--border-subtle)] w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-6 border-b border-[var(--border-subtle)] bg-[var(--bg-page-subtle)] flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[var(--brand)] to-[var(--brand-hover)] flex items-center justify-center shadow-[0_4px_16px_rgba(22,101,3,0.25)] text-white shrink-0">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
                顧客へ物件を提案・メール送信
              </h2>
              <p className="text-xs text-[var(--text-muted)] font-medium mt-0.5">
                選択した抽出物件にコメントを添えて、お客様への提案メールを作成・送信します
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowConfigModal(true)}
              className="h-9 w-9 rounded-xl text-[var(--text-muted)] hover:text-[var(--brand)]"
              title="メール設定（署名）"
            >
              <Settings className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-9 w-9 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--border-subtle)]">
          {/* Recipient. The free-text 添え状 field was removed: the mail body in
              step 3 is directly editable, so a second place to write prose only
              made it unclear which one the customer would actually receive. */}
          <section className="p-6 space-y-3">
          <SectionHeader step={1} icon={Users} title="提案先" />
          <div className="grid grid-cols-1 gap-5 bg-slate-50 p-5 rounded-2xl border border-slate-200/80">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-emerald-700" />
                提案先の顧客 (買主)
              </label>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full h-11 px-3.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
              >
                <option value="">-- 顧客を選択 --</option>
                {(customers || []).map((c) => (
                  <option key={c._id} value={c._id}>
                    👤 {c.name} {c.company ? `(${c.company})` : ""}{" "}
                    {c.email ? `<${c.email}>` : ""}
                  </option>
                ))}
              </select>
              {selectedCustomer && (
                <div className="text-xs text-slate-500 font-medium pt-1 flex flex-wrap gap-3">
                  {selectedCustomer.phone && (
                    <span>📞 {selectedCustomer.phone}</span>
                  )}
                  {selectedCustomer.email && (
                    <span>✉️ {selectedCustomer.email}</span>
                  )}
                </div>
              )}
            </div>

          </div>
          </section>

          {/* Listing Selection List */}
          <section className="p-6 space-y-3">
            <SectionHeader
              step={2}
              icon={CheckSquare}
              title="提案する物件"
              action={
                <span className="text-xs font-bold text-slate-500">
                  {selectedIds.size} / {items.length}件 選択中
                </span>
              }
            />
            {!showPicker && (
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                <div className="text-xs font-bold text-emerald-900">
                  一覧で選択した {selectedIds.size} 件を提案に含めます
                </div>
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="text-xs font-bold text-emerald-800 underline cursor-pointer"
                >
                  選択を変更
                </button>
              </div>
            )}
            <div className={showPicker ? "space-y-3" : "hidden"}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-500">
                提案に含める物件を選択してください
              </div>
              <div className="flex items-center gap-3">
                <div className="relative w-48 sm:w-56">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={listingSearch}
                    onChange={(e) => setListingSearch(e.target.value)}
                    placeholder="リスト内検索 (住所・価格)..."
                    className="w-full pl-8 pr-3 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-700"
                  />
                </div>
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-xs font-bold text-emerald-700 hover:underline shrink-0"
                >
                  全件選択
                </button>
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
              {items
                .filter((item) => {
                  if (!listingSearch.trim()) return true;
                  const q = listingSearch.toLowerCase().trim();
                  return (
                    item.address?.toLowerCase().includes(q) ||
                    item.ward?.toLowerCase().includes(q) ||
                    item.propertyType?.toLowerCase().includes(q) ||
                    String(item.price || "").includes(q)
                  );
                })
                .map((item) => {
                  const isSelected = selectedIds.has(item.id);
                  const score = item.score;

                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleSelectMatch(item.id)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        isSelected
                          ? "bg-emerald-50/70 border-emerald-300 shadow-xs"
                          : "bg-white border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {isSelected ? (
                          <CheckSquare className="w-5 h-5 text-emerald-700 shrink-0" />
                        ) : (
                          <Square className="w-5 h-5 text-slate-300 shrink-0" />
                        )}
                        <div className="truncate">
                          <div className="text-sm font-extrabold text-slate-900 truncate">
                            {item.address || item.listingId?.slice(0, 8) || "—"}
                          </div>
                          <div className="text-xs text-slate-500 font-semibold flex items-center gap-2 mt-0.5">
                            {item.price !== undefined && (
                              <span>{item.price.toLocaleString()}万円</span>
                            )}
                            {item.size !== undefined && <span>{item.size}㎡</span>}
                            {item.propertyType && <span>{item.propertyType}</span>}
                          </div>
                        </div>
                      </div>

                      {score !== undefined && (
                        <Badge className="bg-emerald-100 text-emerald-900 border border-emerald-300 font-black text-xs shrink-0">
                          評価 {score}点
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Status Feedback Banner (signature-settings save failures) */}
          {formError && (
            <div className="px-6 pt-5">
              <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 font-bold text-xs flex items-center justify-between gap-2 shadow-xs">
                <span>{formError}</span>
                <button
                  type="button"
                  onClick={() => setShowConfigModal(true)}
                  className="underline font-black text-red-800 shrink-0 cursor-pointer"
                >
                  設定を確認
                </button>
              </div>
            </div>
          )}

          {/* Email Subject & Body (Editable) */}
          <section className="p-6 space-y-3">
            <SectionHeader
              step={3}
              icon={FileText}
              title="提案メール内容 (編集可能)"
              action={
                <button
                  type="button"
                  onClick={handleResetTemplate}
                  className="text-xs font-bold text-emerald-700 hover:underline"
                >
                  テンプレート本文を再生成
                </button>
              }
            />

            <div className="space-y-2">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  メール件名
                </label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => {
                    setEmailSubject(e.target.value);
                    setIsUserEditedSubject(true);
                  }}
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  メール本文 (直接自由に編集できます)
                </label>
                <textarea
                  rows={8}
                  value={emailBody}
                  onChange={(e) => {
                    setEmailBody(e.target.value);
                    setIsUserEditedBody(true);
                  }}
                  className="w-full p-3.5 bg-white border border-slate-200 rounded-2xl text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700 leading-relaxed"
                />
              </div>
            </div>
          </section>
        </div>

        <div className="p-5 border-t border-slate-200 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCopyText}
              className="rounded-xl text-xs font-bold border-slate-200 text-slate-700 h-10 px-3.5 gap-1.5"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  コピー完了
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                  本文をコピー
                </>
              )}
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={handleOpenMailto}
              disabled={selectedIds.size === 0}
              className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold px-5 gap-1.5 h-11 shadow-md shadow-emerald-700/20"
            >
              <Mail className="w-4 h-4 text-white" />
              Outlookで開く
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleSaveDeal}
              disabled={saving}
              className="rounded-xl text-xs font-bold border-slate-300 text-slate-800 h-11 px-5"
            >
              {savedSuccess ? "案件保存完了！" : "案件として保存"}
            </Button>
          </div>
        </div>
      </div>

      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <Settings className="w-4 h-4 text-emerald-700" />
                メール設定 
              </h3>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  メール署名（会社情報・宅建番号・取引態様）
                </label>
                <p className="text-[11px] text-slate-500 font-medium mb-1.5 leading-relaxed">
                  ここに入力した内容が、提案メール本文の末尾に自動で挿入されます。
                  文言・改行・空白はそのまま送信されます。
                </p>
                <textarea
                  rows={8}
                  value={signature}
                  onChange={(e) => setSignatureDraft(e.target.value)}
                  className="w-full p-3 border rounded-xl font-mono text-[11px] leading-relaxed text-slate-900 focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
                />
                <button
                  type="button"
                  onClick={() => setSignatureDraft(DEFAULT_EMAIL_SIGNATURE)}
                  className="mt-1.5 text-[11px] font-bold text-emerald-700 hover:underline"
                >
                  既定の署名に戻す
                </button>
              </div>

              <div className="text-[11px] text-slate-500 font-medium leading-relaxed">
                保存した設定はログイン中のアカウントに保存されるため、別のパソコンやスマートフォンでも同じ設定で送信できます。
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t">
                {settingsSaved && (
                  <span className="text-[11px] font-bold text-emerald-700 mr-auto">
                    保存しました
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowConfigModal(false)}
                  className="rounded-xl text-xs"
                >
                  キャンセル
                </Button>
                <Button
                  size="sm"
                  onClick={() => void saveSettings()}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold px-4"
                >
                  設定を保存
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}