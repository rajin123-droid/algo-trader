/**
 * Refresh Token Manager — rotating refresh token pattern.
 *
 * Flow:
 *   POST /auth/login    → issue access token (15m) + refresh token (7d, stored in DB)
 *   POST /auth/refresh  → validate, REVOKE old, issue new pair (strict rotation)
 *   POST /auth/logout   → revoke single refresh token + blacklist access token
 *   POST /auth/logout-all → revoke all user's refresh tokens
 *
 * Security:
 *   • Raw tokens are never stored — only SHA-256 hashes
 *   • `tokenId` (UUID) is embedded in the JWT and is the DB primary key
 *   • Device metadata (deviceId, userAgent, ip) is stored per session
 *   • Token re-use after rotation detected and logged as security event
 */

import { createHash, randomUUID } from "crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { refreshTokensTable, usersTable } from "@workspace/db";
import { signAccessToken, signRefreshToken, verifyToken } from "./jwt.js";
import { logger } from "./logger.js";

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function refreshExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d;
}

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface TokenPair {
  accessToken:  string;
  refreshToken: string;
  expiresIn:    number;   // seconds until access token expires
}

export interface DeviceInfo {
  deviceId?:  string;   // client-supplied fingerprint or derived from user-agent
  userAgent?: string;
  ipAddress?: string;
}

/* ── Issue token pair ─────────────────────────────────────────────────────── */

export async function issueTokenPair(
  userId:   number,
  role:     string        = "USER",
  tenantId: number | null = null,
  device:   DeviceInfo    = {}
): Promise<TokenPair> {
  const tokenId     = randomUUID();
  const refreshRaw  = signRefreshToken(userId, tokenId);
  const accessToken = signAccessToken(userId, role, tenantId);

  await db.insert(refreshTokensTable).values({
    id:         tokenId,
    userId,
    tokenHash:  hashToken(refreshRaw),
    expiresAt:  refreshExpiry(),
    deviceId:   device.deviceId  ?? null,
    userAgent:  device.userAgent ?? null,
    ipAddress:  device.ipAddress ?? null,
    lastUsedAt: new Date(),
  });

  return { accessToken, refreshToken: refreshRaw, expiresIn: 900 };
}

/* ── Rotate ───────────────────────────────────────────────────────────────── */

export async function rotateRefreshToken(
  rawRefreshToken: string,
  device:          DeviceInfo = {}
): Promise<TokenPair> {
  let payload: ReturnType<typeof verifyToken>;
  try {
    payload = verifyToken(rawRefreshToken);
  } catch {
    throw new Error("Invalid refresh token signature");
  }

  if (payload.type !== "refresh" || !payload.tokenId) {
    throw new Error("Token is not a refresh token");
  }

  const hash = hashToken(rawRefreshToken);

  const [row] = await db
    .select()
    .from(refreshTokensTable)
    .where(
      and(
        eq(refreshTokensTable.id,        payload.tokenId),
        eq(refreshTokensTable.tokenHash, hash),
        isNull(refreshTokensTable.revokedAt)
      )
    )
    .limit(1);

  if (!row) {
    // Token was already rotated — possible token theft detection
    logger.warn(
      { tokenId: payload.tokenId, userId: payload.userId },
      "SECURITY: Refresh token reuse detected — token already rotated or revoked"
    );
    throw new Error("Refresh token is invalid or has been revoked");
  }

  if (row.expiresAt < new Date()) {
    throw new Error("Refresh token has expired");
  }

  // Fetch current user role + tenantId
  const [user] = await db
    .select({ role: usersTable.role, tenantId: usersTable.tenantId })
    .from(usersTable)
    .where(eq(usersTable.id, row.userId))
    .limit(1);

  // Stamp lastUsedAt on the old row at the moment of use, then revoke it.
  // This preserves accurate "last active" time in audit history even after rotation.
  await db
    .update(refreshTokensTable)
    .set({ revokedAt: new Date(), lastUsedAt: new Date() })
    .where(eq(refreshTokensTable.id, row.id));

  return issueTokenPair(
    row.userId,
    user?.role ?? "USER",
    user?.tenantId ?? null,
    {
      deviceId:  device.deviceId  ?? row.deviceId  ?? undefined,
      userAgent: device.userAgent ?? row.userAgent  ?? undefined,
      ipAddress: device.ipAddress ?? row.ipAddress  ?? undefined,
    }
  );
}

/* ── Revoke ───────────────────────────────────────────────────────────────── */

export async function revokeRefreshToken(rawRefreshToken: string): Promise<void> {
  let payload: ReturnType<typeof verifyToken>;
  try {
    payload = verifyToken(rawRefreshToken);
  } catch {
    return;
  }

  if (!payload.tokenId) return;

  await db
    .update(refreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokensTable.id, payload.tokenId));
}

export async function revokeAllForUser(userId: number): Promise<void> {
  await db
    .update(refreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokensTable.userId,   userId),
        isNull(refreshTokensTable.revokedAt)
      )
    );
}

/* ── Session listing ──────────────────────────────────────────────────────── */

export interface ActiveSession {
  tokenId:    string;
  deviceId:   string | null;
  userAgent:  string | null;
  ipAddress:  string | null;
  createdAt:  Date;
  lastUsedAt: Date | null;
  expiresAt:  Date;
}

/** List all active (non-revoked, non-expired) sessions for a user. */
export async function listActiveSessions(userId: number): Promise<ActiveSession[]> {
  const rows = await db
    .select({
      id:         refreshTokensTable.id,
      deviceId:   refreshTokensTable.deviceId,
      userAgent:  refreshTokensTable.userAgent,
      ipAddress:  refreshTokensTable.ipAddress,
      createdAt:  refreshTokensTable.createdAt,
      lastUsedAt: refreshTokensTable.lastUsedAt,
      expiresAt:  refreshTokensTable.expiresAt,
    })
    .from(refreshTokensTable)
    .where(
      and(
        eq(refreshTokensTable.userId, userId),
        isNull(refreshTokensTable.revokedAt)
      )
    );

  const now = new Date();
  return rows
    .filter((r) => r.expiresAt > now)
    .map((r) => ({
      tokenId:    r.id,
      deviceId:   r.deviceId,
      userAgent:  r.userAgent,
      ipAddress:  r.ipAddress,
      createdAt:  r.createdAt,
      lastUsedAt: r.lastUsedAt,
      expiresAt:  r.expiresAt,
    }));
}

/** Revoke a specific session by tokenId (only if it belongs to userId). */
export async function revokeSession(userId: number, tokenId: string): Promise<boolean> {
  const result = await db
    .update(refreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokensTable.userId, userId),
        eq(refreshTokensTable.id,     tokenId),
        isNull(refreshTokensTable.revokedAt)
      )
    )
    .returning({ id: refreshTokensTable.id });

  return result.length > 0;
}
