import { NavLink } from "react-router-dom";
import { useClerk, useUser } from "@clerk/clerk-react";
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
  { to: "/orders",    label: "物件検索",       desc: "希望条件と自動マッチング", icon: FileCheck2 },
  { to: "/saved",     label: "保存物件",       desc: "検討中のお気に入り一覧",   icon: Star },
  { to: "/customers", label: "顧客管理",       desc: "買主プロファイル管理",     icon: Users },
  { to: "/deals",     label: "案件・提案管理", desc: "提案履歴と成約進捗",       icon: Handshake },
  { to: "/admin",     label: "検索・管理",     desc: "データ収集とシステム設定", icon: Sliders },
];

export default function DashboardNav({ onNavClick }: { onNavClick?: () => void }) {
  const { signOut } = useClerk();
  const { user, isLoaded } = useUser();

  const avatarLetter = (user?.primaryEmailAddress?.emailAddress || user?.fullName || "?")
    .charAt(0)
    .toUpperCase();

  return (
    <aside className="w-68 h-full shrink-0 overflow-y-auto bg-white/95 backdrop-blur-md flex flex-col select-none z-20 border-r border-[var(--border-subtle)] shadow-[1px_0_12px_rgba(0,0,0,0.02)]">
      <div className="px-6 pt-7 pb-6">
        <div className="flex items-center gap-3.5">
          <div
            className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[var(--brand)] to-[var(--brand-hover)] flex items-center justify-center shadow-[0_4px_16px_rgba(22,101,3,0.25),inset_0_1px_1px_rgba(255,255,255,0.3)] transition-transform hover:scale-105"
          >
            <Building className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-xl font-extrabold tracking-tight text-[var(--text-primary)] leading-none font-sans">
                Zephind
              </h1>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-[var(--brand-soft)] text-[10px] font-bold text-[var(--brand)] border border-[var(--brand-border)]">
                PRO
              </span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] font-medium tracking-wide mt-1">
              不動産インテリジェンス
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3.5 space-y-1.5">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavClick}
            className={({ isActive }) =>
              `group relative flex items-center gap-3 px-3.5 py-3 rounded-2xl text-sm font-bold transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                isActive
                  ? "bg-[var(--brand-soft)] text-[var(--brand)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_2px_8px_rgba(22,101,3,0.06)] border border-[var(--brand-border)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] border border-transparent"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`flex items-center justify-center w-8 h-8 rounded-xl transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                    isActive
                      ? "bg-[var(--brand)] text-white shadow-[0_2px_8px_rgba(22,101,3,0.3)] scale-105"
                      : "bg-[#edf1ed] text-[var(--text-muted)] group-hover:bg-[#e1e7e1] group-hover:text-[var(--text-primary)] group-hover:scale-105"
                  }`}
                >
                  <item.icon className="w-4 h-4 transition-transform group-hover:scale-110" />
                </span>
                <span className="flex flex-col leading-tight min-w-0">
                  <span className="tracking-tight">{item.label}</span>
                  {item.desc && (
                    <span className="text-[11px] font-medium text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] truncate mt-0.5">
                      {item.desc}
                    </span>
                  )}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 pb-4 space-y-2.5">
        <div className="flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-[var(--bg-page-subtle)] border border-[var(--border-subtle)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.8)]">
          {isLoaded && user?.imageUrl ? (
            <img
              src={user.imageUrl}
              alt=""
              className="w-8 h-8 rounded-xl shrink-0 object-cover ring-2 ring-white shadow-xs"
            />
          ) : (
            <div className="w-8 h-8 rounded-xl shrink-0 bg-[var(--brand)] text-white flex items-center justify-center text-xs font-extrabold shadow-xs">
              {avatarLetter}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-[var(--text-primary)] truncate leading-tight">
              {!isLoaded ? "読み込み中..." : user?.fullName || user?.username || "ログイン中"}
            </div>
            <div
              className="text-[10px] text-[var(--text-muted)] truncate font-medium leading-tight mt-0.5"
              title={user?.primaryEmailAddress?.emailAddress || ""}
            >
              {user?.primaryEmailAddress?.emailAddress || "—"}
            </div>
          </div>
        </div>

        <button
          onClick={() => signOut({ redirectUrl: "/" })}
          className="flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-xl text-xs font-bold text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50/80 transition-all duration-200"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>ログアウト</span>
        </button>
      </div>
    </aside>
  );
}

