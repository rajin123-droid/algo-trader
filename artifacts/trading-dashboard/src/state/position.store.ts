import { create } from "zustand";

export interface Position {
  symbol: string;
  size: number;
  entryPrice: number;
  markPrice: number;
  pnl: number;
  liquidationPrice: number;
  side?: "BUY" | "SELL";
  leverage?: number;
  margin?: number;
}

interface PositionState {
  loading: boolean;
  positions: Position[];
  /**
   * Incremented each time the backend sends ORDER_FILLED.
   * Components watch this to know when to re-fetch positions from the API.
   */
  fillVersion: number;

  setLoading: (loading: boolean) => void;
  setPositions: (positions: Position[]) => void;
  upsertPosition: (position: Position) => void;
  removePosition: (symbol: string) => void;
  /** Bump the fill-version counter — triggers live refresh in PositionsPage. */
  bumpFill: () => void;
  reset: () => void;
}

const initialState = {
  loading: false,
  positions: [] as Position[],
  fillVersion: 0,
};

export const usePositionStore = create<PositionState>((set) => ({
  ...initialState,

  setLoading: (loading) => set({ loading }),

  setPositions: (positions) => set({ positions }),

  upsertPosition: (position) =>
    set((s) => {
      const rest = s.positions.filter((p) => p.symbol !== position.symbol);
      return { positions: [...rest, position] };
    }),

  removePosition: (symbol) =>
    set((s) => ({ positions: s.positions.filter((p) => p.symbol !== symbol) })),

  bumpFill: () => set((s) => ({ fillVersion: s.fillVersion + 1 })),

  reset: () => set(initialState),
}));
