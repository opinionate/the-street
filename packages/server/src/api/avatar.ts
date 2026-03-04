import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { RATE_LIMITS } from "@the-street/shared";
import { getPool } from "../database/pool.js";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ANIM_CACHE_DIR = join(__dirname, "..", "..", "data", "animations");

// In-memory flag to avoid redundant disk checks
let animsCached = false;

/** Cache walk/run animation GLBs from a completed rig task (one-time). */
async function cacheAnimationsIfNeeded(walkUrl?: string, runUrl?: string): Promise<void> {
  if (animsCached) return;
  if (existsSync(join(ANIM_CACHE_DIR, "walk.glb"))) {
    animsCached = true;
    return;
  }
  if (!walkUrl && !runUrl) return;

  mkdirSync(ANIM_CACHE_DIR, { recursive: true });

  for (const [type, url] of [["walk", walkUrl], ["run", runUrl]] as const) {
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        writeFileSync(join(ANIM_CACHE_DIR, `${type}.glb`), buf);
      }
    } catch (err) {
      console.warn(`Failed to cache ${type} animation:`, err);
    }
  }
  animsCached = true;
}

const router = Router();

// POST /api/avatar/generate — AI avatar appearance generation
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

      const { generateAvatar } = await import("@the-street/ai-service");
      const result = await generateAvatar(description);

      res.json({
        appearance: result.appearance,
        meshDescription: result.meshDescription,
      });
    } catch (err) {
      console.error("POST /api/avatar/generate error:", err);
      const message = err instanceof Error ? err.message : "Avatar generation failed";
      res.status(500).json({ error: message });
    }
  },
);

// GET /api/avatar/mesh/:taskId — Poll Meshy task status
router.get(
  "/mesh/:taskId",
  ...requireAuth(),
  async (req, res) => {
    try {
      const taskId = req.params.taskId as string;
      const { pollMeshTask } = await import("@the-street/ai-service");
      const result = await pollMeshTask(taskId);
      res.json(result);
    } catch (err) {
      console.error("GET /api/avatar/mesh/:taskId error:", err);
      const message = err instanceof Error ? err.message : "Mesh status check failed";
      res.status(500).json({ error: message });
    }
  },
);

// GET /api/avatar/mesh/:taskId/model — Proxy GLB download
router.get(
  "/mesh/:taskId/model",
  ...requireAuth(),
  async (req, res) => {
    try {
      const taskId = req.params.taskId as string;
      const { pollMeshTask } = await import("@the-street/ai-service");
      const status = await pollMeshTask(taskId);

      if (status.status !== "SUCCEEDED" || !status.glbUrl) {
        res.status(404).json({ error: "Model not ready" });
        return;
      }

      const glbRes = await fetch(status.glbUrl);
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
      console.error("GET /api/avatar/mesh/:taskId/model error:", err);
      const message = err instanceof Error ? err.message : "Model proxy failed";
      res.status(500).json({ error: message });
    }
  },
);

// POST /api/avatar/rig — Start rigging a completed mesh task
router.post(
  "/rig",
  ...requireAuth(),
  async (req, res) => {
    try {
      const { meshTaskId } = req.body;

      if (!meshTaskId || typeof meshTaskId !== "string") {
        res.status(400).json({ error: "meshTaskId is required" });
        return;
      }

      const { startRigging } = await import("@the-street/ai-service");
      const rigTaskId = await startRigging(meshTaskId);
      res.json({ rigTaskId });
    } catch (err) {
      console.error("POST /api/avatar/rig error:", err);
      const message = err instanceof Error ? err.message : "Rigging failed";
      res.status(500).json({ error: message });
    }
  },
);

// GET /api/avatar/rig/:taskId — Poll rigging status
router.get(
  "/rig/:taskId",
  ...requireAuth(),
  async (req, res) => {
    try {
      const taskId = req.params.taskId as string;
      const { pollRiggingTask } = await import("@the-street/ai-service");
      const result = await pollRiggingTask(taskId);

      // On first successful rig, cache the shared walk/run animations
      if (result.status === "SUCCEEDED") {
        cacheAnimationsIfNeeded(result.walkAnimUrl, result.runAnimUrl).catch(() => {});
      }

      res.json(result);
    } catch (err) {
      console.error("GET /api/avatar/rig/:taskId error:", err);
      const message = err instanceof Error ? err.message : "Rig status check failed";
      res.status(500).json({ error: message });
    }
  },
);

