import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export interface RecentTrade {
  price: number;
  qty: number;
  side: "BUY" | "SELL";
  time: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PortfolioEntry {
  asset: string;
  balance: number;
}

export interface TradingStore {
  loading: boolean;
  symbol: string;

  price: number;
  priceChange: number;
  priceChangePercent: number;
  volume: number;
  high24h: number;
  low24h: number;

  trades: RecentTrade[];

  candles: Candle[];
  liveCandle: Candle | null;

  portfolio: PortfolioEntry[];

  binanceConnected: boolean;
  gatewayConnected: boolean;

  selectedInterval: string;

  setLoading: (loading: boolean) => void;
  setSymbol: (symbol: string) => void;
  setMarket: (
    partial: Partial<
      Pick<
        TradingStore,
        | "price"
        | "priceChange"
        | "priceChangePercent"
        | "volume"
        | "high24h"
        | "low24h"
      >
    >
  ) => void;
  setPrice: (price: number) => void;
  addTrade: (trade: RecentTrade) => void;
  setTrades: (trades: RecentTrade[]) => void;
  setCandles: (candles: Candle[]) => void;
  upsertLiveCandle: (candle: Candle) => void;
  setPortfolio: (portfolio: PortfolioEntry[]) => void;
  setBinanceConnected: (v: boolean) => void;
  setGatewayConnected: (v: boolean) => void;
  setSelectedInterval: (interval: string) => void;
  reset: () => void;
}

const marketInitial = {
  loading: false,
  symbol: "BTCUSDT",
  price: 0,
  priceChange: 0,
  priceChangePercent: 0,
  volume: 0,
  high24h: 0,
  low24h: 0,
  trades: [] as RecentTrade[],
  candles: [] as Candle[],
  liveCandle: null as Candle | null,
  portfolio: [] as PortfolioEntry[],
  binanceConnected: false,
  gatewayConnected: false,
  selectedInterval: "1m",
};

export const useTradingStore = create<TradingStore>()(
  subscribeWithSelector((set) => ({
    ...marketInitial,

    setLoading: (loading) => set({ loading }),
    setSymbol: (symbol) => set({ symbol }),
    setMarket: (partial) => set(partial),
    setPrice: (price) => set({ price }),
    addTrade: (trade) =>
      set((s) => ({ trades: [trade, ...s.trades].slice(0, 60) })),
    setTrades: (trades) => set({ trades }),
    setCandles: (candles) => set({ candles }),
    upsertLiveCandle: (candle) =>
      set((s) => {
        const candles = s.candles.filter((c) => c.time !== candle.time);
        return {
          candles: [...candles, candle].sort((a, b) => a.time - b.time),
          liveCandle: candle,
        };
      }),
    setPortfolio: (portfolio) => set({ portfolio }),
    setBinanceConnected: (binanceConnected) => set({ binanceConnected }),
    setGatewayConnected: (gatewayConnected) => set({ gatewayConnected }),
    setSelectedInterval: (selectedInterval) => set({ selectedInterval }),
    reset: () => set(marketInitial),
  }))
);
