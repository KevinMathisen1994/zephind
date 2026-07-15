import { Routes, Route, Navigate } from "react-router-dom";
import DashboardLayout from "./components/layout/DashboardLayout";
import AdminPage from "./pages/Admin";
import OrdersPage from "./pages/Orders";
import PropertiesPage from "./pages/Properties";
import ProposalsPage from "./pages/Proposals";

export default function App() {
  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route path="/" element={<Navigate to="/orders" replace />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/properties" element={<PropertiesPage />} />
        <Route path="/proposals" element={<ProposalsPage />} />
      </Route>
    </Routes>
  );
}