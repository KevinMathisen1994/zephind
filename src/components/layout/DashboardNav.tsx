import { NavLink } from "react-router-dom";
import {
  FileCheck2,
  Sliders,
  Building,
  CheckCircle2,
  ChevronRight,
  Users,
  Handshake,
} from "lucide-react";

const navItems = [
  {
    to: "/orders",
    label: "買主オーダー管理",
    description: "希望条件と自動マッチング",
    icon: FileCheck2,
  },
  {
    to: "/customers",
    label: "顧客管理",
    description: "買主・クライアント情報",
    icon: Users,
  },
  {
    to: "/deals",
    label: "案件・提案管理",
    description: "提案履歴と成約進捗",
    icon: Handshake,
  },
  {
    to: "/admin",
    label: "スクレイピング・管理",
    description: "データ収集とシステム設定",
    icon: Sliders,
  },
];

export default function DashboardNav() {
  return (
    <aside className="w-72 min-h-screen bg-white text-slate-900 border-r border-slate-200 flex flex-col shadow-sm select-none z-20">
      {/* Brand Header */}
      <div className="p-6 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-700 flex items-center justify-center shadow-md shadow-emerald-700/20">
            <Building className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
              Zephind
            </h1>
            <p className="text-xs text-slate-500 font-semibold tracking-wide mt-0.5">
              不動産インテリジェンス
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `group relative flex items-center justify-between p-3.5 rounded-xl text-base font-semibold transition-all duration-200 ${
                isActive
                  ? "bg-emerald-50 text-emerald-900 border border-emerald-200/80 shadow-sm font-bold"
                  : "text-slate-700 hover:bg-slate-100/80 hover:text-slate-900"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <div className="flex items-center gap-3.5">
                  <div
                    className={`p-2 rounded-lg transition-colors ${
                      isActive
                        ? "bg-emerald-700 text-white shadow-sm"
                        : "bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700"
                    }`}
                  >
                    <item.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-base leading-snug">{item.label}</div>
                    <div
                      className={`text-xs font-normal ${
                        isActive
                          ? "text-emerald-700 font-medium"
                          : "text-slate-400 group-hover:text-slate-500"
                      }`}
                    >
                      {item.description}
                    </div>
                  </div>
                </div>
                <ChevronRight
                  className={`w-4 h-4 transition-transform duration-200 ${
                    isActive
                      ? "text-emerald-700 translate-x-0.5"
                      : "text-slate-400 group-hover:text-slate-600"
                  }`}
                />
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer Info */}
      <div className="p-4 m-4 rounded-xl bg-emerald-50/60 border border-emerald-100">
        <div className="flex items-center gap-2 text-xs font-bold text-emerald-900 mb-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          全14サイト 自動収集対応
        </div>
        <p className="text-[11px] text-emerald-800/80 leading-relaxed font-medium">
          住友・三井・東急・野村・みずほ・三菱UFJ・小田急・京王・朝日・長谷工・大京・東京建物・LIFULL
        </p>
      </div>
    </aside>
  );
}
