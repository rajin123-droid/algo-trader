/**
 * Role Guard middleware — RBAC for route-level access control.
 *
 * Usage:
 *   router.get('/admin/users', requireAuth, requireRole('ADMIN'), handler);
 *   router.post('/trade',      requireAuth, requireRole('TRADER', 'ADMIN'), handler);
 *
 * Role hierarchy (highest to lowest):
 *   ADMIN > TRADER > USER
 *
 * requireAuth must run first — this middleware reads req.userRole.
 */

import type { Request, Response, NextFunction } from "express";

export type UserRole = "USER" | "TRADER" | "ADMIN";

const ROLE_RANK: Record<UserRole, number> = { USER: 1, TRADER: 2, ADMIN: 3 };

/**
 * Returns middleware that rejects requests whose role is below any of `allowed`.
 *
 * @param allowed - One or more roles that are permitted. Pass the minimum role
 *                  required (e.g. 'ADMIN') or a list of permitted roles.
 */
export function requireRole(...allowed: UserRole[]) {
  const minRank = Math.min(...allowed.map((r) => ROLE_RANK[r] ?? 0));

  return function roleGuard(req: Request, res: Response, next: NextFunction): void {
    const role      = (req as Request & { userRole?: string }).userRole ?? "USER";
    const userRank  = ROLE_RANK[role as UserRole] ?? 0;

    if (userRank < minRank) {
      res.status(403).json({
        error:    "Forbidden",
        required: allowed,
        current:  role,
      });
      return;
    }

    next();
  };
}
