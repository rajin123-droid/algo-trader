/**
 * Auth routes — production-grade, exchange-grade security.
 *
 * POST   /auth/register     → create account + issue token pair
 * POST   /auth/login        → verify credentials + issue token pair
 * POST   /auth/refresh      → rotate refresh token → new token pair
 * POST   /auth/logout       → revoke refresh token + blacklist access token
 * POST   /auth/logout-all   → revoke all sessions for the authenticated user
 * GET    /auth/sessions      → list active sessions (requires auth)
 * DELETE /auth/sessions/:id  → revoke a specific session (requires auth)
 * GET    /auth/me            → current user info (requires auth)
 *
 * Security layers:
 *   1. Password policy (min 8 chars, uppercase, number)
 *   2. bcrypt cost 12
 *   3. Account lockout (5 fails / 15 min → locked 30 min)
 *   4. Rotating refresh tokens stored by SHA-256 hash
 *   5. Access token blacklist on logout
 *   6. Rate limiting via authLimiter
 *   7. Audit log on every significant event
 *   8. Auth event metrics (Prometheus)
 */

import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  listActiveSessions,
  revokeSession,
} from "../lib/refresh-token-manager.js";
import { blacklistToken, isTokenBlacklisted } from "../lib/token-blacklist.js";
import { verifyToken, tokenTtlSeconds } from "../lib/jwt.js";
import { validatePassword } from "../lib/password-policy.js";
import {
  isLockedOut,
  recordFailedAttempt,
  clearAttempts,
  lockoutRemainingSeconds,
} from "../lib/login-attempt-tracker.js";
import { auditLog, AuditAction, requestMeta } from "../lib/audit-log.js";
import { authLimiter } from "../middlewares/rate-limiter.js";
import { requireAuth } from "../middlewares/auth.js";
import { authEventCounter } from "../../../../services/observability/src/index.js";
import { validate, loginSchema, registerSchema, refreshSchema } from "../validation/index.js";
import { logger, requestLogger } from "../lib/logger.js";

const router: IRouter = Router();

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function deviceInfo(req: Parameters<typeof requestMeta>[0]) {
  return {
    userAgent: req.headers["user-agent"] ?? undefined,
    ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip,
    deviceId:  req.headers["x-device-id"] as string | undefined,
  };
}

/* ── Register ─────────────────────────────────────────────────────────────── */

