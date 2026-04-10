/**
 * Admin routes — restricted to ADMIN role.
 *
 * GET  /admin/audit-logs      — paginated audit log viewer
 * POST /admin/reconcile       — trigger ledger reconciliation
 * GET  /admin/reconcile/last  — last reconciliation result (cached)
 * GET  /admin/users           — list users with roles
 * PATCH /admin/users/:id/role — change user role
 * GET  /admin/queue/depth     — order queue depth
 */

import { Router } from "express";
import { z } from "zod";
import { eq, desc, sql } from "drizzle-orm";
import {
  db,
  auditLogsTable,
  usersTable,
  strategySubscriptionsTable,
  strategyListingsTable,
  copyTradesTable,
  revenueEventsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
import { requireRole } from "../middlewares/role-guard.js";
import { adminLimiter } from "../middlewares/rate-limiter.js";
import { logger } from "../lib/logger.js";
import { reconcileLedger } from "../lib/reconciliation.js";
import { auditLog, AuditAction, requestMeta } from "../lib/audit-log.js";
import { orderQueue } from "../lib/order-queue.js";
import {
  activateKillSwitch,
  deactivateKillSwitch,
  killSwitchState,
} from "../lib/kill-switch.js";
import { LedgerService } from "../lib/ledger-service.js";
import { getOrCreateAccount } from "../lib/risk-check.js";
import { reconcileExchange, getReconHistory } from "../exchange/exchange-reconciliation.js";
import { captureBalanceSnapshot, getLatestSnapshot } from "../exchange/balance-snapshot.js";

const router = Router();
const adminOnly = [requireAuth, requireRole("ADMIN")] as const;

// Rate-limit all admin endpoints (per authenticated user)
router.use("/admin", adminLimiter);

/* ── Audit log viewer ─────────────────────────────────────────────────────── */

router.get("/admin/audit-logs", ...adminOnly, async (req, res) => {
  const limit  = Math.min(Number(req.query.limit)  || 100, 500);
  const offset = Number(req.query.offset) || 0;
  const action = req.query.action as string | undefined;

  try {
    const rows = await db
      .select()
      .from(auditLogsTable)
      .orderBy(auditLogsTable.createdAt)
      .limit(limit)
      .offset(offset);

    const filtered = action
      ? rows.filter((r) => r.action === action)
      : rows;

    res.json({
      logs:   filtered.map((r) => ({
        ...r,
        payload: r.payload ? JSON.parse(r.payload) : null,
      })),
      count:  filtered.length,
      limit,
      offset,
    });
  } catch (err) {
    logger.error({ err, path: req.path }, "Admin operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── Ledger reconciliation ────────────────────────────────────────────────── */

let lastReconciliation: Awaited<ReturnType<typeof reconcileLedger>> | null = null;

router.post("/admin/reconcile", ...adminOnly, async (req, res) => {
  try {
    const result = await reconcileLedger(String(req.userId!));
    lastReconciliation = result;

    res.status(result.status === "FAIL" ? 207 : 200).json({ result });
  } catch (err) {
    logger.error({ err, path: req.path }, "Admin operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/reconcile/last", ...adminOnly, (_req, res) => {
  if (!lastReconciliation) {
    res.status(404).json({ error: "No reconciliation has been run yet" });
    return;
  }
  res.json({ result: lastReconciliation });
});

/* ── User management ──────────────────────────────────────────────────────── */

router.get("/admin/users", ...adminOnly, async (_req, res) => {
  try {
    const users = await db
      .select({
        id:        usersTable.id,
        email:     usersTable.email,
        role:      usersTable.role,
        plan:      usersTable.plan,
        isActive:  usersTable.isActive,
        tenantId:  usersTable.tenantId,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable);

    res.json({ users, count: users.length });
  } catch (err) {
    logger.error({ err, path: req.path }, "Admin operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const patchRoleSchema = z.object({
  role: z.enum(["USER", "TRADER", "ADMIN"]),
});

router.patch("/admin/users/:id/role", ...adminOnly, async (req, res) => {
  const parsed = patchRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }

  const targetId = Number(req.params["id"]);
  if (isNaN(targetId)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  try {
    const [updated] = await db
      .update(usersTable)
      .set({ role: parsed.data.role })
      .where(eq(usersTable.id, targetId))
      .returning({ id: usersTable.id, email: usersTable.email, role: usersTable.role });

    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await auditLog({
      userId:     req.userId,
      action:     AuditAction.ROLE_CHANGED,
      resource:   "user",
      resourceId: targetId,
      payload:    { newRole: parsed.data.role },
      ...requestMeta(req),
    });

    res.json({ user: updated });
  } catch (err) {
    logger.error({ err, path: req.path }, "Admin operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── Order queue depth ────────────────────────────────────────────────────── */

router.get("/admin/queue/depth", ...adminOnly, async (_req, res) => {
  try {
    const depth   = await orderQueue.depth();
    const backend = orderQueue.isRedis ? "redis" : "in-memory";
    res.json({ depth, backend });
  } catch (err) {
    logger.error({ err, path: req.path }, "Admin operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── Marketplace management ───────────────────────────────────────────────── */

/**
 * GET /admin/subscriptions
 * List all strategy subscriptions across all users.
 * Query: ?status=ACTIVE|CANCELLED|SUSPENDED  ?listingId=<id>
 */
router.get("/admin/subscriptions", ...adminOnly, async (req, res) => {
  const { status, listingId } = req.query as Record<string, string | undefined>;
  try {
    let rows = await db
      .select()
      .from(strategySubscriptionsTable)
      .orderBy(desc(strategySubscriptionsTable.createdAt));

    if (status)    rows = rows.filter((r) => r.status === status.toUpperCase());
    if (listingId) rows = rows.filter((r) => r.listingId === listingId);

    res.json({
      subscriptions: rows.map((r) => ({ ...r, isActive: r.status === "ACTIVE" })),
      count: rows.length,
    });
  } catch (err) {
    logger.error({ err, path: req.path }, "Admin operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const patchSubscriptionSchema = z.object({
  status: z.enum(["ACTIVE", "CANCELLED", "SUSPENDED"]),
});

/**
 * PATCH /admin/subscriptions/:id
 * Override a subscription's status (admin only).
 */
router.patch("/admin/subscriptions/:id", ...adminOnly, async (req, res) => {
  const parsed = patchSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }

  const id = Number(req.params["id"]);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid subscription ID" });
    return;
  }

  try {
    const [updated] = await db
      .update(strategySubscriptionsTable)
      .set({
        status:      parsed.data.status,
        cancelledAt: parsed.data.status === "CANCELLED" ? new Date() : undefined,
      })
      .where(eq(strategySubscriptionsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Subscription not found" });
      return;
    }

    res.json({ subscription: { ...updated, isActive: updated.status === "ACTIVE" } });
  } catch (err) {
    logger.error({ err, path: req.path }, "Admin operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /admin/strategies
 * List all strategy listings (public and private).
 * Query: ?isActive=true|false  ?creatorId=<id>
 */
router.get("/admin/strategies", ...adminOnly, async (req, res) => {
  const { isActive, creatorId } = req.query as Record<string, string | undefined>;
  try {
    let rows = await db
      .select()
      .from(strategyListingsTable)
      .orderBy(desc(strategyListingsTable.createdAt));

    if (isActive !== undefined) {
      const active = isActive === "true";
      rows = rows.filter((r) => r.isActive === active);
    }
    if (creatorId) rows = rows.filter((r) => r.creatorId === creatorId);

    res.json({ strategies: rows, count: rows.length });
  } catch (err) {
    logger.error({ err, path: req.path }, "Admin operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /admin/strategies/:id
 * Update a listing's visibility or active state (admin only).
 */
router.patch("/admin/strategies/:id", ...adminOnly, async (req, res) => {
  const { isPublic, isActive, name, description } = req.body ?? {};

  try {
    const [updated] = await db
      .update(strategyListingsTable)
      .set({
        ...(isPublic  !== undefined && { isPublic:  Boolean(isPublic) }),
        ...(isActive  !== undefined && { isActive:  Boolean(isActive) }),
        ...(name      !== undefined && { name }),
        ...(description !== undefined && { description }),
        updatedAt: new Date(),
      })
      .where(eq(strategyListingsTable.id, req.params["id"]!))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Strategy listing not found" });
      return;
    }

    res.json({ strategy: updated });
  } catch (err) {
    logger.error({ err, path: req.path }, "Admin operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── Kill Switch ──────────────────────────────────────────────────────────── */

/**
 * GET /admin/kill-switch
 * Returns the current kill-switch state.
 */
router.get("/admin/kill-switch", ...adminOnly, (_req, res) => {
  res.json(killSwitchState());
});

const killSwitchActivateSchema = z.object({
  reason: z.string().min(1).max(500),
});

/**
 * POST /admin/kill-switch/activate
 * Halts all trading system-wide. Requires ADMIN role.
 * Body: { reason: string }
 */
router.post("/admin/kill-switch/activate", ...adminOnly, async (req, res) => {
  const parsed = killSwitchActivateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "reason (string) is required" });
    return;
  }

  await activateKillSwitch(parsed.data.reason);

  await auditLog({
    userId:   req.userId,
    action:   "KILL_SWITCH_ACTIVATED",
    resource: "system",
    payload:  { reason: parsed.data.reason },
    ...requestMeta(req),
  });

  res.json({ message: "Kill switch activated — all trading halted", ...killSwitchState() });
});

/**
 * POST /admin/kill-switch/deactivate
 * Resumes trading. Requires ADMIN role.
 */
router.post("/admin/kill-switch/deactivate", ...adminOnly, async (req, res) => {
  await deactivateKillSwitch();

  await auditLog({
    userId:   req.userId,
    action:   "KILL_SWITCH_DEACTIVATED",
    resource: "system",
    ...requestMeta(req),
  });

  res.json({ message: "Kill switch deactivated — trading resumed", ...killSwitchState() });
});

/* ── Platform analytics ────────────────────────────────────────────────────── */

/**
 * GET /admin/analytics/kpi
 * Platform-wide KPIs aggregated from all users.
 */
router.get("/admin/analytics/kpi", ...adminOnly, async (_req, res) => {
  try {
    const [
      usersResult,
      activeStrategies,
      activeSubscriptions,
      copyTradesResult,
      revenueResult,
    ] = await Promise.all([
      db.select({ n: sql<number>`COUNT(*)` }).from(usersTable),
      db.select({ n: sql<number>`COUNT(*)` }).from(strategyListingsTable)
        .where(eq(strategyListingsTable.isActive, true)),
      db.select({ n: sql<number>`COUNT(*)` }).from(strategySubscriptionsTable)
        .where(eq(strategySubscriptionsTable.status, "ACTIVE")),
      db.select({ n: sql<number>`COUNT(*)` }).from(copyTradesTable)
        .where(eq(copyTradesTable.status, "EXECUTED")),
      db.select({
        platformRevenue: sql<number>`COALESCE(SUM(platform_share), 0)`,
        creatorEarnings: sql<number>`COALESCE(SUM(creator_share), 0)`,
        revenueEvents:   sql<number>`COUNT(*)`,
      }).from(revenueEventsTable),
    ]);

    res.json({
      totalUsers:          Number(usersResult[0]?.n          ?? 0),
      activeStrategies:    Number(activeStrategies[0]?.n     ?? 0),
      activeSubscriptions: Number(activeSubscriptions[0]?.n  ?? 0),
      totalCopyTrades:     Number(copyTradesResult[0]?.n     ?? 0),
      platformRevenue:     Number(revenueResult[0]?.platformRevenue ?? 0),
      creatorEarnings:     Number(revenueResult[0]?.creatorEarnings ?? 0),
      revenueEvents:       Number(revenueResult[0]?.revenueEvents   ?? 0),
      checkedAt:           new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err, path: req.path }, "Admin operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── Ledger viewer ─────────────────────────────────────────────────────────── */

/**
 * GET /admin/ledger/:userId
 * Returns all ledger account balances for a user plus recent entries per account.
 */
router.get("/admin/ledger/:userId", ...adminOnly, async (req, res) => {
  const { userId } = req.params;
  try {
    const balances = await LedgerService.listAccountBalances(userId);

    // Fetch last 20 entries for each account (in parallel)
    const enriched = await Promise.all(
      balances.map(async (b) => {
        const entries = await LedgerService.getAccountEntries(b.accountId, 20, 0);
        return { ...b, entries };
      })
    );

    res.json({ userId, accounts: enriched, count: enriched.length });
  } catch (err) {
    logger.error({ err, path: req.path }, "Admin operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── Admin balance adjustment ─────────────────────────────────────────────── */

const adjustBalanceSchema = z.object({
  userId: z.string().min(1),
  asset:  z.string().min(1).max(10).toUpperCase(),
  amount: z.number().positive("Amount must be positive"),
  note:   z.string().max(500).optional(),
});

/**
 * POST /admin/adjust-balance
 * Credit or debit a user's account using a balanced ADJUSTMENT transaction.
 * Positive `amount` → user receives funds (DEBIT user, CREDIT system).
 * Negative amounts are intentionally not supported — use a separate DEBIT route.
 */
router.post("/admin/adjust-balance", ...adminOnly, async (req, res) => {
  const parsed = adjustBalanceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }

  const { userId, asset, amount, note } = parsed.data;

  try {
    const userAccount = await getOrCreateAccount(userId, asset);
    const sysAccount  = await getOrCreateAccount("system", asset);
    const amtStr      = amount.toFixed(8);

    const tx = await LedgerService.postTransaction({
      type: "ADJUSTMENT",
      note: note ?? `Admin balance adjustment for user ${userId}`,
      entries: [
        { accountId: userAccount, side: "DEBIT",  amount: amtStr },
        { accountId: sysAccount,  side: "CREDIT", amount: amtStr },
      ],
    });

    await auditLog({
      userId:   req.userId,
      action:   "ADMIN_BALANCE_ADJUST",
      resource: "ledger",
      payload:  { targetUserId: userId, asset, amount, transactionId: tx.transactionId, note },
      ...requestMeta(req),
    });

    res.json({
      success:       true,
      transactionId: tx.transactionId,
      userId,
      asset,
      amount,
    });
  } catch (err) {
    logger.error({ err, path: req.path }, "Admin operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── System health ─────────────────────────────────────────────────────────── */

/**
 * GET /admin/system/health
 * Returns process uptime, memory usage, queue depth, and kill-switch status.
 */
router.get("/admin/system/health", ...adminOnly, async (_req, res) => {
  try {
    const mem   = process.memoryUsage();
    const cpu   = process.cpuUsage();
    const depth = await orderQueue.depth().catch(() => 0);
    const ks    = killSwitchState();

    res.json({
      status:    ks.active ? "HALTED" : "OK",
      uptime:    process.uptime(),
      memory: {
        heapUsed:  mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss:       mem.rss,
        external:  mem.external,
      },
      cpu: {
        userMicros:   cpu.user,
        systemMicros: cpu.system,
      },
      queue: {
        depth,
        backend: orderQueue.isRedis ? "redis" : "in-memory",
      },
      killSwitch: ks,
      nodeVersion: process.version,
      checkedAt:   new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err, path: req.path }, "Admin operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── Exchange Reconciliation Routes ────────────────────────────────────────── */

/**
 * POST /admin/exchange/recon/run
 * Trigger a full exchange ↔ internal reconciliation run immediately.
 */
router.post("/admin/exchange/recon/run", ...adminOnly, async (req, res) => {
  try {
    const result = await reconcileExchange(`admin:${req.userId}`);
    await auditLog({
      userId:   req.userId,
      action:   "EXCHANGE_RECON_RUN",
      resource: "exchange",
      payload:  { status: result.status, mismatches: result.mismatches.length, orphans: result.totalOrphans },
      ...requestMeta(req),
    });
    res.status(result.status === "FAIL" ? 207 : 200).json({ result });
  } catch (err) {
    logger.error({ err, path: req.path }, "Admin operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /admin/exchange/recon/history
 * Return the last N exchange reconciliation log entries.
 * Query: ?limit=20
 */
router.get("/admin/exchange/recon/history", ...adminOnly, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  try {
    const history = await getReconHistory(limit);
    res.json({ history, count: history.length });
  } catch (err) {
    logger.error({ err, path: req.path }, "Admin operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /admin/exchange/balance/snapshot
 * Manually trigger a Binance balance snapshot.
 */
router.post("/admin/exchange/balance/snapshot", ...adminOnly, async (_req, res) => {
  try {
    const result = await captureBalanceSnapshot();
    res.json({ snapshot: result });
  } catch (err) {
    logger.error({ err, path: req.path }, "Admin operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /admin/exchange/balance/latest
 * Return the most recent balance snapshot.
 */
router.get("/admin/exchange/balance/latest", ...adminOnly, async (_req, res) => {
  try {
    const snapshot = await getLatestSnapshot(100);
    res.json({ snapshot });
  } catch (err) {
    logger.error({ err, path: req.path }, "Admin operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
