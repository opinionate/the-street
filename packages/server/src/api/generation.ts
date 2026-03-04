import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import {
  RATE_LIMITS,
  UNIVERSAL_CODE,
  ORIGIN_NEIGHBORHOOD_CODE,
  V1_CONFIG,
} from "@the-street/shared";
import type { GenerationRequest } from "@the-street/shared";
import { generate } from "@the-street/ai-service";
import { getPool } from "../database/pool.js";

const router = Router();

// POST /api/generate — AI object generation via Anthropic
router.post(
  "/",
  ...requireAuth(),
  rateLimit({
    windowMs: 60_000,
    maxRequests: RATE_LIMITS.aiGeneration.maxPerMinute,
  }),
  async (req, res) => {
    try {
      const { userDescription, plotUUID, plotContext } = req.body;

      if (!userDescription) {
        res.status(400).json({ error: "userDescription is required" });
        return;
      }

      const request: GenerationRequest = {
        userDescription,
        plotUUID: plotUUID || "preview",
        plotContext: plotContext || {
          existingObjects: [],
          remainingRenderBudget: V1_CONFIG.plotRenderBudget,
          plotBounds: {
            width: V1_CONFIG.plotWidth,
            depth: V1_CONFIG.plotDepth,
            height: V1_CONFIG.plotHeight,
          },
        },
        buildingCode: UNIVERSAL_CODE,
        neighborhoodCode: ORIGIN_NEIGHBORHOOD_CODE,
      };

      const result = await generate(request);

      // Persist to gallery
      try {
        const pool = getPool();
        const objDef = result.objectDefinition;
        const { rows } = await pool.query(
          `INSERT INTO generated_objects
             (name, description, prompt, tags, object_definition, status, created_by)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6)
           RETURNING id`,
          [
            objDef?.name || userDescription.slice(0, 80),
            objDef?.description || userDescription,
            userDescription,
            objDef?.tags || [],
            JSON.stringify(objDef || {}),
            (req as AuthedRequest).userId || "dev-user",
          ],
        );
        res.json({ ...result, galleryId: rows[0].id });
      } catch (dbErr) {
        console.error("Gallery insert failed (non-fatal):", dbErr);
        res.json(result);
      }
    } catch (err) {
      console.error("POST /api/generate error:", err);
      const message = err instanceof Error ? err.message : "Generation failed";
      res.status(500).json({ error: message });
    }
  },
);

// POST /api/generate/mesh — Start Meshy text-to-3D generation (returns task ID)
router.post(
  "/mesh",
  ...requireAuth(),
  rateLimit({
    windowMs: 60_000,
    maxRequests: RATE_LIMITS.aiGeneration.maxPerMinute,
  }),
  async (req, res) => {
    try {
      const { description } = req.body;

      if (!description) {
        res.status(400).json({ error: "description is required" });
        return;
      }

      const { startMeshPreview } = await import("@the-street/ai-service");
      const taskId = await startMeshPreview(description);
      res.json({ taskId });
    } catch (err) {
      console.error("POST /api/generate/mesh error:", err);
      const message =
        err instanceof Error ? err.message : "Mesh generation failed";
      res.status(500).json({ error: message });
    }
  },
);

// POST /api/generate/mesh/refine — Start Meshy refine from a completed preview
router.post(
  "/mesh/refine",
  ...requireAuth(),
  async (req, res) => {
    try {
      const { previewTaskId } = req.body;

      if (!previewTaskId) {
        res.status(400).json({ error: "previewTaskId is required" });
        return;
      }

      const { startMeshRefine } = await import("@the-street/ai-service");
      const taskId = await startMeshRefine(previewTaskId);
      res.json({ taskId });
    } catch (err) {
      console.error("POST /api/generate/mesh/refine error:", err);
      const message =
        err instanceof Error ? err.message : "Mesh refine failed";
      res.status(500).json({ error: message });
    }
  },
);

// GET /api/generate/mesh/:taskId — Poll Meshy task status
router.get(
  "/mesh/:taskId",
  ...requireAuth(),
  async (req, res) => {
    try {
      const taskId = req.params.taskId as string;
      const galleryId = req.query.galleryId as string | undefined;
      const { pollMeshTask } = await import("@the-street/ai-service");
      const result = await pollMeshTask(taskId);

      // Update gallery row on completion
      if (galleryId && result.status === "SUCCEEDED" && result.glbUrl) {
        try {
          const pool = getPool();
          // Determine if this is a preview or refine task
          const { rows } = await pool.query(
            "SELECT preview_task_id FROM generated_objects WHERE id = $1",
            [galleryId],
          );
          const isRefine = rows.length > 0 && rows[0].preview_task_id != null;

          if (isRefine) {
            await pool.query(
              `UPDATE generated_objects
               SET status = 'refined', refine_task_id = $2, glb_url = $3,
                   thumbnail_url = $4
               WHERE id = $1`,
              [galleryId, taskId, result.glbUrl, result.thumbnailUrl || null],
            );
          } else {
            await pool.query(
              `UPDATE generated_objects
               SET status = 'preview', preview_task_id = $2, glb_url = $3,
                   thumbnail_url = $4
               WHERE id = $1`,
              [galleryId, taskId, result.glbUrl, result.thumbnailUrl || null],
            );
          }
        } catch (dbErr) {
          console.error("Gallery update failed (non-fatal):", dbErr);
        }
      }

      res.json(result);
    } catch (err) {
      console.error("GET /api/generate/mesh/:taskId error:", err);
      const message =
        err instanceof Error ? err.message : "Mesh status check failed";
      res.status(500).json({ error: message });
    }
  },
);

// GET /api/generate/mesh/:taskId/model — Proxy GLB download (avoids CORS)
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

      // Fetch the GLB and pipe it through
      const glbRes = await fetch(status.glbUrl);
      if (!glbRes.ok || !glbRes.body) {
        res.status(502).json({ error: "Failed to fetch model" });
        return;
      }

      res.setHeader("Content-Type", "model/gltf-binary");
      res.setHeader("Cache-Control", "public, max-age=86400");

      // Stream the response
      const reader = glbRes.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        res.end();
      };
      await pump();
    } catch (err) {
      console.error("GET /api/generate/mesh/:taskId/model error:", err);
      const message =
        err instanceof Error ? err.message : "Model proxy failed";
      res.status(500).json({ error: message });
    }
  },
);

export default router;
