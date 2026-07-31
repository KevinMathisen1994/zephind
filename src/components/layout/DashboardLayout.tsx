import { Outlet } from "react-router-dom";
import DashboardNav from "./DashboardNav";

export default function DashboardLayout() {
  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">
      <DashboardNav />
      <main className="flex-1 overflow-y-auto min-w-0 bg-slate-50/50">
        <Outlet />
      </main>
    </div>
  );
}