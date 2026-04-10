import { create } from "zustand";
import type { AutoTrade } from "@/core/api";

export interface AutoTradeEvent {
  sessionId:   string;
  strategyId:  string;
  symbol:      string;
  signal:      "BUY" | "SELL";
  price:       number;
  size:        number;
  pnl:         number;
  balance:     number;
  stopLoss?:   number | null;
  takeProfit?: number | null;
  closeReason?: string | null;
  executedAt:  string;
}

interface AutoTradingState {
  trades:       AutoTrade[];
  version:      number;
  setTrades:    (trades: AutoTrade[]) => void;
  prependTrade: (ev: AutoTradeEvent) => void;
  bumpVersion:  () => void;
}

export const useAutoTradingStore = create<AutoTradingState>((set) => ({
  trades:  [],
  version: 0,

  setTrades: (trades) => set({ trades }),

  prependTrade: (ev) =>
    set((s) => {
      const trade: AutoTrade = {
        id:          `ws-${Date.now()}`,
        sessionId:   ev.sessionId,
        userId:      "",
        symbol:      ev.symbol,
        side:        ev.signal,
        price:       ev.price,
        quantity:    ev.size,
        pnl:         ev.pnl,
        stopLoss:    ev.stopLoss,
        takeProfit:  ev.takeProfit,
        closeReason: ev.closeReason,
        executedAt:  ev.executedAt,
      };
      return {
        trades:  [trade, ...s.trades].slice(0, 100),
        version: s.version + 1,
      };
    }),

  bumpVersion: () => set((s) => ({ version: s.version + 1 })),
}));
