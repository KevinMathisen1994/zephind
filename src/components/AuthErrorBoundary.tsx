import { Component, type ReactNode } from "react";

/**
 * Queries throw during render when they reject (TanStack is configured with
 * throwOnError for exactly this), which would otherwise take the whole tree
 * down. The most likely rejection is "not signed in" caused by the backend not
 * accepting the Clerk token — a configuration problem, not a code bug. A white
 * screen with a stack trace in the console is the least useful way to
 * communicate that, so catch it and say what to check.
 */
type Props = { children: ReactNode };
type State = { error: Error | null };

export class AuthErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[AuthErrorBoundary]", error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isAuthError = /未認証|Not signed in|getUserIdentity|Unauthenticated/i.test(
      error.message || "",
    );

    return (
      <div className="app-bg flex min-h-screen items-center justify-center px-4 py-12">
        <div className="w-full max-w-xl rounded-2xl border border-[var(--border-subtle)] bg-white p-8 shadow-sm">
          <h1 className="text-xl font-bold tracking-[-0.02em] text-[var(--text-primary)]">
            {isAuthError ? "認証の設定が未完了です" : "エラーが発生しました"}
          </h1>

          {isAuthError ? (
            <>
              <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                ログインは成功していますが、バックエンドが認証トークンを受け取れていません。
                サーバー側の設定を確認してください（バックエンドのログに理由が出力されます）。
              </p>
              <ol className="mt-4 space-y-2 text-sm text-slate-700 list-decimal list-inside">
                <li>
                  バックエンドが起動しているか（
                  <code className="px-1 py-0.5 rounded bg-slate-100 font-mono text-xs">
                    {import.meta.env.VITE_API_URL || "VITE_API_URL 未設定"}
                  </code>
                  ）
                </li>
                <li>
                  <code className="px-1 py-0.5 rounded bg-slate-100 font-mono text-xs">CLERK_FRONTEND_API_URL</code>{" "}
                  が Clerk の Frontend API URL と一致しているか
                </li>
                <li>
                  <code className="px-1 py-0.5 rounded bg-slate-100 font-mono text-xs">CLERK_JWT_AUDIENCE</code>{" "}
                  が空であるか（既定のセッショントークンには aud が無いため）
                </li>
                <li>設定変更後、バックエンドを再起動してこのページを再読み込み</li>
              </ol>
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              予期しないエラーです。詳細はブラウザのコンソールを確認してください。
            </p>
          )}

          <pre className="mt-5 overflow-x-auto whitespace-pre-wrap rounded-xl bg-[#121815] p-3 font-mono text-xs text-[#e6ece8]">
            {error.message}
          </pre>

          <button
            onClick={() => window.location.reload()}
            className="mt-5 cursor-pointer rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-hover)]"
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }
}
