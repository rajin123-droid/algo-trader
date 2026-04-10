import { useEffect, useRef, useState } from "react";
import { connectPriceStream } from "@/core/ws";

interface PriceTickerProps {
  symbol?: string;
  className?: string;
}

/**
 * Self-contained live price ticker.
 * Opens a Binance trade WebSocket and flashes green/red on each tick.
 *
 * Python/JS equivalent:
 *   const ws = connectPriceStream("btcusdt", setPrice)
 *   return () => ws.close()
 */
export function PriceTicker({ symbol = "btcusdt", className }: PriceTickerProps) {
  const [price, setPrice] = useState(0);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ws = connectPriceStream(symbol, (p) => {
      setPrice((prev) => {
        if (prevRef.current > 0) {
          const dir = p > prevRef.current ? "up" : p < prevRef.current ? "down" : null;
          if (dir) {
            setFlash(dir);
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setFlash(null), 280);
          }
        }
        prevRef.current = p;
        return p;
      });
    });

    return () => {
      ws.close();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [symbol]);

  const formatted =
    price > 0
      ? price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "—";

  const color =
    flash === "up" ? "#0ECB81" : flash === "down" ? "#F6465D" : "#E8E8E8";

  return (
    <span
      className={`tabular-nums font-bold transition-colors duration-150 ${className ?? ""}`}
      style={{ color }}
    >
      {symbol.toUpperCase().replace("USDT", "")}/USDT {formatted}
    </span>
  );
}
