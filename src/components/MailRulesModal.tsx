import { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, SlidersHorizontal, X } from "lucide-react";
import { useApiQuery as useQuery, useApiMutation as useMutation } from "../hooks/useApi";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Label } from "./ui/label";

const FIELDS = [
  {
    key: "requiredKeywords" as const,
    label: "必須ワード",
    hint: "件名か本文にこのいずれかを含むメールだけを読み取ります。空欄ならすべて読み取ります。",
    placeholder: "物件\n物件概要\n売買価格",
  },
  {
    key: "blockedKeywords" as const,
    label: "除外ワード",
    hint: "このいずれかを含むメールは読み取りません。",
    placeholder: "メルマガ\nセミナー\nPremium deal",
  },
  {
    key: "allowedSenders" as const,
    label: "許可する送信者",
    hint: "入力すると、この送信者からのメールだけを読み取ります。@以下だけでも指定できます。",
    placeholder: "@baseltd.co.jp\ninagaki@xialead.co.jp",
  },
  {
    key: "blockedSenders" as const,
    label: "除外する送信者",
    hint: "この送信者からのメールは読み取りません。",
    placeholder: "@marketing.going.com\nnoreply@",
  },
];

/**
 * Which incoming mail the sync reads. Each rule list is one word/address per line; brokers change often
 * enough that a tag editor would be more ceremony than the job needs. Mount it only while open.
 */
type Props = { onClose: () => void; onSaved: () => void; onError: (message: string) => void };

export function MailRulesModal(props: Props) {
  const ingestSettings = useQuery(api.mailIngestData.getIngestSettings);
  // The form seeds its fields once from the row, so it mounts only after the row loads.
  if (ingestSettings === undefined) return null;
  return <MailRulesForm initial={ingestSettings} {...props} />;
}

function MailRulesForm({
  initial, onClose, onSaved, onError,
}: Props & {
  initial: {
    requiredKeywords?: string[];
    blockedKeywords?: string[];
    allowedSenders?: string[];
    blockedSenders?: string[];
    requireAttachment?: boolean;
  } | null;
}) {
  const saveIngestSettings = useMutation(api.mailIngestData.saveIngestSettings);
  const [saving, setSaving] = useState(false);
  const [rules, setRules] = useState(() => ({
    requiredKeywords: (initial?.requiredKeywords ?? []).join("\n"),
    blockedKeywords: (initial?.blockedKeywords ?? []).join("\n"),
    allowedSenders: (initial?.allowedSenders ?? []).join("\n"),
    blockedSenders: (initial?.blockedSenders ?? []).join("\n"),
    requireAttachment: initial?.requireAttachment ?? false,
  }));

  const save = async () => {
    setSaving(true);
    try {
      const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);
      await saveIngestSettings({
        requiredKeywords: lines(rules.requiredKeywords),
        blockedKeywords: lines(rules.blockedKeywords),
        allowedSenders: lines(rules.allowedSenders),
        blockedSenders: lines(rules.blockedSenders),
        requireAttachment: rules.requireAttachment,
      });
      onSaved();
      onClose();
    } catch (err) {
      onError(`設定の保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  // Portaled: .page-shell children animate with a transform, which would make `fixed` relative to the page, not the viewport.
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-md flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mail-rules-title"
        className="bg-white rounded-3xl shadow-ambient border border-[var(--border-subtle)] w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="p-5 border-b border-[var(--border-subtle)] bg-[var(--bg-page-subtle)] flex items-center justify-between">
          <div>
            <h3 id="mail-rules-title" className="text-base font-extrabold text-[var(--text-primary)] flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4" />
              メール取り込み設定
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              どのメールを物件情報として読み取るかを決めます。1行に1つ入力してください。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <Label htmlFor={`mail-rule-${f.key}`} className="text-xs font-bold text-[var(--text-primary)]">
                {f.label}
              </Label>
              <p className="text-[14px] text-[var(--text-muted)] mt-0.5 mb-1.5">{f.hint}</p>
              <textarea
                id={`mail-rule-${f.key}`}
                rows={4}
                value={rules[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => setRules((prev) => ({ ...prev, [f.key]: e.target.value }))}
                className="w-full text-xs rounded-xl border border-[var(--border-subtle)] bg-white px-3 py-2 font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30"
              />
            </div>
          ))}

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={rules.requireAttachment}
              onChange={(e) => setRules((prev) => ({ ...prev, requireAttachment: e.target.checked }))}
              className="mt-0.5 w-4 h-4 accent-[var(--brand)]"
            />
            <span>
              <span className="block text-xs font-bold text-[var(--text-primary)]">
                添付ファイルのあるメールだけを読み取る
              </span>
              <span className="block text-[14px] text-[var(--text-muted)]">
                マイソクを必ず添付する会社だけを対象にしたい場合に使います。本文だけで物件を紹介するメールは除外されます。
              </span>
            </span>
          </label>
        </div>

        <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-page-subtle)] flex items-center justify-between gap-3">
          <p className="text-[14px] text-[var(--text-muted)]">
            除外済みのメールは、次回の同期で新しい設定により再判定されます。
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onClose} className="h-8 px-3 text-xs font-bold rounded-lg">
              キャンセル
            </Button>
            <Button
              size="sm"
              disabled={saving}
              onClick={() => void save()}
              className="h-8 px-3 text-xs font-bold rounded-lg gap-1.5"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              保存
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
