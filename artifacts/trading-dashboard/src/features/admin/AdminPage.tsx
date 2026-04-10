import { useState, useEffect, useCallback } from "react";
import {
  getAdminUsers, updateUserRole, getAdminAuditLogs, getAdminQueueDepth,
  getKillSwitch, activateKillSwitch, deactivateKillSwitch, triggerReconcile, getLastReconcile,
  getAdminLedger, adjustAdminBalance, getSystemHealth, getAdminAnalyticsKpi,
  runExchangeRecon, getExchangeReconHistory, getLatestExchangeSnapshot,
  type AdminUser, type AuditLog, type KillSwitchState, type ReconcileResult,
  type AdminLedgerAccount, type SystemHealth, type PlatformKpi,
  type ExchangeReconResult, type ExchangeReconLog, type ExchangeMismatch,
} from "@/core/api";
import { fmtDate } from "@/core/utils/format";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const BORDER = "1px solid #2B3139";
const TABS = ["Analytics", "Users", "Ledger", "Kill Switch", "Queue", "Audit Logs", "Reconcile", "System"] as const;
type Tab = typeof TABS[number];

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold"
      style={{ background: `${color}22`, color }}>
      {children}
    </span>
  );
}

function Spinner() {
  return <div className="flex items-center justify-center h-40 text-xs text-muted-foreground font-mono">Loading...</div>;
}
function Err({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-40 gap-2">
      <span className="text-xs text-[#F6465D] font-mono">{msg}</span>
      <button onClick={onRetry} className="text-xs text-muted-foreground hover:text-foreground font-mono underline">Retry</button>
    </div>
  );
}
function Empty({ label }: { label: string }) {
  return <div className="flex items-center justify-center h-24 text-xs text-muted-foreground font-mono">{label}</div>;
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="rounded border p-4 space-y-1 flex-1 min-w-[120px]"
      style={{ borderColor: "#2B3139", background: "#12161a" }}>
      <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-mono font-bold leading-none" style={{ color }}>{value}</div>
      {sub && <div className="text-[9px] font-mono text-muted-foreground">{sub}</div>}
    </div>
  );
}

