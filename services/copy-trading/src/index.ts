/**
 * @workspace/copy-trading
 *
 * Pure domain logic for copy trading position scaling.
 * No DB, no HTTP, no Redis — those live in the api-server adapter layer.
 */

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface LeaderTrade {
  leaderId:       string;
  listingId:      string;
  signal:         "BUY" | "SELL";
  leaderSize:     number;
  leaderBalance:  number;
  executionPrice: number;
  pnl?:           number;
}

export interface FollowerAllocation {
  subscriptionId:  number;
  followerId:      string;
  followerSize:    number;
  followerPnl:     number | null;
  isSuspended:     boolean;
  suspendReason?:  string;
}

/* ── Position Scaler ─────────────────────────────────────────────────────── */

/**
 * Scale a leader's position size proportionally to the follower's balance,
 * then apply the subscription's copyRatio.
 *
 *   followerSize = leaderSize × (followerBalance / leaderBalance) × copyRatio
 *
 * Clamped to a minimum of 0.0001 to avoid dust positions.
 */
export function scalePosition(
  leaderSize:      number,
  leaderBalance:   number,
  followerBalance: number,
  copyRatio:       number
): number {
  if (leaderBalance <= 0) return 0;
  const raw = leaderSize * (followerBalance / leaderBalance) * copyRatio;
  return Math.max(raw, 0.0001);
}

/**
 * Compute a follower's proportional P&L from a SELL trade.
 * Returns null if this is not a SELL or P&L is not available.
 */
export function computeFollowerPnl(
  leaderPnl:    number | undefined,
  leaderSize:   number,
  followerSize: number
): number | null {
  if (leaderPnl == null || leaderSize <= 0) return null;
  return leaderPnl * (followerSize / leaderSize);
}

/**
 * Check whether a subscription's max-loss limit has been breached.
 */
export function isMaxLossBreached(cumulativePnl: number, maxLossLimit: number): boolean {
  return maxLossLimit > 0 && cumulativePnl < -maxLossLimit;
}

/**
 * Compute follower allocations for a leader trade across all active subscribers.
 * Returns one FollowerAllocation per subscriber (suspended ones are flagged).
 */
export function computeAllocations(
  trade: LeaderTrade,
  subscribers: Array<{
    id:                      number;
    userId:                  string;
    copyRatio:               number;
    followerBalanceSnapshot: number;
    cumulativePnl:           number;
    maxLossLimit:            number;
  }>
): FollowerAllocation[] {
  return subscribers.map((sub) => {
    if (isMaxLossBreached(sub.cumulativePnl, sub.maxLossLimit)) {
      return {
        subscriptionId: sub.id,
        followerId:     sub.userId,
        followerSize:   0,
        followerPnl:    null,
        isSuspended:    true,
        suspendReason:  "Max loss limit reached",
      };
    }

    const followerSize = scalePosition(
      trade.leaderSize,
      trade.leaderBalance,
      sub.followerBalanceSnapshot,
      sub.copyRatio
    );

    const followerPnl =
      trade.signal === "SELL"
        ? computeFollowerPnl(trade.pnl, trade.leaderSize, followerSize)
        : null;

    return {
      subscriptionId: sub.id,
      followerId:     sub.userId,
      followerSize,
      followerPnl,
      isSuspended:    false,
    };
  });
}
