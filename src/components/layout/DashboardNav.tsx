import { NavLink } from "react-router-dom";
import { useClerk, useUser } from "@clerk/clerk-react";
import {
  FileCheck2,
  Sliders,
  Building,
  Users,
  Handshake,
  LogOut,
} from "lucide-react";

const navItems = [
  { to: "/orders",    label: "物件検索",       desc: "希望条件と自動マッチング", icon: FileCheck2 },
  { to: "/customers", label: "顧客管理",       desc: "買主情報",                  icon: Users },
  { to: "/deals",     label: "案件・提案管理", desc: "提案履歴と成約進捗",        icon: Handshake },
  { to: "/admin",     label: "検索・管理",     desc: "データ収集とシステム設定",  icon: Sliders },
];

export default function DashboardNav({ onNavClick }: { onNavClick?: () => void }) {
  const { signOut } = useClerk();
  const { user, isLoaded } = useUser();

  const avatarLetter = (user?.primaryEmailAddress?.emailAddress || user?.fullName || "?")
    .charAt(0)
    .toUpperCase();

  return (
    <aside className="w-64 h-full shrink-0 overflow-y-auto bg-white flex flex-col select-none z-20 border-r border-[var(--border-subtle)]">
      {/* ── Brand ── */}
      <div className="px-5 pt-6 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--brand)] flex items-center justify-center"
               style={{ boxShadow: "0 4px 12px rgba(26,113,0,0.2)" }}>
            <Building className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-[var(--text-primary)] leading-none">
              Zephind
            </h1>
            <p className="text-[11px] text-[var(--text-muted)] font-medium tracking-wide mt-0.5">
              不動産インテリジェンス
            </p>
          </div>
        </div>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavClick}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all duration-150 ${
                isActive
                  ? "bg-[var(--brand-soft)] text-[var(--brand)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                    isActive
                      ? "bg-[var(--brand)] text-white"
                      : "bg-[#f1f3f1] text-[var(--text-muted)] group-hover:bg-[#e4e7e4] group-hover:text-[var(--text-secondary)]"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                </span>
                <span className="flex flex-col leading-tight">
                  <span>{item.label}</span>
                  <span className="text-[11px] font-medium text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
                    {item.desc}
                  </span>
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Footer: user + logout ── */}
      <div className="px-3 pb-3 space-y-2">
        {/* User pill */}
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[var(--bg-surface-hover)]">
          {isLoaded && user?.imageUrl ? (
            <img src={user.imageUrl} alt="" className="w-7 h-7 rounded-full shrink-0 object-cover ring-2 ring-white" />
          ) : (
            <div className="w-7 h-7 rounded-full shrink-0 bg-[var(--brand)] text-white flex items-center justify-center text-[11px] font-bold">
              {avatarLetter}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-[var(--text-primary)] truncate leading-tight">
              {!isLoaded ? "読み込み中..." : user?.fullName || user?.username || "ログイン中"}
            </div>
            <div
              className="text-[10px] text-[var(--text-muted)] truncate font-medium leading-tight"
              title={user?.primaryEmailAddress?.emailAddress || ""}
            >
              {user?.primaryEmailAddress?.emailAddress || "—"}
            </div>
          </div>
        </div>

        <button
          onClick={() => signOut({ redirectUrl: "/" })}
          className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-xs font-bold text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 transition-all duration-150"
        >
          <LogOut className="w-4 h-4" />
          <span>ログアウト</span>
        </button>
      </div>
    </aside>
  );
}
