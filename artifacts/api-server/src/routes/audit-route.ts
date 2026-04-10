/**
 * Audit Log Query API — read-only access to the immutable audit log.
 *
 * The audit table is append-only at the DB level (enforced via Postgres policy
 * when row-level security is enabled — see the database hardening guide).
 * These endpoints are read-only — no mutations are ever exposed via API.
 *
 * Admin routes:
 *   GET /audit/logs                      — paginated audit log with filters
 *   GET /audit/logs/:id                  — single log entry
 *   GET /audit/stats                     — event frequency counts by action
 *   GET /audit/users/:userId/timeline    — all events for a specific user
 */

import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";
import { requireRole } from "../middlewares/role-guard.js";

const router = Router();
const adminOnly = [requireAuth, requireRole("ADMIN")] as const;

/* ── Query schema ─────────────────────────────────────────────────────────── */

const listSchema = z.object({
  action:    z.string().optional(),
  userId:    z.string().optional(),
  resource:  z.string().optional(),
  ipAddress: z.string().optional(),
  since:     z.string().datetime().optional(),
  until:     z.string().datetime().optional(),
  limit:     z.coerce.number().int().min(1).max(500).default(100),
  offset:    z.coerce.number().int().min(0).default(0),
});

/* ── GET /audit/logs ──────────────────────────────────────────────────────── */

router.get("/audit/logs", ...adminOnly, async (req, res): Promise<void> => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }

  const { action, userId, resource, ipAddress, since, until, limit, offset } = parsed.data;

  try {
    const conditions = [];
    if (action)    conditions.push(eq(auditLogsTable.action,    action));
    if (userId)    conditions.push(eq(auditLogsTable.userId,    userId));
    if (resource)  conditions.push(eq(auditLogsTable.resource,  resource));
    if (ipAddress) conditions.push(eq(auditLogsTable.ipAddress, ipAddress));
    if (since)     conditions.push(gte(auditLogsTable.createdAt, new Date(since)));
    if (until)     conditions.push(lte(auditLogsTable.createdAt, new Date(until)));

    const rows = await db
      .select()
      .from(auditLogsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({
      logs: rows.map((r) => ({
        ...r,
        payload: r.payload ? JSON.parse(r.payload) : null,
      })),
      count:  rows.length,
      limit,
      offset,
    });
  } catch (err) {
    logger.error({ err, path: req.path }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /audit/logs/:id — single entry ──────────────────────────────────── */

router.get("/audit/logs/:id", ...adminOnly, async (req, res): Promise<void> => {
  const [row] = await db
    .select()
    .from(auditLogsTable)
    .where(eq(auditLogsTable.id, req.params["id"]!))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Audit log entry not found" });
    return;
  }

  res.json({ log: { ...row, payload: row.payload ? JSON.parse(row.payload) : null } });
});

/* ── GET /audit/stats — event frequency ──────────────────────────────────── */

router.get("/audit/stats", ...adminOnly, async (_req, res): Promise<void> => {
  try {
    const stats = await db
      .select({
        action: auditLogsTable.action,
        count:  sql<number>`COUNT(*)::int`,
        latest: sql<string>`MAX(${auditLogsTable.createdAt})`,
      })
      .from(auditLogsTable)
      .groupBy(auditLogsTable.action)
      .orderBy(sql`COUNT(*) DESC`);

    res.json({ stats, totalActions: stats.length });
  } catch (err) {
    logger.error({ err, path: req.path }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /audit/users/:userId/timeline ───────────────────────────────────── */

router.get("/audit/users/:userId/timeline", ...adminOnly, async (req, res): Promise<void> => {
  const targetUserId = req.params["userId"]!;

  const parsed = z.object({
    limit:  z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  }).safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.userId, targetUserId))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(parsed.data.limit)
      .offset(parsed.data.offset);

    res.json({
      userId:  targetUserId,
      events:  rows.map((r) => ({
        ...r,
        payload: r.payload ? JSON.parse(r.payload) : null,
      })),
      count:  rows.length,
    });
  } catch (err) {
    logger.error({ err, path: req.path }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── User: GET /audit/me — my own audit trail ─────────────────────────────── */

router.get("/audit/me", requireAuth, async (req, res): Promise<void> => {
  const userId = String(req.userId!);
  const parsed = z.object({
    limit:  z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }).safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }

  try {
    const rows = await db
      .select({
        id:         auditLogsTable.id,
        action:     auditLogsTable.action,
        resource:   auditLogsTable.resource,
        resourceId: auditLogsTable.resourceId,
        createdAt:  auditLogsTable.createdAt,
        ipAddress:  auditLogsTable.ipAddress,
      })
      .from(auditLogsTable)
      .where(eq(auditLogsTable.userId, userId))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(parsed.data.limit)
      .offset(parsed.data.offset);

    // Return without payload — users get their own timeline but not full payloads
    res.json({ events: rows, count: rows.length });
  } catch (err) {
    logger.error({ err, path: req.path }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
