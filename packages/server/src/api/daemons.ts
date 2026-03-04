import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { RATE_LIMITS } from "@the-street/shared";
import { getPool } from "../database/pool.js";

const MAX_DAEMONS_PER_PLOT = 2;
const router = Router();

// POST /api/daemons/generate — AI daemon definition generation
router.post(
  "/generate",
  ...requireAuth(),
  rateLimit({
    windowMs: 60_000,
    maxRequests: RATE_LIMITS.aiGeneration.maxPerMinute,
  }),
  async (req, res) => {
    try {
      const { description } = req.body;

      if (!description || typeof description !== "string") {
        res.status(400).json({ error: "description is required" });
        return;
      }

      const { generateDaemon } = await import("@the-street/ai-service");
      const result = await generateDaemon(description);

      res.json(result);
    } catch (err) {
      console.error("POST /api/daemons/generate error:", err);
      const message = err instanceof Error ? err.message : "Daemon generation failed";
      res.status(500).json({ error: message });
    }
  },
);

// POST /api/daemons/create — Save daemon to plot
router.post(
  "/create",
  ...requireAuth(),
  async (req, res) => {
    try {
      const userId = (req as AuthedRequest).userId;
      const { definition } = req.body;

      if (!definition || !definition.plotUuid || !definition.name) {
        res.status(400).json({ error: "definition with plotUuid and name is required" });
        return;
      }

      const pool = getPool();

      // Verify plot ownership
      const { rows: plotRows } = await pool.query(
        "SELECT uuid FROM plots WHERE uuid = $1 AND owner_id = $2",
        [definition.plotUuid, userId],
      );
      if (plotRows.length === 0) {
        res.status(403).json({ error: "You don't own this plot" });
        return;
      }

      // Check daemon limit per plot
      const { rows: countRows } = await pool.query(
        "SELECT COUNT(*) as count FROM daemons WHERE plot_uuid = $1 AND is_active = true",
        [definition.plotUuid],
      );
      if (parseInt(countRows[0].count) >= MAX_DAEMONS_PER_PLOT) {
        res.status(400).json({ error: `Maximum ${MAX_DAEMONS_PER_PLOT} daemons per plot` });
        return;
      }

      const { rows } = await pool.query(
        `INSERT INTO daemons
          (plot_uuid, owner_id, name, description, daemon_definition, appearance, behavior,
           position_x, position_y, position_z, rotation)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          definition.plotUuid,
          userId,
          definition.name,
          definition.description || "",
          JSON.stringify(definition),
          JSON.stringify(definition.appearance),
          JSON.stringify(definition.behavior),
          definition.position?.x || 0,
          definition.position?.y || 0,
          definition.position?.z || 0,
          definition.rotation || 0,
        ],
      );

      res.json({ id: rows[0].id, success: true });
    } catch (err) {
      console.error("POST /api/daemons/create error:", err);
      const message = err instanceof Error ? err.message : "Daemon creation failed";
      res.status(500).json({ error: message });
    }
  },
);

// GET /api/daemons/plot/:plotUuid — List daemons on a plot
router.get(
  "/plot/:plotUuid",
  ...requireAuth(),
  async (req, res) => {
    try {
      const plotUuid = req.params.plotUuid as string;
      const pool = getPool();

      const { rows } = await pool.query(
        `SELECT id, name, description, daemon_definition, appearance, behavior,
                position_x, position_y, position_z, rotation, is_active, created_at
         FROM daemons WHERE plot_uuid = $1 AND is_active = true
         ORDER BY created_at`,
        [plotUuid],
      );

      res.json({
        daemons: rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          definition: r.daemon_definition,
          position: { x: r.position_x, y: r.position_y, z: r.position_z },
          rotation: r.rotation,
          isActive: r.is_active,
          createdAt: r.created_at,
        })),
      });
    } catch (err) {
      console.error("GET /api/daemons/plot/:plotUuid error:", err);
      res.status(500).json({ error: "Failed to list daemons" });
    }
  },
);

// DELETE /api/daemons/:id — Remove daemon (owner only)
router.delete(
  "/:id",
  ...requireAuth(),
  async (req, res) => {
    try {
      const userId = (req as AuthedRequest).userId;
      const daemonId = req.params.id as string;
      const pool = getPool();

      const { rowCount } = await pool.query(
        "UPDATE daemons SET is_active = false WHERE id = $1 AND owner_id = $2",
        [daemonId, userId],
      );

      if (rowCount === 0) {
        res.status(404).json({ error: "Daemon not found or not owned by you" });
        return;
      }

      res.json({ success: true });
    } catch (err) {
      console.error("DELETE /api/daemons/:id error:", err);
      res.status(500).json({ error: "Failed to delete daemon" });
    }
  },
);

export default router;
