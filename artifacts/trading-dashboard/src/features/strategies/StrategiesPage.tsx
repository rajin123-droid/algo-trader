import { useState, useEffect, useCallback } from "react";
import {
  generateAiStrategy, deployAiStrategy,
  getAutoTradingStatus, startAutoTrading, stopAutoTrading, getAutoTradingTrades,
  getBacktestStrategies, getExchangeStatus, switchSessionMode, getMarketDataStatus,
  type AiStrategyResult, type AutoTradingSession, type ExchangeStatus, type MarketDataStatus,
} from "@/core/api";
import { useTradingStore } from "@/state/trading.store";
import { useAutoTradingStore } from "@/state/auto-trading.store";
import { fmtNum, fmtPnl, fmtPct, fmtUsd, fmtPrice, fmtDate, isPositive } from "@/core/utils/format";

const BORDER = "1px solid #2B3139";
const TABS = ["AI Strategy Builder", "Auto-Trading", "Exchange"] as const;
type Tab = typeof TABS[number];

const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];

function Spinner({ label = "Loading..." }: { label?: string }) {
  return <div className="flex items-center justify-center h-40 text-xs text-muted-foreground font-mono">{label}</div>;
}
function Err({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8">
      <span className="text-xs text-[#F6465D] font-mono">{msg}</span>
      {onRetry && <button onClick={onRetry} className="text-xs text-muted-foreground underline font-mono">Retry</button>}
    </div>
  );
}
function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold"
      style={{ background: `${color}22`, color }}>{children}</span>
  );
}
function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded border p-3 space-y-0.5" style={{ borderColor: BORDER, background: "#12161a" }}>
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-base font-mono font-bold" style={{ color: color ?? "#E8E8E8" }}>{value}</div>
    </div>
  );
}