// GET /api/avatar/rig/:taskId/model — Proxy rigged GLB download
router.get(
  "/rig/:taskId/model",
  ...requireAuth(),
  async (req, res) => {
    try {
      const taskId = req.params.taskId as string;
      const { pollRiggingTask } = await import("@the-street/ai-service");
      const status = await pollRiggingTask(taskId);

      if (status.status !== "SUCCEEDED" || !status.riggedGlbUrl) {
        res.status(404).json({ error: "Rigged model not ready" });
        return;
      }

      const glbRes = await fetch(status.riggedGlbUrl);
      if (!glbRes.ok || !glbRes.body) {
        res.status(502).json({ error: "Failed to fetch rigged model" });
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
      console.error("GET /api/avatar/rig/:taskId/model error:", err);
      const message = err instanceof Error ? err.message : "Rigged model proxy failed";
      res.status(500).json({ error: message });
    }
  },
);

// GET /api/avatar/rig/:taskId/anim/:type — Proxy walk/run animation GLB download
router.get(
  "/rig/:taskId/anim/:type",
  ...requireAuth(),
  async (req, res) => {
    try {
      const taskId = req.params.taskId as string;
      const animType = req.params.type as string;

      if (animType !== "walk" && animType !== "run") {
        res.status(400).json({ error: "Animation type must be 'walk' or 'run'" });
        return;
      }

      const { pollRiggingTask } = await import("@the-street/ai-service");
      const status = await pollRiggingTask(taskId);

      if (status.status !== "SUCCEEDED") {
        res.status(404).json({ error: "Rigging not complete" });
        return;
      }

      const animUrl = animType === "walk" ? status.walkAnimUrl : status.runAnimUrl;
      if (!animUrl) {
        res.status(404).json({ error: `No ${animType} animation available` });
        return;
      }

      const glbRes = await fetch(animUrl);
      if (!glbRes.ok || !glbRes.body) {
        res.status(502).json({ error: "Failed to fetch animation" });
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
      console.error("GET /api/avatar/rig/:taskId/anim/:type error:", err);
      const message = err instanceof Error ? err.message : "Animation proxy failed";
      res.status(500).json({ error: message });
    }
  },
);

// GET /api/avatar/animations/:type — Serve cached shared animation GLBs (walk/run)
router.get(
  "/animations/:type",
  ...requireAuth(),
  async (req, res) => {
    try {
      const animType = req.params.type as string;
      if (animType !== "walk" && animType !== "run") {
        res.status(400).json({ error: "Animation type must be 'walk' or 'run'" });
        return;
      }

      const filePath = join(ANIM_CACHE_DIR, `${animType}.glb`);
      if (!existsSync(filePath)) {
        res.status(404).json({ error: `No cached ${animType} animation yet` });
        return;
      }

      const data = readFileSync(filePath);
      res.setHeader("Content-Type", "model/gltf-binary");
      res.setHeader("Cache-Control", "public, max-age=604800"); // 7 days
      res.send(data);
    } catch (err) {
      console.error("GET /api/avatar/animations/:type error:", err);
      res.status(500).json({ error: "Failed to serve animation" });
    }
  },
);

// GET /api/avatar/history — User's avatar history (most recent first)
router.get(
  "/history",
  ...requireAuth(),
  async (req, res) => {
    try {
      const userId = (req as AuthedRequest).userId;
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT id, avatar_definition, mesh_description, meshy_task_id, thumbnail_url, created_at
         FROM avatar_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [userId],
      );
      res.json({ history: rows });
    } catch (err) {
      console.error("GET /api/avatar/history error:", err);
      const message = err instanceof Error ? err.message : "Failed to load history";
      res.status(500).json({ error: message });
    }
  },
);

// POST /api/avatar/save — Save avatar definition to user record + history
router.post(
  "/save",
  ...requireAuth(),
  async (req, res) => {
    try {
      const userId = (req as AuthedRequest).userId;
      const { avatarDefinition, meshDescription, meshyTaskId, thumbnailUrl } = req.body;

      if (!avatarDefinition) {
        res.status(400).json({ error: "avatarDefinition is required" });
        return;
      }

      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "UPDATE users SET avatar_definition = $1 WHERE id = $2",
          [JSON.stringify(avatarDefinition), userId],
        );
        await client.query(
          `INSERT INTO avatar_history (user_id, avatar_definition, mesh_description, meshy_task_id, thumbnail_url)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, JSON.stringify(avatarDefinition), meshDescription || null, meshyTaskId || null, thumbnailUrl || null],
        );
        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
      } finally {
        client.release();
      }

      res.json({ success: true });
    } catch (err) {
      console.error("POST /api/avatar/save error:", err);
      const message = err instanceof Error ? err.message : "Save failed";
      res.status(500).json({ error: message });
    }
  },
);

// DELETE /api/avatar/history/:id — Delete a saved avatar from history
router.delete(
  "/history/:id",
  ...requireAuth(),
  async (req, res) => {
    try {
      const userId = (req as AuthedRequest).userId;
      const historyId = req.params.id as string;
      const pool = getPool();
      const { rowCount } = await pool.query(
        "DELETE FROM avatar_history WHERE id = $1 AND user_id = $2",
        [historyId, userId],
      );
      if (rowCount === 0) {
        res.status(404).json({ error: "Avatar not found" });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      console.error("DELETE /api/avatar/history/:id error:", err);
      const message = err instanceof Error ? err.message : "Delete failed";
      res.status(500).json({ error: message });
    }
  },
);

export default router;
