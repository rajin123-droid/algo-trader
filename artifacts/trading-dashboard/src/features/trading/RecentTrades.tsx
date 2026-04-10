import { motion, AnimatePresence } from "framer-motion";
import { RecentTrade } from "@/state/trading.store";

interface RecentTradesProps {
  trades: RecentTrade[];
}

export function RecentTrades({ trades }: RecentTradesProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex justify-between px-2 py-1 text-[10px] font-mono text-muted-foreground border-b border-border/20 shrink-0">
        <span>Price</span>
        <span>Qty</span>
        <span>Side</span>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col gap-[1px] pt-[2px]">
        <AnimatePresence mode="popLayout" initial={false}>
          {trades.map((t) => (
            <motion.div
              key={t.time}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="flex justify-between px-2 text-[11px] font-mono tabular-nums shrink-0"
            >
              <span style={{ color: t.side === "BUY" ? "#0ECB81" : "#F6465D" }}>
                {(Number(t.price) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-muted-foreground">{(Number(t.qty) || 0).toFixed(4)}</span>
              <span
                className="text-[9px] font-bold"
                style={{ color: t.side === "BUY" ? "#0ECB81" : "#F6465D" }}
              >
                {t.side}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
