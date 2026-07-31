import { Routes, Route, Navigate } from "react-router-dom";
import { SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";
import DashboardLayout from "./components/layout/DashboardLayout";
import AdminPage from "./pages/Admin";
import OrdersPage from "./pages/Orders";
import CustomersPage from "./pages/Customers";
import DealsPage from "./pages/Deals";
import { isClerkEnabled } from "./Providers";
import { AuthErrorBoundary } from "./components/AuthErrorBoundary";

function AppRoutes() {
  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route path="/" element={<Navigate to="/orders" replace />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/deals" element={<DealsPage />} />
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
        <div className="min-h-screen flex flex-col items-center justify-center gap-8 bg-slate-50 px-4 py-12">
          <div className="text-center">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
              Zephind
            </h1>
            <p className="mt-1 text-sm font-medium text-slate-500">
              不動産インテリジェンス
            </p>
            <p className="mt-4 text-sm font-medium text-slate-600">
              続けるにはログインしてください
            </p>
          </div>
          <SignIn routing="virtual" />
        </div>
      </SignedOut>
    </>
  );
}
