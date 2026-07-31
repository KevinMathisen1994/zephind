import { useState } from "react";
import { Outlet } from "react-router-dom";
import DashboardNav from "./DashboardNav";
import { Menu, X } from "lucide-react";

export default function DashboardLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    // h-screen + overflow-hidden makes the SHELL exactly viewport height so the
    // <main> below becomes the scroll container. Previously the shell was
    // min-h-screen, so the whole page scrolled and the sidebar (min-h-screen)
    // scrolled away with it — main's overflow-y-auto never actually engaged.
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">
      {/* Mobile nav overlay */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-30 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileNavOpen(!mobileNavOpen)}
        className="fixed top-4 left-4 z-40 lg:hidden p-2.5 rounded-xl bg-white border border-slate-200 shadow-md text-slate-700 hover:bg-slate-50 transition-colors"
        aria-label="Toggle navigation menu"
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

      <main className="flex-1 overflow-y-auto min-w-0 bg-slate-50/50 pt-16 lg:pt-0">
        <Outlet />
      </main>
    </div>
  );
}