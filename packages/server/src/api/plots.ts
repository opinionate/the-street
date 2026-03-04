import { Router } from "express";
import { getPool } from "../database/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import {
  validateWorldObject,
  getPlotPosition,
  V1_CONFIG,
  UNIVERSAL_CODE,
  ORIGIN_NEIGHBORHOOD_CODE,
} from "@the-street/shared";
import type { WorldObject } from "@the-street/shared";

const router = Router();

// GET /api/plots — list all plots with owner info
router.get("/", async (req, res) => {
  try {
    const neighborhood = (req.query.neighborhood as string) || "origin";
    const ring = parseInt((req.query.ring as string) || "0", 10);

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT p.uuid, p.owner_id, p.neighborhood, p.ring, p.position,
              u.display_name as owner_name
       FROM plots p
       JOIN users u ON u.id = p.owner_id
       WHERE p.neighborhood = $1 AND p.ring = $2
       ORDER BY p.position`,
      [neighborhood, ring],
    );

    const plots = rows.map((row) => {
      const placement = getPlotPosition(row.position, V1_CONFIG);
      return {
        uuid: row.uuid,
        ownerId: row.owner_id,
        ownerName: row.owner_name,
        neighborhood: row.neighborhood,
        ring: row.ring,
        position: row.position,
        placement,
        objects: [], // objects loaded separately
      };
    });

    res.json({ plots });
  } catch (err) {
    console.error("GET /api/plots error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/plots/:uuid — plot detail with objects
router.get("/:uuid", async (req, res) => {
  try {
    const pool = getPool();
    const { rows: plotRows } = await pool.query(
      `SELECT p.uuid, p.owner_id, p.neighborhood, p.ring, p.position,
              u.display_name as owner_name
       FROM plots p
       JOIN users u ON u.id = p.owner_id
       WHERE p.uuid = $1`,
      [req.params.uuid],
    );

    if (plotRows.length === 0) {
      res.status(404).json({ error: "Plot not found" });
      return;
    }

    const plot = plotRows[0];
    const { rows: objects } = await pool.query(
      `SELECT id, name, description, tags, object_definition, state_data,
              render_cost, origin_x, origin_y, origin_z,
              scale_x, scale_y, scale_z,
              rotation_x, rotation_y, rotation_z, rotation_w,
              asset_hash, created_at, modified_at
       FROM world_objects WHERE plot_uuid = $1`,
      [req.params.uuid],
    );

    const placement = getPlotPosition(plot.position, V1_CONFIG);
    res.json({
      plot: {
        uuid: plot.uuid,
        ownerId: plot.owner_id,
        ownerName: plot.owner_name,
        neighborhood: plot.neighborhood,
        ring: plot.ring,
        position: plot.position,
        placement,
      },
      objects: objects.map((o) => o.object_definition),
    });
  } catch (err) {
    console.error("GET /api/plots/:uuid error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/plots/:uuid/publish — publish staging to live
router.post("/:uuid/publish", ...requireAuth(), async (req, res) => {
  const authedReq = req as AuthedRequest;
  try {
    const pool = getPool();

    // Verify plot ownership
    const { rows: plotRows } = await pool.query(
      "SELECT uuid, position FROM plots WHERE uuid = $1 AND owner_id = $2",
      [req.params.uuid, authedReq.userId],
    );
    if (plotRows.length === 0) {
      res.status(403).json({ error: "Not plot owner" });
      return;
    }

    const plotPosition = plotRows[0].position;
    const placement = getPlotPosition(plotPosition, V1_CONFIG);

    // Get staging objects for this user
    const { rows: staging } = await pool.query(
      "SELECT object_definition, render_cost FROM staging_objects WHERE creator_id = $1",
      [authedReq.userId],
    );

    if (staging.length === 0) {
      res.status(400).json({ error: "No staging objects to publish" });
      return;
    }

    // Validate all objects against building codes
    const allErrors: { objectName: string; errors: unknown[] }[] = [];
    let totalRenderCost = 0;

    for (const s of staging) {
      const obj = s.object_definition as WorldObject;
      totalRenderCost += Number(s.render_cost);
      const result = validateWorldObject(
        obj,
        placement.bounds,
        V1_CONFIG.plotRenderBudget - totalRenderCost + Number(s.render_cost),
        UNIVERSAL_CODE,
        ORIGIN_NEIGHBORHOOD_CODE,
      );
      if (!result.valid) {
        allErrors.push({ objectName: obj.name, errors: result.errors });
      }
    }

    if (allErrors.length > 0) {
      res.status(400).json({ success: false, errors: allErrors });
      return;
    }

    // Atomic publish: delete old objects, insert staging as live
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Archive old objects (delete for V1)
      await client.query("DELETE FROM world_objects WHERE plot_uuid = $1", [
        req.params.uuid,
      ]);

      // Copy staging objects to world_objects
      for (const s of staging) {
        const obj = s.object_definition as WorldObject;
        await client.query(
          `INSERT INTO world_objects
            (plot_uuid, name, description, tags, object_definition, render_cost,
             origin_x, origin_y, origin_z,
             scale_x, scale_y, scale_z,
             rotation_x, rotation_y, rotation_z, rotation_w,
             asset_hash, modified_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [
            req.params.uuid,
            obj.name,
            obj.description,
            obj.tags,
            JSON.stringify(obj),
            obj.renderCost,
            obj.origin.x,
            obj.origin.y,
            obj.origin.z,
            obj.scale.x,
            obj.scale.y,
            obj.scale.z,
            obj.rotation.x,
            obj.rotation.y,
            obj.rotation.z,
            obj.rotation.w,
            obj.meshDefinition.type === "novel"
              ? obj.meshDefinition.assetHash
              : null,
            authedReq.userId,
          ],
        );
      }

      // Clear staging objects
      await client.query(
        "DELETE FROM staging_objects WHERE creator_id = $1",
        [authedReq.userId],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/plots/:uuid/publish error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
