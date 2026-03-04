import { Router } from "express";
import { getPool } from "../database/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { RATE_LIMITS } from "@the-street/shared";

const router = Router();

// GET /api/assets/:contentHash — asset metadata
router.get("/:contentHash", async (req, res) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT a.content_hash, a.creator_id, a.creator_public_key, a.signature,
              a.asset_type, a.file_size_bytes, a.metadata, a.dependencies,
              a.adoption_count, a.created_at,
              u.display_name as creator_name
       FROM assets a
       JOIN users u ON u.id = a.creator_id
       WHERE a.content_hash = $1`,
      [req.params.contentHash],
    );

    if (rows.length === 0) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    const asset = rows[0];
    res.json({
      contentHash: asset.content_hash,
      creatorId: asset.creator_id,
      creatorName: asset.creator_name,
      creatorPublicKey: asset.creator_public_key,
      signature: asset.signature,
      assetType: asset.asset_type,
      fileSizeBytes: Number(asset.file_size_bytes),
      metadata: asset.metadata,
      dependencies: asset.dependencies,
      adoptionCount: asset.adoption_count,
      createdAt: asset.created_at,
    });
  } catch (err) {
    console.error("GET /api/assets/:contentHash error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/assets/:contentHash/glb — redirect to CDN
router.get("/:contentHash/glb", async (req, res) => {
  const cdnBase = process.env.CDN_BASE_URL || "https://cdn.thestreet.world";
  res.set(
    "Cache-Control",
    "public, max-age=31536000, immutable",
  );
  res.redirect(`${cdnBase}/assets/${req.params.contentHash}.glb`);
});

// POST /api/assets/upload — upload .glb file
router.post(
  "/upload",
  ...requireAuth(),
  rateLimit({
    windowMs: 60_000,
    maxRequests: RATE_LIMITS.assetUpload.maxPerMinute,
  }),
  async (req, res) => {
    const authedReq = req as AuthedRequest;
    try {
      // Asset upload requires multipart handling
      // This is a skeleton — actual S3 upload + signing handled by asset-pipeline
      res.status(501).json({
        error: "Asset upload not yet connected",
        message:
          "This endpoint requires the asset-pipeline package to be implemented",
      });
    } catch (err) {
      console.error("POST /api/assets/upload error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
