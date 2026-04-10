import { motion, AnimatePresence } from "framer-motion";
import { useOrderBookStore, type OrderBookEntry } from "./orderbook.store";
import { useTradingStore } from "@/state/trading.store";

function maxTotal(entries: OrderBookEntry[]) {
  return Math.max(...entries.map((e) => e.total), 0.001);
}

function formatQty(n: number): string {
  if (n >= 1000) return n.toFixed(1);
  if (n >= 10)   return n.toFixed(2);
  return n.toFixed(4);
}

function Row({
  entry,
  side,
  maxT,
}: {
  entry: OrderBookEntry;
  side: "bid" | "ask";
  maxT: number;
}) {
  const fillPct = Math.min((entry.total / maxT) * 100, 100);
  const color   = side === "bid" ? "#0ECB81" : "#F6465D";
  const bgColor = side === "bid" ? "rgba(14,203,129,0.10)" : "rgba(246,70,93,0.10)";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: side === "bid" ? -4 : 4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15 }}
      className="relative grid grid-cols-3 items-center px-2 py-[2px] text-[11px] font-mono cursor-default hover:brightness-125"
      style={{ minHeight: 18 }}
    >
      <div
        className="absolute inset-y-0 right-0"
        style={{
          width: `${fillPct}%`,
          background: bgColor,
          transition: "width 0.25s ease",
        }}
      />
      <span style={{ color }} className="relative z-10 tabular-nums">
        {entry.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <span className="relative z-10 tabular-nums text-muted-foreground text-right">
        {formatQty(entry.qty)}
      </span>
      <span className="relative z-10 tabular-nums text-muted-foreground text-right">
        {formatQty(entry.total)}
      </span>
    </motion.div>
  );
}

function computeSpread(
  asks: OrderBookEntry[],
  bids: OrderBookEntry[]
): { abs: string; pct: string } | null {
  const bestAsk = asks[0]?.price;
  const bestBid = bids[0]?.price;
  if (!bestAsk || !bestBid || bestAsk <= bestBid) return null;
  const abs = bestAsk - bestBid;
  const pct = (abs / bestAsk) * 100;
  return {
    abs: abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    pct: pct.toFixed(3) + "%",
  };
}

export function OrderBook() {
  const { bids, asks } = useOrderBookStore();
  const { price, priceChange } = useTradingStore();

  const maxBidTotal = maxTotal(bids);
  const maxAskTotal = maxTotal(asks);
  const isPriceUp   = priceChange >= 0;
  const spread      = computeSpread(asks, bids);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-2 py-2 border-b border-border/40">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          Order Book
        </span>
      </div>

      <div className="grid grid-cols-3 px-2 py-1 text-[10px] font-mono text-muted-foreground border-b border-border/20">
        <span>Price (USDT)</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Total</span>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden flex flex-col-reverse">
          <AnimatePresence mode="popLayout">
            {asks.slice().reverse().map((ask) => (
              <Row key={ask.price} entry={ask} side="ask" maxT={maxAskTotal} />
            ))}
          </AnimatePresence>
        </div>

        {/* ── Mid-price + spread ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-2 py-2 border-y border-border/40">
          <span
            className="text-base font-mono font-bold tabular-nums"
            style={{ color: isPriceUp ? "#0ECB81" : "#F6465D" }}
          >
            {price > 0
              ? price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : "—"}
            <span className="ml-1 text-xs">{isPriceUp ? "▲" : "▼"}</span>
          </span>

          {spread ? (
            <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
              Spread&nbsp;
              <span className="text-foreground/70">{spread.abs}</span>
              <span className="ml-1 opacity-60">({spread.pct})</span>
            </span>
          ) : (
            <span className="text-[10px] font-mono text-muted-foreground">Spread —</span>
          )}
        </div>

        <div className="flex-1 overflow-hidden">
          <AnimatePresence mode="popLayout">
            {bids.map((bid) => (
              <Row key={bid.price} entry={bid} side="bid" maxT={maxBidTotal} />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
