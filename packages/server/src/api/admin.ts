import { Router } from "express";
import { getPool } from "../database/pool.js";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import type { UserRole } from "@the-street/shared";
import { cacheObjectAssets } from "./asset-cache.js";

const router = Router();

// GET /api/admin/me — Get current user's profile and role (any authed user)
router.get("/me", ...requireAuth(), async (req, res) => {
  const authedReq = req as AuthedRequest;
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT id, display_name, role, avatar_definition FROM users WHERE id = $1",
      [authedReq.userId],
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({
      userId: rows[0].id,
      displayName: rows[0].display_name,
      role: rows[0].role,
      avatarDefinition: rows[0].avatar_definition,
    });
  } catch (err) {
    console.error("GET /api/admin/me error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/users — List all users with roles (super_admin only)
router.get(
  "/users",
  ...requireAuth(),
  requireRole("super_admin"),
  async (_req, res) => {
    try {
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT id, clerk_id, display_name, role, created_at, last_seen_at
         FROM users ORDER BY created_at DESC LIMIT 200`,
      );
      res.json({ users: rows });
    } catch (err) {
      console.error("GET /api/admin/users error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PUT /api/admin/users/:id/role — Assign role (super_admin only)
router.put(
  "/users/:id/role",
  ...requireAuth(),
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const { role } = req.body;
      const validRoles: UserRole[] = ["user", "super_admin"];
      if (!validRoles.includes(role)) {
        res.status(400).json({ error: `role must be one of: ${validRoles.join(", ")}` });
        return;
      }

      const pool = getPool();
      const { rowCount } = await pool.query(
        "UPDATE users SET role = $1 WHERE id = $2",
        [role, req.params.id],
      );

      if (rowCount === 0) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.json({ success: true });
    } catch (err) {
      console.error("PUT /api/admin/users/:id/role error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// POST /api/admin/cache-assets — Download all uncached gallery object assets to local disk (super_admin only)
router.post(
  "/cache-assets",
  ...requireAuth(),
  requireRole("super_admin"),
  async (_req, res) => {
    const results = { objects: 0, errors: 0 };

    try {
      const pool = getPool();

      // Cache gallery object assets
      const { rows: objects } = await pool.query(
        `SELECT id, glb_url, thumbnail_url FROM generated_objects
         WHERE assets_cached = false AND glb_url IS NOT NULL`,
      );
      for (const row of objects) {
        try {
          const success = await cacheObjectAssets(row.id, row.glb_url, row.thumbnail_url);
          if (success) {
            await pool.query(
              "UPDATE generated_objects SET assets_cached = true WHERE id = $1",
              [row.id],
            );
            results.objects++;
          }
        } catch {
          results.errors++;
        }
      }

      res.json({
        success: true,
        cached: results,
        message: `Cached ${results.objects} objects (${results.errors} errors)`,
      });
    } catch (err) {
      console.error("POST /api/admin/cache-assets error:", err);
      res.status(500).json({ error: "Asset caching failed" });
    }
  },
);

export default router;
