import { Router } from "express";
import { getPool } from "../database/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

const router = Router();

// GET /api/plots/:uuid/metrics — plot metrics for owner
router.get("/:uuid/metrics", ...requireAuth(), async (req, res) => {
  const authedReq = req as AuthedRequest;
  try {
    const pool = getPool();

    // Verify plot ownership
    const { rows: plotRows } = await pool.query(
      "SELECT uuid FROM plots WHERE uuid = $1 AND owner_id = $2",
      [req.params.uuid, authedReq.userId],
    );
    if (plotRows.length === 0) {
      res.status(403).json({ error: "Not plot owner" });
      return;
    }

    // Get visit metrics
    const { rows: visits } = await pool.query(
      `SELECT pm.entered_at, pm.exited_at, pm.dwell_seconds, pm.visit_type,
              pm.visitor_id, u.display_name as visitor_name
       FROM plot_metrics pm
       JOIN users u ON u.id = pm.visitor_id
       WHERE pm.plot_uuid = $1
       ORDER BY pm.entered_at DESC
       LIMIT 100`,
      [req.params.uuid],
    );

    // Compute aggregates
    const { rows: agg } = await pool.query(
      `SELECT
         COUNT(*)::int as visit_count,
         COALESCE(AVG(dwell_seconds), 0)::float as avg_dwell_seconds,
         CASE WHEN COUNT(*) > 0
           THEN COUNT(*) FILTER (WHERE visit_type = 'repeat')::float / COUNT(*)::float
           ELSE 0
         END as repeat_visit_rate
       FROM plot_metrics
       WHERE plot_uuid = $1 AND exited_at IS NOT NULL`,
      [req.params.uuid],
    );

    const stats = agg[0];
    res.json({
      plotUUID: req.params.uuid,
      visitCount: stats.visit_count,
      avgDwellSeconds: Math.round(stats.avg_dwell_seconds * 10) / 10,
      repeatVisitRate: Math.round(stats.repeat_visit_rate * 100) / 100,
      visits: visits.map((v) => ({
        enteredAt: v.entered_at,
        exitedAt: v.exited_at,
        dwellSeconds: v.dwell_seconds,
        visitType: v.visit_type,
        visitorId: v.visitor_id,
        visitorName: v.visitor_name,
      })),
    });
  } catch (err) {
    console.error("GET /api/plots/:uuid/metrics error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
