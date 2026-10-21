import { useState } from "react";
import { Outlet } from "react-router-dom";
import DashboardNav from "./DashboardNav";
import { Menu, X } from "lucide-react";

export default function DashboardLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-page)] text-[var(--text-primary)] font-sans antialiased">
      {/* Mobile nav overlay */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-md z-30 lg:hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Mobile toggle */}
      <button
        onClick={() => setMobileNavOpen(!mobileNavOpen)}
        className={`fixed top-4 z-40 lg:hidden p-2.5 rounded-2xl bg-white/90 backdrop-blur-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          mobileNavOpen ? "left-[17.5rem]" : "left-4"
        }`}
        style={{ boxShadow: "var(--shadow-md)" }}
        aria-label={mobileNavOpen ? "メニューを閉じる" : "メニューを開く"}
        aria-expanded={mobileNavOpen}
      >
        {mobileNavOpen ? (
          <X className="w-5 h-5 transition-transform rotate-90 duration-300" />
        ) : (
          <Menu className="w-5 h-5 transition-transform duration-300" />
        )}
      </button>

      {/* Sidebar */}
      <div
        className={`${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0 fixed lg:static inset-y-0 left-0 z-30 h-full shrink-0 transition-transform duration-400 ease-[cubic-bezier(0.16,1,0.3,1)]`}
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