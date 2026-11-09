import { NavLink, useNavigate } from "react-router-dom";
import { useApiQuery as useQuery } from "../../hooks/useApi";
import { api } from "../../lib/api";
import { useClerk, useUser } from "@clerk/clerk-react";
import { isClerkEnabled } from "../../Providers";
import { LogOut, Plus } from "lucide-react";

const navSections = [
  {
    label: "探す",
    items: [
      { to: "/orders", label: "物件検索", desc: "条件登録と自動マッチング" },
      { to: "/map", label: "地図分析", desc: "東京広域・水害ハザード" },
      { to: "/saved", label: "保存物件", desc: "検討中のお気に入り" },
    ],
  },
  {
    label: "営業",
    items: [
      { to: "/customers", label: "顧客管理", desc: "買主プロファイル" },
      { to: "/deals", label: "案件・提案管理", desc: "提案履歴と成約進捗" },
    ],
  },
  {
    label: "設定",
    items: [{ to: "/admin", label: "検索・管理", desc: "収集とシステム設定" }],
  },
];

// 検索・管理 is a local-only tool, so its section is hidden on deployed hosts.
const IS_LOCALHOST = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
  window.location.hostname,
);
const visibleSections = navSections.filter((s) => s.label !== "設定" || IS_LOCALHOST);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Clerk hooks throw unless a ClerkProvider is mounted, so the account footer
 * lives in its own component and is only rendered when auth is configured.
 */
function NavAccount() {
  const { signOut } = useClerk();
  const { user, isLoaded } = useUser();

  const avatarLetter = (user?.primaryEmailAddress?.emailAddress || user?.fullName || "?")
    .charAt(0)
    .toUpperCase();

  return (
    <div className="border-t border-white/10 p-3">
      <div className="flex items-center gap-2.5 rounded-[4px] px-2 py-2">
        {isLoaded && user?.imageUrl ? (
          <img
            src={user.imageUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded-[10px] object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#5b3fc4] font-mono text-[15px] font-semibold text-white">
            {avatarLetter}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-medium leading-tight text-[#efe9dd]">
            {!isLoaded ? "読み込み中..." : user?.fullName || user?.username || "ログイン中"}
          </div>
          <div
            className="mt-1 truncate font-mono text-[12.5px] leading-tight text-[#7d7568]"
            title={user?.primaryEmailAddress?.emailAddress || ""}
          >
            {user?.primaryEmailAddress?.emailAddress || "—"}
          </div>
        </div>
        <button
          onClick={() => signOut({ redirectUrl: "/" })}
          title="ログアウト"
          aria-label="ログアウト"
          className="rounded-[4px] p-1.5 text-[#7d7568] transition-colors hover:bg-white/10 hover:text-[#f4efe6]"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function DashboardNav({ onNavClick }: { onNavClick?: () => void }) {
  const navigate = useNavigate();
  const matches = useQuery(api.matching.list) as any[] | undefined;
  const total = matches?.length ?? 0;
  const fresh = (matches ?? []).filter((m) => Date.now() - (m._creationTime ?? 0) <= DAY_MS);
  const freshHigh = fresh.filter((m) => (m.score ?? 0) >= 80).length;

  return (
    <aside className="sidebar-surface z-20 flex h-full w-[248px] shrink-0 select-none flex-col overflow-y-auto">
      <div className="px-5 pb-5 pt-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center" aria-hidden>
            <svg viewBox="0 0 24 24" className="h-9 w-9 text-emerald-400" fill="currentColor">
              <path d="M11 11C10 6 7 3 3.500 3.500 2.500 6 4 10 8 12c1 .5 2 .2 3-1z" />
              <path d="M13 11c1-5 4-8 7.500-7.500C21.500 6 20 10 16 12c-1 .5-2 .2-3-1z" />
              <path d="M10.500 13.500C8 12.500 5 14 5 17c0 2.500 2.500 4 4.500 3 1.500-.8 2-3.500 1-6.500z" />
              <path d="M13.500 13.500c2.500-1 5.500.5 5.500 3.500 0 2.500-2.500 4-4.500 3-1.500-.8-2-3.500-1-6.500z" />
            </svg>
          </div>
          <h1 className="text-[22px] font-bold leading-none tracking-[-0.01em] text-white">
            Zephinder
          </h1>
        </div>
      </div>

            <div className="px-3 pt-4">
        <button
          type="button"
          data-tour="new-search"
          onClick={() => {
            navigate("/orders?new=1");
            onNavClick?.();
          }}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[var(--brand)] py-2 text-[14px] font-bold text-white transition-colors hover:bg-[var(--brand-hover)]"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          新しい検索を作成
        </button>
      </div>

      <nav className="flex-1 px-3 pb-4 pt-2">
        {visibleSections.map((section) => (
          <div key={section.label} className="pt-4">
            <p className="mb-1.5 px-3 text-[12px] font-medium text-[#79827b]">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  data-tour={`nav${item.to}`}
                  onClick={onNavClick}
                  title={item.desc}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-150 ${
                      isActive
                        ? "bg-[#262b27] text-white"
                        : "text-[#b4bab5] hover:bg-white/[0.05] hover:text-white"
                    }`
                  }
                >
                  <span className="flex-1 text-[14px] font-bold leading-tight">{item.label}</span>
                  {item.to === "/orders" && total > 0 && (
                    <span className="text-[12.5px] font-bold leading-none text-[#d6dbd7]">{total}</span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {fresh.length > 0 && (
        <button
          type="button"
          onClick={() => {
            navigate("/orders");
            onNavClick?.();
          }}
          className="mx-5 mb-3 cursor-pointer border-t border-white/[0.09] pb-2 pt-4 text-left text-white"
        >
          <p className="text-[12.5px] text-[#79827b]">本日の新着</p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[34px] font-bold leading-none">{fresh.length}</span>
            <span className="text-sm">件</span>
          </p>
          <p className="mt-1.5 text-[12.5px] text-[#79827b]">高評価（80点以上）{freshHigh}件</p>
        </button>
      )}

      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("zephind:start-tour"))}
        className="mx-5 mb-3 cursor-pointer text-left text-[12.5px] text-[#79827b] transition-colors hover:text-white"
      >
        使い方ガイド
      </button>

      {isClerkEnabled ? (
        <NavAccount />
      ) : (
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5 rounded-[4px] px-2 py-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#5b3fc4] font-mono text-[15px] font-semibold text-white">
              Z
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14.5px] font-medium leading-tight text-[#efe9dd]">
                ローカルモード
              </div>
              <div className="mt-1 truncate font-mono text-[12.5px] leading-tight text-[#7d7568]">
                認証なしで実行中
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
