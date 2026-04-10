import { useMemo } from "react";
import { useOrderBookStore } from "./orderbook.store";

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function Heatmap() {
  const { bids, asks } = useOrderBookStore();

  const allQtys = useMemo(() => [...bids, ...asks].map((e) => e.qty), [bids, asks]);
  const maxQ = useMemo(() => Math.max(...allQtys, 0.001), [allQtys]);

  const combined = useMemo(() => {
    const bidCells = bids.map((b) => ({ ...b, side: "bid" as const }));
    const askCells = asks.map((a) => ({ ...a, side: "ask" as const }));
    return [...askCells.slice().reverse(), ...bidCells];
  }, [bids, asks]);

  if (combined.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs font-mono">
        Awaiting heatmap data...
      </div>
    );
  }

  return (
    <div className="grid h-full" style={{ gridTemplateColumns: `repeat(${combined.length}, 1fr)` }}>
      {combined.map((cell, i) => {
        const intensity = clamp(cell.qty / maxQ, 0.05, 1);
        const base = cell.side === "bid" ? "14,203,129" : "246,70,93";
        const alpha = intensity * 0.85;
        return (
          <div
            key={i}
            title={`$${cell.price.toLocaleString()}\n${cell.qty.toFixed(4)} BTC`}
            className="flex flex-col justify-end items-center cursor-default overflow-hidden"
            style={{
              background: `rgba(${base},${alpha})`,
              borderRight: "1px solid rgba(0,0,0,0.2)",
              transition: "background 0.2s ease",
            }}
          >
            <span
              className="font-mono rotate-90 origin-center select-none"
              style={{
                fontSize: 7,
                color: `rgba(255,255,255,${clamp(intensity, 0.3, 0.9)})`,
                whiteSpace: "nowrap",
                transformOrigin: "center center",
                writingMode: "vertical-rl",
                transform: "rotate(180deg)",
              }}
            >
              {cell.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
