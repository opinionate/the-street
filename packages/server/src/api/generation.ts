import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { RATE_LIMITS } from "@the-street/shared";

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
    const authedReq = req as AuthedRequest;
    try {
      const { userDescription, plotUUID, plotContext, buildingCode, neighborhoodCode } =
        req.body;

      if (!userDescription || !plotUUID) {
        res.status(400).json({ error: "userDescription and plotUUID required" });
        return;
      }

      // Call Anthropic API for object generation
      // This will be handled by the ai-service package
      // For now, return a stub response indicating the pipeline
      res.status(501).json({
        error: "AI generation service not yet connected",
        message:
          "This endpoint requires the ai-service package to be implemented",
      });
    } catch (err) {
      console.error("POST /api/generate error:", err);
      res.status(500).json({ error: "Internal server error" });
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

      // Call Meshy API for mesh generation
      // This will be handled by the ai-service package
      res.status(501).json({
        error: "Mesh generation service not yet connected",
        message:
          "This endpoint requires the ai-service package to be implemented",
      });
    } catch (err) {
      console.error("POST /api/generate/mesh error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
