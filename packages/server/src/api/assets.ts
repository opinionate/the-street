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
      // Collect raw body (GLB binary)
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const data = Buffer.concat(chunks);

      if (data.length === 0) {
        res.status(400).json({ error: "No file data received" });
        return;
      }

      // Validate GLB magic bytes
      if (data.length < 4 || data.readUInt32LE(0) !== 0x46546C67) {
        res.status(400).json({ error: "Invalid GLB file format" });
        return;
      }

      const { uploadAsset, computeContentHash } = await import("@the-street/asset-pipeline");
      const { signContentHash } = await import("@the-street/asset-pipeline");

      // Upload to S3
      const result = await uploadAsset(data);

      // Get user's private key for signing
      const pool = getPool();
      const { rows: userRows } = await pool.query(
        "SELECT public_key, private_key_encrypted FROM users WHERE id = $1",
        [authedReq.userId],
      );

      let signature = "";
      let publicKey = "";
      if (userRows.length > 0) {
        publicKey = userRows[0].public_key;
        // Decrypt private key and sign
        const masterKey = process.env.MASTER_ENCRYPTION_KEY;
        if (masterKey) {
          const crypto = await import("node:crypto");
          const [ivHex, encrypted] = userRows[0].private_key_encrypted.split(":");
          const iv = Buffer.from(ivHex, "hex");
          const key = crypto.scryptSync(masterKey, "salt", 32);
          const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
          let decrypted = decipher.update(encrypted, "hex", "utf8");
          decrypted += decipher.final("utf8");
          signature = signContentHash(result.contentHash, decrypted);
        }
      }

      // Write attribution record (dedup: skip if hash already exists)
      if (!result.isDuplicate) {
        await pool.query(
          `INSERT INTO assets (content_hash, creator_id, creator_public_key, signature,
                               asset_type, s3_key, file_size_bytes, metadata, dependencies)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (content_hash) DO NOTHING`,
          [
            result.contentHash,
            authedReq.userId,
            publicKey,
            signature,
            "model/gltf-binary",
            result.s3Key,
            result.fileSizeBytes,
            JSON.stringify({}),
            [],
          ],
        );
      } else {
        // Increment adoption count for existing asset
        await pool.query(
          "UPDATE assets SET adoption_count = adoption_count + 1 WHERE content_hash = $1",
          [result.contentHash],
        );
      }

      res.json({
        contentHash: result.contentHash,
        attributionRecord: {
          contentHash: result.contentHash,
          creatorPublicKey: publicKey,
          signature,
          fileSizeBytes: result.fileSizeBytes,
          isDuplicate: result.isDuplicate,
        },
      });
    } catch (err) {
      console.error("POST /api/assets/upload error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
