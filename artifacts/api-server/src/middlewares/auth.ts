import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/jwt.js";
import { isTokenBlacklisted } from "../lib/token-blacklist.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

declare global {
  namespace Express {
    interface Request {
      userId?:    number;
      userRole?:  string;
      tenantId?:  number;
      tokenJti?:  string;   // JWT ID for blacklist operations on logout
    }
  }
}

export async function requireAuth(
  req:  Request,
  res:  Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers["authorization"];
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = header.slice(7);

  try {
    const payload = verifyToken(token);

    // Refuse refresh tokens on protected API routes
    if (payload.type !== "access") {
      res.status(401).json({ error: "Refresh tokens cannot be used for API access" });
      return;
    }

    // Check revocation blacklist (covers logout-before-expiry)
    if (payload.jti && await isTokenBlacklisted(payload.jti)) {
      res.status(401).json({ error: "Token has been revoked" });
      return;
    }

    const [user] = await db
      .select({
        id:       usersTable.id,
        isActive: usersTable.isActive,
        role:     usersTable.role,
        tenantId: usersTable.tenantId,
      })
      .from(usersTable)
      .where(eq(usersTable.id, payload.userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ error: "Account disabled" });
      return;
    }

    req.userId   = user.id;
    req.userRole = user.role ?? "USER";
    req.tenantId = user.tenantId ?? undefined;
    req.tokenJti = payload.jti;    // expose for logout endpoint
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
