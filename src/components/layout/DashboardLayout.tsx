import { Outlet } from "react-router-dom";
import DashboardNav from "./DashboardNav";

export default function DashboardLayout() {
  return (
    <div className="flex min-h-screen bg-background">
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}