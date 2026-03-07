import { Router } from "express";
import { requireAuth, type AuthedRequest, isAdmin } from "../middleware/auth.js";
import { getPool } from "../database/pool.js";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ANIM_CACHE_DIR = join(__dirname, "..", "..", "data", "animations");
const MODELS_DIR = join(__dirname, "..", "..", "data", "models");
const DEFAULT_MODEL_PATH = join(MODELS_DIR, "default-mannequin.glb");

const router = Router();

// GET /api/avatar/animations/:type — Serve cached shared animation GLBs
const ALLOWED_ANIM_TYPES = new Set([
  "idle", "walk", "run", "turnLeft", "turnRight",
  "strafeLeftWalk", "strafeRightWalk", "strafeLeftRun", "strafeRightRun", "jump",
  "walk-mixamo", "run-mixamo", "jump-mixamo",
  "strafeLeftWalk-mixamo", "strafeRightWalk-mixamo",
  "strafeLeftRun-mixamo", "strafeRightRun-mixamo",
  "turnLeft-mixamo", "turnRight-mixamo",
]);
router.get(
  "/animations/:type",
  ...requireAuth(),
  async (req, res) => {
    try {
      const animType = req.params.type as string;
      if (!ALLOWED_ANIM_TYPES.has(animType)) {
        res.status(400).json({ error: `Unknown animation type: '${animType}'` });
        return;
      }

      const filePath = join(ANIM_CACHE_DIR, `${animType}.glb`);
      if (!existsSync(filePath)) {
        res.status(404).json({ error: `No cached ${animType} animation` });
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

// GET /api/avatar/emotes/:name — Serve emote animation GLBs
const EMOTE_DIR = join(__dirname, "..", "..", "data", "emotes");
const VALID_EMOTES: Record<string, string> = {
  dance: "hip-hop-dance.glb",
  shrug: "shrugging.glb",
  nod: "nod.glb",
  cry: "crying.glb",
  wave: "waving.glb",
  bow: "bow.glb",
  cheer: "cheering.glb",
  laugh: "laughing.glb",
};
router.get(
  "/emotes/:name",
  async (req, res) => {
    const name = req.params.name as string;
    const filename = VALID_EMOTES[name];
    if (!filename) {
      res.status(404).json({ error: "Unknown emote" });
      return;
    }
    const filePath = join(EMOTE_DIR, filename);
    if (!existsSync(filePath)) {
      res.status(404).json({ error: "Emote file not found" });
      return;
    }
    const data = readFileSync(filePath);
    res.setHeader("Content-Type", "model/gltf-binary");
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.send(data);
  },
);

// POST /api/avatar/upload-character — Upload a pre-rigged character model (FBX converted to GLB client-side)
const UPLOAD_DIR = join(__dirname, "..", "..", "data", "assets", "upload");
const MAX_UPLOAD_SIZE = 200 * 1024 * 1024; // 200MB
router.post(
  "/upload-character",
  ...requireAuth(),
  async (req, res) => {
    const authedReq = req as AuthedRequest;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks);

      if (body.length < 12) {
        res.status(400).json({ error: "File too small" });
        return;
      }
      if (body.length > MAX_UPLOAD_SIZE) {
        res.status(400).json({ error: `File too large (max ${MAX_UPLOAD_SIZE / 1024 / 1024}MB)` });
        return;
      }

      // Validate GLB magic bytes (glTF)
      const magic = body.readUInt32LE(0);
      if (magic !== 0x46546c67) {
        res.status(400).json({ error: "Invalid GLB file (bad magic bytes)" });
        return;
      }

      const originalFilename = (req.headers["x-original-filename"] as string) || "character.glb";
      const pool = getPool();

      // Insert DB record
      const { rows } = await pool.query(
        `INSERT INTO avatar_uploads (user_id, original_filename, file_size_bytes, bone_space)
         VALUES ($1, $2, $3, 'mixamo') RETURNING id`,
        [authedReq.userId, originalFilename, body.length],
      );
      const uploadId = rows[0].id as string;

      // Write file to disk
      const dir = join(UPLOAD_DIR, uploadId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "model.glb"), body);

      res.json({ uploadId });
    } catch (err) {
      console.error("POST /api/avatar/upload-character error:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  },
);

// GET /api/avatar/upload/:uploadId/model — Serve an uploaded character model
router.get(
  "/upload/:uploadId/model",
  ...requireAuth(),
  async (req, res) => {
    try {
      const uploadId = req.params.uploadId as string;
      const filePath = join(UPLOAD_DIR, uploadId, "model.glb");
      if (!existsSync(filePath)) {
        res.status(404).json({ error: "Upload not found" });
        return;
      }
      const data = readFileSync(filePath);
      res.setHeader("Content-Type", "model/gltf-binary");
      res.setHeader("Cache-Control", "public, max-age=604800");
      res.send(data);
    } catch (err) {
      console.error("GET /api/avatar/upload/:uploadId/model error:", err);
      res.status(500).json({ error: "Failed to serve uploaded model" });
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
        `SELECT id, avatar_definition, mesh_description, thumbnail_url, created_at
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
      const { avatarDefinition, meshDescription, thumbnailUrl } = req.body;

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
          `INSERT INTO avatar_history (user_id, avatar_definition, mesh_description, thumbnail_url)
           VALUES ($1, $2, $3, $4)`,
          [userId, JSON.stringify(avatarDefinition), meshDescription || null, thumbnailUrl || null],
        );
        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
      } finally {
        client.release();
      }

      // Asynchronously mark uploaded character assets as cached (model is already on disk)
      const uploadedModelId = avatarDefinition?.uploadedModelId as string | undefined;
      if (uploadedModelId) {
        pool.query(
          `UPDATE avatar_history SET assets_cached = true
           WHERE user_id = $1 AND avatar_definition->>'uploadedModelId' = $2`,
          [userId, uploadedModelId],
        ).catch((e) => console.warn("Failed to update assets_cached for upload:", e));
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

// GET /api/avatar/default-model — Serve the default mannequin GLB (no auth required)
router.get(
  "/default-model",
  async (_req, res) => {
    try {
      if (!existsSync(DEFAULT_MODEL_PATH)) {
        res.status(404).json({ error: "No default model uploaded yet" });
        return;
      }
      const data = readFileSync(DEFAULT_MODEL_PATH);
      res.setHeader("Content-Type", "model/gltf-binary");
      res.setHeader("Cache-Control", "public, max-age=604800");
      res.send(data);
    } catch (err) {
      console.error("GET /api/avatar/default-model error:", err);
      res.status(500).json({ error: "Failed to serve default model" });
    }
  },
);

// POST /api/avatar/default-model — Upload a default mannequin GLB (admin only)
router.post(
  "/default-model",
  ...requireAuth(),
  async (req, res) => {
    const authedReq = req as AuthedRequest;
    if (!isAdmin(authedReq)) {
      res.status(403).json({ error: "Admin only" });
      return;
    }

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks);

      if (body.length < 12) {
        res.status(400).json({ error: "File too small" });
        return;
      }
      if (body.length > MAX_UPLOAD_SIZE) {
        res.status(400).json({ error: `File too large (max ${MAX_UPLOAD_SIZE / 1024 / 1024}MB)` });
        return;
      }

      // Validate GLB magic bytes
      const magic = body.readUInt32LE(0);
      if (magic !== 0x46546c67) {
        res.status(400).json({ error: "Invalid GLB file (bad magic bytes)" });
        return;
      }

      mkdirSync(MODELS_DIR, { recursive: true });
      writeFileSync(DEFAULT_MODEL_PATH, body);

      console.log(`[Avatar] Default model uploaded: ${(body.length / 1024 / 1024).toFixed(2)} MB`);
      res.json({ success: true, size: body.length });
    } catch (err) {
      console.error("POST /api/avatar/default-model error:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  },
);

export default router;
