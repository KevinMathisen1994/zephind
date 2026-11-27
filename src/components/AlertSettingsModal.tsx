import { useState, useEffect } from "react";
import {
  X,
  Bell,
  Check,
  Send,
  Loader2,
  Sparkles,
  Smartphone,
  Mail,
  Sliders,
  AlertCircle,
  TrendingDown,
  FileText,
} from "lucide-react";
import { Button } from "./ui/button";
import { useApiQuery as useQuery, useApiMutation as useMutation } from "../hooks/useApi";
import { api } from "../lib/api";

interface AlertSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AlertSettingsModal({ isOpen, onClose }: AlertSettingsModalProps) {
  const currentSettings = useQuery(api.alertSettings.get);
  const saveSettings = useMutation(api.alertSettings.save);
  const sendTest = useMutation(api.alertSettings.sendTest);
  const testDigest = useMutation(api.alertSettings.testDigest);
  const [isTestingDigest, setIsTestingDigest] = useState(false);

  const [webhookUrl, setWebhookUrl] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [minScore, setMinScore] = useState(80);
  const [notifyHighScores, setNotifyHighScores] = useState(true);
  const [notifyPriceDrops, setNotifyPriceDrops] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [dailyDigest, setDailyDigest] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Sync state when settings are loaded from backend
  useEffect(() => {
    if (currentSettings) {
      setWebhookUrl(currentSettings.webhookUrl || "");
      setEmailAddress(currentSettings.emailAddress || "");
      setMinScore(currentSettings.minScore ?? 80);
      setNotifyHighScores(currentSettings.notifyHighScores !== false);
      setNotifyPriceDrops(currentSettings.notifyPriceDrops !== false);
      setEnabled(currentSettings.enabled !== false);
      setDailyDigest(currentSettings.dailyDigest === true);
    }
  }, [currentSettings]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await saveSettings({
        webhookUrl: webhookUrl.trim(),
        emailAddress: emailAddress.trim(),
        minScore,
        notifyHighScores,
        notifyPriceDrops,
        enabled,
        dailyDigest,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err: any) {
      alert(`保存に失敗しました: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Saves first: the report is built on GitHub from the saved settings, not this form.
  const handleTestDigest = async () => {
    if (!emailAddress.trim()) {
      alert("通知先メールアドレスを入力してください。");
      return;
    }
    setIsTestingDigest(true);
    setTestResult(null);
    try {
      await saveSettings({ webhookUrl: webhookUrl.trim(), emailAddress: emailAddress.trim(), minScore, notifyHighScores, notifyPriceDrops, enabled, dailyDigest });
      const res = await testDigest();
      setTestResult({ success: true, message: `新着物件レポート（直近24時間）を作成中です。1〜2分で ${res.emailAddress} に届きます。` });
    } catch (err) {
      setTestResult({ success: false, message: `レポートのテスト送信に失敗しました: ${(err as Error).message}` });
    } finally {
      setIsTestingDigest(false);
    }
  };

  const handleSendTest = async () => {
    if (!webhookUrl.trim() && !emailAddress.trim()) {
      alert("通知先メールアドレスを入力してください。");
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const res = (await sendTest({
        webhookUrl: webhookUrl.trim(),
        emailAddress: emailAddress.trim(),
        minScore,
      })) as { success: boolean; message: string };
      setTestResult({
        success: res.success,
        message: res.success ? "テスト通知の送信に成功しました！通知先をご確認ください。" : res.message,
      });
    } catch (err: any) {
      setTestResult({
        success: false,
        message: `テスト送信に失敗しました: ${err.message}`,
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl max-h-[92vh] flex flex-col rounded-3xl bg-white shadow-2xl border border-slate-200/80 overflow-hidden">
        {/* Modal Top Header (Cohesive Zephind / Map Aesthetic) */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-800 border border-emerald-100 shadow-2xs">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900">
                物件通知設定
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                高スコア・値下げ物件の即時通知と、毎朝の新着物件レポート
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/70">
          {/* Master Enabled Banner */}
          <div className="flex items-center justify-between p-4 rounded-2xl border border-emerald-100 bg-emerald-50/50 shadow-2xs">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-800 text-white shadow-xs">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">
                  通知を受け取る
                </div>
                <div className="text-xs text-slate-500">
                  オフにすると、即時通知と毎朝のレポートを含むすべての通知が停止します
                </div>
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-800"></div>
            </label>
          </div>

          {/* Everything below only applies while the master switch is on; the backend skips disabled users entirely. */}
          <fieldset disabled={!enabled} className={`min-w-0 space-y-4 transition-opacity ${enabled ? "" : "opacity-50"}`}>
          {/* Delivery Channels */}
          <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
            <h3 className="text-xs font-black tracking-wider text-slate-800 uppercase flex items-center gap-1.5">
              <Smartphone className="h-4 w-4 text-emerald-700" />
              通知先の設定
            </h3>

            {/* Email Address */}
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1.5">
                通知先メールアドレス（任意）
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  type="email"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                  placeholder="broker@example.com"
                  className="w-full h-10 pl-9 pr-3 text-xs font-medium rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:border-emerald-700 focus:ring-1 focus:ring-emerald-700 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Alert Conditions & Trigger Filters */}
          <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
            <h3 className="text-xs font-black tracking-wider text-slate-800 uppercase flex items-center gap-1.5">
              <Sliders className="h-4 w-4 text-emerald-700" />
              通知トリガー条件
            </h3>

            {/* Minimum AI Score Threshold */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-700">
                  通知を発動する最低AIスコア基準
                </span>
                <span className="text-sm font-black text-emerald-800 font-data">
                  {minScore}点 以上
                </span>
              </div>

              <div className="flex gap-2">
                {[70, 75, 80, 85, 90].map((score) => (
                  <button
                    key={score}
                    type="button"
                    onClick={() => setMinScore(score)}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                      minScore === score
                        ? "bg-emerald-800 text-white border-emerald-800 shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300"
                    }`}
                  >
                    {score}点{score === 80 ? " (推奨)" : ""}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                80点以上は相場比割安・高利回り・駅徒歩などの総合指標が極めて優秀なお宝物件です。
              </p>
            </div>

            {/* Checkboxes for notification events */}
            <div className="space-y-2.5 pt-3 border-t border-slate-100">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyHighScores}
                  onChange={(e) => setNotifyHighScores(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-800 focus:ring-emerald-700 accent-emerald-800"
                />
                <div>
                  <span className="text-xs font-bold text-slate-800">
                    高スコア新着物件の通知 ({minScore}点以上)
                  </span>
                  <p className="text-[11px] text-slate-500">
                    条件に合致し、AIスコアが基準値を超えた新着物件を即座に通知します。
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyPriceDrops}
                  onChange={(e) => setNotifyPriceDrops(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-800 focus:ring-emerald-700 accent-emerald-800"
                />
                <div>
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <TrendingDown className="h-3.5 w-3.5 text-rose-600" />
                    大幅値下げ物件の通知
                  </span>
                  <p className="text-[11px] text-slate-500">
                    価格改定（値下げ）が行われた売り急ぎ物件を優先的に通知します。
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dailyDigest}
                  onChange={(e) => setDailyDigest(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-800 focus:ring-emerald-700 accent-emerald-800"
                />
                <div>
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-emerald-700" />
                    毎朝の新着物件レポート (PDF)
                  </span>
                  <p className="text-[11px] text-slate-500">
                    毎日最初の自動検索（3:30頃）の後、オーダーごとの新着物件をまとめたPDFを通知先メールアドレスに送信します。
                  </p>
                  {dailyDigest && !emailAddress.trim() && (
                    <p className="mt-1 text-[11px] font-bold text-rose-600">通知先メールアドレスを入力してください。</p>
                  )}
                </div>
              </label>
            </div>
          </div>

          </fieldset>

          {/* Test Status Feedback */}
          {testResult && (
            <div
              className={`p-3.5 rounded-2xl border text-xs font-bold flex items-start gap-2.5 ${
                testResult.success
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-rose-50 border-rose-200 text-rose-800"
              }`}
            >
              {testResult.success ? (
                <Check className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div>{testResult.message}</div>
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 border-t border-slate-100 bg-white">
          <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleSendTest}
            disabled={isTesting || (!webhookUrl.trim() && !emailAddress.trim())}
            className="h-10 gap-2 rounded-xl text-xs font-bold border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            {isTesting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4 text-emerald-700" />
            )}
            テスト通知を送信
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleTestDigest}
            disabled={isTestingDigest || !emailAddress.trim()}
            className="h-10 gap-2 rounded-xl text-xs font-bold border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            {isTestingDigest ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4 text-emerald-700" />}
            PDFレポートをテスト送信
          </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="h-10 rounded-xl text-xs font-bold border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              閉じる
            </Button>

            <Button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="h-10 gap-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-bold text-xs shadow-sm min-w-[100px] transition-all"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : saveSuccess ? (
                <>
                  <Check className="h-4 w-4" />
                  保存完了
                </>
              ) : (
                "設定を保存"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
