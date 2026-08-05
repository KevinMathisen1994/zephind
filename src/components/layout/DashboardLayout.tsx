import { useState } from "react";
import { Outlet } from "react-router-dom";
import DashboardNav from "./DashboardNav";
import { Menu, X } from "lucide-react";

export default function DashboardLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-page)] text-[var(--text-primary)] font-sans">
      {/* Mobile nav overlay — backdrop blur for depth */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-30 lg:hidden transition-opacity duration-300"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Mobile toggle */}
      <button
        onClick={() => setMobileNavOpen(!mobileNavOpen)}
        className={`fixed top-4 z-40 lg:hidden p-2.5 rounded-xl bg-white border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-all duration-300 ease-in-out ${
          mobileNavOpen ? "left-[14.5rem]" : "left-4"
        }`}
        style={{ boxShadow: "var(--shadow-md)" }}
        aria-label={mobileNavOpen ? "メニューを閉じる" : "メニューを開く"}
        aria-expanded={mobileNavOpen}
      >
        {mobileNavOpen ? (
          <X className="w-5 h-5" />
        ) : (
          <Menu className="w-5 h-5" />
        )}
      </button>

      {/* Sidebar */}
      <div
        className={`${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0 fixed lg:static inset-y-0 left-0 z-30 h-full shrink-0 transition-transform duration-300 ease-in-out`}
      >
        <DashboardNav onNavClick={() => setMobileNavOpen(false)} />
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto min-w-0 pt-16 lg:pt-0">
        <Outlet />
      </main>
    </div>
  );
}