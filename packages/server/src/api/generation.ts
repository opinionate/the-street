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

export default router;
