import { useState } from "react";
import { Outlet } from "react-router-dom";
import DashboardNav from "./DashboardNav";
import { Menu, X } from "lucide-react";

export default function DashboardLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-page)] font-sans text-[var(--text-primary)] antialiased">
      {/* Mobile nav overlay */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-[#121815]/35 backdrop-blur-sm transition-opacity duration-200 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden
        />
      )}

      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between bg-[#17150f] px-4 lg:hidden">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-[3px] bg-[var(--brand)] text-white">
            <span className="font-serif text-[15px] leading-none">Z</span>
          </div>
          <span className="font-serif text-[18px] leading-none tracking-[0.01em] text-[#f4efe6]">
            Zephind
          </span>
        </div>
        <button
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
          className="-mr-1 rounded-[4px] p-2 text-[#b7b0a4] transition-colors hover:bg-white/10 hover:text-[#f7f3ea]"
          aria-label={mobileNavOpen ? "メニューを閉じる" : "メニューを開く"}
          aria-expanded={mobileNavOpen}
        >
          {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {/* Sidebar */}
      <div
        className={`${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        } fixed inset-y-0 left-0 z-40 h-full shrink-0 transition-transform duration-300 ease-out lg:static lg:translate-x-0`}
      >
        <DashboardNav onNavClick={() => setMobileNavOpen(false)} />
      </div>

      {/* Main content */}
      <main className="app-bg min-w-0 flex-1 overflow-y-auto pt-14 lg:pt-0">
        <Outlet />
      </main>
    </div>
  );
}