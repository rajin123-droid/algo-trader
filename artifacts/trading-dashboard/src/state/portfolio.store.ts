import { create } from "zustand";

export interface Balance {
  asset: string;
  free: number;
  locked: number;
}

interface PortfolioState {
  loading: boolean;
  balances: Balance[];
  equity: number;
  pnl: number;
  /**
   * Bumped each time a PORTFOLIO_UPDATE WS event arrives.
   * Components watch this to re-fetch ledger balances from the API.
   */
  version: number;

  setLoading: (loading: boolean) => void;
  setPortfolio: (data: { balances?: Balance[]; equity?: number; pnl?: number }) => void;
  /** Signal that a server-side portfolio change has occurred. */
  bumpVersion: () => void;
  reset: () => void;
}

const initialState = {
  loading: false,
  balances: [] as Balance[],
  equity: 0,
  pnl: 0,
  version: 0,
};

export const usePortfolioStore = create<PortfolioState>((set) => ({
  ...initialState,

  setLoading: (loading) => set({ loading }),

  setPortfolio: (data) =>
    set({
      ...(data.balances !== undefined && { balances: data.balances }),
      ...(data.equity   !== undefined && { equity:   data.equity   }),
      ...(data.pnl      !== undefined && { pnl:      data.pnl      }),
    }),

  bumpVersion: () => set((s) => ({ version: s.version + 1 })),

  reset: () => set(initialState),
}));
