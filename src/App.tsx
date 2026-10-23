import { Routes, Route, Navigate } from "react-router-dom";
import { SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";
import DashboardLayout from "./components/layout/DashboardLayout";
import AdminPage from "./pages/Admin";
import OrdersPage from "./pages/Orders";
import CustomersPage from "./pages/Customers";
import DealsPage from "./pages/Deals";
import SavedListingsPage from "./pages/SavedListings";
import MapIntelligencePage from "./pages/MapIntelligence";
import { isClerkEnabled } from "./Providers";
import { AuthErrorBoundary } from "./components/AuthErrorBoundary";

function AppRoutes() {
  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route path="/" element={<Navigate to="/orders" replace />} />
        <Route path="/orders" element={<OrdersPage />} />
        {/* One order, one page. The list used to expand listings inline, which
            buried the page under 500-row accordions. */}
        <Route path="/orders/:orderId" element={<OrdersPage />} />
        <Route path="/map" element={<MapIntelligencePage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/deals" element={<DealsPage />} />
        <Route path="/saved" element={<SavedListingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/orders" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  // Without Clerk configured there is no session to gate on, so render the app
  // as before rather than showing a sign-in screen nobody can pass.
  if (!isClerkEnabled) return <AuthErrorBoundary><AppRoutes /></AuthErrorBoundary>;

  // Nothing used to gate on auth state, so signing out cleared the Clerk session
  // while the dashboard stayed on screen — the ログアウト button looked broken
  // even though it worked. Gating here is what makes sign-out visible.
  return (
    <>
      <SignedIn>
        {/* Convex query rejections throw during render; without this the whole
            app white-screens on a config problem. */}
        <AuthErrorBoundary>
          <AppRoutes />
        </AuthErrorBoundary>
      </SignedIn>
      <SignedOut>
        <div className="app-bg flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-12">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-[4px] bg-[var(--brand)] font-serif text-[19px] leading-none text-white">
              Z
            </div>
            <h1 className="font-serif text-[28px] leading-none tracking-[0.01em] text-[var(--text-primary)]">
              Zephind
            </h1>
            <p className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.24em] text-[var(--text-muted)]">
              Property Intelligence
            </p>
            <p className="mt-5 text-sm font-medium text-[var(--text-secondary)]">
              続けるにはログインしてください
            </p>
          </div>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-white p-1 shadow-sm">
            <SignIn routing="virtual" />
          </div>
        </div>
      </SignedOut>
    </>
  );
}
