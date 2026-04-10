import { useCallback, useEffect, useRef, useState } from "react";
import { useTradingStore } from "@/state/trading.store";
import { useOrderBookStore } from "@/features/orderbook/orderbook.store";
import { connectMarketStreams, connectGateway } from "@/core/ws";
import { subscribePositions, setPositions } from "@/features/positions/positions.lib";
import { subscribeAuth, getToken, AuthUser } from "@/core/auth";
import { logout } from "@/core/auth/auth.service";
import { getPositions } from "@/core/api";
import { OrderBook } from "@/features/orderbook/OrderBook";
import { TradePanel } from "@/features/trading/TradePanel";
import { RecentTrades } from "@/features/trading/RecentTrades";
import { Positions } from "@/features/positions/Positions";
import { AuthModal } from "@/features/auth/AuthModal";
import { OrdersPanel } from "@/features/orders/OrdersPanel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { TerminalTopBar } from "./components/TerminalTopBar";
import { ChartContainer } from "./chart/ChartContainer";
import { IndicatorPanel, type IndicatorConfig } from "./chart/IndicatorPanel";
import { RSIPanel } from "./chart/RSIPanel";
import { MACDPanel } from "./chart/MACDPanel";
import { useDrawingStore } from "./drawing/drawing.store";
import type { Position } from "@/features/positions/positions.lib";
import type { ApiOrder } from "@/core/api";
import { useOrdersStore } from "@/state/orders.store";

const INTERVALS = ["1m", "3m", "5m", "15m", "1h", "4h", "1d"] as const;
const BORDER = "1px solid #2B3139";

