import { Routes, Route, Navigate } from "react-router-dom";
import { SignedIn, SignedOut, SignIn, useAuth } from "@clerk/clerk-react";
import { useRef } from "react";
import DashboardLayout from "./components/layout/DashboardLayout";
import AdminPage from "./pages/Admin";
import OrdersPage from "./pages/Orders";
import CustomersPage from "./pages/Customers";
import DealsPage from "./pages/Deals";
import SavedListingsPage from "./pages/SavedListings";
import MapIntelligencePage from "./pages/MapIntelligence";
import { isClerkEnabled } from "./Providers";
import { AuthErrorBoundary } from "./components/AuthErrorBoundary";
import SplashScreen from "./components/SplashScreen";
import FlyingButterflies from "./components/FlyingButterflies";

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

// Plays on every login. The signed-out flag lives in localStorage because Google sign-in
// reloads the page, which would otherwise look like a reload of an existing session.
const SIGNED_OUT_KEY = "zephind:was-signed-out";
function LoginSplash() {
  const { isLoaded, isSignedIn } = useAuth();
  const force = useRef<boolean | null>(null);
  if (!isLoaded) return null;
  if (!isSignedIn) {
    force.current = null;
    try {
      localStorage.setItem(SIGNED_OUT_KEY, "1");
    } catch {
      /* storage blocked: falls back to the 2-hour rule */
    }
    return null;
  }
  if (force.current === null) {
    try {
      force.current = localStorage.getItem(SIGNED_OUT_KEY) === "1";
      localStorage.removeItem(SIGNED_OUT_KEY);
    } catch {
      force.current = false;
    }
  }
  return <SplashScreen force={force.current} />;
}

export default function App() {
  return (
    <>
      {isClerkEnabled ? <LoginSplash /> : <SplashScreen />}
      <AppInner />
    </>
  );
}

function AppInner() {
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
        <div className="login-bg relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden px-4 py-12">
          <FlyingButterflies />
          <div className="relative text-center">
            <h1 className="text-[64px] font-bold leading-none tracking-[-0.02em] text-white sm:text-[80px]">Zephinder</h1>
          </div>
          {/* One white card. Clerk's own card is made transparent so there is no box in a box. */}
          <div className="relative w-full max-w-[440px] rounded-3xl bg-white px-4 py-8 shadow-2xl shadow-black/25">
            <div className="px-3 pb-2">
              <h2 className="text-[22px] font-bold text-[var(--text-primary)]">サインイン</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">続けるにはログインしてください</p>
            </div>
            <SignIn
              routing="virtual"
              appearance={{
                variables: { colorPrimary: "#3d6b3f", borderRadius: "0.75rem" },
                elements: {
                  rootBox: { width: "100%" },
                  cardBox: { width: "100%", boxShadow: "none", border: "none" },
                  card: { boxShadow: "none", border: "none", background: "transparent", width: "100%" },
                  header: { display: "none" },
                },
              }}
            />
          </div>
        </div>
      </SignedOut>
    </>
  );
}
