import { Router } from "express";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../database/pool.js";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ANIM_DIR = join(__dirname, "..", "..", "data", "assets", "animations");
const SHARED_ANIM_DIR = join(__dirname, "..", "..", "data", "animations");
const SHARED_EMOTE_DIR = join(__dirname, "..", "..", "data", "emotes");

// Valid core animation slots (includes movement animations)
const CORE_SLOTS = [
  "walk", "run", "idle",
  "turnLeft", "turnRight",
  "strafeLeftWalk", "strafeRightWalk", "strafeLeftRun", "strafeRightRun",
  "jump",
] as const;

// Emote name → filename mapping for shared emotes
const EMOTE_FILENAMES: Record<string, string> = {
  dance: "hip-hop-dance.glb",
  shrug: "shrugging.glb",
  nod: "nod.glb",
  cry: "crying.glb",
  wave: "waving.glb",
  bow: "bow.glb",
  cheer: "cheering.glb",
  laugh: "laughing.glb",
};

function isValidSlot(slot: string): boolean {
  if (CORE_SLOTS.includes(slot as any)) return true;
  // Emote slots: alphanumeric + hyphens, prefixed with "emote-"
  if (/^emote-[a-z0-9-]+$/.test(slot)) return true;
  return false;
}

function animPath(entityType: string, entityId: string, slot: string): string {
  return join(ANIM_DIR, entityType, entityId, `${slot}.glb`);
}

const router = Router();

