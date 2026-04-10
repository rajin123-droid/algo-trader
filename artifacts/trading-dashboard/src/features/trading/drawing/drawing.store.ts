import { create } from "zustand";

export interface TrendLine {
  id: string;
  time1: number;
  price1: number;
  time2: number;
  price2: number;
  color: string;
}

export interface DrawingStore {
  lines: TrendLine[];
  mode: "none" | "trendline" | "hline";
  pending: { time: number; price: number } | null;

  addLine: (line: TrendLine) => void;
  removeLine: (id: string) => void;
  setMode: (mode: DrawingStore["mode"]) => void;
  setPending: (pt: DrawingStore["pending"]) => void;
  clearAll: () => void;
}

export const useDrawingStore = create<DrawingStore>((set) => ({
  lines: [],
  mode: "none",
  pending: null,

  addLine: (line) => set((s) => ({ lines: [...s.lines, line] })),
  removeLine: (id) => set((s) => ({ lines: s.lines.filter((l) => l.id !== id) })),
  setMode: (mode) => set({ mode, pending: null }),
  setPending: (pending) => set({ pending }),
  clearAll: () => set({ lines: [], pending: null }),
}));
