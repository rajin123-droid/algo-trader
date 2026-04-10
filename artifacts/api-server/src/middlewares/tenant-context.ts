/**
 * Tenant Context middleware — extracts and validates tenant identity.
 *
 * Tenant resolution order:
 *   1. `X-Tenant-ID` header (numeric)
 *   2. `tenantId` claim in the access JWT (set by requireAuth)
 *   3. null (standalone user — no tenant isolation)
 *
 * When a tenantId is resolved, it is set on req.tenantId for downstream
 * handlers to enforce data isolation.
 *
 * Usage:
 *   router.use(requireAuth, tenantContext, handler);
 */

import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function tenantContext(
  req:  Request,
  res:  Response,
  next: NextFunction
): Promise<void> {
  const headerTenantId = req.headers["x-tenant-id"];
  const jwtTenantId    = (req as Request & { tenantId?: number }).tenantId;

  const rawId = headerTenantId
    ? Number(headerTenantId)
    : jwtTenantId ?? null;

  if (rawId == null || isNaN(rawId)) {
    // No tenant — standalone user, allow through
    next();
    return;
  }

  // Validate tenant exists and is active
  const [tenant] = await db
    .select({ id: tenantsTable.id, isActive: tenantsTable.isActive })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, rawId))
    .limit(1);

  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  if (!tenant.isActive) {
    res.status(403).json({ error: "Tenant account is inactive" });
    return;
  }

  (req as Request & { tenantId?: number }).tenantId = tenant.id;
  next();
}

/** Require a tenant to be present. Use after tenantContext. */
export function requireTenant(req: Request, res: Response, next: NextFunction): void {
  const tenantId = (req as Request & { tenantId?: number }).tenantId;
  if (!tenantId) {
    res.status(403).json({ error: "A tenant context is required for this endpoint" });
    return;
  }
  next();
}
