import { Component, type ReactNode } from "react";

/**
 * Convex's useQuery throws during render when a query rejects, which takes the
 * whole tree down. The most likely rejection right after enabling per-user data
 * isolation is "not signed in" caused by a missing Clerk JWT template — a
 * configuration problem, not a code bug. A white screen with a stack trace in
 * the console is the least useful way to communicate that, so catch it and say
 * what to do.
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
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12">
        <div className="max-w-xl w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
          <h1 className="text-xl font-extrabold text-slate-900">
            {isAuthError ? "認証の設定が未完了です" : "エラーが発生しました"}
          </h1>

          {isAuthError ? (
            <>
              <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                ログインは成功していますが、バックエンド（Convex）が認証トークンを
                受け取れていません。Clerk 側の JWT テンプレートを作成すると解決します。
              </p>
              <ol className="mt-4 space-y-2 text-sm text-slate-700 list-decimal list-inside">
                <li>Clerk ダッシュボード → JWT Templates → New template</li>
                <li>テンプレート「Convex」を選択</li>
                <li>
                  名前を <code className="px-1 py-0.5 rounded bg-slate-100 font-mono text-xs">convex</code>{" "}
                  に設定（小文字・完全一致）
                </li>
                <li>保存後、このページを再読み込み</li>
              </ol>
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              予期しないエラーです。詳細はブラウザのコンソールを確認してください。
            </p>
          )}

          <pre className="mt-5 p-3 rounded-xl bg-slate-900 text-slate-100 text-xs overflow-x-auto whitespace-pre-wrap">
            {error.message}
          </pre>

          <button
            onClick={() => window.location.reload()}
            className="mt-5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold"
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }
}
