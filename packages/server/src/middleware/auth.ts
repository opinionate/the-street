import { clerkMiddleware, getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { getPool } from "../database/pool.js";
import type { UserRole } from "@the-street/shared";

export interface AuthedRequest extends Request {
  userId?: string; // internal UUID
  clerkId?: string;
  userRole?: UserRole;
}

// Clerk middleware — validates session token on every request
export const clerkAuth = clerkMiddleware();

// Resolve Clerk user to internal user, attach to request
export async function resolveUser(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT id, role FROM users WHERE clerk_id = $1",
    [auth.userId],
  );

  if (rows.length === 0) {
    res.status(403).json({ error: "User not registered" });
    return;
  }

  req.userId = rows[0].id;
  req.clerkId = auth.userId;
  req.userRole = rows[0].role as UserRole;
  next();
}

// Dev bypass — skips Clerk auth in development mode
function devBypass(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
): void {
  req.userId = "00000000-0000-0000-0000-000000000000";
  req.clerkId = "dev_clerk_id";
  req.userRole = (process.env.DEV_USER_ROLE as UserRole) || "super_admin";
  next();
}

// Combined auth middleware
export function requireAuth() {
  if (process.env.NODE_ENV === "development") {
    return [devBypass];
  }
  return [clerkAuth, resolveUser];
}

/**
 * Require a specific role. Must be used AFTER requireAuth().
 * Usage: router.post("/admin-thing", ...requireAuth(), requireRole("super_admin"), handler)
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.userRole || !allowedRoles.includes(req.userRole)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

/**
 * Check if the current user is an admin (utility for ownership bypass logic).
 */
export function isAdmin(req: AuthedRequest): boolean {
  return req.userRole === "super_admin";
}
