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
      res.json(result);
    } catch (err) {
      console.error("POST /api/generate error:", err);
      const message = err instanceof Error ? err.message : "Generation failed";
      res.status(500).json({ error: message });
    }
  },
);

// POST /api/generate/mesh — Meshy text-to-3D generation
router.post(
  "/mesh",
  ...requireAuth(),
  rateLimit({
    windowMs: 60_000,
    maxRequests: RATE_LIMITS.aiGeneration.maxPerMinute,
  }),
  async (req, res) => {
    try {
      const { route, description } = req.body;

      if (route !== "novel" || !description) {
        res
          .status(400)
          .json({ error: 'route must be "novel" and description required' });
        return;
      }

      // Meshy integration — import dynamically to avoid requiring key when unused
      const { generateMesh } = await import("@the-street/ai-service");
      const result = await generateMesh(description);
      res.json(result);
    } catch (err) {
      console.error("POST /api/generate/mesh error:", err);
      const message =
        err instanceof Error ? err.message : "Mesh generation failed";
      res.status(500).json({ error: message });
    }
  },
);

export default router;
