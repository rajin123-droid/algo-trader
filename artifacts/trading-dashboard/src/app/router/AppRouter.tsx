import { createBrowserRouter, Navigate } from "react-router-dom";
import AppLayout from "../layout/AppLayout";
import { TradingTerminal } from "@/features/trading/TradingTerminal";
import Dashboard from "@/features/portfolio/Dashboard";
import PositionsPage from "@/features/positions/PositionsPage";
import StrategiesPage from "@/features/strategies/StrategiesPage";
import BacktestingPage from "@/features/backtesting/BacktestingPage";
import MarketplacePage from "@/features/marketplace/MarketplacePage";
import CopyTradingPage from "@/features/copyTrading/CopyTradingPage";
import AdminPage from "@/features/admin/AdminPage";
import LiveTrading from "@/features/trading/LiveTrading";
import NotFound from "@/pages/not-found";

export const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <AppLayout />,
      children: [
        { index: true,          element: <TradingTerminal /> },
        { path: "portfolio",    element: <Dashboard /> },
        { path: "positions",    element: <PositionsPage /> },
        { path: "strategies",   element: <StrategiesPage /> },
        { path: "backtesting",  element: <BacktestingPage /> },
        { path: "marketplace",  element: <MarketplacePage /> },
        { path: "copy",         element: <CopyTradingPage /> },
        { path: "admin",        element: <AdminPage /> },
        { path: "live",         element: <LiveTrading /> },
        { path: "terminal",     element: <Navigate to="/" replace /> },
        { path: "*",            element: <NotFound /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL }
);
