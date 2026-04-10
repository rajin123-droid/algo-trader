import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { subscribePositions, setPositions, Position } from "@/features/positions/positions.lib";
import { subscribeAuth, AuthUser } from "@/core/auth";
import { logout } from "@/core/auth/auth.service";
import { getPositions } from "@/core/api";
import { OrderBook } from "@/features/orderbook/OrderBook";
import { DepthChart } from "@/features/orderbook/DepthChart";
import { Heatmap } from "@/features/orderbook/Heatmap";
import { RecentTrades } from "./RecentTrades";
import { Positions } from "@/features/positions/Positions";
import { TradePanel } from "./TradePanel";
import { AuthModal } from "@/features/auth/AuthModal";
import { TradingViewChart } from "./chart/TradingViewChart";
import { LiveChart } from "./chart/LiveChart";
import { PriceTicker } from "@/features/orderbook/PriceTicker";
import { connectMarketStreams } from "@/core/ws";
import { useOrderBookStore } from "@/features/orderbook/orderbook.store";
import { useTradingStore } from "@/state/trading.store";
import { ChevronLeft, LogOut } from "lucide-react";

const BORDER = "1px solid #2B3139";

export default function LiveTrading() {
  const { price, priceChange, trades, setMarket, addTrade, setBinanceConnected } = useTradingStore();
  const [positions, setLocalPositions] = useState<Position[]>([]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [chartMode, setChartMode] = useState<"tradingview" | "live">("tradingview");
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    cleanupRef.current?.();
    cleanupRef.current = connectMarketStreams("BTCUSDT", {
      setOrderBook: useOrderBookStore.getState().setOrderBook,
      setMarket,
      addTrade,
      setBinanceConnected,
    });
    return () => { cleanupRef.current?.(); };
  }, []);

  useEffect(() => {
    const unsubPositions = subscribePositions(setLocalPositions);
    const unsubAuth = subscribeAuth(setUser);
    return () => { unsubPositions(); unsubAuth(); };
  }, []);

  useEffect(() => {
    if (!user) { setPositions([]); return; }
    getPositions().then((apiPositions) => {
      const restored: Position[] = apiPositions.map((p) => {
        const notional = p.quantity * p.entryPrice;
        const liqPrice = p.side === "BUY"
          ? p.entryPrice * (1 - 1 / p.leverage)
          : p.entryPrice * (1 + 1 / p.leverage);
        return {
          id: `db-${p.id}`, dbId: p.id, side: p.side, entry: p.entryPrice,
          qty: p.quantity, leverage: p.leverage, notional, margin: notional / p.leverage,
          liqPrice, openTime: new Date(p.createdAt).getTime(),
        };
      });
      setPositions(restored);
    }).catch(() => {});
  }, [user]);

  const isPriceUp = priceChange >= 0;

  return (
    <div className="flex flex-col font-mono select-none h-full overflow-hidden"
      style={{ background: "#0B0E11", color: "#E8E8E8" }}>
      <div className="flex items-center justify-between px-4 py-2 shrink-0"
        style={{ borderBottom: BORDER, minHeight: 44 }}>
        <div className="flex items-center gap-4">
          <Link to="/" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="h-3 w-3" /> Terminal
          </Link>
          <span className="text-xs text-muted-foreground ml-1">BTC/USDT · Live</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <PriceTicker symbol="btcusdt" />
          {user ? (
            <button onClick={() => logout().finally(() => setPositions([]))}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
              <LogOut className="h-3 w-3" />{user.email}
            </button>
          ) : (
            <button onClick={() => setShowAuth(true)} className="text-yellow-400 hover:underline">Login →</button>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex flex-col shrink-0 overflow-hidden" style={{ width: 200, borderRight: BORDER }}>
          <OrderBook />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-2 px-3 py-1 shrink-0" style={{ borderBottom: BORDER }}>
            {(["tradingview", "live"] as const).map((m) => (
              <button key={m} onClick={() => setChartMode(m)}
                className="text-[10px] px-2 py-[2px] rounded transition-colors"
                style={{ background: chartMode === m ? "#2B3139" : "transparent", color: chartMode === m ? "#F0B90B" : "#555C6A" }}>
                {m === "tradingview" ? "TradingView" : "Lightweight"}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0">
            {chartMode === "tradingview"
              ? <TradingViewChart symbol="BINANCE:BTCUSDT" />
              : <LiveChart symbol="BTCUSDT" interval="1m" />}
          </div>
          <div className="flex shrink-0" style={{ height: 168, borderTop: BORDER }}>
            <div className="flex-1 flex flex-col min-w-0" style={{ borderRight: BORDER }}>
              <div className="px-3 pt-2 pb-1 shrink-0">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Depth Chart</span>
              </div>
              <div className="flex-1 min-h-0 pb-1"><DepthChart /></div>
            </div>
            <div className="flex flex-col shrink-0" style={{ width: 380, borderRight: BORDER }}>
              <div className="px-3 pt-2 pb-1 shrink-0">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Heatmap</span>
              </div>
              <div className="flex-1 min-h-0"><Heatmap /></div>
            </div>
            <div className="flex flex-col shrink-0 overflow-hidden" style={{ width: 210 }}>
              <div className="px-2 pt-2 pb-1 shrink-0" style={{ borderBottom: BORDER }}>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Recent Trades</span>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden"><RecentTrades trades={trades} /></div>
            </div>
          </div>
          <div className="shrink-0 overflow-hidden" style={{ height: 130, borderTop: BORDER }}>
            <Positions positions={positions} currentPrice={price} />
          </div>
        </div>
        <div className="shrink-0 overflow-y-auto" style={{ width: 240, borderLeft: BORDER }}>
          <TradePanel lastPrice={price} onLoginRequired={() => setShowAuth(true)} />
        </div>
      </div>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}
