import { NavLink } from "react-router-dom";
import {
  Package,
  Building2,
  FileText,
  Settings,
} from "lucide-react";

const navItems = [
  { to: "/orders", label: "オーダー", icon: Package },
  { to: "/properties", label: "物件", icon: Building2 },
  { to: "/proposals", label: "提案", icon: FileText },
  { to: "/admin", label: "管理", icon: Settings },
];

export default function DashboardNav() {
  return (
    <aside className="w-64 min-h-screen bg-white border-r border-border flex flex-col shadow-sm">
      <div className="p-5 border-b border-border">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-primary">
          Zephind
        </h1>
        <p className="text-xs text-muted-foreground/60 mt-1 tracking-wide uppercase">
          不動産インテリジェンス
        </p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 text-sm transition-all duration-200 ${
                isActive
                  ? "bg-primary text-primary-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`
            }
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-border">
        <p className="text-xs text-muted-foreground/40">v0.1.0</p>
      </div>
    </aside>
  );
}