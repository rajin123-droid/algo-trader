/**
 * Orders store — tracks active orders and order history fetched from the API.
 *
 * The store is intentionally thin: it only fetches data and holds it in memory.
 * Components subscribe via useOrdersStore().
 */

import { create } from "zustand";
import {
  getActiveOrders,
  getOrderHistory,
  getOrderStats,
  cancelOrder as apiCancelOrder,
  type ApiOrder,
  type OrderStats,
} from "@/core/api";

interface OrdersState {
  active:      ApiOrder[];
  history:     ApiOrder[];
  stats:       OrderStats;
  loading:     boolean;
  error:       string | null;

  fetchActive:  () => Promise<void>;
  fetchHistory: (symbol?: string) => Promise<void>;
  fetchStats:   () => Promise<void>;
  fetchAll:     (symbol?: string) => Promise<void>;
  cancelOrder:  (id: string, reason?: string) => Promise<void>;
  addOrder:     (order: ApiOrder) => void;
  updateOrder:  (order: ApiOrder) => void;
}

export const useOrdersStore = create<OrdersState>((set, get) => ({
  active:  [],
  history: [],
  stats:   { openOrders: 0, totalFeesPaid: 0 },
  loading: false,
  error:   null,

  fetchActive: async () => {
    try {
      const active = await getActiveOrders();
      set({ active });
    } catch (e: unknown) {
      set({ error: (e as Error).message });
    }
  },

  fetchHistory: async (symbol?: string) => {
    try {
      const history = await getOrderHistory({ symbol, limit: 100 });
      set({ history });
    } catch (e: unknown) {
      set({ error: (e as Error).message });
    }
  },

  fetchStats: async () => {
    try {
      const stats = await getOrderStats();
      set({ stats });
    } catch (e: unknown) {
      set({ error: (e as Error).message });
    }
  },

  fetchAll: async (symbol?: string) => {
    set({ loading: true, error: null });
    try {
      const [active, history, stats] = await Promise.all([
        getActiveOrders(),
        getOrderHistory({ symbol, limit: 100 }),
        getOrderStats(),
      ]);
      set({ active, history, stats, loading: false });
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  cancelOrder: async (id: string, reason?: string) => {
    try {
      const { order } = await apiCancelOrder(id, reason);
      const state = get();
      set({
        active:  state.active.filter((o) => o.id !== id),
        history: [order, ...state.history.filter((o) => o.id !== id)],
      });
    } catch (e: unknown) {
      set({ error: (e as Error).message });
    }
  },

  addOrder: (order: ApiOrder) => {
    const state = get();
    const isActive = ["PENDING", "PARTIALLY_FILLED"].includes(order.status);
    if (isActive) {
      set({ active: [order, ...state.active.filter((o) => o.id !== order.id)] });
    } else {
      set({ history: [order, ...state.history.filter((o) => o.id !== order.id)] });
    }
  },

  updateOrder: (order: ApiOrder) => {
    const state = get();
    const isActive = ["PENDING", "PARTIALLY_FILLED"].includes(order.status);
    if (isActive) {
      const exists = state.active.find((o) => o.id === order.id);
      set({
        active:  exists
          ? state.active.map((o) => o.id === order.id ? order : o)
          : [order, ...state.active],
        history: state.history.filter((o) => o.id !== order.id),
      });
    } else {
      set({
        active:  state.active.filter((o) => o.id !== order.id),
        history: [order, ...state.history.filter((o) => o.id !== order.id)],
      });
    }
  },
}));
