import { useState, useEffect, useCallback } from "react";
import { getMarketplaceCopyTrades, getMarketplaceSubscriptions, type CopyTrade, type MarketplaceSubscription } from "@/core/api";
import { fmtPrice, fmtPnl, fmtNum, fmtDate, isPositive } from "@/core/utils/format";

const BORDER = "1px solid #2B3139";

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold"
      style={{ background: `${color}22`, color }}>
      {children}
    </span>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded border p-3 space-y-1" style={{ borderColor: BORDER, background: "#12161a" }}>
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-xl font-mono font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

export default function CopyTradingPage() {
  const [trades, setTrades] = useState<CopyTrade[]>([]);
  const [subs, setSubs] = useState<MarketplaceSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([getMarketplaceCopyTrades(), getMarketplaceSubscriptions()])
      .then(([c, s]) => {
        setTrades(Array.isArray(c.copyTrades) ? c.copyTrades : []);
        setSubs(Array.isArray(s.subscriptions) ? s.subscriptions : []);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Safe aggregate calculations
  const totalPnl = trades.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
  const wins = trades.filter((t) => Number(t.pnl ?? 0) > 0).length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

  return (
    <div className="flex flex-col h-full font-mono overflow-hidden" style={{ background: "#0B0E11" }}>
      <div className="flex items-center justify-between px-4 shrink-0" style={{ height: 44, borderBottom: BORDER }}>
        <span className="text-xs text-muted-foreground uppercase tracking-widest">Copy Trading</span>
        <button onClick={load} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">↻ Refresh</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1 text-xs text-muted-foreground">Loading...</div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2">
          <span className="text-xs text-[#F6465D] font-mono">{error}</span>
          <button onClick={load} className="text-xs text-muted-foreground underline">Retry</button>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {/* ── Summary stats ───────────────────────────────────────────────── */}
          <div className="p-4 grid grid-cols-3 gap-3 max-w-xl">
            <Stat label="Copy Trades" value={String(trades.length)} color="#F0B90B" />
            <Stat label="Total PnL"
              value={`${isPositive(totalPnl) ? "+" : ""}$${fmtNum(totalPnl)}`}
              color={isPositive(totalPnl) ? "#0ECB81" : "#F6465D"} />
            <Stat label="Win Rate" value={`${fmtNum(winRate, 1)}%`} color="#8B8FA8" />
          </div>

          {/* ── Active subscriptions ─────────────────────────────────────────── */}
          <div className="px-4 pb-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
              Active Subscriptions ({subs.filter((s) => s.isActive).length})
            </div>
            {subs.filter((s) => s.isActive).length === 0 ? (
              <div className="text-xs text-muted-foreground mb-4">
                No active subscriptions. Go to <span className="text-[#F0B90B]">Marketplace</span> to subscribe to strategies.
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap mb-4">
                {subs.filter((s) => s.isActive).map((s) => (
                  <div key={s.id} className="rounded border px-3 py-1.5 text-[11px] font-mono" style={{ borderColor: BORDER, background: "#12161a" }}>
                    <span className="text-muted-foreground">Sub #{s.id}</span>
                    {s.copyRatio != null && (
                      <span className="ml-2 text-[#0ECB81]">{fmtNum(s.copyRatio, 1)}×</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Copy trade history ───────────────────────────────────────────── */}
          <div className="px-4 pb-4">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
              Copy Trade History ({trades.length})
            </div>

            {trades.length === 0 ? (
              <div className="rounded border p-8 flex items-center justify-center text-xs text-muted-foreground" style={{ borderColor: BORDER }}>
                No copy trades yet. Subscribe to a strategy in the Marketplace to start mirroring trades.
              </div>
            ) : (
              <div className="rounded border overflow-hidden" style={{ borderColor: BORDER }}>
                <table className="w-full text-xs font-mono border-collapse">
                  <thead>
                    <tr style={{ borderBottom: BORDER }}>
                      {["Time", "Symbol", "Side", "Origin Price", "Copy Price", "Qty", "PnL"].map((h) => (
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
                          <td className="px-3 py-2 tabular-nums">{fmtPrice(t.originPrice)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtPrice(t.copyPrice)}</td>
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
      )}
    </div>
  );
}
