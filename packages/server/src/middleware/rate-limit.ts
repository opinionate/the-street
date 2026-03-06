import type { Response, NextFunction } from "express";
import { getRedis } from "../database/redis.js";
import type { AuthedRequest } from "./auth.js";

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export function rateLimit(config: RateLimitConfig) {
  return async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Super admins bypass rate limits
    if (req.userRole === "super_admin") {
      next();
      return;
    }

    const redis = getRedis();
    const key = `ratelimit:${req.path}:${userId}`;
    const windowSec = Math.ceil(config.windowMs / 1000);

    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, windowSec);
    }

    if (current > config.maxRequests) {
      const ttl = await redis.ttl(key);
      res.set("Retry-After", String(ttl > 0 ? ttl : windowSec));
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    next();
  };
}

// Chat rate limiter for WebSocket — returns true if allowed
export async function checkChatRateLimit(userId: string, role?: string): Promise<boolean> {
  if (role === "super_admin") return true;
  const redis = getRedis();
  const key = `ratelimit:chat:${userId}`;
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, 1); // 1 second window
  }
  return current <= 1;
}
