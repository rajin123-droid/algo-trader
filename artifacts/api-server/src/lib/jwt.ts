import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { authConfig } from "../config/auth.js";

const SECRET = authConfig.sessionSecret;

const ACCESS_EXPIRY  = "15m";
const REFRESH_EXPIRY = "7d";

export type TokenType = "access" | "refresh";

export interface JwtPayload {
  userId:    number;
  /** Present on access tokens. */
  role?:     string;
  /** Present on access tokens. */
  tenantId?: number | null;
  /** tokenId links back to the refresh_tokens row (refresh tokens only). */
  tokenId?:  string;
  /**
   * JWT ID — unique per access token, used for revocation blacklist.
   * Present on access tokens only.
   */
  jti?:      string;
  type:      TokenType;
}

/* ── Access token ─────────────────────────────────────────────────────────── */

export function signAccessToken(
  userId:   number,
  role:     string        = "USER",
  tenantId: number | null = null
): string {
  const jti     = randomUUID();
  const payload: JwtPayload = { userId, role, tenantId, jti, type: "access" };
  return jwt.sign(payload, SECRET, { expiresIn: ACCESS_EXPIRY });
}

/* ── Refresh token ────────────────────────────────────────────────────────── */

export function signRefreshToken(userId: number, tokenId: string): string {
  const payload: JwtPayload = { userId, tokenId, type: "refresh" };
  return jwt.sign(payload, SECRET, { expiresIn: REFRESH_EXPIRY });
}

/* ── Verification ─────────────────────────────────────────────────────────── */

export function verifyToken(token: string): JwtPayload {
  const payload = jwt.verify(token, SECRET);
  if (typeof payload !== "object" || payload === null || !("userId" in payload)) {
    throw new Error("Invalid token payload");
  }
  const p = payload as Record<string, unknown>;
  return {
    userId:   Number(p["userId"]),
    role:     typeof p["role"]     === "string" ? p["role"]     : "USER",
    tenantId: typeof p["tenantId"] === "number" ? p["tenantId"] : null,
    tokenId:  typeof p["tokenId"]  === "string" ? p["tokenId"]  : undefined,
    jti:      typeof p["jti"]      === "string" ? p["jti"]      : undefined,
    type:     (p["type"] as TokenType) ?? "access",
  };
}

/** Extract remaining TTL in seconds from a decoded JWT `exp` claim. */
export function tokenTtlSeconds(token: string): number {
  try {
    const decoded = jwt.decode(token) as Record<string, unknown> | null;
    if (!decoded || typeof decoded["exp"] !== "number") return 0;
    return Math.max(0, decoded["exp"] - Math.floor(Date.now() / 1000));
  } catch {
    return 0;
  }
}

/* ── Legacy helper ────────────────────────────────────────────────────────── */
export function signToken(userId: number): string {
  return signAccessToken(userId);
}