export function TradingTerminal() {
  const store = useTradingStore();
  const { symbol, price, priceChange, trades } = store;

  const cleanupRef = useRef<(() => void) | null>(null);
  const gatewayRef = useRef<WebSocket | null>(null);

  const [positions, setLocalPositions] = useState<Position[]>([]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [bottomTab, setBottomTab] = useState<"positions" | "trades" | "orders">(
    "positions"
  );
  const [interval, setChartInterval] = useState("1m");

  const [indicators, setIndicators] = useState<IndicatorConfig>({
    ema9: true,
    ema21: true,
    ema55: false,
    volume: true,
    rsi: false,
    macd: false,
  });

  const [candleCloses, setCandleCloses] = useState<number[]>([]);
  const [candleTimes, setCandleTimes] = useState<number[]>([]);

  const { setMode } = useDrawingStore();

  const toggleIndicator = useCallback((key: keyof IndicatorConfig) => {
    setIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleCandlesChange = useCallback(
    (closes: number[], times: number[]) => {
      setCandleCloses(closes);
      setCandleTimes(times);
    },
    []
  );

  useEffect(() => {
    const unsubPos = subscribePositions(setLocalPositions);
    const unsubAuth = subscribeAuth(setUser);
    return () => {
      unsubPos();
      unsubAuth();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setPositions([]);
      return;
    }
    getPositions()
      .then((apiPositions) => {
        const restored: Position[] = apiPositions.map((p) => {
          const notional = p.quantity * p.entryPrice;
          const liqPrice =
            p.side === "BUY"
              ? p.entryPrice * (1 - 1 / p.leverage)
              : p.entryPrice * (1 + 1 / p.leverage);
          return {
            id: `db-${p.id}`,
            dbId: p.id,
            side: p.side,
            entry: p.entryPrice,
            qty: p.quantity,
            leverage: p.leverage,
            notional,
            margin: notional / p.leverage,
            liqPrice,
            openTime: new Date(p.createdAt).getTime(),
          };
        });
        setPositions(restored);
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    cleanupRef.current?.();
    gatewayRef.current?.close();

    const cleanup = connectMarketStreams(symbol, {
      setOrderBook: useOrderBookStore.getState().setOrderBook,
      setMarket: store.setMarket,
      addTrade: store.addTrade,
      setBinanceConnected: store.setBinanceConnected,
    });
    cleanupRef.current = cleanup;

    const token = getToken() ?? undefined;
    const gw = connectGateway(
      symbol,
      (fill) => {
        store.addTrade({
          price: fill.price,
          qty: fill.quantity,
          side: fill.side,
          time: new Date(fill.executedAt).getTime(),
        });
      },
      () => {},
      {
        token,
        onPortfolio: store.setPortfolio,
        onOpen: () => store.setGatewayConnected(true),
        onOrderPending: (order) => {
          useOrdersStore.getState().addOrder(order as unknown as ApiOrder);
        },
        onOrderCancelled: (order) => {
          useOrdersStore.getState().updateOrder(order as unknown as ApiOrder);
        },
      }
    );
    gw.onclose = () => store.setGatewayConnected(false);
    gatewayRef.current = gw;

    return () => {
      cleanup();
      gw.close();
    };
  }, [symbol]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      switch (e.key) {
        case "Escape":
          setMode("none");
          break;
        case "l":
        case "L":
          setMode(
            useDrawingStore.getState().mode === "trendline" ? "none" : "trendline"
          );
          break;
        case "h":
        case "H":
          if (!e.ctrlKey && !e.metaKey) {
            setMode(
              useDrawingStore.getState().mode === "hline" ? "none" : "hline"
            );
          }
          break;
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [setMode]);

  function handleLogout() {
    logout().finally(() => setPositions([]));
  }

  return (
    <div
      className="flex flex-col font-mono select-none overflow-hidden"
      style={{ background: "#0B0E11", color: "#E8E8E8", height: "100%" }}
    >
      <TerminalTopBar />

      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
        {/* ── LEFT: Chart column ──────────────────────────────────────── */}
        <ResizablePanel defaultSize={72} minSize={45}>
          <ResizablePanelGroup direction="vertical">
            {/* Chart area */}
            <ResizablePanel defaultSize={78} minSize={40}>
              <div className="flex flex-col h-full overflow-hidden">
                {/* Interval row */}
                <div
                  className="flex items-center gap-1 px-3 py-1 shrink-0"
                  style={{ borderBottom: BORDER }}
                >
                  <span className="text-[10px] text-muted-foreground/60 mr-1">
                    TF
                  </span>
                  {INTERVALS.map((iv) => (
                    <button
                      key={iv}
                      onClick={() => setChartInterval(iv)}
                      className="px-2 py-[2px] text-[10px] font-mono rounded transition-colors"
                      style={{
                        background:
                          interval === iv ? "#2B3139" : "transparent",
                        color: interval === iv ? "#F0B90B" : "#555C6A",
                        border:
                          interval === iv
                            ? "1px solid #3d444e"
                            : "1px solid transparent",
                        fontWeight: interval === iv ? 600 : 400,
                      }}
                    >
                      {iv}
                    </button>
                  ))}
                </div>

                {/* Indicator toggle toolbar */}
                <IndicatorPanel
                  indicators={indicators}
                  onToggle={toggleIndicator}
                />

                {/* Chart itself */}
                <div className="flex-1 overflow-hidden min-h-0">
                  <ChartContainer
                    symbol={symbol}
                    interval={interval}
                    indicators={indicators}
                    onCandlesChange={handleCandlesChange}
                  />
                </div>

                {/* RSI sub-panel */}
                {indicators.rsi && (
                  <RSIPanel closes={candleCloses} times={candleTimes} />
                )}

                {/* MACD sub-panel */}
                {indicators.macd && (
                  <MACDPanel closes={candleCloses} times={candleTimes} />
                )}
              </div>
            </ResizablePanel>

            <ResizableHandle
              style={{ background: "#2B3139", height: 3 }}
              className="hover:bg-[#F0B90B]/60 transition-colors"
            />

            {/* Bottom panel: Positions / Recent Trades */}
            <ResizablePanel defaultSize={22} minSize={12}>
              <div className="flex flex-col h-full overflow-hidden">
                <div
                  className="flex items-center shrink-0"
                  style={{ borderBottom: BORDER }}
                >
                  {(["positions", "trades", "orders"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setBottomTab(tab)}
                      className="px-4 py-2 text-[10px] font-mono uppercase tracking-wider transition-colors"
                      style={{
                        background:
                          bottomTab === tab ? "#12161a" : "transparent",
                        color:
                          bottomTab === tab ? "#E8E8E8" : "#555C6A",
                        borderBottom:
                          bottomTab === tab
                            ? "2px solid #F0B90B"
                            : "2px solid transparent",
                      }}
                    >
                      {tab === "positions"
                        ? `Positions (${positions.length})`
                        : tab === "trades"
                        ? "Trades"
                        : "Orders"}
                    </button>
                  ))}
                  <div className="ml-auto px-3 text-[10px] text-muted-foreground/40 font-mono">
                    <kbd className="px-1 bg-[#1E2329] rounded text-[9px]">L</kbd> trend
                    {" · "}
                    <kbd className="px-1 bg-[#1E2329] rounded text-[9px]">H</kbd> hline
                    {" · "}
                    <kbd className="px-1 bg-[#1E2329] rounded text-[9px]">Esc</kbd> clear
                  </div>
                </div>
                <div className="flex-1 overflow-hidden">
                  {bottomTab === "positions" ? (
                    <Positions positions={positions} currentPrice={price} />
                  ) : bottomTab === "trades" ? (
                    <RecentTrades trades={trades} />
                  ) : (
                    <OrdersPanel symbol={symbol} />
                  )}
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

        <ResizableHandle
          style={{ background: "#2B3139", width: 3 }}
          className="hover:bg-[#F0B90B]/60 transition-colors"
        />

        {/* ── RIGHT: Order Book + Trade Panel ───────────────────────── */}
        <ResizablePanel defaultSize={28} minSize={20} maxSize={45}>
          <ResizablePanelGroup direction="vertical">
            <ResizablePanel defaultSize={55} minSize={30}>
              <OrderBook />
            </ResizablePanel>

            <ResizableHandle
              style={{ background: "#2B3139", height: 3 }}
              className="hover:bg-[#F0B90B]/60 transition-colors"
            />

            <ResizablePanel defaultSize={45} minSize={30}>
              <div className="flex flex-col h-full overflow-hidden">
                {user ? (
                  <div
                    className="flex items-center justify-between px-3 py-1 shrink-0 text-[10px]"
                    style={{ borderBottom: BORDER }}
                  >
                    <span className="text-muted-foreground truncate max-w-[160px]">
                      {user.email}
                    </span>
                    <button
                      onClick={handleLogout}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Logout
                    </button>
                  </div>
                ) : (
                  <div
                    className="flex items-center justify-between px-3 py-1 shrink-0 text-[10px]"
                    style={{ borderBottom: BORDER }}
                  >
                    <span className="text-muted-foreground/60">Paper mode</span>
                    <button
                      onClick={() => setShowAuth(true)}
                      className="text-[#F0B90B] hover:underline"
                    >
                      Login →
                    </button>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto">
                  <TradePanel
                    lastPrice={price}
                    onLoginRequired={() => setShowAuth(true)}
                  />
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}
