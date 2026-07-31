import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import emailjs from "@emailjs/browser";
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
  Loader2,
  Settings,
  Search,
} from "lucide-react";
import type { Doc } from "../../convex/_generated/dataModel";

interface ProposalModalProps {
  order: Doc<"orders">;
  orderMatchList: Doc<"matching">[];
  matchedListing: (id: string) => Doc<"listings"> | undefined;
  evaluations: Record<string, string>;
  onClose: () => void;
}

export default function ProposalModal({
  order,
  orderMatchList,
  matchedListing,
  evaluations,
  onClose,
}: ProposalModalProps) {
  const customers = useQuery(api.customers.list);
  const createDeal = useMutation(api.deals.create);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(
    order?.customerId || "",
  );
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(
    new Set(),
  );
  const [listingSearch, setListingSearch] = useState<string>("");
  const [customMessage, setCustomMessage] = useState<string>(
    `${order?.name || "ご希望条件"}に適合するおすすめの物件情報を厳選してご案内いたします。ご内見や詳細資料のご要望がございましたら、お気軽にお申し付けください。`,
  );
  const [emailSubject, setEmailSubject] = useState<string>("");
  const [emailBody, setEmailBody] = useState<string>("");
  const [isUserEditedBody, setIsUserEditedBody] = useState<boolean>(false);
  const [isUserEditedSubject, setIsUserEditedSubject] =
    useState<boolean>(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // EmailJS State
  const [sendingEmailJS, setSendingEmailJS] = useState(false);
  const [emailJSSuccess, setEmailJSSuccess] = useState(false);
  const [emailJSError, setEmailJSError] = useState<string | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);

  const [serviceId, setServiceId] = useState(
    localStorage.getItem("emailjs_service_id") ||
      (import.meta.env.VITE_EMAILJS_SERVICE_ID as string) ||
      "",
  );
  const [templateId, setTemplateId] = useState(
    localStorage.getItem("emailjs_template_id") ||
      (import.meta.env.VITE_EMAILJS_TEMPLATE_ID as string) ||
      "",
  );
  const [publicKey, setPublicKey] = useState(
    localStorage.getItem("emailjs_public_key") ||
      (import.meta.env.VITE_EMAILJS_PUBLIC_KEY as string) ||
      "",
  );

  const saveEmailJSConfig = () => {
    localStorage.setItem("emailjs_service_id", serviceId);
    localStorage.setItem("emailjs_template_id", templateId);
    localStorage.setItem("emailjs_public_key", publicKey);
    setShowConfigModal(false);
  };

  const selectedCustomer = customers?.find((c) => c._id === selectedCustomerId);

  const toggleSelectMatch = (id: string) => {
    const next = new Set(selectedMatchIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedMatchIds(next);
  };

  const selectAll = () => {
    setSelectedMatchIds(new Set(orderMatchList.map((m) => m._id)));
  };

  const selectedListingsData = orderMatchList
    .filter((m) => selectedMatchIds.has(m._id))
    .map((m) => {
      const listing = matchedListing(m.listingId ?? "");
      const hasEvaluation = m.evaluation || evaluations[m._id];
      const score =
        m.score ??
        (hasEvaluation
          ? hasEvaluation.match(/評価[：:\s]*(\d+)/)?.[1]
            ? Number(hasEvaluation.match(/評価[：:\s]*(\d+)/)[1])
            : undefined
          : undefined);
      return {
        matchId: m._id,
        listingId: m.listingId,
        address: listing?.address || "—",
        ward: listing?.ward || "",
        price: listing?.price,
        landSize: listing?.landSize || listing?.area,
        walkMinutes: listing?.walkMinutes,
        station: listing?.station,
        url: listing?.url,
        source: listing?.source,
        propertyType: listing?.propertyType,
        score,
        evaluation: hasEvaluation,
      };
    });

  // Construct Email Subject & Body
  const clientName = selectedCustomer?.name || order?.name || "お客様";

  const buildGeneratedSubject = () =>
    `【物件ご提案】${clientName}様 ご希望条件に適合するおすすめ物件のご案内`;

  const buildGeneratedBody = () => {
    const lines = [
      `${clientName} 様`,
      "",
      "いつもお世話になっております。",
      customMessage,
      "",
      "--------------------------------------------------",
      `■ ご提案物件一覧 (全${selectedListingsData.length}件)`,
      "--------------------------------------------------",
      "",
      ...selectedListingsData.flatMap((l, idx) => [
        `【物件${idx + 1}】${l.address} ${l.propertyType ? `(${l.propertyType})` : ""}`,
        `・価格: ${l.price ? `${l.price.toLocaleString()} 万円` : "要確認"}`,
        `・面積: ${l.landSize ? `${l.landSize} ㎡` : "要確認"}`,
        `・アクセス: ${l.station || ""} ${l.walkMinutes !== undefined ? `(徒歩${l.walkMinutes}分)` : ""}`,
        l.score !== undefined ? `・評価スコア: ${l.score}点` : "",
        l.url ? `・詳細URL: ${l.url}` : "",
        "",
      ]),
      "--------------------------------------------------",
      "ご興味のある物件や、ご内見・詳細資料（公図・測量図等）のご要望がございましたら、",
      "本メールへのご返信、またはお電話にてお気軽にご連絡くださいませ。",
      "",
      "引き続き何卒よろしくお願い申し上げます。",
    ].filter((line) => line !== "");
    return lines.join("\n");
  };

  useEffect(() => {
    if (!isUserEditedSubject) {
      setEmailSubject(buildGeneratedSubject());
    }
    if (!isUserEditedBody) {
      setEmailBody(buildGeneratedBody());
    }
  }, [selectedCustomerId, selectedMatchIds, customMessage]);

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

  // Direct Client-Side EmailJS Dispatch
  const handleSendEmailJS = async () => {
    if (!serviceId || !templateId || !publicKey) {
      setShowConfigModal(true);
      return;
    }

    const recipientEmail = selectedCustomer?.email?.trim();
    if (!recipientEmail) {
      setEmailJSError(
        "提案先の顧客メールアドレスが設定されていません。選択した顧客にメールアドレスが登録されているかご確認ください。",
      );
      return;
    }

    setSendingEmailJS(true);
    setEmailJSError(null);

    try {
      await emailjs.send(
        serviceId,
        templateId,
        {
          to_email: recipientEmail,
          email: recipientEmail,
          user_email: recipientEmail,
          recipient_email: recipientEmail,
          to: recipientEmail,
          reply_to: recipientEmail,
          title: emailSubject,
          subject: emailSubject,
          name: clientName,
          to_name: clientName,
          time: new Date().toLocaleString("ja-JP"),
          message: emailBody,
          content: emailBody,
          order_name: order?.name || "",
          listings_count: selectedListingsData.length,
        },
        publicKey,
      );

      setEmailJSSuccess(true);
      setTimeout(() => setEmailJSSuccess(false), 4000);

      // Auto save deal
      await handleSaveDeal();
    } catch (err: unknown) {
      console.error("EmailJS Send Failed:", err);
      const errorMessage =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "text" in err
            ? (err as { text: string }).text
            : "メール送信に失敗しました。設定をご確認ください。";
      setEmailJSError(errorMessage);
    } finally {
      setSendingEmailJS(false);
    }
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
        orderId: order._id,
        orderName: order.name,
        listings: selectedListingsData,
        customMessage,
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
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-700 flex items-center justify-center shadow-md shadow-emerald-700/20 text-white">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                顧客へ物件を提案・メール送信
              </h2>
              <p className="text-xs text-slate-500 font-semibold mt-0.5">
                選択した抽出物件にコメントを添えて、お客様への提案メールを作成・送信します
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowConfigModal(true)}
              className="p-2 text-slate-500 hover:text-emerald-700 rounded-lg hover:bg-slate-100 transition-colors"
              title="EmailJS API設定"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Customer Selection & Message Box */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 bg-slate-50 p-5 rounded-2xl border border-slate-200/80">
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

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-emerald-700" />
                自由記述コメント (添え状・メッセージ)
              </label>
              <textarea
                rows={3}
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="お客様への自由メッセージやおすすめポイントをご記入ください..."
                className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700 leading-relaxed"
              />
            </div>
          </div>

          {/* Listing Selection List */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                提案に含める物件を選択 ({selectedMatchIds.size} /{" "}
                {orderMatchList.length}件 選択中)
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
              {orderMatchList
                .filter((m) => {
                  if (!listingSearch.trim()) return true;
                  const q = listingSearch.toLowerCase().trim();
                  const listing = matchedListing(m.listingId ?? "");
                  return (
                    listing?.address?.toLowerCase().includes(q) ||
                    listing?.ward?.toLowerCase().includes(q) ||
                    listing?.propertyType?.toLowerCase().includes(q) ||
                    String(listing?.price || "").includes(q)
                  );
                })
                .map((m) => {
                  const listing = matchedListing(m.listingId ?? "");
                  const isSelected = selectedMatchIds.has(m._id);
                  const hasEval = m.evaluation || evaluations[m._id];
                  const score =
                    m.score ??
                    (hasEval
                      ? hasEval.match(/評価[：:\s]*(\d+)/)?.[1]
                        ? Number(hasEval.match(/評価[：:\s]*(\d+)/)[1])
                        : undefined
                      : undefined);

                  return (
                    <div
                      key={m._id}
                      onClick={() => toggleSelectMatch(m._id)}
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
                            {listing?.address || m.listingId?.slice(0, 8)}
                          </div>
                          <div className="text-xs text-slate-500 font-semibold flex items-center gap-2 mt-0.5">
                            {listing?.price && (
                              <span>{listing.price.toLocaleString()}万円</span>
                            )}
                            {listing?.landSize && (
                              <span>{listing.landSize}㎡</span>
                            )}
                            {listing?.propertyType && (
                              <span>{listing.propertyType}</span>
                            )}
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

          {/* Status Feedback Banners */}
          {emailJSSuccess && (
            <div className="p-4 rounded-xl bg-emerald-700 text-white font-bold text-xs flex items-center gap-2 animate-in fade-in">
              <Check className="w-5 h-5" />
              EmailJSにより、{clientName}様へのメール直接送信が成功しました！
            </div>
          )}

          {emailJSError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold text-xs flex items-center justify-between gap-2">
              <span>{emailJSError}</span>
              <button
                onClick={() => setShowConfigModal(true)}
                className="underline font-black text-red-800 shrink-0"
              >
                API設定を変更
              </button>
            </div>
          )}

          {/* Email Subject & Body (Editable) */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-emerald-700" />
                提案メール内容 (編集可能)
              </div>
              <button
                type="button"
                onClick={handleResetTemplate}
                className="text-xs font-bold text-emerald-700 hover:underline"
              >
                テンプレート本文を再生成
              </button>
            </div>

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
          </div>
        </div>

        <div className="p-5 border-t border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3">
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
            <Button
              type="button"
              variant="outline"
              onClick={handleOpenMailto}
              className="rounded-xl text-xs font-bold border-slate-200 text-slate-700 h-10 px-3.5 gap-1.5"
            >
              <Mail className="w-3.5 h-3.5 text-slate-500" />
              標準メールアプリで開く
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={handleSendEmailJS}
              disabled={sendingEmailJS || selectedMatchIds.size === 0}
              className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold px-5 gap-1.5 h-11 shadow-md shadow-emerald-700/20"
            >
              {sendingEmailJS ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  送信中
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 text-white" />
                  メール送信
                </>
              )}
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
                EmailJS API 設定 (無料クライアント送信)
              </h3>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-emerald-50 text-emerald-900 border border-emerald-200 leading-relaxed font-semibold">
                EmailJS (`@emailjs/browser`)
                はサーバー不要でブラウザから直接Gmail/Outlook/SMTPにメール送信できる無料ライブラリです（月200通無料）。
              </div>

              <div className="p-3 rounded-xl bg-amber-50 text-amber-900 border border-amber-200 leading-relaxed font-semibold">
                ⚠️ <strong>EmailJSダッシュボード設定のポイント:</strong>
                <br />
                <a
                  href="https://dashboard.emailjs.com/admin/templates"
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-amber-900 hover:text-amber-950 font-bold"
                >
                  EmailJS Dashboard
                </a>
                の <strong>Email Templates {">"} Settings</strong> にて、「<strong>To Email (宛先)</strong>」を
                <code className="bg-amber-100 px-1 rounded mx-1 text-amber-950">{"{{to_email}}"}</code>
                または
                <code className="bg-amber-100 px-1 rounded mx-1 text-amber-950">{"{{email}}"}</code>
                に設定してください。（アカウント登録時のメールアドレスのままだと自身宛てに固定送信されてしまいます）
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Service ID (サービスID)
                </label>
                <input
                  type="text"
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                  placeholder="例: service_abc123"
                  className="w-full px-3 py-2 border rounded-xl font-mono text-xs focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Template ID (テンプレートID)
                </label>
                <input
                  type="text"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  placeholder="例: template_xyz789"
                  className="w-full px-3 py-2 border rounded-xl font-mono text-xs focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Public Key (公開キー)
                </label>
                <input
                  type="text"
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  placeholder="例: user_pk_123456"
                  className="w-full px-3 py-2 border rounded-xl font-mono text-xs focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t">
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
                  onClick={saveEmailJSConfig}
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