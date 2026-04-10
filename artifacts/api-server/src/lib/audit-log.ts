/**
 * Audit Logger — persists immutable audit events to the audit_logs table.
 *
 * Usage:
 *   await auditLog({
 *     userId: '42',
 *     action: 'TRADE_EXECUTED',
 *     resource: 'auto_trade',
 *     resourceId: tradeId,
 *     payload: { symbol, side, pnl },
 *     ipAddress: req.ip,
 *   });
 */

import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import { logger } from "./logger.js";

/* ── Audit action constants ───────────────────────────────────────────────── */

export const AuditAction = {
  // Auth
  LOGIN_SUCCESS:        "LOGIN_SUCCESS",
  LOGIN_FAILED:         "LOGIN_FAILED",
  REGISTER:             "REGISTER",
  LOGOUT:               "LOGOUT",
  TOKEN_REFRESHED:      "TOKEN_REFRESHED",
  ALL_SESSIONS_REVOKED: "ALL_SESSIONS_REVOKED",
  // Trading
  TRADE_EXECUTED:       "TRADE_EXECUTED",
  TRADE_BLOCKED:        "TRADE_BLOCKED",
  SOR_EXECUTED:         "SOR_EXECUTED",
  SOR_REJECTED:         "SOR_REJECTED",
  // Config
  API_KEY_ADDED:        "API_KEY_ADDED",
  API_KEY_DELETED:      "API_KEY_DELETED",
  PASSWORD_CHANGED:     "PASSWORD_CHANGED",
  ROLE_CHANGED:         "ROLE_CHANGED",
  // Financial
  RECONCILE_PASS:       "RECONCILE_PASS",
  RECONCILE_FAIL:       "RECONCILE_FAIL",
  // Compliance
  KYC_SUBMITTED:        "KYC_SUBMITTED",
  KYC_APPROVED:         "KYC_APPROVED",
  KYC_REJECTED:         "KYC_REJECTED",
  AML_FLAGGED:          "AML_FLAGGED",
  AML_BLOCKED:          "AML_BLOCKED",
  // Marketplace
  STRATEGY_PUBLISHED:   "STRATEGY_PUBLISHED",
  STRATEGY_SUBSCRIBED:  "STRATEGY_SUBSCRIBED",
} as const;

export type AuditActionType = (typeof AuditAction)[keyof typeof AuditAction];

/* ── Log entry ────────────────────────────────────────────────────────────── */

export interface AuditEntry {
  userId?:     string | number;
  tenantId?:   number;
  action:      AuditActionType | string;
  resource?:   string;
  resourceId?: string | number;
  payload?:    Record<string, unknown>;
  ipAddress?:  string;
  userAgent?:  string;
}

/* ── Core function ────────────────────────────────────────────────────────── */

export async function auditLog(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      id:         randomUUID(),
      userId:     entry.userId != null ? String(entry.userId) : null,
      tenantId:   entry.tenantId,
      action:     entry.action,
      resource:   entry.resource,
      resourceId: entry.resourceId != null ? String(entry.resourceId) : null,
      payload:    entry.payload ? JSON.stringify(entry.payload) : null,
      ipAddress:  entry.ipAddress,
      userAgent:  entry.userAgent,
    });
  } catch (err) {
    // Audit logging must NEVER crash the main flow
    logger.error({ err, action: entry.action }, "Failed to write audit log");
  }
}

/* ── Express helper — extract request metadata ────────────────────────────── */

import type { Request } from "express";

export function requestMeta(req: Request): Pick<AuditEntry, "ipAddress" | "userAgent"> {
  return {
    ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip,
    userAgent: req.headers["user-agent"],
  };
}