function AnalyticsTab() {
  const [kpi, setKpi]       = useState<PlatformKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getAdminAnalyticsKpi()
      .then((k) => { setKpi(k); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !kpi) return <Spinner />;
  if (error) return <Err msg={error} onRetry={load} />;
  if (!kpi) return null;

  const totalRevenue = kpi.platformRevenue + kpi.creatorEarnings;

  // Build a simple sparkline from KPI values for visual interest
  const funnelData = [
    { label: "Users",    value: kpi.totalUsers },
    { label: "Strats",   value: kpi.activeStrategies },
    { label: "Subs",     value: kpi.activeSubscriptions },
    { label: "Trades",   value: kpi.totalCopyTrades },
    { label: "Events",   value: kpi.revenueEvents },
  ];

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Platform KPIs</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground font-mono">Updated {fmtDate(kpi.checkedAt)}</span>
          <button onClick={load} className="text-[10px] font-mono text-muted-foreground hover:text-foreground">↻</button>
        </div>
      </div>

      {/* KPI row 1 — activity */}
      <div className="flex gap-3 flex-wrap">
        <KpiCard label="Total Users"       value={kpi.totalUsers.toLocaleString()}          color="#F0B90B" />
        <KpiCard label="Active Strategies" value={kpi.activeStrategies.toLocaleString()}    color="#0ECB81" />
        <KpiCard label="Active Subs"       value={kpi.activeSubscriptions.toLocaleString()} color="#0ECB81" />
        <KpiCard label="Copy Trades"       value={kpi.totalCopyTrades.toLocaleString()}     color="#F0B90B" />
        <KpiCard label="Revenue Events"    value={kpi.revenueEvents.toLocaleString()}       color="#8B8FA8" />
      </div>

      {/* KPI row 2 — revenue */}
      <div className="flex gap-3 flex-wrap">
        <KpiCard
          label="Platform Revenue"
          value={`$${(Number(kpi.platformRevenue) || 0).toFixed(2)}`}
          sub="Platform cut of performance fees"
          color="#0ECB81"
        />
        <KpiCard
          label="Creator Earnings"
          value={`$${(Number(kpi.creatorEarnings) || 0).toFixed(2)}`}
          sub="Creator cut of performance fees"
          color="#F0B90B"
        />
        <KpiCard
          label="Total Revenue"
          value={`$${(Number(totalRevenue) || 0).toFixed(2)}`}
          sub="Platform + creator combined"
          color="#0ECB81"
        />
      </div>

      {/* Activity funnel chart */}
      <div className="space-y-2">
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Platform Funnel</div>
        <div className="rounded border p-4" style={{ borderColor: "#2B3139", background: "#12161a", height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={funnelData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="kpiFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#F0B90B" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#F0B90B" stopOpacity={0}   />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fill: "#555C6A", fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#555C6A", fontSize: 9, fontFamily: "monospace" }} axisLine={false} tickLine={false} width={36} />
              <Tooltip
                contentStyle={{ background: "#1a1d23", border: "1px solid #2B3139", borderRadius: 4, fontSize: 11, fontFamily: "monospace" }}
                itemStyle={{ color: "#F0B90B" }}
                labelStyle={{ color: "#8B8FA8" }}
              />
              <Area type="monotone" dataKey="value" stroke="#F0B90B" strokeWidth={2} fill="url(#kpiFill)" dot={{ fill: "#F0B90B", r: 3 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Revenue split breakdown */}
      {totalRevenue > 0 && (
        <div className="space-y-2 max-w-sm">
          <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Revenue Split</div>
          <div className="rounded border p-4 space-y-3" style={{ borderColor: "#2B3139", background: "#12161a" }}>
            {[
              { label: "Creator (70%)",  value: kpi.creatorEarnings,  color: "#F0B90B" },
              { label: "Platform (30%)", value: kpi.platformRevenue,  color: "#0ECB81" },
            ].map((item) => {
              const pct = totalRevenue > 0 ? (item.value / totalRevenue) * 100 : 0;
              return (
                <div key={item.label} className="space-y-1">
                  <div className="flex justify-between text-[10px] font-mono">
                    <span style={{ color: item.color }}>{item.label}</span>
                    <span className="text-foreground">${(Number(item.value) || 0).toFixed(4)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: item.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────
function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getAdminUsers()
      .then((r) => { setUsers(Array.isArray(r.users) ? r.users : []); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function changeRole(id: number, role: "USER" | "TRADER" | "ADMIN") {
    setUpdating(id);
    try {
      const { user } = await updateUserRole(id, role);
      setUsers((u) => u.map((x) => (x.id === id ? { ...x, role: user.role } : x)));
    } catch (e) { alert((e as Error).message); }
    finally { setUpdating(null); }
  }

  if (loading) return <Spinner />;
  if (error) return <Err msg={error} onRetry={load} />;

  return (
    <div className="overflow-auto h-full">
      <table className="w-full text-xs font-mono border-collapse">
        <thead>
          <tr style={{ borderBottom: BORDER }}>
            {["ID", "Email", "Role", "Plan", "Status", "Created", "Change Role"].map((h) => (
              <th key={h} className="px-3 py-2 text-left text-muted-foreground font-normal uppercase tracking-wider text-[10px]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} style={{ borderBottom: BORDER }} className="hover:bg-white/[0.02] transition-colors">
              <td className="px-3 py-2 text-muted-foreground">{u.id}</td>
              <td className="px-3 py-2">{u.email ?? "—"}</td>
              <td className="px-3 py-2">
                <Badge color={u.role === "ADMIN" ? "#F0B90B" : u.role === "TRADER" ? "#0ECB81" : "#8B8FA8"}>
                  {u.role ?? "USER"}
                </Badge>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{u.plan ?? "—"}</td>
              <td className="px-3 py-2">
                <Badge color={u.isActive ? "#0ECB81" : "#F6465D"}>{u.isActive ? "Active" : "Inactive"}</Badge>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{fmtDate(u.createdAt)}</td>
              <td className="px-3 py-2">
                <select
                  disabled={updating === u.id}
                  value={u.role ?? "USER"}
                  onChange={(e) => changeRole(u.id, e.target.value as "USER" | "TRADER" | "ADMIN")}
                  className="bg-[#1a1d23] border border-border/40 rounded px-2 py-0.5 text-[10px] font-mono outline-none disabled:opacity-50"
                >
                  {["USER", "TRADER", "ADMIN"].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {users.length === 0 && <Empty label="No users found" />}
    </div>
  );
}

// ── Kill Switch Tab ────────────────────────────────────────────────────────────
function KillSwitchTab() {
  const [state, setState] = useState<KillSwitchState | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getKillSwitch()
      .then((s) => { setState(s); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle() {
    if (!state) return;
    if (state.active) {
      setBusy(true);
      try {
        const r = await deactivateKillSwitch();
        setState(r);
      } catch (e) { alert((e as Error).message); }
      finally { setBusy(false); }
    } else {
      if (!reason.trim()) { alert("Enter a reason before activating the kill switch."); return; }
      setBusy(true);
      try {
        const r = await activateKillSwitch(reason.trim());
        setState(r);
        setReason("");
      } catch (e) { alert((e as Error).message); }
      finally { setBusy(false); }
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Err msg={error} onRetry={load} />;
  if (!state) return null;

  const isActive = state.active === true;

  return (
    <div className="p-6 max-w-lg space-y-6">
      <div className="rounded border p-5 space-y-4"
        style={{ borderColor: isActive ? "#F6465D55" : "#2B3139", background: isActive ? "#F6465D08" : "#12161a" }}>
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${isActive ? "bg-[#F6465D] animate-pulse" : "bg-[#0ECB81]"}`} />
          <span className="font-mono text-sm font-semibold">
            {isActive ? "KILL SWITCH ACTIVE — ALL TRADING HALTED" : "Trading System Operational"}
          </span>
        </div>
        {isActive && state.reason && (
          <div className="text-xs text-muted-foreground font-mono">
            <span className="text-[#F6465D]">Reason:</span> {state.reason}
          </div>
        )}
        {isActive && state.activatedAt && (
          <div className="text-xs text-muted-foreground font-mono">
            Activated: {fmtDate(state.activatedAt)}
          </div>
        )}
      </div>

      {!isActive && (
        <div className="space-y-2">
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Reason for activation</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe why you are halting trading..."
            rows={3}
            className="w-full bg-[#1a1d23] border border-border/40 rounded px-3 py-2 text-xs font-mono outline-none resize-none focus:border-[#F6465D]/50"
          />
        </div>
      )}

      <button
        disabled={busy}
        onClick={toggle}
        className="px-6 py-2 rounded text-xs font-mono font-semibold transition-colors disabled:opacity-50"
        style={{
          background: isActive ? "#0ECB8122" : "#F6465D22",
          color: isActive ? "#0ECB81" : "#F6465D",
          border: `1px solid ${isActive ? "#0ECB8144" : "#F6465D44"}`,
        }}
      >
        {busy ? "…" : isActive ? "Deactivate — Resume Trading" : "Activate Kill Switch"}
      </button>
    </div>
  );
}

// ── Queue Tab ──────────────────────────────────────────────────────────────────
function QueueTab() {
  const [data, setData] = useState<{ depth: number; backend: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getAdminQueueDepth()
      .then((d) => { setData(d); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  if (loading && !data) return <Spinner />;
  if (error) return <Err msg={error} onRetry={load} />;

  return (
    <div className="p-6 space-y-4 max-w-xs">
      <div className="rounded border p-5 space-y-3" style={{ borderColor: BORDER, background: "#12161a" }}>
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Order Queue Depth</div>
        <div className="text-4xl font-mono font-bold" style={{ color: "#F0B90B" }}>
          {data?.depth ?? 0}
        </div>
        <div className="text-xs font-mono text-muted-foreground">
          Backend: <span className="text-foreground">{data?.backend ?? "—"}</span>
        </div>
      </div>
      <button onClick={load} className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors">↻ Refresh</button>
    </div>
  );
}

// ── Audit Logs Tab ─────────────────────────────────────────────────────────────
function AuditLogsTab() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const load = useCallback((off: number) => {
    setLoading(true);
    getAdminAuditLogs({ limit: LIMIT, offset: off })
      .then((r) => { setLogs(Array.isArray(r.logs) ? r.logs : []); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(offset); }, [load, offset]);

  if (loading && logs.length === 0) return <Spinner />;
  if (error) return <Err msg={error} onRetry={() => load(offset)} />;

  return (
    <div className="flex flex-col h-full">
      <div className="overflow-auto flex-1">
        <table className="w-full text-xs font-mono border-collapse">
          <thead>
            <tr style={{ borderBottom: BORDER }}>
              {["Time", "Action", "User", "Resource", "IP"].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-muted-foreground font-normal uppercase tracking-wider text-[10px]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => {
              const action = String(l.action ?? "");
              return (
                <tr key={l.id} style={{ borderBottom: BORDER }} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(l.createdAt)}</td>
                  <td className="px-3 py-2">
                    <Badge color={action.includes("LOGIN") ? "#0ECB81" : action.includes("FAIL") || action.includes("ERROR") ? "#F6465D" : "#F0B90B"}>
                      {action || "—"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{l.userId ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{l.resource ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{l.ipAddress ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {logs.length === 0 && <Empty label="No audit logs found" />}
      </div>
      <div className="flex items-center gap-4 px-3 py-2 shrink-0" style={{ borderTop: BORDER }}>
        <button disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
          className="text-xs font-mono text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">← Prev</button>
        <span className="text-[10px] text-muted-foreground font-mono">{offset + 1}–{offset + logs.length}</span>
        <button disabled={logs.length < LIMIT} onClick={() => setOffset((o) => o + LIMIT)}
          className="text-xs font-mono text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">Next →</button>
      </div>
    </div>
  );
}

// ── Reconcile Tab ──────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const color = status === "PASS" ? "#0ECB81" : status === "SKIP" ? "#F0B90B" : status === "FAIL" ? "#F6465D" : "#8B8FA8";
  return <span className="inline-block w-2 h-2 rounded-full" style={{ background: color, boxShadow: status === "FAIL" ? "0 0 6px #F6465D88" : undefined }} />;
}

function ReconcileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest border-b pb-2" style={{ borderColor: "#2B3139" }}>{title}</div>
      {children}
    </div>
  );
}

function MismatchTable({ mismatches }: { mismatches: ExchangeMismatch[] }) {
  if (mismatches.length === 0) return null;
  return (
    <div className="rounded border overflow-hidden" style={{ borderColor: "#F6465D44" }}>
      <table className="w-full text-xs font-mono border-collapse">
        <thead>
          <tr style={{ borderBottom: "1px solid #F6465D22", background: "#F6465D0A" }}>
            {["Asset", "Internal", "Exchange", "Diff", "Direction"].map((h) => (
              <th key={h} className="px-3 py-1.5 text-left text-[9px] text-muted-foreground uppercase tracking-wider">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mismatches.map((m, i) => (
            <tr key={i} style={{ borderBottom: i < mismatches.length - 1 ? "1px solid #2B3139" : undefined }}>
              <td className="px-3 py-1.5 font-semibold text-foreground">{m.asset}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{(Number(m.internal) || 0).toFixed(6)}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{(Number(m.exchange) || 0).toFixed(6)}</td>
              <td className="px-3 py-1.5 text-[#F6465D]">{(Number(m.diff) || 0).toFixed(6)}</td>
              <td className="px-3 py-1.5">
                <Badge color={m.direction === "OVER" ? "#F0B90B" : "#F6465D"}>{m.direction}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReconcileTab() {
  // ── Internal ledger recon ──
  const [ledgerResult, setLedgerResult]   = useState<ReconcileResult | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError]     = useState<string | null>(null);

  // ── Exchange recon ──
  const [exchResult, setExchResult]       = useState<ExchangeReconResult | null>(null);
  const [exchHistory, setExchHistory]     = useState<ExchangeReconLog[]>([]);
  const [exchLoading, setExchLoading]     = useState(false);
  const [exchError, setExchError]         = useState<string | null>(null);
  const [histLoading, setHistLoading]     = useState(true);

  const loadHistory = useCallback(() => {
    setHistLoading(true);
    Promise.all([
      getLastReconcile().then((r) => setLedgerResult(r.result)).catch(() => {}),
      getExchangeReconHistory(10).then((r) => setExchHistory(r.history)).catch(() => {}),
    ]).finally(() => setHistLoading(false));
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function runLedger() {
    setLedgerLoading(true); setLedgerError(null);
    try { const r = await triggerReconcile(); setLedgerResult(r.result); }
    catch (e) { setLedgerError((e as Error).message); }
    finally { setLedgerLoading(false); }
  }

  async function runExchange() {
    setExchLoading(true); setExchError(null);
    try {
      const r = await runExchangeRecon();
      setExchResult(r.result);
      // Refresh history
      getExchangeReconHistory(10).then((hr) => setExchHistory(hr.history)).catch(() => {});
    }
    catch (e) { setExchError((e as Error).message); }
    finally { setExchLoading(false); }
  }

  const ledgerOk = ledgerResult?.status === "PASS";

  return (
    <div className="overflow-auto h-full p-6 space-y-8 max-w-3xl">

      {/* ── LAYER 1: Internal Ledger Reconciliation ── */}
      <ReconcileSection title="Layer 1 — Internal Ledger (Double-Entry Invariant)">
        <div className="text-[10px] font-mono text-muted-foreground mb-3">
          Verifies every transaction has balanced DEBIT = CREDIT entries. Runs automatically every hour.
        </div>
        <button onClick={runLedger} disabled={ledgerLoading}
          className="px-4 py-1.5 rounded text-xs font-mono font-semibold disabled:opacity-50 transition-opacity"
          style={{ background: "#F0B90B22", color: "#F0B90B", border: "1px solid #F0B90B44" }}>
          {ledgerLoading ? "Running…" : "Run Ledger Check"}
        </button>
        {ledgerError && <div className="text-[10px] font-mono text-[#F6465D]">{ledgerError}</div>}

        {histLoading && !ledgerResult && <Spinner />}

        {ledgerResult && (
          <div className="rounded border p-4 space-y-3 font-mono"
            style={{ borderColor: ledgerOk ? "#0ECB8133" : "#F6465D44", background: "#12161a" }}>
            <div className="flex items-center gap-2">
              <StatusDot status={ledgerOk ? "PASS" : "FAIL"} />
              <span className="text-xs font-semibold">{ledgerOk ? "Balanced" : "Discrepancy Detected"}</span>
              <span className="text-[9px] text-muted-foreground ml-auto">{fmtDate(ledgerResult.checkedAt)}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-[10px]">
              <div>
                <div className="text-muted-foreground mb-0.5">TX Checked</div>
                <div>{(ledgerResult as any).totalTxChecked ?? "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground mb-0.5">Discrepancies</div>
                <div style={{ color: (Array.isArray(ledgerResult.discrepancies) && ledgerResult.discrepancies.length > 0) ? "#F6465D" : "#0ECB81" }}>
                  {Array.isArray(ledgerResult.discrepancies) ? ledgerResult.discrepancies.length : 0}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground mb-0.5">Duration</div>
                <div>{(ledgerResult as any).durationMs ?? "—"} ms</div>
              </div>
            </div>
            {Array.isArray(ledgerResult.discrepancies) && ledgerResult.discrepancies.length > 0 && (
              <div className="space-y-1 pt-2 border-t" style={{ borderColor: "#2B3139" }}>
                {ledgerResult.discrepancies.slice(0, 5).map((d: any, i: number) => (
                  <div key={i} className="text-[10px] text-[#F6465D]">
                    TX {d.transactionId}: debit {(Number(d.totalDebit)||0).toFixed(8)} ≠ credit {(Number(d.totalCredit)||0).toFixed(8)} (Δ {(Number(d.delta)||0).toFixed(8)})
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </ReconcileSection>

      {/* ── LAYER 2: Exchange ↔ Internal Reconciliation ── */}
      <ReconcileSection title="Layer 2 — Exchange ↔ Internal (Binance Source of Truth)">
        <div className="text-[10px] font-mono text-muted-foreground mb-3">
          Compares Binance live positions against our internal tracked state. Detects orphan fills and balance mismatches. Runs automatically every 5 minutes for live sessions.
        </div>
        <div className="flex gap-3 items-center">
          <button onClick={runExchange} disabled={exchLoading}
            className="px-4 py-1.5 rounded text-xs font-mono font-semibold disabled:opacity-50 transition-opacity"
            style={{ background: "#0ECB8122", color: "#0ECB81", border: "1px solid #0ECB8144" }}>
            {exchLoading ? "Running…" : "Run Exchange Recon"}
          </button>
          <span className="text-[9px] font-mono text-muted-foreground">Requires live sessions + Binance credentials</span>
        </div>
        {exchError && <div className="text-[10px] font-mono text-[#F6465D]">{exchError}</div>}

        {exchResult && (
          <div className="rounded border p-4 space-y-3 font-mono"
            style={{
              borderColor: exchResult.status === "PASS" ? "#0ECB8133" : exchResult.status === "SKIP" ? "#F0B90B33" : "#F6465D44",
              background: "#12161a"
            }}>
            <div className="flex items-center gap-2">
              <StatusDot status={exchResult.status} />
              <span className="text-xs font-semibold">{exchResult.status}</span>
              <span className="text-[9px] text-muted-foreground ml-auto">{fmtDate(exchResult.runAt)}</span>
            </div>
            <div className="text-[10px] text-muted-foreground">{exchResult.summary}</div>
            <div className="grid grid-cols-4 gap-3 text-[10px]">
              <div><div className="text-muted-foreground mb-0.5">Sessions</div><div>{exchResult.sessionCount}</div></div>
              <div><div className="text-muted-foreground mb-0.5">Mismatches</div>
                <div style={{ color: exchResult.mismatches.length > 0 ? "#F6465D" : "#0ECB81" }}>{exchResult.mismatches.length}</div></div>
              <div><div className="text-muted-foreground mb-0.5">Orphan Fills</div>
                <div style={{ color: exchResult.totalOrphans > 0 ? "#F6465D" : "#0ECB81" }}>{exchResult.totalOrphans}</div></div>
              <div><div className="text-muted-foreground mb-0.5">Duration</div><div>{exchResult.durationMs} ms</div></div>
            </div>
            {exchResult.mismatches.length > 0 && (
              <div className="pt-2 border-t" style={{ borderColor: "#2B3139" }}>
                <div className="text-[9px] font-mono text-[#F6465D] font-semibold mb-2 uppercase tracking-wider">⚠ Balance Mismatches</div>
                <MismatchTable mismatches={exchResult.mismatches} />
              </div>
            )}
          </div>
        )}

        {/* Exchange Recon History */}
        {!histLoading && exchHistory.length > 0 && (
          <div className="space-y-2">
            <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Recent Runs</div>
            <div className="rounded border overflow-hidden" style={{ borderColor: "#2B3139" }}>
              <table className="w-full text-xs font-mono border-collapse">
                <thead>
                  <tr style={{ borderBottom: BORDER, background: "#0B0E1180" }}>
                    {["Status", "Sessions", "Mismatches", "Orphans", "Triggered By", "Run At"].map((h) => (
                      <th key={h} className="px-3 py-1.5 text-left text-[9px] text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {exchHistory.map((log, i) => {
                    const mismatches = Array.isArray(log.mismatches) ? log.mismatches : [];
                    const statusColor = log.status === "PASS" ? "#0ECB81" : log.status === "SKIP" ? "#F0B90B" : log.status === "FAIL" ? "#F6465D" : "#8B8FA8";
                    return (
                      <tr key={log.id} style={{ borderBottom: i < exchHistory.length - 1 ? BORDER : undefined }}
                        className="hover:bg-white/[0.02]">
                        <td className="px-3 py-1.5">
                          <Badge color={statusColor}>{log.status}</Badge>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{log.sessionCount}</td>
                        <td className="px-3 py-1.5">
                          <span style={{ color: mismatches.length > 0 ? "#F6465D" : "#0ECB81" }}>{mismatches.length}</span>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{(log as any).orphanCount ?? 0}</td>
                        <td className="px-3 py-1.5 text-muted-foreground text-[9px]">{log.triggeredBy ?? "—"}</td>
                        <td className="px-3 py-1.5 text-muted-foreground text-[9px]">{fmtDate(log.runAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!histLoading && exchHistory.length === 0 && (
          <div className="text-[10px] font-mono text-muted-foreground">No exchange reconciliation runs yet. Click "Run Exchange Recon" to start.</div>
        )}
      </ReconcileSection>

      {/* Principles callout */}
      <div className="rounded border p-4 space-y-2" style={{ borderColor: "#2B3139", background: "#0B0E11" }}>
        <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Core Principles (Never Break)</div>
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-muted-foreground">
          <div>1. Exchange = source of truth for live mode</div>
          <div>2. Ledger must always balance (DEBIT = CREDIT)</div>
          <div>3. Every trade must have an audit trail</div>
          <div>4. No silent failures — all anomalies logged</div>
        </div>
      </div>
    </div>
  );
}

// ── Ledger Tab ─────────────────────────────────────────────────────────────────
function LedgerTab() {
  const [userId, setUserId]     = useState("");
  const [queried, setQueried]   = useState("");
  const [accounts, setAccounts] = useState<AdminLedgerAccount[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Adjust form
  const [adjAsset,   setAdjAsset]   = useState("USDT");
  const [adjAmount,  setAdjAmount]  = useState("");
  const [adjNote,    setAdjNote]    = useState("");
  const [adjBusy,    setAdjBusy]    = useState(false);
  const [adjSuccess, setAdjSuccess] = useState<string | null>(null);

  function lookup() {
    const uid = userId.trim();
    if (!uid) return;
    setQueried(uid);
    setLoading(true);
    setError(null);
    setAccounts([]);
    getAdminLedger(uid)
      .then((r) => setAccounts(r.accounts))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  async function doAdjust() {
    const uid = queried.trim();
    const amt = parseFloat(adjAmount);
    if (!uid || isNaN(amt) || amt <= 0) { alert("Enter a valid user ID, asset, and positive amount."); return; }
    setAdjBusy(true);
    setAdjSuccess(null);
    try {
      const r = await adjustAdminBalance({ userId: uid, asset: adjAsset, amount: amt, note: adjNote || undefined });
      setAdjSuccess(`✓ Credited ${amt} ${adjAsset} — tx ${r.transactionId.slice(0, 8)}…`);
      setAdjAmount(""); setAdjNote("");
      // refresh
      const fresh = await getAdminLedger(uid);
      setAccounts(fresh.accounts);
    } catch (e) { alert((e as Error).message); }
    finally { setAdjBusy(false); }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: BORDER }}>
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && lookup()}
          placeholder="Enter user ID or email…"
          className="flex-1 bg-[#1a1d23] border border-border/40 rounded px-3 py-1.5 text-xs font-mono outline-none focus:border-[#F0B90B]/50"
        />
        <button onClick={lookup}
          className="px-4 py-1.5 rounded text-[11px] font-mono font-semibold transition-colors"
          style={{ background: "#F0B90B22", color: "#F0B90B", border: "1px solid #F0B90B44" }}>
          Lookup
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {loading && <Spinner />}
        {error   && <div className="text-xs text-[#F6465D] font-mono">{error}</div>}

        {accounts.length > 0 && (
          <>
            {/* Balances */}
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono mb-2">
                Accounts — {queried}
              </div>
              <div className="flex gap-3 flex-wrap">
                {accounts.map((a) => (
                  <div key={a.accountId} className="rounded border p-3 min-w-[120px]"
                    style={{ borderColor: a.balance >= 0 ? "#0ECB8133" : "#F6465D44", background: "#12161a" }}>
                    <div className="text-[10px] text-muted-foreground font-mono uppercase">{a.asset}</div>
                    <div className={`text-lg font-bold font-mono ${a.balance >= 0 ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>
                      {(Number(a.balance) || 0).toFixed(4)}
                    </div>
                    <div className="text-[9px] text-muted-foreground font-mono">
                      D:{(Number(a.debitSum) || 0).toFixed(2)} C:{(Number(a.creditSum) || 0).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent entries */}
            {accounts.map((a) => a.entries.length > 0 && (
              <div key={`entries-${a.accountId}`} className="space-y-1">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">
                  {a.asset} — recent entries
                </div>
                <table className="w-full text-xs font-mono border-collapse">
                  <thead>
                    <tr style={{ borderBottom: BORDER }}>
                      {["Seq", "Side", "Amount", "Tx ID", "Time"].map((h) => (
                        <th key={h} className="px-2 py-1.5 text-left text-[10px] text-muted-foreground font-normal uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {a.entries.map((e) => (
                      <tr key={e.id} style={{ borderBottom: BORDER }} className="hover:bg-white/[0.02]">
                        <td className="px-2 py-1.5 text-muted-foreground">{e.seq ?? "—"}</td>
                        <td className="px-2 py-1.5">
                          <Badge color={e.side === "DEBIT" ? "#0ECB81" : "#F6465D"}>{e.side}</Badge>
                        </td>
                        <td className="px-2 py-1.5">{(Number(e.amount) || 0).toFixed(6)}</td>
                        <td className="px-2 py-1.5 text-muted-foreground text-[10px]">{e.transactionId.slice(0, 12)}…</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{e.createdAt ? fmtDate(e.createdAt) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

            {/* Adjust balance */}
            <div className="rounded border p-4 space-y-3 max-w-md" style={{ borderColor: "#F0B90B33", background: "#12161a" }}>
              <div className="text-[10px] font-mono text-[#F0B90B] uppercase tracking-wider">Admin Balance Adjustment</div>
              <div className="flex gap-2">
                <select value={adjAsset} onChange={(e) => setAdjAsset(e.target.value)}
                  className="bg-[#1a1d23] border border-border/40 rounded px-2 py-1.5 text-xs font-mono outline-none">
                  {["USDT", "BTC", "ETH", "SOL", "BNB"].map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <input type="number" min="0" step="any" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)}
                  placeholder="Amount (positive)"
                  className="flex-1 bg-[#1a1d23] border border-border/40 rounded px-2 py-1.5 text-xs font-mono outline-none" />
              </div>
              <input value={adjNote} onChange={(e) => setAdjNote(e.target.value)}
                placeholder="Note (optional)"
                className="w-full bg-[#1a1d23] border border-border/40 rounded px-2 py-1.5 text-xs font-mono outline-none" />
              <button onClick={doAdjust} disabled={adjBusy}
                className="px-4 py-1.5 rounded text-[11px] font-mono font-semibold disabled:opacity-50 transition-colors"
                style={{ background: "#F0B90B22", color: "#F0B90B", border: "1px solid #F0B90B44" }}>
                {adjBusy ? "Posting…" : "Credit Balance →"}
              </button>
              {adjSuccess && <div className="text-xs font-mono text-[#0ECB81]">{adjSuccess}</div>}
            </div>
          </>
        )}

        {!loading && !error && accounts.length === 0 && queried && (
          <Empty label={`No ledger accounts found for "${queried}"`} />
        )}
        {!queried && (
          <Empty label="Enter a user ID above to view their ledger" />
        )}
      </div>
    </div>
  );
}

// ── System Tab ─────────────────────────────────────────────────────────────────
function SystemTab() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getSystemHealth()
      .then((h) => { setHealth(h); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  function fmtBytes(n: number) {
    if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
    if (n >= 1_048_576)     return `${(n / 1_048_576).toFixed(1)} MB`;
    return `${(n / 1024).toFixed(1)} KB`;
  }
  function fmtUptime(s: number) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return [h && `${h}h`, m && `${m}m`, `${sec}s`].filter(Boolean).join(" ");
  }

  if (loading && !health) return <Spinner />;
  if (error) return <Err msg={error} onRetry={load} />;
  if (!health) return null;

  const isOk   = health.status === "OK";
  const mem    = health.memory;
  const heap   = mem.heapUsed / mem.heapTotal;

  const cards = [
    { label: "Status",        value: health.status,                       color: isOk ? "#0ECB81" : "#F6465D" },
    { label: "Uptime",        value: fmtUptime(health.uptime),            color: "#F0B90B" },
    { label: "Node",          value: health.nodeVersion,                  color: "#8B8FA8" },
    { label: "Queue Depth",   value: String(health.queue.depth),          color: health.queue.depth > 50 ? "#F6465D" : "#0ECB81" },
    { label: "Queue Backend", value: health.queue.backend,                color: "#8B8FA8" },
    { label: "Kill Switch",   value: health.killSwitch.active ? "ACTIVE" : "OFF", color: health.killSwitch.active ? "#F6465D" : "#0ECB81" },
    { label: "RSS",           value: fmtBytes(mem.rss),                   color: "#8B8FA8" },
    { label: "Heap Used",     value: `${fmtBytes(mem.heapUsed)} / ${fmtBytes(mem.heapTotal)}`, color: heap > 0.85 ? "#F6465D" : "#F0B90B" },
    { label: "External",      value: fmtBytes(mem.external),              color: "#8B8FA8" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <div className={`h-2.5 w-2.5 rounded-full ${isOk ? "bg-[#0ECB81]" : "bg-[#F6465D] animate-pulse"}`} />
        <span className="text-sm font-mono font-semibold">
          {isOk ? "All systems operational" : "⚠ Trading halted — kill switch active"}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono ml-auto">Updated {fmtDate(health.checkedAt)}</span>
        <button onClick={load} className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors">↻</button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded border p-3 space-y-1" style={{ borderColor: "#2B3139", background: "#12161a" }}>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-mono">{c.label}</div>
            <div className="text-sm font-mono font-bold" style={{ color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Heap bar */}
      <div className="space-y-1 max-w-sm">
        <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
          <span>Heap Utilisation</span>
          <span>{(heap * 100).toFixed(1)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(heap * 100, 100)}%`, background: heap > 0.85 ? "#F6465D" : "#F0B90B" }} />
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("Analytics");

  return (
    <div className="flex flex-col h-full font-mono overflow-hidden" style={{ background: "#0B0E11" }}>
      <div className="flex items-center shrink-0 overflow-x-auto" style={{ borderBottom: BORDER, height: 44 }}>
        <span className="px-4 text-xs text-muted-foreground uppercase tracking-widest mr-2 shrink-0">Admin</span>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 h-full text-[11px] font-mono transition-colors shrink-0"
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
        {tab === "Analytics"   && <AnalyticsTab />}
        {tab === "Users"       && <UsersTab />}
        {tab === "Ledger"      && <LedgerTab />}
        {tab === "Kill Switch" && <KillSwitchTab />}
        {tab === "Queue"       && <QueueTab />}
        {tab === "Audit Logs"  && <AuditLogsTab />}
        {tab === "Reconcile"   && <ReconcileTab />}
        {tab === "System"      && <SystemTab />}
      </div>
    </div>
  );
}
