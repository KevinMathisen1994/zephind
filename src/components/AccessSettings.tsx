import { useState } from "react";
import { Users, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "./ui/button";
import { useApiQuery as useQuery, useApiMutation as useMutation, SKIP } from "../hooks/useApi";
import { api } from "../lib/api";

interface AllowedEmail {
  _id: string;
  email: string;
  addedBy?: string | null;
}

/** Sign-in allowlist. Rendered for everyone, but only admins (ADMIN_EMAILS) see the list. */
export function AccessSettings() {
  const me = useQuery(api.access.me);
  const list = useQuery(api.access.list, me?.isAdmin ? undefined : SKIP) as AllowedEmail[] | undefined;
  const add = useMutation(api.access.add);
  const remove = useMutation(api.access.remove);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  if (!me) return null;
  // Without an email claim nobody can be recognised as admin, so explain instead of hiding silently.
  if (!me.email) {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        ログイン許可リスト: セッショントークンにメールアドレスが含まれていないため、管理者を判定できません。
        Clerk → Sessions → Customize session token に {'{"email": "{{user.primary_email_address}}"}'} を追加してください。
      </p>
    );
  }
  if (!me.isAdmin) return null;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await add({ email: email.trim() });
      setEmail("");
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (row: AllowedEmail) => {
    if (!confirm(`${row.email} のアクセスを削除しますか？`)) return;
    try {
      await remove({ id: row._id });
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[var(--border-subtle)] p-6 space-y-4 shadow-xs">
      <div className="pb-3 border-b border-[var(--border-subtle)]">
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-[var(--text-primary)]">
          <Users className="w-5 h-5 text-[var(--brand)]" />
          ログイン許可リスト
        </h2>
        <p className="text-xs text-[var(--text-muted)] font-medium mt-1">
          {me.enforced
            ? "リストにあるメールアドレスと管理者のみログインできます。"
            : "リストが空の間は誰でもログインできます。1件追加すると制限が有効になります。"}
        </p>
      </div>

      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          aria-label="許可するメールアドレス"
          className="min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm"
        />
        <Button type="submit" disabled={busy} className="shrink-0">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "追加"}
        </Button>
      </form>

      {list === undefined ? (
        <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
      ) : list.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">登録なし</p>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {list.map((row) => (
            <li key={row._id} className="flex items-center justify-between py-2 text-sm">
              <span className="truncate">{row.email}</span>
              <button
                type="button"
                onClick={() => handleRemove(row)}
                className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-red-50 hover:text-red-600"
                aria-label={`${row.email}を削除`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
