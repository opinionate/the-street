import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { RATE_LIMITS } from "@the-street/shared";
import { getPool } from "../database/pool.js";

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

      // Start Meshy mesh generation for the avatar
      let taskId: string | undefined;
      try {
        const { startMeshPreview } = await import("@the-street/ai-service");
        taskId = await startMeshPreview(result.meshDescription);
      } catch (meshErr) {
        console.error("Avatar mesh generation start failed (non-fatal):", meshErr);
      }

      res.json({
        appearance: result.appearance,
        meshDescription: result.meshDescription,
        meshyTaskId: taskId,
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

// POST /api/avatar/save — Save avatar definition to user record
router.post(
  "/save",
  ...requireAuth(),
  async (req, res) => {
    try {
      const userId = (req as AuthedRequest).userId;
      const { avatarDefinition } = req.body;

      if (!avatarDefinition) {
        res.status(400).json({ error: "avatarDefinition is required" });
        return;
      }

      const pool = getPool();
      await pool.query(
        "UPDATE users SET avatar_definition = $1 WHERE id = $2",
        [JSON.stringify(avatarDefinition), userId],
      );

      res.json({ success: true });
    } catch (err) {
      console.error("POST /api/avatar/save error:", err);
      const message = err instanceof Error ? err.message : "Save failed";
      res.status(500).json({ error: message });
    }
  },
);

export default router;
