import { useEffect, useState, useCallback } from "react";
import { subscribePositions } from "./positions.lib";
import { Positions } from "./Positions";
import { useTradingStore } from "@/state/trading.store";
import { usePositionStore } from "@/state/position.store";
import { getPositions, type ApiPosition } from "@/core/api";
import { useOrderBookStore } from "@/features/orderbook/orderbook.store";
import type { Position } from "./positions.lib";

function apiToPosition(p: ApiPosition): Position {
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
}

const BORDER = "1px solid #2B3139";

export default function PositionsPage() {
  const price = useTradingStore((s) => s.price);
  const fillVersion = usePositionStore((s) => s.fillVersion);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to locally-opened positions (from TradePanel, paper mode)
  useEffect(() => {
    const unsub = subscribePositions(setPositions);
    return unsub;
  }, []);

  // Fetch positions from API — re-runs on mount AND whenever ORDER_FILLED arrives
  const fetchPositions = useCallback(() => {
    setLoading(true);
    getPositions()
      .then((data) => {
        setPositions(data.map(apiToPosition));
        setError(null);
      })
      .catch((e: Error) => {
        // 401 = not authenticated — show soft prompt, not an error
        if (e.message.includes("401") || e.message.toLowerCase().includes("authorization")) {
          setError("auth");
        } else {
          setError(e.message);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions, fillVersion]); // fillVersion bumps on every ORDER_FILLED WS event

  return (
    <div className="h-full overflow-hidden flex flex-col font-mono" style={{ background: "#0B0E11" }}>
      <div
        className="flex items-center justify-between px-4 shrink-0"
        style={{ height: 44, borderBottom: BORDER }}
      >
        <span className="text-xs text-muted-foreground uppercase tracking-widest">Open Positions</span>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground">
            {positions.length} position{positions.length !== 1 ? "s" : ""}
          </span>
          <button
            onClick={fetchPositions}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors font-mono"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1 text-xs text-muted-foreground">
          Loading positions...
        </div>
      ) : error === "auth" ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2">
          <span className="text-xs text-muted-foreground font-mono">Sign in to view persisted positions</span>
          <span className="text-[10px] text-muted-foreground/50 font-mono">
            Paper trades placed this session appear in the Positions panel below the chart
          </span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2">
          <span className="text-xs text-[#F6465D] font-mono">{error}</span>
          <button className="text-xs text-muted-foreground underline font-mono" onClick={fetchPositions}>
            retry
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <Positions positions={positions} currentPrice={price} />
        </div>
      )}
    </div>
  );
}
