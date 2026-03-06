import { Router } from "express";
import { requireAuth, isAdmin, type AuthedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { RATE_LIMITS } from "@the-street/shared";
import type { LogEntryType } from "@the-street/shared";
import { getPool } from "../database/pool.js";
import { getActiveDaemonManager } from "../rooms/StreetRoom.js";
import { queryActivityLog, getTokenSummary } from "../services/ActivityLogService.js";

const MAX_DAEMONS_PER_PLOT = 10;

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

// POST /api/daemons/create — Save daemon to plot (or as a global street daemon for admins)
router.post(
  "/create",
  ...requireAuth(),
  async (req, res) => {
    try {
      const userId = (req as AuthedRequest).userId;
      const authedReq = req as AuthedRequest;
      const { definition } = req.body;

      if (!definition || !definition.name) {
        res.status(400).json({ error: "definition with name is required" });
        return;
      }

      const pool = getPool();
      const plotUuid: string | null = definition.plotUuid || null;

      if (plotUuid) {
        // Plot-based daemon: verify plot ownership (admins bypass ownership check)
        const { rows: plotRows } = isAdmin(authedReq)
          ? await pool.query(
              "SELECT uuid FROM plots WHERE uuid = $1",
              [plotUuid],
            )
          : await pool.query(
              "SELECT uuid FROM plots WHERE uuid = $1 AND owner_id = $2",
              [plotUuid, userId],
            );
        if (plotRows.length === 0) {
          res.status(403).json({ error: "You don't own this plot" });
          return;
        }

        // Check daemon limit per plot
        const { rows: countRows } = await pool.query(
          "SELECT COUNT(*) as count FROM daemons WHERE plot_uuid = $1 AND is_active = true",
          [plotUuid],
        );
        if (parseInt(countRows[0].count) >= MAX_DAEMONS_PER_PLOT) {
          res.status(400).json({ error: `Maximum ${MAX_DAEMONS_PER_PLOT} daemons per plot` });
          return;
        }
      } else {
        // Global street daemon (no plot) — admin only
        if (!isAdmin(authedReq)) {
          res.status(403).json({ error: "Only admins can create daemons without a plot" });
          return;
        }
      }

      const { rows } = await pool.query(
        `INSERT INTO daemons
          (plot_uuid, owner_id, name, description, daemon_definition, appearance, behavior,
           position_x, position_y, position_z, rotation, mesh_description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          plotUuid,
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
          definition.meshDescription || null,
        ],
      );

      // Notify running DaemonManager so the daemon appears for all connected clients
      const dm = getActiveDaemonManager();
      if (dm) {
        dm.addDaemon(rows[0].id, definition, definition.behavior);
      }

      res.json({ id: rows[0].id, success: true });
    } catch (err) {
      console.error("POST /api/daemons/create error:", err);
      const message = err instanceof Error ? err.message : "Daemon creation failed";
      res.status(500).json({ error: message });
    }
  },
);

// GET /api/daemons/global — List global street daemons (no plot, admin only)
router.get(
  "/global",
  ...requireAuth(),
  async (req, res) => {
    try {
      const authedReq = req as AuthedRequest;
      if (!isAdmin(authedReq)) {
        res.status(403).json({ error: "Admin only" });
        return;
      }

      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT id, name, description, daemon_definition, appearance, behavior,
                position_x, position_y, position_z, rotation, is_active, created_at
         FROM daemons WHERE plot_uuid IS NULL AND is_active = true
         ORDER BY created_at DESC`,
      );

      res.json({
        daemons: rows.map((r: Record<string, unknown>) => ({
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
      console.error("GET /api/daemons/global error:", err);
      res.status(500).json({ error: "Failed to list global daemons" });
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

      const authedReq = req as AuthedRequest;
      const { rowCount } = isAdmin(authedReq)
        ? await pool.query(
            "UPDATE daemons SET is_active = false WHERE id = $1",
            [daemonId],
          )
        : await pool.query(
            "UPDATE daemons SET is_active = false WHERE id = $1 AND owner_id = $2",
            [daemonId, userId],
          );

      if (rowCount === 0) {
        res.status(404).json({ error: "Daemon not found or not owned by you" });
        return;
      }

      // Notify running DaemonManager to despawn for all connected clients
      const dm = getActiveDaemonManager();
      if (dm) {
        dm.removeDaemon(daemonId);
      }

      res.json({ success: true });
    } catch (err) {
      console.error("DELETE /api/daemons/:id error:", err);
      res.status(500).json({ error: "Failed to delete daemon" });
    }
  },
);

// GET /api/daemons/:id/activity — Get recent daemon activity
router.get(
  "/:id/activity",
  ...requireAuth(),
  async (req, res) => {
    try {
      const daemonId = req.params.id as string;
      const dm = getActiveDaemonManager();

      if (!dm) {
        res.json({ activity: [] });
        return;
      }

      const activity = dm.getDaemonActivity(daemonId, 15);
      res.json({ activity });
    } catch (err) {
      console.error("GET /api/daemons/:id/activity error:", err);
      res.status(500).json({ error: "Failed to get activity" });
    }
  },
);

// PUT /api/daemons/:id — Update daemon definition
router.put(
  "/:id",
  ...requireAuth(),
  async (req, res) => {
    try {
      const userId = (req as AuthedRequest).userId;
      const daemonId = req.params.id as string;
      const { definition } = req.body;

      if (!definition) {
        res.status(400).json({ error: "definition is required" });
        return;
      }

      const pool = getPool();
      const authedReq = req as AuthedRequest;
      const { rowCount } = isAdmin(authedReq)
        ? await pool.query(
            `UPDATE daemons SET
              name = $1,
              description = $2,
              daemon_definition = $3,
              appearance = $4,
              behavior = $5,
              mesh_description = $6
             WHERE id = $7 AND is_active = true`,
            [
              definition.name,
              definition.description || "",
              JSON.stringify(definition),
              JSON.stringify(definition.appearance),
              JSON.stringify(definition.behavior),
              definition.meshDescription || null,
              daemonId,
            ],
          )
        : await pool.query(
            `UPDATE daemons SET
              name = $1,
              description = $2,
              daemon_definition = $3,
              appearance = $4,
              behavior = $5,
              mesh_description = $6
             WHERE id = $7 AND owner_id = $8 AND is_active = true`,
            [
              definition.name,
              definition.description || "",
              JSON.stringify(definition),
              JSON.stringify(definition.appearance),
              JSON.stringify(definition.behavior),
              definition.meshDescription || null,
              daemonId,
              userId,
            ],
          );

      if (rowCount === 0) {
        res.status(404).json({ error: "Daemon not found or not owned by you" });
        return;
      }

      // Notify running DaemonManager to reload definition
      const dm = getActiveDaemonManager();
      if (dm) {
        dm.updateDaemonDefinition?.(daemonId, definition);
      }

      res.json({ success: true });
    } catch (err) {
      console.error("PUT /api/daemons/:id error:", err);
      const message = err instanceof Error ? err.message : "Update failed";
      res.status(500).json({ error: message });
    }
  },
);

// GET /api/daemons/:id/activity-log — Paginated activity log
router.get(
  "/:id/activity-log",
  ...requireAuth(),
  async (req, res) => {
    try {
      const authedReq = req as AuthedRequest;
      if (!isAdmin(authedReq)) {
        res.status(403).json({ error: "Admin only" });
        return;
      }

      const daemonId = req.params.id as string;
      const types = req.query.types
        ? (req.query.types as string).split(",") as LogEntryType[]
        : undefined;
      const visitorId = req.query.visitorId as string | undefined;
      const after = req.query.after ? Number(req.query.after) : undefined;
      const before = req.query.before ? Number(req.query.before) : undefined;
      const sessionId = req.query.sessionId as string | undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const cursor = req.query.cursor as string | undefined;

      const result = await queryActivityLog({
        daemonId,
        types,
        visitorId,
        after,
        before,
        sessionId,
        limit,
        cursor,
      });

      res.json(result);
    } catch (err) {
      console.error("GET /api/daemons/:id/activity-log error:", err);
      res.status(500).json({ error: "Failed to query activity log" });
    }
  },
);

// GET /api/daemons/:id/token-summary — Token usage breakdown
router.get(
  "/:id/token-summary",
  ...requireAuth(),
  async (req, res) => {
    try {
      const authedReq = req as AuthedRequest;
      if (!isAdmin(authedReq)) {
        res.status(403).json({ error: "Admin only" });
        return;
      }

      const daemonId = req.params.id as string;
      const window = (req.query.window as string) || "30d";

      if (!["30d", "90d", "all"].includes(window)) {
        res.status(400).json({ error: "window must be 30d, 90d, or all" });
        return;
      }

      const result = await getTokenSummary(daemonId, window as "30d" | "90d" | "all");
      res.json(result);
    } catch (err) {
      console.error("GET /api/daemons/:id/token-summary error:", err);
      res.status(500).json({ error: "Failed to get token summary" });
    }
  },
);

export default router;