// POST /api/animations/upload — Upload a converted animation GLB for an entity
router.post(
  "/upload",
  ...requireAuth(),
  async (req, res) => {
    const authedReq = req as AuthedRequest;
    try {
      const entityType = req.headers["x-entity-type"] as string;
      const entityId = req.headers["x-entity-id"] as string;
      const slot = req.headers["x-slot"] as string;
      const originalFilename = req.headers["x-original-filename"] as string || "";

      if (!entityType || !entityId || !slot) {
        res.status(400).json({ error: "Missing x-entity-type, x-entity-id, or x-slot headers" });
        return;
      }

      if (entityType !== "avatar" && entityType !== "daemon") {
        res.status(400).json({ error: "entity_type must be 'avatar' or 'daemon'" });
        return;
      }

      if (!isValidSlot(slot)) {
        res.status(400).json({ error: `Invalid slot name: ${slot}. Use walk, run, idle, or emote-<name>` });
        return;
      }

      // Validate entity ownership
      const pool = getPool();
      if (entityType === "avatar") {
        const { rows } = await pool.query(
          "SELECT id FROM avatar_history WHERE id = $1 AND user_id = $2",
          [entityId, authedReq.userId],
        );
        if (rows.length === 0) {
          res.status(403).json({ error: "Avatar not found or not owned by you" });
          return;
        }
      } else {
        // Daemon: must be on a plot owned by the user
        const { rows } = await pool.query(
          `SELECT d.id FROM daemons d
           JOIN plots p ON d.plot_uuid = p.uuid
           WHERE d.id = $1 AND p.owner_id = $2`,
          [entityId, authedReq.userId],
        );
        if (rows.length === 0) {
          res.status(403).json({ error: "Daemon not found or not on your plot" });
          return;
        }
      }

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

      // Write to disk
      const filePath = animPath(entityType, entityId, slot);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, data);

      // Upsert DB record
      const { rows } = await pool.query(
        `INSERT INTO custom_animations (entity_type, entity_id, slot, original_filename, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (entity_type, entity_id, slot) DO UPDATE
           SET original_filename = EXCLUDED.original_filename,
               created_by = EXCLUDED.created_by,
               created_at = NOW()
         RETURNING id`,
        [entityType, entityId, slot, originalFilename, authedReq.userId],
      );

      res.json({ id: rows[0].id, slot, entityType, entityId });
    } catch (err) {
      console.error("POST /api/animations/upload error:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  },
);

// GET /api/animations/:entityType/:entityId — List custom animations for an entity
router.get(
  "/:entityType/:entityId",
  ...requireAuth(),
  async (req, res) => {
    try {
      const { entityType, entityId } = req.params;
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT id, slot, original_filename, created_at
         FROM custom_animations
         WHERE entity_type = $1 AND entity_id = $2
         ORDER BY slot`,
        [entityType, entityId],
      );
      res.json({ animations: rows });
    } catch (err) {
      console.error("GET /api/animations/:entityType/:entityId error:", err);
      res.status(500).json({ error: "Failed to list animations" });
    }
  },
);

// GET /api/animations/:entityType/:entityId/:slot — Serve custom animation GLB
router.get(
  "/:entityType/:entityId/:slot",
  async (req, res) => {
    try {
      const { entityType, entityId, slot } = req.params;
      const filePath = animPath(entityType, entityId, slot);
      if (!existsSync(filePath)) {
        res.status(404).json({ error: "No custom animation for this slot" });
        return;
      }
      const data = readFileSync(filePath);
      res.setHeader("Content-Type", "model/gltf-binary");
      res.setHeader("Cache-Control", "public, max-age=604800");
      res.send(data);
    } catch (err) {
      console.error("GET /api/animations/:entityType/:entityId/:slot error:", err);
      res.status(500).json({ error: "Failed to serve animation" });
    }
  },
);

// DELETE /api/animations/:id — Delete a custom animation
router.delete(
  "/:id",
  ...requireAuth(),
  async (req, res) => {
    const authedReq = req as AuthedRequest;
    try {
      const pool = getPool();
      // Fetch the record and verify ownership
      const { rows } = await pool.query(
        "SELECT id, entity_type, entity_id, slot, created_by FROM custom_animations WHERE id = $1",
        [req.params.id],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "Animation not found" });
        return;
      }

      const record = rows[0];

      // Verify ownership (creator or super_admin)
      if (record.created_by !== authedReq.userId) {
        const { rows: userRows } = await pool.query(
          "SELECT role FROM users WHERE id = $1",
          [authedReq.userId],
        );
        if (!userRows.length || userRows[0].role !== "super_admin") {
          res.status(403).json({ error: "Not authorized to delete this animation" });
          return;
        }
      }

      // Delete file from disk
      const filePath = animPath(record.entity_type, record.entity_id, record.slot);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }

      // Clean up empty directory
      const dir = dirname(filePath);
      try {
        const entries = existsSync(dir) ? readdirSync(dir) : [];
        if (entries.length === 0) rmSync(dir, { recursive: true });
      } catch { /* ignore cleanup failures */ }

      // Delete DB record
      await pool.query("DELETE FROM custom_animations WHERE id = $1", [req.params.id]);

      res.json({ success: true });
    } catch (err) {
      console.error("DELETE /api/animations/:id error:", err);
      res.status(500).json({ error: "Delete failed" });
    }
  },
);

// POST /api/animations/convert-shared — Admin: replace shared animation files (one-time conversion)
router.post(
  "/convert-shared",
  ...requireAuth(),
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const slot = req.headers["x-slot"] as string;
      if (!slot) {
        res.status(400).json({ error: "Missing x-slot header" });
        return;
      }

      // Collect raw body
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

      // Determine target path
      // Accept core slots, emotes, and "-mixamo" variants (e.g. "turnLeft-mixamo")
      let targetPath: string;
      const baseName = slot.replace(/-mixamo$/, "");
      if (CORE_SLOTS.includes(baseName as any)) {
        targetPath = join(SHARED_ANIM_DIR, `${slot}.glb`);
      } else if (EMOTE_FILENAMES[slot]) {
        targetPath = join(SHARED_EMOTE_DIR, EMOTE_FILENAMES[slot]);
      } else {
        res.status(400).json({ error: `Unknown shared animation slot: ${slot}` });
        return;
      }

      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, data);

      console.log(`[Admin] Replaced shared animation: ${slot} → ${targetPath} (${data.length} bytes)`);
      res.json({ success: true, slot, size: data.length });
    } catch (err) {
      console.error("POST /api/animations/convert-shared error:", err);
      res.status(500).json({ error: "Failed to replace shared animation" });
    }
  },
);

export default router;