// ── AI Strategy Builder ───────────────────────────────────────────────────────
function AiStrategyTab() {
  const symbol = useTradingStore((s) => s.symbol);
  const [idea, setIdea] = useState("");
  const [sym, setSym] = useState(symbol || "BTCUSDT");
  const [interval, setInterval] = useState("1h");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiStrategyResult | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployed, setDeployed] = useState<string | null>(null);

  async function generate() {
    if (!idea.trim() || idea.trim().length < 5) {
      setError("Enter at least 5 characters describing your strategy.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setDeployed(null);
    try {
      const r = await generateAiStrategy({
        idea: idea.trim(), symbol: sym, interval, optimize: true, iterations: 15,
      });
      setResult(r);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  async function deploy(mode: "paper" | "live") {
    if (!result) return;
    setDeploying(true);
    try {
      const cfg = result.optimized?.config ?? result.generated.config;
      const r = await deployAiStrategy({ config: cfg, symbol: sym, interval, mode });
      setDeployed(r.sessionId);
    } catch (e) { alert((e as Error).message); }
    finally { setDeploying(false); }
  }

  const best = result?.optimized ?? result?.generated;
  const winRate = Number(best?.result?.winRate ?? 0);
  const sharpe  = Number(best?.result?.sharpeRatio ?? 0);
  const dd      = Number(best?.result?.maxDrawdown ?? 0);
  const totalPnl  = Number(best?.result?.totalPnl ?? 0);
  const initBal   = Number(best?.result?.initialBalance ?? 0);
  const finalBal  = Number(best?.result?.finalBalance ?? 0);

  return (
    <div className="overflow-auto h-full p-4 space-y-5 max-w-3xl">
      {/* ── Input ─────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          Describe your strategy in plain English
        </div>
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder={'E.g. "Buy when EMA 9 crosses above EMA 21, sell on the reverse cross. Use 2% risk per trade."'}
          rows={4}
          className="w-full bg-[#12161a] border border-border/40 rounded px-3 py-2 text-xs font-mono outline-none resize-none focus:border-[#F0B90B]/40 transition-colors"
        />
        <div className="flex gap-3 flex-wrap items-end">
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground font-mono">Symbol</div>
            <select value={sym} onChange={(e) => setSym(e.target.value)}
              className="bg-[#1a1d23] border border-border/40 rounded px-2 py-1 text-xs font-mono outline-none">
              {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground font-mono">Interval</div>
            <select value={interval} onChange={(e) => setInterval(e.target.value)}
              className="bg-[#1a1d23] border border-border/40 rounded px-2 py-1 text-xs font-mono outline-none">
              {INTERVALS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <button
            onClick={generate}
            disabled={loading}
            className="px-5 py-1.5 rounded text-xs font-mono font-semibold transition-colors disabled:opacity-50"
            style={{ background: "#F0B90B22", color: "#F0B90B", border: "1px solid #F0B90B44" }}
          >
            {loading ? "Generating…" : "Generate Strategy"}
          </button>
        </div>
        {loading && (
          <div className="text-xs font-mono text-muted-foreground animate-pulse">
            Running AI pipeline: generate → backtest → optimize… (5–15 s)
          </div>
        )}
      </div>

      {error && <Err msg={error} />}

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {result && best && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-semibold">
              {String(best.config?.["name"] ?? "Generated Strategy")}
            </span>
            <Badge color="#F0B90B">{result.symbol} · {result.interval}</Badge>
            {result.optimized && <Badge color="#0ECB81">Optimized</Badge>}
            <span className="text-[10px] text-muted-foreground font-mono ml-auto">
              {result.candleCount ?? 0} candles
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Stat label="Final Balance" value={fmtUsd(finalBal)}
              color={isPositive(finalBal - initBal) ? "#0ECB81" : "#F6465D"} />
            <Stat label="Total PnL" value={`${isPositive(totalPnl) ? "+" : ""}${fmtUsd(totalPnl)}`}
              color={isPositive(totalPnl) ? "#0ECB81" : "#F6465D"} />
            <Stat label="Win Rate" value={fmtPct(winRate)}
              color={winRate > 0.5 ? "#0ECB81" : "#F6465D"} />
            <Stat label="Total Trades" value={String(best.result?.totalTrades ?? 0)} />
            <Stat label="Sharpe Ratio" value={fmtNum(sharpe)}
              color={sharpe > 1 ? "#0ECB81" : sharpe > 0 ? "#F0B90B" : "#F6465D"} />
            <Stat label="Max Drawdown" value={fmtPct(dd)}
              color={dd < 0.1 ? "#0ECB81" : "#F0B90B"} />
          </div>

          {best.evaluation && (
            <div className="rounded border p-4 space-y-1" style={{ borderColor: BORDER, background: "#12161a" }}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-mono font-semibold">AI Evaluation</span>
                <Badge color={best.evaluation.grade === "A" ? "#0ECB81" : best.evaluation.grade === "B" ? "#F0B90B" : "#F6465D"}>
                  Grade {best.evaluation.grade ?? "—"}
                </Badge>
                <span className="text-xs font-mono text-muted-foreground">
                  Score: {fmtNum((best.evaluation.score ?? 0) * 100, 0)}%
                </span>
              </div>
              {best.evaluation.summary && (
                <p className="text-[11px] text-muted-foreground leading-relaxed">{best.evaluation.summary}</p>
              )}
            </div>
          )}

          {deployed ? (
            <div className="text-xs font-mono text-[#0ECB81]">✓ Deployed — Session ID: {deployed}</div>
          ) : (
            <div className="flex gap-2">
              <button disabled={deploying} onClick={() => deploy("paper")}
                className="px-4 py-1.5 rounded text-xs font-mono font-semibold disabled:opacity-50 transition-colors"
                style={{ background: "#0ECB8122", color: "#0ECB81", border: "1px solid #0ECB8144" }}>
                {deploying ? "…" : "Deploy Paper"}
              </button>
              <button disabled={deploying} onClick={() => deploy("live")}
                className="px-4 py-1.5 rounded text-xs font-mono font-semibold disabled:opacity-50 transition-colors"
                style={{ background: "#F0B90B22", color: "#F0B90B", border: "1px solid #F0B90B44" }}>
                {deploying ? "…" : "Deploy Live"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Auto-Trading Tab ──────────────────────────────────────────────────────────
function AutoTradingTab() {
  const [sessions, setSessions] = useState<AutoTradingSession[]>([]);
  const [strategies, setStrategies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [strategy, setStrategy] = useState("ema-crossover");
  const [sym, setSym] = useState("BTCUSDT");
  const [interval, setInterval] = useState("1m");
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState<string | null>(null);
  const [switchingMode, setSwitchingMode] = useState<string | null>(null);

  // Trades come from the global store — updated instantly via AUTO_TRADE WS events
  const trades  = useAutoTradingStore((s) => s.trades);
  const setStoreTrades = useAutoTradingStore((s) => s.setTrades);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      getAutoTradingStatus(),
      getAutoTradingTrades({ limit: 50 }),
      getBacktestStrategies(),
    ])
      .then(([s, t, strats]) => {
        setSessions(Array.isArray(s.sessions) ? s.sessions : []);
        // Seed the store with API data; WS events will prepend newer trades on top
        if (Array.isArray(t.trades)) setStoreTrades(t.trades);
        const stratList = Array.isArray(strats.strategies) ? strats.strategies : [];
        setStrategies(stratList);
        if (stratList.length > 0) setStrategy(stratList[0]);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [setStoreTrades]);

  useEffect(() => { load(); }, [load]);

  // Poll every 30 s to catch any trades that arrived between WS reconnects
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  async function start() {
    setStarting(true);
    try {
      await startAutoTrading({ userId: "me", strategy, symbol: sym, interval, mode });
      await load();
    } catch (e) { alert((e as Error).message); }
    finally { setStarting(false); }
  }

  async function stop(sessionId: string) {
    setStopping(sessionId);
    try {
      await stopAutoTrading(sessionId, "me");
      setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, isActive: false } : s));
    } catch (e) { alert((e as Error).message); }
    finally { setStopping(null); }
  }

  async function toggleMode(sessionId: string, currentMode: string) {
    const newMode = currentMode === "live" ? "paper" : "live";
    if (newMode === "live") {
      const ok = window.confirm(
        "⚠️  Switch to LIVE mode?\n\n" +
        "This will send real orders to Binance. " +
        "Make sure your API credentials are configured and you understand the risks."
      );
      if (!ok) return;
    }
    setSwitchingMode(sessionId);
    try {
      await switchSessionMode(sessionId, newMode);
      setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, mode: newMode } : s));
    } catch (e) { alert((e as Error).message); }
    finally { setSwitchingMode(null); }
  }

  if (loading) return <Spinner />;
  if (error) return <Err msg={error} onRetry={load} />;

  const activeSessions = sessions.filter((s) => s.isActive);

  return (
    <div className="overflow-auto h-full p-4 space-y-5">
      {/* ── Launch form ──────────────────────────────────────────────────────── */}
      <div className="rounded border p-4 space-y-4 max-w-xl" style={{ borderColor: BORDER, background: "#12161a" }}>
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Launch New Session</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Strategy">
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)}
              className="w-full bg-[#1a1d23] border border-border/40 rounded px-2 py-1 text-xs font-mono outline-none">
              {strategies.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Symbol">
            <select value={sym} onChange={(e) => setSym(e.target.value)}
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
          <Field label="Mode">
            <select value={mode} onChange={(e) => setMode(e.target.value as "paper" | "live")}
              className="w-full bg-[#1a1d23] border border-border/40 rounded px-2 py-1 text-xs font-mono outline-none">
              <option value="paper">Paper</option>
              <option value="live">Live</option>
            </select>
          </Field>
        </div>
        <button disabled={starting} onClick={start}
          className="px-5 py-1.5 rounded text-xs font-mono font-semibold disabled:opacity-50 transition-colors"
          style={{ background: "#0ECB8122", color: "#0ECB81", border: "1px solid #0ECB8144" }}>
          {starting ? "Starting…" : "Start Session"}
        </button>
      </div>

      {/* ── Sessions table ────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          Sessions ({sessions.length}) · Active: {activeSessions.length}
        </div>
        {sessions.length === 0 ? (
          <div className="text-xs text-muted-foreground font-mono">No sessions yet.</div>
        ) : (
          <div className="rounded border overflow-hidden" style={{ borderColor: BORDER }}>
            <table className="w-full text-xs font-mono border-collapse">
              <thead>
                <tr style={{ borderBottom: BORDER }}>
                  {["Strategy", "Symbol", "Interval", "Mode", "Status", "Actions"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-muted-foreground font-normal uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const sessionMode = (s.mode ?? "paper") as string;
                  const isLive = sessionMode === "live";
                  return (
                    <tr key={s.id} style={{ borderBottom: BORDER }} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2">{s.strategyId ?? "—"}</td>
                      <td className="px-3 py-2">{s.symbol ?? "—"}</td>
                      <td className="px-3 py-2">{s.interval ?? "—"}</td>
                      <td className="px-3 py-2">
                        <button
                          disabled={switchingMode === s.id}
                          onClick={() => toggleMode(s.id, sessionMode)}
                          title={isLive ? "Click to switch to Paper" : "Click to switch to Live"}
                          className="flex items-center gap-1 disabled:opacity-50 transition-opacity"
                        >
                          <Badge color={isLive ? "#F0B90B" : "#8B8FA8"}>
                            {switchingMode === s.id ? "…" : sessionMode}
                          </Badge>
                          <span className="text-[9px] text-muted-foreground">⇄</span>
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <Badge color={s.isActive ? "#0ECB81" : "#555C6A"}>{s.isActive ? "Running" : "Stopped"}</Badge>
                      </td>
                      <td className="px-3 py-2 flex gap-2 items-center">
                        {s.isActive && (
                          <button disabled={stopping === s.id} onClick={() => stop(s.id)}
                            className="text-[10px] font-mono text-[#F6465D] hover:underline disabled:opacity-50">
                            {stopping === s.id ? "…" : "Stop"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Trades table ──────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          Recent Auto-Trades ({trades.length})
        </div>
        {trades.length === 0 ? (
          <div className="text-xs text-muted-foreground font-mono">No automated trades executed yet.</div>
        ) : (
          <div className="rounded border overflow-hidden" style={{ borderColor: BORDER }}>
            <table className="w-full text-xs font-mono border-collapse">
              <thead>
                <tr style={{ borderBottom: BORDER }}>
                  {["Time", "Symbol", "Side", "Price", "Qty", "PnL"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-muted-foreground font-normal uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const tPnl = Number(t.pnl ?? 0);
                  return (
                    <tr key={t.id} style={{ borderBottom: BORDER }} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(t.executedAt)}</td>
                      <td className="px-3 py-2">{t.symbol ?? "—"}</td>
                      <td className="px-3 py-2">
                        <Badge color={(t.side ?? "BUY") === "BUY" ? "#0ECB81" : "#F6465D"}>{t.side ?? "—"}</Badge>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{fmtPrice(t.price)}</td>
                      <td className="px-3 py-2 tabular-nums">{fmtNum(t.quantity, 4)}</td>
                      <td className="px-3 py-2 tabular-nums font-semibold" style={{ color: tPnl >= 0 ? "#0ECB81" : "#F6465D" }}>
                        {fmtPnl(t.pnl)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Exchange Tab ──────────────────────────────────────────────────────────────
function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className="inline-block w-2 h-2 rounded-full mr-1.5"
      style={{ background: ok ? "#0ECB81" : "#F6465D", boxShadow: ok ? "0 0 6px #0ECB8188" : undefined }} />
  );
}

function ExchangeTab() {
  const [status, setStatus] = useState<ExchangeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marketStatus, setMarketStatus] = useState<MarketDataStatus | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getExchangeStatus()
      .then((s) => { setStatus(s); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    getMarketDataStatus()
      .then((m) => setMarketStatus(m))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);

  if (loading && !status) return <Spinner />;
  if (error && !status) return <Err msg={error} onRetry={load} />;

  const s = status!;

  return (
    <div className="overflow-auto h-full p-6 space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Exchange Connection</div>
        <button onClick={load} className="text-[10px] font-mono text-muted-foreground hover:text-foreground">↻ Refresh</button>
      </div>

      {/* Connection card */}
      <div className="rounded border p-5 space-y-4" style={{ borderColor: "#2B3139", background: "#12161a" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusDot ok={s.connected} />
            <span className="text-sm font-mono font-semibold">{s.connected ? "Connected" : "Offline"}</span>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded"
            style={{ background: s.network === "TESTNET" ? "#F0B90B22" : "#0ECB8122", color: s.network === "TESTNET" ? "#F0B90B" : "#0ECB81" }}>
            {s.network ?? "UNKNOWN"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs font-mono">
          <div className="space-y-0.5">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Endpoint</div>
            <div className="text-foreground break-all">{s.baseURL}</div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Latency</div>
            <div className="text-foreground">{s.latencyMs != null ? `${s.latencyMs} ms` : "—"}</div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider">API Credentials</div>
            <div className="flex items-center gap-1">
              <StatusDot ok={s.credentialsOk} />
              <span style={{ color: s.credentialsOk ? "#0ECB81" : "#F6465D" }}>
                {s.credentialsOk ? "Configured" : "Not configured"}
              </span>
            </div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Live Trading</div>
            <div className="flex items-center gap-1">
              <StatusDot ok={s.canGoLive} />
              <span style={{ color: s.canGoLive ? "#0ECB81" : "#F6465D" }}>
                {s.canGoLive ? "Ready" : "Not ready"}
              </span>
            </div>
          </div>
        </div>

        {s.error && (
          <div className="text-[10px] font-mono text-[#F6465D] p-2 rounded" style={{ background: "#F6465D11" }}>
            {s.error}
          </div>
        )}
      </div>

      {/* Market Data Feed card */}
      {marketStatus && (
        <div className="rounded border p-5 space-y-4" style={{ borderColor: "#2B3139", background: "#12161a" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusDot ok={marketStatus.connected} />
              <span className="text-sm font-mono font-semibold">Market Data Feed</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded"
              style={{
                background: marketStatus.connected ? "#0ECB8122" : "#F6465D22",
                color:      marketStatus.connected ? "#0ECB81"   : "#F6465D",
              }}>
              {marketStatus.connected ? "Binance WS" : "Simulator"}
            </span>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">
            {marketStatus.connected
              ? "Real-time aggTrade stream active — strategies and SL/TP use live prices."
              : "GBM price simulator active — connect Binance WebSocket for real prices."}
          </div>
          {marketStatus.connected && (
            <div className="grid grid-cols-2 gap-2">
              {marketStatus.symbols.map((sym) => (
                <div key={sym} className="flex items-center justify-between text-[11px] font-mono px-2 py-1 rounded"
                  style={{ background: "#0B0E11", border: "1px solid #2B3139" }}>
                  <span className="text-muted-foreground">{sym}</span>
                  <span className="text-foreground">
                    {(marketStatus.prices[sym] ?? 0) > 0
                      ? `$${(Number(marketStatus.prices[sym]) || 0).toFixed(2)}`
                      : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Setup instructions */}
      {!s.credentialsOk && (
        <div className="rounded border p-4 space-y-3" style={{ borderColor: "#F0B90B44", background: "#F0B90B08" }}>
          <div className="text-[10px] font-mono font-semibold text-[#F0B90B] uppercase tracking-wider">Setup Required</div>
          <div className="text-xs font-mono text-muted-foreground space-y-2">
            <p>To enable live trading, add the following environment variables:</p>
            <div className="rounded p-3 space-y-1 font-mono text-[11px]"
              style={{ background: "#0B0E11", border: "1px solid #2B3139" }}>
              <div><span className="text-[#F0B90B]">BINANCE_API_KEY</span>=your_testnet_api_key</div>
              <div><span className="text-[#F0B90B]">BINANCE_SECRET_KEY</span>=your_testnet_secret_key</div>
              <div><span className="text-[#0ECB81]">BINANCE_BASE_URL</span>=https://testnet.binance.vision</div>
            </div>
            <p className="text-[10px]">
              Get testnet keys at{" "}
              <a href="https://testnet.binance.vision" target="_blank" rel="noreferrer"
                className="text-[#F0B90B] underline">testnet.binance.vision</a>
            </p>
          </div>
        </div>
      )}

      {/* Risk limits card */}
      <div className="rounded border p-4 space-y-3" style={{ borderColor: "#2B3139", background: "#12161a" }}>
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Risk Limits (server-side)</div>
        <div className="grid grid-cols-2 gap-3 text-xs font-mono">
          <div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">Max Order Notional</div>
            <div className="text-foreground">$10,000 USD</div>
          </div>
          <div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">Kill Switch</div>
            <div className="text-[#0ECB81]">Active on admin halt</div>
          </div>
          <div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">Credential Guard</div>
            <div className="text-[#0ECB81]">Pre-flight check</div>
          </div>
          <div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">Order Type</div>
            <div className="text-foreground">MARKET (FULL response)</div>
          </div>
        </div>
      </div>

      {/* Testnet note */}
      <div className="text-[10px] font-mono text-muted-foreground leading-relaxed">
        Always test on Binance Testnet before using real funds.
        Switch sessions to "live" mode individually via the Auto-Trading tab.
        Each mode switch restarts the engine with the correct executor.
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-mono text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function StrategiesPage() {
  const [tab, setTab] = useState<Tab>("AI Strategy Builder");

  return (
    <div className="flex flex-col h-full font-mono overflow-hidden" style={{ background: "#0B0E11" }}>
      <div className="flex items-center shrink-0" style={{ borderBottom: BORDER, height: 44 }}>
        <span className="px-4 text-xs text-muted-foreground uppercase tracking-widest mr-4">Strategies</span>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 h-full text-[11px] font-mono transition-colors"
            style={{
              color: tab === t ? "#E8E8E8" : "#555C6A",
              borderBottom: tab === t ? "2px solid #F0B90B" : "2px solid transparent",
              background: "transparent",
            }}>
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "AI Strategy Builder" && <AiStrategyTab />}
        {tab === "Auto-Trading"        && <AutoTradingTab />}
        {tab === "Exchange"            && <ExchangeTab />}
      </div>
    </div>
  );
}