router.post("/auth/register", authLimiter, validate(registerSchema), async (req, res): Promise<void> => {
  const { email, password } = req.body;

  // Password policy (deeper complexity check on top of the Zod length check)
  const policy = validatePassword(password);
  if (!policy.ok) {
    res.status(400).json({ error: "Password does not meet requirements", details: policy.errors });
    return;
  }

  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (existing.length > 0) {
    res.status(400).json({ error: "User already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [user] = await db
    .insert(usersTable)
    .values({ email, passwordHash })
    .returning({
      id:       usersTable.id,
      email:    usersTable.email,
      plan:     usersTable.plan,
      role:     usersTable.role,
      tenantId: usersTable.tenantId,
    });

  const tokens = await issueTokenPair(
    user!.id,
    user!.role ?? "USER",
    user!.tenantId ?? null,
    deviceInfo(req)
  );

  authEventCounter.inc({ event: "register" });

  await auditLog({
    userId:     user!.id,
    action:     AuditAction.REGISTER,
    resource:   "user",
    resourceId: user!.id,
    payload:    { email },
    ...requestMeta(req),
  });

  res.status(201).json({
    msg:  "User created",
    user: { id: user!.id, email: user!.email, plan: user!.plan, role: user!.role },
    ...tokens,
    token: tokens.accessToken,   // backward compat
  });
});

/* ── Login ────────────────────────────────────────────────────────────────── */

router.post("/auth/login", authLimiter, validate(loginSchema), async (req, res): Promise<void> => {
  const { email, password } = req.body;

  // Lockout check — fast Redis/in-memory check before touching DB
  if (await isLockedOut(email)) {
    const remaining = await lockoutRemainingSeconds(email);
    authEventCounter.inc({ event: "login_locked" });
    res.status(429).json({
      error:             "Account temporarily locked due to too many failed attempts",
      retryAfterSeconds: remaining,
    });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  // Use constant-time comparison to prevent email enumeration via timing
  if (!user) {
    await bcrypt.compare(password, "$2b$12$invalidhashfortimingnormalization");
    await recordFailedAttempt(email);
    await auditLog({ action: AuditAction.LOGIN_FAILED, payload: { email }, ...requestMeta(req) });
    authEventCounter.inc({ event: "login_fail" });
    requestLogger(req.reqId ?? "").warn({ event: "login_fail_no_user", email, ip: req.ip }, "Login failed — user not found");
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (!user.isActive) {
    res.status(403).json({ error: "Account disabled" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const { locked, remaining } = await recordFailedAttempt(email);
    await auditLog({ userId: user.id, action: AuditAction.LOGIN_FAILED, payload: { email }, ...requestMeta(req) });
    authEventCounter.inc({ event: "login_fail" });
    requestLogger(req.reqId ?? "").warn({ event: "login_fail_bad_password", userId: user.id, email, ip: req.ip, locked }, "Login failed — wrong password");

    if (locked) {
      res.status(429).json({
        error:             "Account locked due to too many failed attempts. Try again in 30 minutes.",
        retryAfterSeconds: 1800,
      });
    } else {
      res.status(401).json({
        error:              "Invalid credentials",
        attemptsRemaining:  remaining,
      });
    }
    return;
  }

  // Success — clear lockout counter
  await clearAttempts(email);

  const tokens = await issueTokenPair(
    user.id,
    user.role ?? "USER",
    user.tenantId ?? null,
    deviceInfo(req)
  );

  authEventCounter.inc({ event: "login_success" });

  await auditLog({
    userId:     user.id,
    action:     AuditAction.LOGIN_SUCCESS,
    resource:   "user",
    resourceId: user.id,
    ...requestMeta(req),
  });

  requestLogger(req.reqId ?? "").info({
    event:  "login_success",
    userId: user.id,
    email:  user.email,
    role:   user.role,
    ip:     req.ip,
  }, "Login success");

  res.json({
    msg:   "Login success",
    user:  { id: user.id, email: user.email, plan: user.plan, role: user.role },
    ...tokens,
    token: tokens.accessToken,   // backward compat
  });
});

/* ── Refresh ──────────────────────────────────────────────────────────────── */

router.post("/auth/refresh", authLimiter, validate(refreshSchema), async (req, res): Promise<void> => {
  const { refreshToken } = req.body;

  try {
    const tokens = await rotateRefreshToken(refreshToken, deviceInfo(req));
    authEventCounter.inc({ event: "token_refresh" });
    await auditLog({ action: AuditAction.TOKEN_REFRESHED, ...requestMeta(req) });
    res.json(tokens);
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Token refresh failed" });
  }
});

/* ── Logout (single session) ──────────────────────────────────────────────── */

router.post("/auth/logout", async (req, res): Promise<void> => {
  const { refreshToken } = req.body ?? {};
  const authHeader = req.headers["authorization"];

  // Revoke the refresh token
  if (refreshToken && typeof refreshToken === "string") {
    await revokeRefreshToken(refreshToken);
  }

  // Blacklist the current access token (so it's rejected immediately)
  if (authHeader?.startsWith("Bearer ")) {
    const rawAccess = authHeader.slice(7);
    try {
      const payload = verifyToken(rawAccess);
      if (payload.jti) {
        const ttl = tokenTtlSeconds(rawAccess);
        await blacklistToken(payload.jti, ttl);
      }
    } catch { /* token already invalid — ignore */ }
  }

  authEventCounter.inc({ event: "logout" });
  await auditLog({ action: AuditAction.LOGOUT, ...requestMeta(req) });
  res.sendStatus(204);
});

/* ── Logout all sessions ──────────────────────────────────────────────────── */

router.post("/auth/logout-all", requireAuth, async (req, res): Promise<void> => {
  await revokeAllForUser(req.userId!);

  // Blacklist the current access token too
  if (req.tokenJti) {
    const rawAccess = req.headers["authorization"]!.slice(7);
    const ttl       = tokenTtlSeconds(rawAccess);
    await blacklistToken(req.tokenJti, ttl);
  }

  authEventCounter.inc({ event: "logout_all" });
  await auditLog({
    userId: req.userId,
    action: AuditAction.ALL_SESSIONS_REVOKED,
    ...requestMeta(req),
  });

  res.sendStatus(204);
});

/* ── Session listing ──────────────────────────────────────────────────────── */

router.get("/auth/sessions", requireAuth, async (req, res): Promise<void> => {
  const sessions = await listActiveSessions(req.userId!);
  res.json({ sessions });
});

/* ── Revoke specific session ──────────────────────────────────────────────── */

router.delete("/auth/sessions/:id", requireAuth, async (req, res): Promise<void> => {
  const tokenId = req.params["id"];

  const revoked = await revokeSession(req.userId!, tokenId);

  if (!revoked) {
    res.status(404).json({ error: "Session not found or already revoked" });
    return;
  }

  await auditLog({
    userId:     req.userId,
    action:     AuditAction.LOGOUT,
    resource:   "session",
    resourceId: tokenId,
    ...requestMeta(req),
  });

  res.sendStatus(204);
});

/* ── Me (current user info) ───────────────────────────────────────────────── */

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db
    .select({
      id:       usersTable.id,
      email:    usersTable.email,
      plan:     usersTable.plan,
      role:     usersTable.role,
      tenantId: usersTable.tenantId,
    })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ user });
});

export default router;
