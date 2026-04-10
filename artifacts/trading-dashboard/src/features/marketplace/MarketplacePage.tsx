import { useState, useEffect, useCallback } from "react";
import {
  getMarketplaceStrategies, getMarketplaceSubscriptions, subscribeToStrategy,
  cancelSubscription, getMarketplaceRevenue,
  type MarketplaceListing, type MarketplaceSubscription, type RevenueSummary,
} from "@/core/api";
import { fmtNum, fmtDate } from "@/core/utils/format";

const BORDER = "1px solid #2B3139";
const TABS = ["Browse", "My Subscriptions", "Revenue"] as const;
type Tab = typeof TABS[number];

function Spinner() {
  return <div className="flex items-center justify-center h-40 text-xs text-muted-foreground font-mono">Loading...</div>;
}
function Err({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-40 gap-2">
      <span className="text-xs text-[#F6465D] font-mono">{msg}</span>
      <button onClick={onRetry} className="text-xs text-muted-foreground font-mono underline">Retry</button>
    </div>
  );
}
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
    <div className="rounded border p-4 space-y-1" style={{ borderColor: BORDER, background: "#12161a" }}>
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-mono font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

// ── Browse Tab ────────────────────────────────────────────────────────────────
function BrowseTab() {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [subs, setSubs] = useState<MarketplaceSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([getMarketplaceStrategies(), getMarketplaceSubscriptions()])
      .then(([l, s]) => {
        setListings(Array.isArray(l.listings) ? l.listings : []);
        setSubs(Array.isArray(s.subscriptions) ? s.subscriptions : []);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const isSubscribed = (id: string) => subs.some((s) => s.listingId === id && s.isActive);

  async function toggle(listing: MarketplaceListing) {
    setBusy(listing.id);
    try {
      const existing = subs.find((s) => s.listingId === listing.id && s.isActive);
      if (existing) {
        await cancelSubscription(existing.id);
        setSubs((prev) => prev.filter((s) => s.id !== existing.id));
      } else {
        const { subscription } = await subscribeToStrategy({ listingId: listing.id });
        setSubs((prev) => [...prev, subscription]);
      }
    } catch (e) {
      console.error("Subscription toggle failed:", e);
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Err msg={error} onRetry={load} />;

  return (
    <div className="p-4 overflow-auto h-full">
      {listings.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2">
          <span className="text-xs text-muted-foreground font-mono">No strategies published yet.</span>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {listings.map((l) => {
            const subscribed = isSubscribed(l.id);
            const price = Number(l.pricePerMonth ?? 0);
            return (
              <div key={l.id} className="rounded border p-4 space-y-3 hover:border-[#F0B90B]/30 transition-colors"
                style={{ borderColor: "#2B3139", background: "#12161a" }}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-mono font-semibold leading-tight">{l.name ?? "Unnamed Strategy"}</span>
                  <Badge color={l.isActive ? "#0ECB81" : "#F6465D"}>{l.isActive ? "Active" : "Inactive"}</Badge>
                </div>
                {l.description && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{l.description}</p>
                )}
                <div className="flex gap-2 flex-wrap">
                  {l.symbol && <Badge color="#8B8FA8">{l.symbol}</Badge>}
                  {l.interval && <Badge color="#8B8FA8">{l.interval}</Badge>}
                  {price > 0 && <Badge color="#F0B90B">${fmtNum(price)}/mo</Badge>}
                </div>
                <div className="text-[10px] text-muted-foreground font-mono">Published {fmtDate(l.createdAt)}</div>
                <button
                  disabled={busy === l.id}
                  onClick={() => toggle(l)}
                  className="w-full py-1.5 rounded text-[11px] font-mono font-semibold transition-colors disabled:opacity-50"
                  style={{
                    background: subscribed ? "#F6465D22" : "#0ECB8122",
                    color: subscribed ? "#F6465D" : "#0ECB81",
                    border: `1px solid ${subscribed ? "#F6465D44" : "#0ECB8144"}`,
                  }}
                >
                  {busy === l.id ? "…" : subscribed ? "Unsubscribe" : "Subscribe"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── My Subscriptions Tab ──────────────────────────────────────────────────────
function SubscriptionsTab() {
  const [subs, setSubs] = useState<MarketplaceSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getMarketplaceSubscriptions()
      .then((r) => { setSubs(Array.isArray(r.subscriptions) ? r.subscriptions : []); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function cancel(id: number) {
    setCancelling(id);
    try {
      await cancelSubscription(id);
      setSubs((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      console.error("Cancel subscription failed:", e);
      alert((e as Error).message);
    } finally {
      setCancelling(null);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Err msg={error} onRetry={load} />;
  if (subs.length === 0) return (
    <div className="flex items-center justify-center h-40 text-xs text-muted-foreground font-mono">
      No active subscriptions.
    </div>
  );

  return (
    <div className="overflow-auto h-full">
      <table className="w-full text-xs font-mono border-collapse">
        <thead>
          <tr style={{ borderBottom: BORDER }}>
            {["Listing ID", "Copy Ratio", "Max Loss", "Status", "Subscribed", ""].map((h) => (
              <th key={h} className="px-3 py-2 text-left text-muted-foreground font-normal uppercase tracking-wider text-[10px]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {subs.map((s) => (
            <tr key={s.id} style={{ borderBottom: BORDER }} className="hover:bg-white/[0.02]">
              <td className="px-3 py-2 text-muted-foreground">{String(s.listingId ?? "—").slice(0, 8)}…</td>
              <td className="px-3 py-2">{fmtNum(s.copyRatio ?? 1, 1)}×</td>
              <td className="px-3 py-2">{s.maxLossLimit != null ? `$${fmtNum(s.maxLossLimit)}` : "—"}</td>
              <td className="px-3 py-2">
                <Badge color={s.isActive ? "#0ECB81" : "#F6465D"}>{s.isActive ? "Active" : "Cancelled"}</Badge>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{fmtDate(s.createdAt)}</td>
              <td className="px-3 py-2">
                {s.isActive && (
                  <button disabled={cancelling === s.id} onClick={() => cancel(s.id)}
                    className="text-[10px] font-mono text-[#F6465D] hover:underline disabled:opacity-50">
                    {cancelling === s.id ? "…" : "Cancel"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Revenue Tab ───────────────────────────────────────────────────────────────
function RevenueTab() {
  const [rev, setRev] = useState<RevenueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getMarketplaceRevenue()
      .then((r) => { setRev(r.revenue); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner />;
  if (error) return <Err msg={error} onRetry={load} />;
  if (!rev) return null;

  return (
    <div className="p-6 space-y-5 max-w-xl">
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Total Revenue" value={`$${fmtNum(rev.totalRevenue ?? 0)}`} color="#F0B90B" />
        <Stat label="Active Subscribers" value={String(rev.subscriptions ?? 0)} color="#0ECB81" />
      </div>

      {Array.isArray(rev.events) && rev.events.length > 0 && (
        <div className="rounded border overflow-hidden" style={{ borderColor: BORDER }}>
          <div className="px-3 py-2 text-[10px] font-mono text-muted-foreground uppercase tracking-wider" style={{ borderBottom: BORDER }}>
            Revenue Events
          </div>
          <div className="overflow-auto max-h-64">
            {rev.events.map((e, i) => (
              <div key={i} className="flex justify-between px-3 py-2 text-xs font-mono hover:bg-white/[0.02]" style={{ borderBottom: BORDER }}>
                <span className="text-muted-foreground">{e.description ?? "Revenue"}</span>
                <span className="text-[#0ECB81]">+${fmtNum(e.amount ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function MarketplacePage() {
  const [tab, setTab] = useState<Tab>("Browse");

  return (
    <div className="flex flex-col h-full font-mono overflow-hidden" style={{ background: "#0B0E11" }}>
      <div className="flex items-center shrink-0" style={{ borderBottom: BORDER, height: 44 }}>
        <span className="px-4 text-xs text-muted-foreground uppercase tracking-widest mr-4">Marketplace</span>
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
        {tab === "Browse"           && <BrowseTab />}
        {tab === "My Subscriptions" && <SubscriptionsTab />}
        {tab === "Revenue"          && <RevenueTab />}
      </div>
    </div>
  );
}
