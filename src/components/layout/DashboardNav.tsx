import { NavLink } from "react-router-dom";
import { useClerk, useUser } from "@clerk/clerk-react";
import { isClerkEnabled } from "../../Providers";
import {
  FileCheck2,
  Sliders,
  Building,
  Users,
  Handshake,
  LogOut,
  Star,
} from "lucide-react";

const navItems = [
  { to: "/orders",    label: "物件検索",       desc: "条件登録と自動マッチング", icon: FileCheck2 },
  { to: "/saved",     label: "保存物件",       desc: "検討中のお気に入り",       icon: Star },
  { to: "/customers", label: "顧客管理",       desc: "買主プロファイル",           icon: Users },
  { to: "/deals",     label: "案件・提案管理", desc: "提案履歴と成約進捗",         icon: Handshake },
  { to: "/admin",     label: "検索・管理",     desc: "収集とシステム設定",         icon: Sliders },
];

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
            className="h-7 w-7 shrink-0 rounded-[4px] object-cover"
          />
        ) : (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] bg-white/10 font-mono text-[10px] font-semibold text-[#d8d1c4]">
            {avatarLetter}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11.5px] font-medium leading-tight text-[#efe9dd]">
            {!isLoaded ? "読み込み中..." : user?.fullName || user?.username || "ログイン中"}
          </div>
          <div
            className="mt-1 truncate font-mono text-[9px] leading-tight text-[#7d7568]"
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
  return (
    <aside className="sidebar-surface z-20 flex h-full w-[248px] shrink-0 select-none flex-col overflow-y-auto">
      <div className="px-5 pb-5 pt-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[4px] bg-[var(--brand)] text-white">
            <Building className="h-[17px] w-[17px]" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="font-serif text-[23px] leading-none tracking-[0.01em] text-[#f4efe6]">
              Zephind
            </h1>
            <p className="mt-1.5 font-mono text-[8.5px] uppercase leading-none tracking-[0.22em] text-[#8c8478]">
              Property Intel
            </p>
          </div>
        </div>
      </div>

      <div className="mx-5 h-px bg-white/[0.09]" />

      <nav className="flex-1 px-2 py-5">
        <p className="mb-2.5 px-3 font-mono text-[8.5px] uppercase tracking-[0.24em] text-[#6b6458]">
          Workspace
        </p>
        <div className="space-y-0.5">
          {navItems.map((item, index) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavClick}
              title={item.desc}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-[4px] py-2.5 pl-3.5 pr-2 transition-colors duration-150 ${
                  isActive
                    ? "bg-white/[0.07] text-[#f7f3ea]"
                    : "text-[#b7b0a4] hover:bg-white/[0.04] hover:text-[#f7f3ea]"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden
                    className={`absolute inset-y-1 -left-2 w-[2px] rounded-full transition-opacity ${
                      isActive ? "bg-[var(--brand)] opacity-100" : "opacity-0"
                    }`}
                  />
                  <item.icon
                    className={`h-[15px] w-[15px] shrink-0 transition-colors ${
                      isActive
                        ? "text-[var(--brand)]"
                        : "text-[#7d7568] group-hover:text-[#b7b0a4]"
                    }`}
                    strokeWidth={2}
                  />
                  <span className="flex-1 text-[12.5px] font-medium leading-tight tracking-[0.01em]">
                    {item.label}
                  </span>
                  <span className="font-mono text-[8.5px] tracking-[0.1em] text-[#5d564b]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {isClerkEnabled ? (
        <NavAccount />
      ) : (
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5 rounded-[4px] px-2 py-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] bg-white/10 font-mono text-[10px] font-semibold text-[#d8d1c4]">
              Z
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11.5px] font-medium leading-tight text-[#efe9dd]">
                ローカルモード
              </div>
              <div className="mt-1 truncate font-mono text-[9px] leading-tight text-[#7d7568]">
                認証なしで実行中
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

