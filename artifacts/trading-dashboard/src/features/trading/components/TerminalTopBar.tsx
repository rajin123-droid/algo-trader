import { useTradingStore } from "@/state/trading.store";
import { cn } from "@/lib/utils";
import { Wifi, WifiOff } from "lucide-react";

const SYMBOLS = [
  { label: "BTC/USDT", value: "BTCUSDT" },
  { label: "ETH/USDT", value: "ETHUSDT" },
  { label: "SOL/USDT", value: "SOLUSDT" },
  { label: "BNB/USDT", value: "BNBUSDT" },
];

const BORDER = "1px solid #2B3139";

function Stat({ label, value, colored }: { label: string; value: string; colored?: string }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn("text-xs font-mono tabular-nums", colored ?? "text-foreground")}>
        {value}
      </span>
    </div>
  );
}

export function TerminalTopBar() {
  const {
    symbol,
    setSymbol,
    price,
    priceChange,
    priceChangePercent,
    volume,
    high24h,
    low24h,
    binanceConnected,
    gatewayConnected,
  } = useTradingStore();

  const up = priceChange >= 0;
  const connected = binanceConnected;

  function fmtPrice(n: number) {
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtVol(n: number) {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return n.toFixed(2);
  }

  return (
    <div
      className="flex items-center gap-5 px-4 shrink-0 select-none"
      style={{ height: 40, borderBottom: BORDER, background: "#0B0E11" }}
    >

      <select
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        className="bg-transparent text-xs font-mono text-foreground border border-border/40 rounded px-2 py-1 outline-none cursor-pointer hover:border-border transition-colors"
      >
        {SYMBOLS.map((s) => (
          <option key={s.value} value={s.value} className="bg-[#1a1d23]">
            {s.label}
          </option>
        ))}
      </select>

      <div className="h-5 w-px bg-border/40 shrink-0" />

      <div className="flex items-baseline gap-2">
        <span
          className="text-lg font-mono font-bold tabular-nums leading-none"
          style={{ color: up ? "#26a69a" : "#ef5350" }}
        >
          {fmtPrice(price)}
        </span>
        <span
          className="text-xs font-mono"
          style={{ color: up ? "#26a69a" : "#ef5350" }}
        >
          {up ? "+" : ""}
          {fmtPrice(priceChange)} ({up ? "+" : ""}
          {priceChangePercent.toFixed(2)}%)
        </span>
      </div>

      <div className="h-5 w-px bg-border/40 shrink-0" />

      <div className="flex items-center gap-5">
        <Stat label="24h High" value={fmtPrice(high24h)} colored="text-[#26a69a]" />
        <Stat label="24h Low" value={fmtPrice(low24h)} colored="text-[#ef5350]" />
        <Stat label="24h Vol" value={fmtVol(volume)} />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-[10px]">
          {connected ? (
            <>
              <Wifi className="h-3 w-3 text-[#26a69a]" />
              <span className="text-[#26a69a]">LIVE</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">CONNECTING</span>
            </>
          )}
        </div>
        {gatewayConnected && (
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#26a69a] animate-pulse" />
            <span className="text-[#26a69a]">GATEWAY</span>
          </div>
        )}
      </div>
    </div>
  );
}
