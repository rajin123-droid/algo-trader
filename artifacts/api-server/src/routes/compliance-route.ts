/**
 * Compliance routes — KYC and AML endpoints.
 *
 * GET  /compliance/kyc           — current user's KYC status
 * POST /compliance/kyc/submit    — submit KYC documents
 * PATCH /compliance/kyc/:userId  — admin: approve/reject KYC (ADMIN only)
 * POST /compliance/aml/check     — run AML check on a hypothetical trade
 * GET  /compliance/aml/history   — current user's AML check history
 */

import { Router } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db, kycRecordsTable, amlChecksTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";
import { requireRole } from "../middlewares/role-guard.js";
import { auditLog, AuditAction, requestMeta } from "../lib/audit-log.js";
import {
  runAmlCheck,
  requiresAmlCheck,
  canTrade,
  type AmlCheckInput,
} from "../../../../services/compliance/src/index.js";

const router = Router();

/* ── KYC: get status ──────────────────────────────────────────────────────── */

router.get("/compliance/kyc", requireAuth, async (req, res) => {
  const [record] = await db
    .select()
    .from(kycRecordsTable)
    .where(eq(kycRecordsTable.userId, req.userId!))
    .orderBy(desc(kycRecordsTable.submittedAt))
    .limit(1);

  if (!record) {
    res.json({
      status: "NONE",
      level:  "NONE",
      message: "No KYC record found. Submit KYC to unlock trading.",
    });
    return;
  }

  res.json({
    status:          record.status,
    level:           record.level,
    submittedAt:     record.submittedAt,
    reviewedAt:      record.reviewedAt,
    rejectionReason: record.rejectionReason,
  });
});

/* ── KYC: submit ──────────────────────────────────────────────────────────── */

const submitKycSchema = z.object({
  level:     z.enum(["BASIC", "INTERMEDIATE", "ADVANCED"]),
  documents: z.array(z.object({
    type:   z.string(),   // "PASSPORT" | "DRIVERS_LICENSE" | "UTILITY_BILL"
    hash:   z.string(),   // SHA-256 of the document file
  })).min(1),
});

router.post("/compliance/kyc/submit", requireAuth, async (req, res) => {
  const parsed = submitKycSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }

  const [existing] = await db
    .select({ status: kycRecordsTable.status })
    .from(kycRecordsTable)
    .where(eq(kycRecordsTable.userId, req.userId!))
    .orderBy(desc(kycRecordsTable.submittedAt))
    .limit(1);

  if (existing?.status === "PENDING") {
    res.status(409).json({ error: "A KYC review is already pending" });
    return;
  }

  if (existing?.status === "APPROVED") {
    res.status(409).json({ error: "KYC is already approved" });
    return;
  }

  const [record] = await db
    .insert(kycRecordsTable)
    .values({
      userId:    req.userId!,
      status:    "PENDING",
      level:     parsed.data.level,
      documents: JSON.stringify(parsed.data.documents),
    })
    .returning();

  await auditLog({
    userId:    req.userId,
    action:    AuditAction.KYC_SUBMITTED,
    resource:  "kyc",
    resourceId: record!.id,
    payload:   { level: parsed.data.level, docCount: parsed.data.documents.length },
    ...requestMeta(req),
  });

  res.status(201).json({ record: { id: record!.id, status: record!.status, level: record!.level } });
});

/* ── KYC: admin review ────────────────────────────────────────────────────── */

const reviewKycSchema = z.object({
  decision:        z.enum(["APPROVED", "REJECTED"]),
  level:           z.enum(["NONE", "BASIC", "INTERMEDIATE", "ADVANCED"]).optional(),
  rejectionReason: z.string().optional(),
});

