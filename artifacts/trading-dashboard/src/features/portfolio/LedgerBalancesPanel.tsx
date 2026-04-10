/**
 * LedgerBalancesPanel — real-time asset balances derived from the double-entry ledger.
 *
 * Data flow:
 *   1. On mount: fetch GET /api/portfolio/summary
 *   2. On PORTFOLIO_UPDATE WebSocket event: re-fetch
 *   3. On ORDER_FILLED WebSocket event: re-fetch (position just opened/closed)
 *
 * The balance shown here is ALWAYS server-computed — never calculated in the
 * frontend.  This is the source of truth.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { Wallet, ArrowUpRight, ArrowDownRight, Lock, RefreshCw } from "lucide-react";
import { getPortfolioSummary, type PortfolioSummary } from "@/core/api";
import { usePortfolioStore } from "@/state/portfolio.store";
import { usePositionStore } from "@/state/position.store";
import { fmtUsd, fmtNum } from "@/core/utils/format";

const BORDER = "1px solid #2B3139";

function BalanceRow({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "green" | "red" | "yellow" | "default";
}) {
  const color =
    accent === "green"
      ? "#0ECB81"
      : accent === "red"
      ? "#F6465D"
      : accent === "yellow"
      ? "#FCD535"
      : "#EAECEF";

  return (
    <div
      className="flex items-center justify-between px-4 py-2.5"
      style={{ borderBottom: BORDER }}
    >
      <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <div className="text-right">
        <div className="text-sm font-mono font-medium" style={{ color }}>
          {value}
        </div>
        {sub && (
          <div className="text-[10px] font-mono text-muted-foreground">{sub}</div>
        )}
      </div>
    </div>
  );
}

export function LedgerBalancesPanel() {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [notLoggedIn, setNotLoggedIn] = useState(false);

  // Watch these store values to trigger re-fetches
  const fillVersion = usePositionStore((s) => s.fillVersion);
  const portfolioVersion = usePortfolioStore((s) => s.version ?? 0);
  const fetchRef = useRef(0);

  const fetchSummary = useCallback(async () => {
    const id = ++fetchRef.current;
    try {
      const data = await getPortfolioSummary();
      if (id !== fetchRef.current) return; // stale
      setSummary(data);
      setLastUpdated(new Date());
      setNotLoggedIn(false);
    } catch (err) {
      if (id !== fetchRef.current) return;
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("401") || msg.toLowerCase().includes("authorization")) {
        setNotLoggedIn(true);
      }
    } finally {
      if (id === fetchRef.current) setLoading(false);
    }
  }, []);

  // Re-fetch on: mount, any order fill, and any portfolio WS push
  useEffect(() => {
    fetchSummary();
  }, [fetchSummary, fillVersion, portfolioVersion]);

  if (notLoggedIn) {
    return (
      <div
        className="rounded border flex flex-col items-center justify-center gap-2 py-8"
        style={{ borderColor: "#2B3139", background: "#0B0E11" }}
      >
        <Wallet className="h-5 w-5 text-muted-foreground opacity-40" />
        <p className="text-xs font-mono text-muted-foreground">
          Sign in to see live ledger balances
        </p>
      </div>
    );
  }

  const usdt = summary?.usdtBalance ?? 0;
  const marginLocked = summary?.totalMarginLocked ?? 0;
  const available = usdt - marginLocked;
  const openCount = summary?.openPositionCount ?? 0;

  return (
    <div
      className="rounded border overflow-hidden"
      style={{ borderColor: "#2B3139", background: "#0B0E11" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ borderBottom: BORDER, background: "#161A1E" }}
      >
        <div className="flex items-center gap-2">
          <Wallet className="h-3.5 w-3.5 text-yellow-400" />
          <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
            Live Balances
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "#FCD53520", color: "#FCD535" }}>
            Ledger
          </span>
        </div>
        <button
          onClick={() => { setLoading(true); fetchSummary(); }}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh balances"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && !summary ? (
        <div className="px-4 py-6 text-center text-xs font-mono text-muted-foreground">
          Loading…
        </div>
      ) : (
        <>
          <BalanceRow
            label="USDT Balance"
            value={fmtUsd(usdt)}
            sub="from ledger"
            accent={usdt > 0 ? "green" : "default"}
          />
          <BalanceRow
            label="Margin Locked"
            value={fmtUsd(marginLocked)}
            sub={`${openCount} open position${openCount !== 1 ? "s" : ""}`}
            accent={marginLocked > 0 ? "yellow" : "default"}
          />
          <BalanceRow
            label="Available"
            value={fmtUsd(Math.max(0, available))}
            accent={available >= 0 ? "green" : "red"}
          />

          {summary?.allBalances && summary.allBalances.length > 0 && (
            <>
              <div
                className="px-4 py-1.5 text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest"
                style={{ borderBottom: BORDER }}
              >
                All Assets
              </div>
              {summary.allBalances.map((b) => (
                <BalanceRow
                  key={b.asset}
                  label={b.asset}
                  value={b.asset === "USDT" ? fmtUsd(b.balance) : fmtNum(b.balance, 8)}
                  accent={b.balance > 0 ? "green" : b.balance < 0 ? "red" : "default"}
                />
              ))}
            </>
          )}

          {lastUpdated && (
            <div className="px-4 py-1.5 text-[10px] font-mono text-muted-foreground/40 text-right">
              Updated {lastUpdated.toLocaleTimeString()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
