import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export interface OrderBookEntry {
  price: number;
  qty: number;
  total: number;
}

interface OrderBookStore {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  setOrderBook: (bids: OrderBookEntry[], asks: OrderBookEntry[]) => void;
  reset: () => void;
}

export const useOrderBookStore = create<OrderBookStore>()(
  subscribeWithSelector((set) => ({
    bids: [],
    asks: [],
    setOrderBook: (bids, asks) => set({ bids, asks }),
    reset: () => set({ bids: [], asks: [] }),
  }))
);
