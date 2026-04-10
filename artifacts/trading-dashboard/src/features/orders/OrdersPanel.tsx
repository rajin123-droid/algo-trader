/**
 * OrdersPanel — bottom-panel tab showing active + history orders.
 *
 * Two sub-tabs: Active Orders and History.
 * Active orders can be cancelled with one click.
 */

import { useEffect, useState } from "react";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import { useOrdersStore } from "@/state/orders.store";
import type { ApiOrder } from "@/core/api";
import { subscribeAuth }  from "@/core/auth";

/* ── status badge colours ──────────────────────────────────────────────────── */

const STATUS_COLOR: Record<string, string> = {
  PENDING:          "#F0B90B",
  PARTIALLY_FILLED: "#E89011",
  FILLED:           "#0ECB81",
  CANCELLED:        "#555C6A",
  REJECTED:         "#F6465D",
};

/* ── helpers ─────────────────────────────────────────────────────────────────── */

function fmt(v: unknown, dp = 2) {
  return (Number(v) || 0).toFixed(dp);
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

/* ── ProgressBar ─────────────────────────────────────────────────────────────── */

function FillBar({ pct }: { pct: number }) {
  return (
    <div
      className="relative w-16 h-1.5 rounded-full overflow-hidden"
      style={{ background: "#1e2329" }}
    >
      <div
        className="absolute left-0 top-0 h-full rounded-full transition-all"
        style={{
          width:      `${Math.max(0, Math.min(100, pct))}%`,
          background: pct >= 100 ? "#0ECB81" : "#F0B90B",
        }}
      />
    </div>
  );
}

/* ── empty state ──────────────────────────────────────────────────────────────── */

function Empty({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-[11px] font-mono text-muted-foreground/40">
      {label}
    </div>
  );
}

/* ── OrderRow (active) ─────────────────────────────────────────────────────── */

function ActiveRow({ order }: { order: ApiOrder }) {
  const cancelOrder = useOrdersStore((s) => s.cancelOrder);
  const [cancelling, setCancelling] = useState(false);

  async function handleCancel() {
    setCancelling(true);
    await cancelOrder(order.id, "User cancelled");
    setCancelling(false);
  }

  const fillPct = (Number(order.fillPercent) || 0);

  return (
    <tr
      className="hover:bg-white/[0.02] transition-colors group"
      style={{ borderBottom: "1px solid #1e2329" }}
    >
      <td className="px-3 py-1.5">
        <span
          className="text-[10px] font-bold px-1 py-0.5 rounded"
          style={{
            background: order.side === "BUY" ? "rgba(14,203,129,0.12)" : "rgba(246,70,93,0.12)",
            color:       order.side === "BUY" ? "#0ECB81" : "#F6465D",
          }}
        >
          {order.side}
        </span>
      </td>
      <td className="px-2 py-1.5 text-right font-mono">
        <span className="text-[10px] text-muted-foreground">{order.symbol}</span>
      </td>
      <td className="px-2 py-1.5 text-right font-mono">
        <span style={{ color: STATUS_COLOR[order.status] ?? "#888" }} className="text-[10px]">
          {order.status}
        </span>
      </td>
      <td className="px-2 py-1.5 text-right font-mono text-[11px] tabular-nums">
        {fmt(order.quantity, 4)}
      </td>
      <td className="px-2 py-1.5 text-right font-mono text-[11px] tabular-nums">
        {order.price ? `$${fmt(order.price, 2)}` : "MKT"}
      </td>
      <td className="px-2 py-1.5">
        <div className="flex flex-col gap-0.5 items-end">
          <FillBar pct={fillPct} />
          <span className="text-[9px] text-muted-foreground tabular-nums">{fmt(fillPct, 1)}%</span>
        </div>
      </td>
      <td className="px-2 py-1.5 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
        {fmtDate(order.createdAt)}
      </td>
      <td className="px-2 py-1.5 text-center">
        <button
          onClick={handleCancel}
          disabled={cancelling}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400 disabled:opacity-30"
          title="Cancel order"
        >
          <X size={12} />
        </button>
      </td>
    </tr>
  );
}

/* ── OrderRow (history) ─────────────────────────────────────────────────────── */

function HistoryRow({ order }: { order: ApiOrder }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="hover:bg-white/[0.02] transition-colors cursor-pointer"
        style={{ borderBottom: "1px solid #1e2329" }}
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-3 py-1.5">
          <span
            className="text-[10px] font-bold px-1 py-0.5 rounded"
            style={{
              background: order.side === "BUY" ? "rgba(14,203,129,0.12)" : "rgba(246,70,93,0.12)",
              color:       order.side === "BUY" ? "#0ECB81" : "#F6465D",
            }}
          >
            {order.side}
          </span>
        </td>
        <td className="px-2 py-1.5 text-right font-mono text-[10px] text-muted-foreground">
          {order.symbol}
        </td>
        <td className="px-2 py-1.5 text-right">
          <span style={{ color: STATUS_COLOR[order.status] ?? "#888" }} className="text-[10px] font-mono">
            {order.status}
          </span>
        </td>
        <td className="px-2 py-1.5 text-right font-mono text-[11px] tabular-nums">
          {fmt(order.filledQuantity, 4)} / {fmt(order.quantity, 4)}
        </td>
        <td className="px-2 py-1.5 text-right font-mono text-[11px] tabular-nums">
          {order.price ? `$${fmt(order.price, 2)}` : "MKT"}
        </td>
        <td className="px-2 py-1.5 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
          ${fmt(order.fee, 4)}
        </td>
        <td className="px-2 py-1.5 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
          {fmtDate(order.createdAt)}
        </td>
        <td className="px-2 py-1.5 text-center text-muted-foreground">
          {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </td>
      </tr>
      {expanded && (
        <tr style={{ borderBottom: "1px solid #1e2329", background: "#0d1117" }}>
          <td colSpan={8} className="px-6 py-2">
            <div className="text-[10px] font-mono text-muted-foreground space-y-0.5">
              <div>
                <span className="text-[#555C6A] uppercase tracking-wider mr-2">Order ID</span>
                <span className="text-[#E8E8E8]">{order.id}</span>
              </div>
              <div>
                <span className="text-[#555C6A] uppercase tracking-wider mr-2">Type</span>
                <span>{order.type}</span>
                <span className="text-[#555C6A] uppercase tracking-wider mx-2">Mode</span>
                <span style={{ color: order.mode === "live" ? "#F0B90B" : "#555C6A" }}>
                  {order.mode.toUpperCase()}
                </span>
              </div>
              {order.cancelReason && (
                <div>
                  <span className="text-[#555C6A] uppercase tracking-wider mr-2">Cancel Reason</span>
                  <span className="text-red-400">{order.cancelReason}</span>
                </div>
              )}
              {order.rejectReason && (
                <div>
                  <span className="text-[#555C6A] uppercase tracking-wider mr-2">Reject Reason</span>
                  <span className="text-red-400">{order.rejectReason}</span>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Main Panel ──────────────────────────────────────────────────────────────── */

interface OrdersPanelProps {
  symbol: string;
}

export function OrdersPanel({ symbol }: OrdersPanelProps) {
  const { active, history, stats, loading, fetchAll } = useOrdersStore();
  const [subTab, setSubTab] = useState<"active" | "history">("active");
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const unsub = subscribeAuth((user) => {
      setAuthed(!!user);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (authed) {
      fetchAll(symbol).catch(() => {});
    }
  }, [authed, symbol]);

  if (!authed) {
    return (
      <Empty label="Log in to view your orders" />
    );
  }

  if (loading) {
    return (
      <Empty label="Loading orders…" />
    );
  }

  const SUB_TABS: { key: "active" | "history"; label: string; count: number }[] = [
    { key: "active",  label: "Active",  count: active.length },
    { key: "history", label: "History", count: history.length },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-tab bar + stats */}
      <div
        className="flex items-center justify-between px-3 py-1 shrink-0"
        style={{ borderBottom: "1px solid #2B3139" }}
      >
        <div className="flex items-center gap-0">
          {SUB_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className="text-[10px] font-mono px-3 py-0.5 transition-colors"
              style={{
                borderBottom:  subTab === t.key ? "1px solid #F0B90B" : "1px solid transparent",
                color:         subTab === t.key ? "#E8E8E8" : "#555C6A",
                background:    "transparent",
                cursor:        "pointer",
              }}
            >
              {t.label}
              {t.count > 0 && (
                <span className="ml-1 text-muted-foreground">({t.count})</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
          <span>
            <span className="text-[#555C6A] mr-1">Open:</span>
            <span className="text-[#E8E8E8]">{stats.openOrders}</span>
          </span>
          <span>
            <span className="text-[#555C6A] mr-1">Total Fees:</span>
            <span className="text-[#E8E8E8]">${(Number(stats.totalFeesPaid) || 0).toFixed(4)}</span>
          </span>
          <button
            onClick={() => fetchAll(symbol)}
            className="text-[#555C6A] hover:text-[#E8E8E8] transition-colors"
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {subTab === "active" ? (
          active.length === 0 ? (
            <Empty label="No active orders" />
          ) : (
            <table className="w-full text-[11px] font-mono">
              <thead className="sticky top-0" style={{ background: "#12161a" }}>
                <tr className="text-[10px] text-muted-foreground" style={{ borderBottom: "1px solid #2B3139" }}>
                  <th className="text-left  px-3 py-1 font-normal">Side</th>
                  <th className="text-right px-2 py-1 font-normal">Symbol</th>
                  <th className="text-right px-2 py-1 font-normal">Status</th>
                  <th className="text-right px-2 py-1 font-normal">Qty</th>
                  <th className="text-right px-2 py-1 font-normal">Price</th>
                  <th className="text-right px-2 py-1 font-normal">Fill</th>
                  <th className="text-right px-2 py-1 font-normal">Time</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {active.map((o) => <ActiveRow key={o.id} order={o} />)}
              </tbody>
            </table>
          )
        ) : (
          history.length === 0 ? (
            <Empty label="No order history" />
          ) : (
            <table className="w-full text-[11px] font-mono">
              <thead className="sticky top-0" style={{ background: "#12161a" }}>
                <tr className="text-[10px] text-muted-foreground" style={{ borderBottom: "1px solid #2B3139" }}>
                  <th className="text-left  px-3 py-1 font-normal">Side</th>
                  <th className="text-right px-2 py-1 font-normal">Symbol</th>
                  <th className="text-right px-2 py-1 font-normal">Status</th>
                  <th className="text-right px-2 py-1 font-normal">Filled / Qty</th>
                  <th className="text-right px-2 py-1 font-normal">Price</th>
                  <th className="text-right px-2 py-1 font-normal">Fee</th>
                  <th className="text-right px-2 py-1 font-normal">Time</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {history.map((o) => <HistoryRow key={o.id} order={o} />)}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
