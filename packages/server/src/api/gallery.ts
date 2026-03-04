import { Router } from "express";
import { getPool } from "../database/pool.js";

const router = Router();

// GET /api/gallery — list all generated objects (newest first)
router.get("/", async (_req, res) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, name, description, thumbnail_url, status, created_at
       FROM generated_objects
       ORDER BY created_at DESC
       LIMIT 200`,
    );
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

// GET /api/gallery/:id/model — proxy GLB download (avoids CORS)
router.get("/:id/model", async (req, res) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT glb_url FROM generated_objects WHERE id = $1",
      [req.params.id],
    );

    if (rows.length === 0 || !rows[0].glb_url) {
      res.status(404).json({ error: "Model not available" });
      return;
    }

    const glbRes = await fetch(rows[0].glb_url);
    if (!glbRes.ok || !glbRes.body) {
      res.status(502).json({ error: "Failed to fetch model" });
      return;
    }

    res.setHeader("Content-Type", "model/gltf-binary");
    res.setHeader("Cache-Control", "public, max-age=86400");

    const reader = glbRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error("GET /api/gallery/:id/model error:", err);
    res.status(500).json({ error: "Model proxy failed" });
  }
});

export default router;