router.patch("/compliance/kyc/:recordId",
  requireAuth, requireRole("ADMIN"),
  async (req, res) => {
    const parsed = reviewKycSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message });
      return;
    }

    const recordId = Number(req.params["recordId"]);
    if (isNaN(recordId)) {
      res.status(400).json({ error: "Invalid record ID" });
      return;
    }

    const [record] = await db
      .update(kycRecordsTable)
      .set({
        status:          parsed.data.decision,
        level:           parsed.data.decision === "APPROVED"
                           ? (parsed.data.level ?? "BASIC")
                           : "NONE",
        rejectionReason: parsed.data.rejectionReason,
        reviewedAt:      new Date(),
      })
      .where(eq(kycRecordsTable.id, recordId))
      .returning();

    if (!record) {
      res.status(404).json({ error: "KYC record not found" });
      return;
    }

    await auditLog({
      userId:    req.userId,
      action:    parsed.data.decision === "APPROVED" ? AuditAction.KYC_APPROVED : AuditAction.KYC_REJECTED,
      resource:  "kyc",
      resourceId: recordId,
      payload:   { decision: parsed.data.decision, level: record.level },
      ...requestMeta(req),
    });

    res.json({ record });
  }
);

/* ── AML: manual check ────────────────────────────────────────────────────── */

const amlCheckSchema = z.object({
  amountUsd:              z.number().positive(),
  symbol:                 z.string(),
  side:                   z.enum(["BUY", "SELL"]),
  avgTradeSize30d:        z.number().optional(),
  tradesLastHour:         z.number().optional(),
  tradesLast24h:          z.number().optional(),
  lastTradeSide:          z.enum(["BUY", "SELL"]).optional(),
  secondsSinceLastTrade:  z.number().optional(),
});

router.post("/compliance/aml/check", requireAuth, async (req, res) => {
  const parsed = amlCheckSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }

  const input: AmlCheckInput = { ...parsed.data, userId: req.userId! };
  const result = runAmlCheck(input);

  // Persist if the amount is above threshold or flagged
  if (requiresAmlCheck(parsed.data.amountUsd) || result.flagged) {
    const [check] = await db
      .insert(amlChecksTable)
      .values({
        userId:    req.userId!,
        tradeType: "MANUAL",
        amount:    parsed.data.amountUsd,
        riskScore: result.riskScore,
        flagged:   result.flagged,
        reason:    result.reason,
        factors:   JSON.stringify(result.factors),
      })
      .returning({ id: amlChecksTable.id });

    if (result.decision === "FLAG" || result.decision === "BLOCK") {
      await auditLog({
        userId:    req.userId,
        action:    result.decision === "BLOCK" ? AuditAction.AML_BLOCKED : AuditAction.AML_FLAGGED,
        resource:  "aml_check",
        resourceId: check!.id,
        payload:   { riskScore: result.riskScore, reason: result.reason, amount: parsed.data.amountUsd },
        ...requestMeta(req),
      });
    }
  }

  res.json({ result });
});

/* ── AML: history ─────────────────────────────────────────────────────────── */

router.get("/compliance/aml/history", requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  try {
    const checks = await db
      .select()
      .from(amlChecksTable)
      .where(eq(amlChecksTable.userId, req.userId!))
      .orderBy(desc(amlChecksTable.checkedAt))
      .limit(limit);

    res.json({
      checks: checks.map((c) => ({
        ...c,
        factors: c.factors ? JSON.parse(c.factors) : [],
      })),
      count: checks.length,
    });
  } catch (err) {
    logger.error({ err, path: req.path }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── KYC trade gate check ─────────────────────────────────────────────────── */

router.get("/compliance/kyc/can-trade", requireAuth, async (req, res) => {
  const amountUsd    = Number(req.query.amount)     || 0;
  const dailyVolume  = Number(req.query.dailyVolume) || 0;

  const [record] = await db
    .select({ status: kycRecordsTable.status, level: kycRecordsTable.level })
    .from(kycRecordsTable)
    .where(eq(kycRecordsTable.userId, req.userId!))
    .orderBy(desc(kycRecordsTable.submittedAt))
    .limit(1);

  const kycRecord = record ?? { status: "NONE", level: "NONE" };
  const checkResult = canTrade(
    { status: kycRecord.status as "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED", level: kycRecord.level as "NONE" | "BASIC" | "INTERMEDIATE" | "ADVANCED" },
    amountUsd,
    dailyVolume
  );

  res.json(checkResult);
});

export default router;
