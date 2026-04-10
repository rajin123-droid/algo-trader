/**
 * Safe number formatters for trading UI.
 *
 * In async trading systems, data is partial, delayed, or null.
 * Never call .toFixed() on a raw API value — always go through here.
 */

/** Format a number to fixed decimal places. Treats null/undefined/NaN as 0. */
export function fmtNum(val: unknown, decimals = 2): string {
  const n = Number(val);
  return (isFinite(n) ? n : 0).toFixed(decimals);
}

/** Format a price (2 decimals). */
export function fmtPrice(val: unknown): string {
  return fmtNum(val, 2);
}

/** Format a PnL value with leading + sign for positives. */
export function fmtPnl(val: unknown, decimals = 2): string {
  const n = Number(val);
  const safe = isFinite(n) ? n : 0;
  return `${safe >= 0 ? "+" : ""}${safe.toFixed(decimals)}`;
}

/** Format a ratio (0–1) as a percentage string. */
export function fmtPct(val: unknown, decimals = 1): string {
  const n = Number(val);
  return `${(isFinite(n) ? n * 100 : 0).toFixed(decimals)}%`;
}

/** Format a dollar amount: $1,234.56 */
export function fmtUsd(val: unknown, decimals = 2): string {
  const n = Number(val);
  return `$${(isFinite(n) ? n : 0).toFixed(decimals)}`;
}

/** Format a compact volume: 1.23M, 456K, etc. */
export function fmtVolume(val: unknown): string {
  const n = Number(val);
  if (!isFinite(n)) return "0";
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(2);
}

/** Safe comparison: true if val >= 0, defaults to false for null/undefined. */
export function isPositive(val: unknown): boolean {
  const n = Number(val);
  return isFinite(n) && n >= 0;
}

/** Format a date string to "Apr 9, 10:23 AM". Returns "—" on invalid input. */
export function fmtDate(ts: string | number | null | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

/** Format a unix epoch (seconds) to a date string. */
export function fmtEpoch(epochSec: unknown): string {
  const n = Number(epochSec);
  return fmtDate(isFinite(n) ? n * 1000 : null);
}
