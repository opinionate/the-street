import { clerkMiddleware, getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { getPool } from "../database/pool.js";

export interface AuthedRequest extends Request {
  userId?: string; // internal UUID
  clerkId?: string;
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
    "SELECT id FROM users WHERE clerk_id = $1",
    [auth.userId],
  );

  if (rows.length === 0) {
    res.status(403).json({ error: "User not registered" });
    return;
  }

  req.userId = rows[0].id;
  req.clerkId = auth.userId;
  next();
}

// Dev bypass — skips Clerk auth when no CLERK_SECRET_KEY is set
function devBypass(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
): void {
  req.userId = "00000000-0000-0000-0000-000000000000";
  req.clerkId = "dev_clerk_id";
  next();
}

// Combined auth middleware
export function requireAuth() {
  if (!process.env.CLERK_SECRET_KEY || process.env.NODE_ENV === "development") {
    return [devBypass];
  }
  return [clerkAuth, resolveUser];
}
