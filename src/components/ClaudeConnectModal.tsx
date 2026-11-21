import { useState } from "react";
import { X, Sparkles, Copy, Check, Trash2, Loader2, KeyRound } from "lucide-react";
import { Button } from "./ui/button";
import { useApiQuery as useQuery, useApiMutation as useMutation } from "../hooks/useApi";
import { api } from "../lib/api";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || window.location.origin;

interface ClaudeConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface McpKey {
  _id: string;
  _creationTime: number;
  label: string;
  keyPrefix: string;
  lastUsedAt?: number | null;
}

export function ClaudeConnectModal({ isOpen, onClose }: ClaudeConnectModalProps) {
  const keys = useQuery(api.mcpKeys.list) as McpKey[] | undefined;
  const createKey = useMutation(api.mcpKeys.create);
  const removeKey = useMutation(api.mcpKeys.remove);

  const [label, setLabel] = useState("");
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    // The URL is shown once; don't keep it around after the modal closes.
    setNewUrl(null);
    setCopied(false);
    onClose();
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const { key } = await createKey({ label: label.trim() || "Claude" });
      setNewUrl(`${API_BASE}/api/mcp/${key}`);
      setLabel("");
    } catch (err: any) {
      alert(`発行に失敗しました: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!newUrl) return;
    await navigator.clipboard.writeText(newUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRemove = async (k: McpKey) => {
    if (!confirm(`「${k.label}」を無効化しますか？このURLを使っているClaudeは接続できなくなります。`)) return;
    try {
      await removeKey({ id: k._id });
    } catch (err: any) {
      alert(`削除に失敗しました: ${err.message}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="claude-connect-title"
    >
      <div className="relative w-full max-w-xl max-h-[92vh] flex flex-col rounded-3xl bg-white shadow-2xl border border-slate-200/80 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-800 border border-emerald-100">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 id="claude-connect-title" className="text-base font-bold tracking-tight text-slate-900">
                Claude連携
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Claudeから物件データベースを検索・現地ページを確認できるようにします
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="閉じる"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/70">
          <ol className="space-y-1.5 rounded-2xl border border-slate-200/80 bg-white p-5 text-sm text-slate-700 list-decimal list-inside">
            <li>下の「接続URLを発行」を押してURLをコピー</li>
            <li>Claude（デスクトップ / Web）の「設定 → コネクタ → カスタムコネクタを追加」を開く</li>
            <li>名前に「Zephind」、URLに貼り付けて追加</li>
            <li>チャットで「世田谷区で1.5億以下、利回り6%以上の一棟アパートを探して」のように依頼</li>
          </ol>

          <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-5">
            {newUrl ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-amber-700">
                  このURLは今だけ表示されます。パスワードと同様に扱い、他人と共有しないでください。
                </p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={newUrl}
                    onFocus={(e) => e.target.select()}
                    aria-label="接続URL"
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800"
                  />
                  <Button type="button" onClick={handleCopy} className="shrink-0">
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    <span className="ml-1">{copied ? "コピー済み" : "コピー"}</span>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="名前（例: 会社PC）"
                  aria-label="接続の名前"
                  maxLength={60}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <Button type="button" onClick={handleCreate} disabled={creating} className="shrink-0">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  <span className="ml-1">接続URLを発行</span>
                </Button>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-5">
            <h3 className="mb-2 text-xs font-bold text-slate-800">発行済みの接続</h3>
            {keys === undefined ? (
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            ) : keys.length === 0 ? (
              <p className="text-xs text-slate-500">まだありません</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {keys.map((k) => (
                  <li key={k._id} className="flex items-center justify-between py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-800">{k.label}</div>
                      <div className="text-xs text-slate-500">
                        {k.keyPrefix}… ・ 最終利用{" "}
                        {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("ja-JP") : "なし"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(k)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={`${k.label}を無効化`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
