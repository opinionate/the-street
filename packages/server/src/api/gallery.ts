import { Router } from "express";
import { getPool } from "../database/pool.js";
import { readCachedAsset, getCachedPath } from "./asset-cache.js";

const router = Router();

// GET /api/gallery — list all generated objects (newest first)
router.get("/", async (_req, res) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, name, description, thumbnail_url, status, assets_cached, created_at
       FROM generated_objects
       ORDER BY created_at DESC
       LIMIT 200`,
    );

    // Replace CDN thumbnail URLs with local endpoints for cached objects
    for (const row of rows) {
      if (row.assets_cached && getCachedPath("object", row.id, "thumbnail.jpg")) {
        row.thumbnail_url = `/api/gallery/${row.id}/thumbnail`;
      }
    }

    res.json({ objects: rows });
  } catch (err) {
    console.error("GET /api/gallery error:", err);
    res.status(500).json({ error: "Failed to load gallery" });
  }
});

// GET /api/gallery/:id — full object detail
router.get("/:id", async (req, res) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, name, description, prompt, tags, object_definition,
              preview_task_id, refine_task_id, glb_url, thumbnail_url,
              status, created_by, created_at
       FROM generated_objects
       WHERE id = $1`,
      [req.params.id],
    );

    if (rows.length === 0) {
      res.status(404).json({ error: "Object not found" });
      return;
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("GET /api/gallery/:id error:", err);
    res.status(500).json({ error: "Failed to load object" });
  }
});

// GET /api/gallery/:id/model — Serve cached GLB download
router.get("/:id/model", async (req, res) => {
  try {
    const galleryId = req.params.id as string;

    // Serve from local cache
    const cached = readCachedAsset("object", galleryId, "model.glb");
    if (cached) {
      res.setHeader("Content-Type", "model/gltf-binary");
      res.setHeader("Cache-Control", "public, max-age=604800");
      res.send(cached);
      return;
    }

    res.status(404).json({ error: "Model not available" });
  } catch (err) {
    console.error("GET /api/gallery/:id/model error:", err);
    res.status(500).json({ error: "Model serving failed" });
  }
});

// GET /api/gallery/:id/thumbnail — Serve cached thumbnail
router.get("/:id/thumbnail", async (req, res) => {
  try {
    const galleryId = req.params.id as string;
    const cached = readCachedAsset("object", galleryId, "thumbnail.jpg");
    if (!cached) {
      res.status(404).json({ error: "No cached thumbnail" });
      return;
    }
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.send(cached);
  } catch (err) {
    console.error("GET /api/gallery/:id/thumbnail error:", err);
    res.status(500).json({ error: "Failed to serve thumbnail" });
  }
});

export default router;
