import { useState, useEffect } from "react";
import { getBacktestStrategies, runBacktest, type BacktestResult } from "@/core/api";
import { fmtNum, fmtPnl, fmtUsd, fmtPct, fmtPrice, fmtEpoch, isPositive } from "@/core/utils/format";

const BORDER = "1px solid #2B3139";
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];
const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded border p-3 space-y-0.5" style={{ borderColor: BORDER, background: "#12161a" }}>
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-lg font-mono font-bold" style={{ color: color ?? "#E8E8E8" }}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{label}</div>
      {children}
    </div>
  );
}

export default function BacktestingPage() {
  const [strategies, setStrategies] = useState<string[]>([]);
  const [strategy, setStrategy] = useState("");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState("1h");
  const [limit, setLimit] = useState(500);
  const [initialBalance, setInitialBalance] = useState(10000);
  const [loading, setLoading] = useState(false);
  const [loadingStrats, setLoadingStrats] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);

  useEffect(() => {
    getBacktestStrategies()
      .then((r) => {
        setStrategies(r.strategies);
        if (r.strategies.length > 0) setStrategy(r.strategies[0]);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingStrats(false));
  }, []);

  async function run() {
    if (!strategy) { setError("Select a strategy first."); return; }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await runBacktest({ strategy, symbol, interval, limit, initialBalance });
      setResult(r);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  // Safe percentage change calculation
  const initBal = Number(result?.initialBalance ?? 0);
  const finalBal = Number(result?.finalBalance ?? 0);
  const pnlPct = initBal > 0 ? ((finalBal - initBal) / initBal) * 100 : 0;

  return (
    <div className="flex flex-col h-full font-mono overflow-hidden" style={{ background: "#0B0E11" }}>
      <div className="flex items-center px-4 shrink-0" style={{ height: 44, borderBottom: BORDER }}>
        <span className="text-xs text-muted-foreground uppercase tracking-widest">Backtesting Engine</span>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-5">
        {/* ── Config panel ───────────────────────────────────────────────── */}
        <div className="rounded border p-4 space-y-4 max-w-2xl" style={{ borderColor: BORDER, background: "#12161a" }}>
          <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Configuration</div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Strategy">
              {loadingStrats ? (
                <div className="text-xs text-muted-foreground font-mono">Loading…</div>
              ) : (
                <select value={strategy} onChange={(e) => setStrategy(e.target.value)}
                  className="w-full bg-[#1a1d23] border border-border/40 rounded px-2 py-1 text-xs font-mono outline-none">
                  {strategies.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </Field>

            <Field label="Symbol">
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)}
                className="w-full bg-[#1a1d23] border border-border/40 rounded px-2 py-1 text-xs font-mono outline-none">
                {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>

            <Field label="Interval">
              <select value={interval} onChange={(e) => setInterval(e.target.value)}
                className="w-full bg-[#1a1d23] border border-border/40 rounded px-2 py-1 text-xs font-mono outline-none">
                {INTERVALS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </Field>

            <Field label="Candles">
              <input type="number" value={limit} min={10} max={2000}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="w-full bg-[#1a1d23] border border-border/40 rounded px-2 py-1 text-xs font-mono outline-none" />
            </Field>

            <Field label="Initial Balance ($)">
              <input type="number" value={initialBalance} min={100}
                onChange={(e) => setInitialBalance(Number(e.target.value))}
                className="w-full bg-[#1a1d23] border border-border/40 rounded px-2 py-1 text-xs font-mono outline-none" />
            </Field>
          </div>

          <button
            disabled={loading || loadingStrats}
            onClick={run}
            className="px-5 py-1.5 rounded text-xs font-mono font-semibold disabled:opacity-50 transition-colors"
            style={{ background: "#F0B90B22", color: "#F0B90B", border: "1px solid #F0B90B44" }}
          >
            {loading ? "Running backtest…" : "Run Backtest"}
          </button>
        </div>

        {error && <div className="text-xs font-mono text-[#F6465D]">{error}</div>}

        {/* ── Results ──────────────────────────────────────────────────────── */}
        {result && (
          <div className="space-y-4 max-w-3xl">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono font-semibold">{strategy}</span>
              <span className="text-[10px] font-mono text-muted-foreground">
                {result.symbol ?? symbol} · {result.interval ?? interval}
              </span>
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ml-auto"
                style={{
                  background: pnlPct >= 0 ? "#0ECB8122" : "#F6465D22",
                  color: pnlPct >= 0 ? "#0ECB81" : "#F6465D",
                }}>
                {pnlPct >= 0 ? "+" : ""}{fmtNum(pnlPct, 2)}%
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Stat label="Final Balance" value={fmtUsd(result.finalBalance)}
                color={isPositive(finalBal - initBal) ? "#0ECB81" : "#F6465D"} />
              <Stat label="Total PnL" value={`${isPositive(result.totalPnl) ? "+" : ""}${fmtUsd(result.totalPnl)}`}
                color={isPositive(result.totalPnl) ? "#0ECB81" : "#F6465D"} />
              <Stat label="Win Rate" value={fmtPct(result.winRate)}
                color={Number(result.winRate) > 0.5 ? "#0ECB81" : "#F6465D"} />
              <Stat label="Total Trades" value={String(result.totalTrades ?? 0)} />
              <Stat label="Sharpe Ratio" value={fmtNum(result.sharpeRatio)}
                color={Number(result.sharpeRatio) > 1 ? "#0ECB81" : Number(result.sharpeRatio) > 0 ? "#F0B90B" : "#F6465D"} />
              <Stat label="Max Drawdown" value={fmtPct(result.maxDrawdown)}
                color={Number(result.maxDrawdown) < 0.1 ? "#0ECB81" : Number(result.maxDrawdown) < 0.2 ? "#F0B90B" : "#F6465D"} />
            </div>

            {/* ── Trade log ──────────────────────────────────────────────── */}
            {Array.isArray(result.trades) && result.trades.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  Trade Log ({result.trades.length})
                </div>
                <div className="rounded border overflow-hidden" style={{ borderColor: BORDER }}>
                  <div className="overflow-auto max-h-72">
                    <table className="w-full text-xs font-mono border-collapse">
                      <thead>
                        <tr style={{ borderBottom: BORDER }}>
                          {["Entry Time", "Exit Time", "Side", "Entry", "Exit", "Qty", "PnL"].map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-muted-foreground font-normal text-[10px] uppercase tracking-wider sticky top-0 bg-[#0B0E11]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.trades.map((t, i) => {
                          const tPnl = Number(t.pnl ?? 0);
                          return (
                            <tr key={i} style={{ borderBottom: BORDER }} className="hover:bg-white/[0.02]">
                              <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{fmtEpoch(t.entryTime)}</td>
                              <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{fmtEpoch(t.exitTime)}</td>
                              <td className="px-3 py-1.5">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                  style={{ background: t.side === "BUY" ? "#0ECB8122" : "#F6465D22", color: t.side === "BUY" ? "#0ECB81" : "#F6465D" }}>
                                  {t.side ?? "—"}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 tabular-nums">{fmtPrice(t.entryPrice)}</td>
                              <td className="px-3 py-1.5 tabular-nums">{fmtPrice(t.exitPrice)}</td>
                              <td className="px-3 py-1.5 tabular-nums">{fmtNum(t.qty, 4)}</td>
                              <td className="px-3 py-1.5 tabular-nums font-semibold" style={{ color: tPnl >= 0 ? "#0ECB81" : "#F6465D" }}>
                                {fmtPnl(t.pnl)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
