/**
 * @workspace/marketplace
 *
 * Pure domain types and logic for the strategy marketplace.
 * No DB, no HTTP, no Redis — those live in the api-server adapter layer.
 */

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface StrategyListingRecord {
  id:                  string;
  creatorId:           string;
  strategyId:          string;
  strategyParams:      string;
  name:                string;
  description:         string;
  symbol:              string;
  interval:            string;
  pricePerMonth:       number;
  performanceFee:      number;
  performancePnl:      number;
  performanceWinRate:  number;
  performanceDrawdown: number;
  totalTrades:         number;
  subscriberCount:     number;
  isPublic:            boolean;
  isActive:            boolean;
  createdAt:           Date;
  updatedAt:           Date;
}

export interface SubscriptionRecord {
  id:                      number;
  userId:                  string;
  listingId:               string;
  status:                  "ACTIVE" | "CANCELLED" | "SUSPENDED";
  copyRatio:               number;
  followerBalanceSnapshot: number;
  cumulativePnl:           number;
  maxLossLimit:            number;
  startedAt:               Date;
  cancelledAt:             Date | null;
  createdAt:               Date;
}

export interface PublishParams {
  creatorId:      string;
  strategyId:     string;
  strategyParams: Record<string, unknown>;
  name:           string;
  description:    string;
  symbol?:        string;
  interval?:      string;
  pricePerMonth?: number;
  performanceFee?: number;
}

export interface SubscribeParams {
  userId:                  string;
  listingId:               string;
  copyRatio?:              number;
  followerBalanceSnapshot?: number;
  maxLossLimit?:           number;
}

/* ── Validation helpers ───────────────────────────────────────────────────── */

export function validatePublish(params: PublishParams): string | null {
  if (!params.name || params.name.trim().length < 2) return "Name must be at least 2 characters";
  if (!params.strategyId) return "strategyId is required";
  if (params.pricePerMonth != null && params.pricePerMonth < 0) return "pricePerMonth must be non-negative";
  if (params.performanceFee != null && (params.performanceFee < 0 || params.performanceFee > 1))
    return "performanceFee must be between 0 and 1";
  return null;
}
