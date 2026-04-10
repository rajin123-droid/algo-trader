/**
 * KYC rules — pure functions that determine trading access based on KYC level.
 *
 * No side effects, no DB, no HTTP.
 * All thresholds are configurable via the params argument.
 */

/* ── Types ────────────────────────────────────────────────────────────────── */

export type KycLevel = "NONE" | "BASIC" | "INTERMEDIATE" | "ADVANCED";
export type KycStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

export interface KycRecord {
  level:  KycLevel;
  status: KycStatus;
}

export interface KycCheckResult {
  allowed:       boolean;
  reason?:       string;
  requiredLevel: KycLevel;
  currentLevel:  KycLevel;
}

/* ── Daily volume thresholds per KYC level (in USDT) ─────────────────────── */

export const KYC_VOLUME_LIMITS: Record<KycLevel, number> = {
  NONE:         0,
  BASIC:        10_000,
  INTERMEDIATE: 100_000,
  ADVANCED:     Infinity,
};

const KYC_LEVEL_RANK: Record<KycLevel, number> = {
  NONE: 0, BASIC: 1, INTERMEDIATE: 2, ADVANCED: 3,
};

/* ── Rules ────────────────────────────────────────────────────────────────── */

/**
 * Determine if a user can place a trade of a given notional value.
 *
 * Rules:
 *  1. KYC must be APPROVED (not PENDING, REJECTED, or EXPIRED).
 *  2. The user's KYC level must allow the trade's notional value.
 *  3. The user's cumulative daily volume must not exceed the level limit.
 */
export function canTrade(
  kyc:              KycRecord,
  tradeNotionalUsd: number,
  dailyVolumeUsd:   number = 0
): KycCheckResult {
  if (kyc.status !== "APPROVED") {
    return {
      allowed:       false,
      reason:        `KYC status is ${kyc.status} — must be APPROVED to trade`,
      requiredLevel: "BASIC",
      currentLevel:  kyc.level,
    };
  }

  const limit  = KYC_VOLUME_LIMITS[kyc.level] ?? 0;
  const after  = dailyVolumeUsd + tradeNotionalUsd;

  if (after > limit) {
    const requiredLevel = levelForVolume(after);
    return {
      allowed:       false,
      reason:        `Trade would bring daily volume to $${after.toFixed(2)}, exceeding ${kyc.level} limit of $${limit.toFixed(2)}`,
      requiredLevel,
      currentLevel:  kyc.level,
    };
  }

  return { allowed: true, requiredLevel: kyc.level, currentLevel: kyc.level };
}

/**
 * Return the minimum KYC level required to trade a given volume.
 */
export function levelForVolume(volumeUsd: number): KycLevel {
  const entries = Object.entries(KYC_VOLUME_LIMITS) as [KycLevel, number][];
  for (const [level, limit] of entries.sort((a, b) => a[1] - b[1])) {
    if (volumeUsd <= limit) return level;
  }
  return "ADVANCED";
}

/**
 * Check if levelA is at least as high as levelB.
 */
export function meetsKycLevel(levelA: KycLevel, minLevel: KycLevel): boolean {
  return KYC_LEVEL_RANK[levelA] >= KYC_LEVEL_RANK[minLevel];
}
