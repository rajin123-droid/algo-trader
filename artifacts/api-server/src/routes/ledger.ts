/**
 * Ledger REST API
 *
 * User-facing:
 *   GET  /ledger/accounts              — list my accounts + balances
 *   GET  /ledger/accounts/:id          — single account balance
 *   GET  /ledger/accounts/:id/entries  — paginated entry history
 *   GET  /ledger/replay                — rebuild my balances from scratch
 *
 * Admin-only:
 *   GET  /ledger/integrity             — global SUM(DEBIT) = SUM(CREDIT) check
 *   GET  /ledger/negative-balances     — accounts with negative balance
 *   GET  /ledger/chain/verify          — cryptographic hash chain verification
 *   POST /ledger/deposit               — credit a user account (demo/testing)
 *   POST /ledger/withdraw              — debit a user account (demo/testing)
 */

import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { accountsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";
import { requireRole } from "../middlewares/role-guard.js";
import { LedgerService } from "../lib/ledger-service.js";
import { auditLog } from "../lib/audit-log.js";
import { getOrCreateAccount } from "../lib/risk-check.js";

const router = Router();
const adminOnly = [requireAuth, requireRole("ADMIN")] as const;

/* ── GET /ledger/accounts — list my balances ──────────────────────────────── */

router.get("/ledger/accounts", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId   = String(req.userId!);
    const balances = await LedgerService.listAccountBalances(userId);
    res.json({ accounts: balances, count: balances.length });
  } catch (err) {
    logger.error({ err, path: req.path }, "Ledger operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /ledger/accounts/:id — single account ────────────────────────────── */

router.get("/ledger/accounts/:id", requireAuth, async (req, res): Promise<void> => {
  const accountId = req.params["id"]!;

  // Verify ownership (unless admin)
  if (req.userRole !== "ADMIN") {
    const [acct] = await db
      .select({ userId: accountsTable.userId })
      .from(accountsTable)
      .where(eq(accountsTable.id, accountId))
      .limit(1);

    if (!acct || acct.userId !== String(req.userId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }

  try {
    const balance = await LedgerService.getAccountBalance(accountId);
    res.json({ accountId, balance });
  } catch (err) {
    logger.error({ err, path: req.path }, "Ledger operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /ledger/accounts/:id/entries — entry history ────────────────────── */

const entryQuerySchema = z.object({
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get("/ledger/accounts/:id/entries", requireAuth, async (req, res): Promise<void> => {
  const accountId = req.params["id"]!;

  if (req.userRole !== "ADMIN") {
    const [acct] = await db
      .select({ userId: accountsTable.userId })
      .from(accountsTable)
      .where(eq(accountsTable.id, accountId))
      .limit(1);

    if (!acct || acct.userId !== String(req.userId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }

  const parsed = entryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }

  try {
    const entries = await LedgerService.getAccountEntries(
      accountId,
      parsed.data.limit,
      parsed.data.offset
    );
    res.json({ entries, count: entries.length, limit: parsed.data.limit, offset: parsed.data.offset });
  } catch (err) {
    logger.error({ err, path: req.path }, "Ledger operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /ledger/replay — rebuild balances from entries ───────────────────── */

router.get("/ledger/replay", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId   = req.userRole === "ADMIN" ? undefined : String(req.userId!);
    const balances = await LedgerService.replayBalances(userId);
    const result   = Array.from(balances.values());
    res.json({ balances: result, accountCount: result.length, replayedAt: new Date() });
  } catch (err) {
    logger.error({ err, path: req.path }, "Ledger operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── Admin: GET /ledger/integrity ─────────────────────────────────────────── */

router.get("/ledger/integrity", ...adminOnly, async (_req, res): Promise<void> => {
  try {
    const result = await LedgerService.verifyGlobalIntegrity();
    res.status(result.pass ? 200 : 507).json(result);
  } catch (err) {
    logger.error({ err, path: req.path }, "Ledger operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── Admin: GET /ledger/negative-balances ─────────────────────────────────── */

router.get("/ledger/negative-balances", ...adminOnly, async (_req, res): Promise<void> => {
  try {
    const accounts = await LedgerService.findNegativeBalances();
    res.status(accounts.length > 0 ? 207 : 200).json({
      safe:     accounts.length === 0,
      count:    accounts.length,
      accounts,
    });
  } catch (err) {
    logger.error({ err, path: req.path }, "Ledger operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── Admin: GET /ledger/chain/verify ──────────────────────────────────────── */

const chainQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100_000).default(10_000),
});

router.get("/ledger/chain/verify", ...adminOnly, async (req, res): Promise<void> => {
  const parsed = chainQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }

  try {
    const result = await LedgerService.verifyHashChain(parsed.data.limit);
    res.status(result.valid ? 200 : 507).json({
      ...result,
      verifiedAt: new Date(),
      interpretation: result.valid
        ? "Hash chain intact — no tampering detected"
        : "CRITICAL: Hash chain broken — possible ledger tampering. Investigate immediately.",
    });
  } catch (err) {
    logger.error({ err, path: req.path }, "Ledger operation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── Admin: POST /ledger/deposit — credit a user account ─────────────────── */

const depositSchema = z.object({
  userId: z.string().min(1),
  asset:  z.string().min(1).max(20),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Amount must be a positive decimal string"),
  note:   z.string().max(200).optional(),
});

router.post("/ledger/deposit", ...adminOnly, async (req, res): Promise<void> => {
  const parsed = depositSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }

  const { userId, asset, amount, note } = parsed.data;

  try {
    const userAccountId = await getOrCreateAccount(userId, asset);
    const sysAccountId  = await getOrCreateAccount("system", asset);

    const tx = await LedgerService.postTransaction({
      type: "DEPOSIT",
      entries: [
        { accountId: userAccountId, side: "DEBIT",  amount },
        { accountId: sysAccountId,  side: "CREDIT", amount },
      ],
      note,
    });

    await auditLog({
      userId:     req.userId,
      action:     "DEPOSIT",
      resource:   "ledger",
      resourceId: tx.transactionId,
      payload:    { targetUserId: userId, asset, amount },
    });

    res.status(201).json({
      transactionId: tx.transactionId,
      userId,
      asset,
      amount,
      type: "DEPOSIT",
    });
  } catch (err) {
    logger.warn({ err }, "Ledger validation error");
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid request" });
  }
});

/* ── Admin: POST /ledger/withdraw ─────────────────────────────────────────── */

const withdrawSchema = z.object({
  userId: z.string().min(1),
  asset:  z.string().min(1).max(20),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Amount must be a positive decimal string"),
  note:   z.string().max(200).optional(),
});

router.post("/ledger/withdraw", ...adminOnly, async (req, res): Promise<void> => {
  const parsed = withdrawSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }

  const { userId, asset, amount, note } = parsed.data;

  try {
    const userAccountId = await getOrCreateAccount(userId, asset);
    const sysAccountId  = await getOrCreateAccount("system", asset);

    // Check balance before withdrawal
    const { LedgerService: LS } = await import("../lib/ledger-service.js");
    const balance = await LS.getAccountBalance(userAccountId);
    if (balance < Number(amount)) {
      res.status(422).json({
        error:     "Insufficient balance for withdrawal",
        balance,
        requested: Number(amount),
      });
      return;
    }

    const tx = await LedgerService.postTransaction({
      type: "WITHDRAWAL",
      entries: [
        { accountId: userAccountId, side: "CREDIT", amount },
        { accountId: sysAccountId,  side: "DEBIT",  amount },
      ],
      note,
    });

    await auditLog({
      userId:     req.userId,
      action:     "WITHDRAWAL",
      resource:   "ledger",
      resourceId: tx.transactionId,
      payload:    { targetUserId: userId, asset, amount },
    });

    res.status(201).json({
      transactionId: tx.transactionId,
      userId,
      asset,
      amount,
      type: "WITHDRAWAL",
    });
  } catch (err) {
    logger.warn({ err }, "Ledger validation error");
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid request" });
  }
});

export default router;
