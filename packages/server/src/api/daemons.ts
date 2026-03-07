import { Router } from "express";
import { requireAuth, requireRole, isAdmin, type AuthedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { RATE_LIMITS, getPlotPosition, V1_CONFIG } from "@the-street/shared";
import type { PersonalityManifest, LogEntryType } from "@the-street/shared";
import { getPool } from "../database/pool.js";
import { getActiveDaemonManager } from "../rooms/StreetRoom.js";
import { queryActivityLog, getTokenSummary } from "../services/ActivityLogService.js";
import { mkdirSync, writeFileSync, existsSync, createReadStream } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = join(__dirname, "..", "..", "data", "uploads");
const MAX_FBX_SIZE = 100 * 1024 * 1024; // 100MB
// FBX Binary magic: "Kaydara FBX Binary  \0"
const FBX_BINARY_MAGIC = Buffer.from("Kaydara FBX Binary  \0", "ascii");

const MAX_DAEMONS_PER_PLOT = 10;

const router = Router();

// POST /api/daemons/generate — AI daemon definition generation
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

      const { generateDaemon } = await import("@the-street/ai-service");
      const result = await generateDaemon(description);

      res.json(result);
    } catch (err) {
      console.error("POST /api/daemons/generate error:", err);
      const message = err instanceof Error ? err.message : "Daemon generation failed";
      res.status(500).json({ error: message });
    }
  },
);

// POST /api/daemons/create — Save daemon to plot (or as a global street daemon for admins)
router.post(
  "/create",
  ...requireAuth(),
  async (req, res) => {
    try {
      const userId = (req as AuthedRequest).userId;
      const authedReq = req as AuthedRequest;
      const { definition } = req.body;

      if (!definition || !definition.name) {
        res.status(400).json({ error: "definition with name is required" });
        return;
      }

      const pool = getPool();
      const plotUuid: string | null = definition.plotUuid || null;

      if (plotUuid) {
        // Plot-based daemon: verify plot ownership (admins bypass ownership check)
        const { rows: plotRows } = isAdmin(authedReq)
          ? await pool.query(
              "SELECT uuid FROM plots WHERE uuid = $1",
              [plotUuid],
            )
          : await pool.query(
              "SELECT uuid FROM plots WHERE uuid = $1 AND owner_id = $2",
              [plotUuid, userId],
            );
        if (plotRows.length === 0) {
          res.status(403).json({ error: "You don't own this plot" });
          return;
        }

        // Check daemon limit per plot
        const { rows: countRows } = await pool.query(
          "SELECT COUNT(*) as count FROM daemons WHERE plot_uuid = $1 AND is_active = true",
          [plotUuid],
        );
        if (parseInt(countRows[0].count) >= MAX_DAEMONS_PER_PLOT) {
          res.status(400).json({ error: `Maximum ${MAX_DAEMONS_PER_PLOT} daemons per plot` });
          return;
        }
      } else {
        // Global street daemon (no plot) — admin only
        if (!isAdmin(authedReq)) {
          res.status(403).json({ error: "Only admins can create daemons without a plot" });
          return;
        }
      }

      const { rows } = await pool.query(
        `INSERT INTO daemons
          (plot_uuid, owner_id, name, description, daemon_definition, appearance, behavior,
           position_x, position_y, position_z, rotation, mesh_description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          plotUuid,
          userId,
          definition.name,
          definition.description || "",
          JSON.stringify(definition),
          JSON.stringify(definition.appearance),
          JSON.stringify(definition.behavior),
          definition.position?.x || 0,
          definition.position?.y || 0,
          definition.position?.z || 0,
          definition.rotation || 0,
          definition.meshDescription || null,
        ],
      );

      // Notify running DaemonManager so the daemon appears for all connected clients
      const dm = getActiveDaemonManager();
      if (dm) {
        dm.addDaemon(rows[0].id, definition, definition.behavior);
      }

      res.json({ id: rows[0].id, success: true });
    } catch (err) {
      console.error("POST /api/daemons/create error:", err);
      const message = err instanceof Error ? err.message : "Daemon creation failed";
      res.status(500).json({ error: message });
    }
  },
);

// GET /api/daemons/all — List all daemons including inactive (admin only)
router.get(
  "/all",
  ...requireAuth(),
  requireRole("super_admin"),
  async (_req, res) => {
    try {
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT id, name, description, plot_uuid, daemon_definition, behavior,
                position_x, position_y, position_z, rotation, is_active, created_at
         FROM daemons ORDER BY is_active DESC, created_at DESC`,
      );

      res.json({
        daemons: rows.map((r: Record<string, unknown>) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          definition: r.daemon_definition,
          behavior: r.behavior,
          plotUuid: r.plot_uuid,
          position: { x: r.position_x, y: r.position_y, z: r.position_z },
          rotation: r.rotation,
          isActive: r.is_active,
          createdAt: r.created_at,
        })),
      });
    } catch (err) {
      console.error("GET /api/daemons/all error:", err);
      res.status(500).json({ error: "Failed to list daemons" });
    }
  },
);

// GET /api/daemons/global — List global street daemons (no plot, admin only)
router.get(
  "/global",
  ...requireAuth(),
  async (req, res) => {
    try {
      const authedReq = req as AuthedRequest;
      if (!isAdmin(authedReq)) {
        res.status(403).json({ error: "Admin only" });
        return;
      }

      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT id, name, description, daemon_definition, appearance, behavior,
                position_x, position_y, position_z, rotation, is_active, created_at
         FROM daemons WHERE plot_uuid IS NULL AND is_active = true
         ORDER BY created_at DESC`,
      );

      res.json({
        daemons: rows.map((r: Record<string, unknown>) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          definition: r.daemon_definition,
          position: { x: r.position_x, y: r.position_y, z: r.position_z },
          rotation: r.rotation,
          isActive: r.is_active,
          createdAt: r.created_at,
        })),
      });
    } catch (err) {
      console.error("GET /api/daemons/global error:", err);
      res.status(500).json({ error: "Failed to list global daemons" });
    }
  },
);

// GET /api/daemons/plot/:plotUuid — List daemons on a plot
router.get(
  "/plot/:plotUuid",
  ...requireAuth(),
  async (req, res) => {
    try {
      const plotUuid = req.params.plotUuid as string;
      const pool = getPool();

      const { rows } = await pool.query(
        `SELECT id, name, description, daemon_definition, appearance, behavior,
                position_x, position_y, position_z, rotation, is_active, created_at
         FROM daemons WHERE plot_uuid = $1 AND is_active = true
         ORDER BY created_at`,
        [plotUuid],
      );

      res.json({
        daemons: rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          definition: r.daemon_definition,
          position: { x: r.position_x, y: r.position_y, z: r.position_z },
          rotation: r.rotation,
          isActive: r.is_active,
          createdAt: r.created_at,
        })),
      });
    } catch (err) {
      console.error("GET /api/daemons/plot/:plotUuid error:", err);
      res.status(500).json({ error: "Failed to list daemons" });
    }
  },
);

// =============================================
// DAEMON CREATION DRAFT ENDPOINTS (super_admin only)
// These MUST be registered before /:id routes to avoid
// Express matching "drafts" as an :id parameter.
// =============================================

// POST /api/daemons/drafts — Create a new draft
router.post(
  "/drafts",
  ...requireAuth(),
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const userId = (req as AuthedRequest).userId;
      const pool = getPool();

      const { rows } = await pool.query(
        `INSERT INTO daemon_creation_drafts (admin_id)
         VALUES ($1) RETURNING id, created_at`,
        [userId],
      );

      res.json({
        success: true,
        draft: {
          id: rows[0].id,
          createdAt: rows[0].created_at,
        },
      });
    } catch (err) {
      console.error("POST /api/daemons/drafts error:", err);
      res.status(500).json({ error: "Failed to create draft" });
    }
  },
);

// GET /api/daemons/drafts/:id — Read a draft
router.get(
  "/drafts/:id",
  ...requireAuth(),
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const draftId = req.params.id;
      const pool = getPool();

      const { rows } = await pool.query(
        `SELECT d.*,
                COALESCE(
                  (SELECT json_agg(json_build_object(
                    'id', a.id,
                    'uploadType', a.upload_type,
                    'fbxFilename', a.fbx_filename,
                    'label', a.label,
                    'conversionStatus', a.conversion_status,
                    'uploadedAt', a.uploaded_at
                  )) FROM daemon_asset_uploads a
                  WHERE a.id = ANY(
                    ARRAY[d.character_upload_id] || d.emote_upload_ids
                  ) AND a.id IS NOT NULL),
                  '[]'::json
                ) as uploads
         FROM daemon_creation_drafts d
         WHERE d.id = $1 AND d.status = 'draft'`,
        [draftId],
      );

      if (rows.length === 0) {
        res.status(404).json({ error: "Draft not found" });
        return;
      }

      const row = rows[0];
      res.json({
        draft: {
          id: row.id,
          adminId: row.admin_id,
          characterUploadId: row.character_upload_id,
          emoteUploadIds: row.emote_upload_ids,
          adminPrompt: row.admin_prompt,
          expandedFields: row.expanded_fields,
          expansionStatus: row.expansion_status,
          maxConversationTurns: row.max_conversation_turns,
          maxDailyCalls: row.max_daily_calls,
          dailyBudgetResetsAt: row.daily_budget_resets_at,
          rememberVisitors: row.remember_visitors,
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          uploads: row.uploads,
        },
      });
    } catch (err) {
      console.error("GET /api/daemons/drafts/:id error:", err);
      res.status(500).json({ error: "Failed to read draft" });
    }
  },
);

// PUT /api/daemons/drafts/:id — Update a draft
router.put(
  "/drafts/:id",
  ...requireAuth(),
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const draftId = req.params.id;
      const pool = getPool();
      const {
        adminPrompt,
        expandedFields,
        maxConversationTurns,
        maxDailyCalls,
        dailyBudgetResetsAt,
        rememberVisitors,
      } = req.body;

      // Build dynamic SET clause
      const setClauses: string[] = ["updated_at = now()"];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (adminPrompt !== undefined) {
        setClauses.push(`admin_prompt = $${paramIdx++}`);
        params.push(adminPrompt);
      }
      if (expandedFields !== undefined) {
        setClauses.push(`expanded_fields = $${paramIdx++}`);
        params.push(JSON.stringify(expandedFields));
      }
      if (maxConversationTurns !== undefined) {
        setClauses.push(`max_conversation_turns = $${paramIdx++}`);
        params.push(maxConversationTurns);
      }
      if (maxDailyCalls !== undefined) {
        setClauses.push(`max_daily_calls = $${paramIdx++}`);
        params.push(maxDailyCalls);
      }
      if (dailyBudgetResetsAt !== undefined) {
        setClauses.push(`daily_budget_resets_at = $${paramIdx++}`);
        params.push(dailyBudgetResetsAt);
      }
      if (rememberVisitors !== undefined) {
        setClauses.push(`remember_visitors = $${paramIdx++}`);
        params.push(rememberVisitors);
      }

      params.push(draftId);

      const { rowCount } = await pool.query(
        `UPDATE daemon_creation_drafts
         SET ${setClauses.join(", ")}
         WHERE id = $${paramIdx} AND status = 'draft'`,
        params,
      );

      if (rowCount === 0) {
        res.status(404).json({ error: "Draft not found" });
        return;
      }

      res.json({ success: true });
    } catch (err) {
      console.error("PUT /api/daemons/drafts/:id error:", err);
      res.status(500).json({ error: "Failed to update draft" });
    }
  },
);

// POST /api/daemons/drafts/:id/upload-character — Upload FBX for character model
router.post(
  "/drafts/:id/upload-character",
  ...requireAuth(),
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const draftId = req.params.id;
      const pool = getPool();

      // Verify draft exists
      const { rows: draftRows } = await pool.query(
        "SELECT id FROM daemon_creation_drafts WHERE id = $1 AND status = 'draft'",
        [draftId],
      );
      if (draftRows.length === 0) {
        res.status(404).json({ error: "Draft not found" });
        return;
      }

      // Read raw binary
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks);

      if (body.length < 23) {
        res.status(400).json({ error: "File too small to be a valid FBX" });
        return;
      }
      if (body.length > MAX_FBX_SIZE) {
        res.status(400).json({ error: `File too large (max ${MAX_FBX_SIZE / 1024 / 1024}MB)` });
        return;
      }

      // Validate FBX binary magic bytes
      if (!body.subarray(0, FBX_BINARY_MAGIC.length).equals(FBX_BINARY_MAGIC)) {
        res.status(400).json({ error: "Invalid FBX file (bad magic bytes)" });
        return;
      }

      const originalFilename = (req.headers["x-original-filename"] as string) || "character.fbx";

      // Create asset upload record
      // TODO: implement FBX-to-glTF conversion pipeline; for now mark as ready
      const { rows: uploadRows } = await pool.query(
        `INSERT INTO daemon_asset_uploads (upload_type, fbx_filename, conversion_status)
         VALUES ('character', $1, 'ready')
         RETURNING id`,
        [originalFilename],
      );
      const uploadId = uploadRows[0].id as string;

      // Write FBX to disk
      const dir = join(UPLOAD_DIR, uploadId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "model.fbx"), body);

      // Link to draft (replace previous character upload if any)
      await pool.query(
        `UPDATE daemon_creation_drafts
         SET character_upload_id = $1, updated_at = now()
         WHERE id = $2`,
        [uploadId, draftId],
      );

      console.log(`[Daemon Draft] Character FBX uploaded: ${uploadId} (${(body.length / 1024 / 1024).toFixed(2)} MB)`);

      res.json({
        success: true,
        uploadId,
        filename: originalFilename,
        size: body.length,
      });
    } catch (err) {
      console.error("POST /api/daemons/drafts/:id/upload-character error:", err);
      res.status(500).json({ error: "Character upload failed" });
    }
  },
);

// POST /api/daemons/drafts/:id/upload-emote — Upload FBX for emote animation
router.post(
  "/drafts/:id/upload-emote",
  ...requireAuth(),
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const draftId = req.params.id;
      const label = req.headers["x-emote-label"] as string;

      if (!label || typeof label !== "string") {
        res.status(400).json({ error: "x-emote-label header is required" });
        return;
      }

      const pool = getPool();

      // Verify draft exists
      const { rows: draftRows } = await pool.query(
        "SELECT id FROM daemon_creation_drafts WHERE id = $1 AND status = 'draft'",
        [draftId],
      );
      if (draftRows.length === 0) {
        res.status(404).json({ error: "Draft not found" });
        return;
      }

      // Read raw binary
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks);

      if (body.length < 23) {
        res.status(400).json({ error: "File too small to be a valid FBX" });
        return;
      }
      if (body.length > MAX_FBX_SIZE) {
        res.status(400).json({ error: `File too large (max ${MAX_FBX_SIZE / 1024 / 1024}MB)` });
        return;
      }

      // Validate FBX binary magic bytes
      if (!body.subarray(0, FBX_BINARY_MAGIC.length).equals(FBX_BINARY_MAGIC)) {
        res.status(400).json({ error: "Invalid FBX file (bad magic bytes)" });
        return;
      }

      const originalFilename = (req.headers["x-original-filename"] as string) || "emote.fbx";

      // Create asset upload record
      // TODO: implement FBX-to-glTF conversion pipeline; for now mark as ready
      const { rows: uploadRows } = await pool.query(
        `INSERT INTO daemon_asset_uploads (upload_type, fbx_filename, label, conversion_status)
         VALUES ('emote', $1, $2, 'ready')
         RETURNING id`,
        [originalFilename, label],
      );
      const uploadId = uploadRows[0].id as string;

      // Write FBX to disk
      const dir = join(UPLOAD_DIR, uploadId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "emote.fbx"), body);

      // Append to draft's emote upload list
      await pool.query(
        `UPDATE daemon_creation_drafts
         SET emote_upload_ids = array_append(emote_upload_ids, $1::uuid),
             updated_at = now()
         WHERE id = $2`,
        [uploadId, draftId],
      );

      console.log(`[Daemon Draft] Emote FBX uploaded: ${uploadId} label="${label}" (${(body.length / 1024 / 1024).toFixed(2)} MB)`);

      res.json({
        success: true,
        uploadId,
        label,
        filename: originalFilename,
        size: body.length,
      });
    } catch (err) {
      console.error("POST /api/daemons/drafts/:id/upload-emote error:", err);
      res.status(500).json({ error: "Emote upload failed" });
    }
  },
);

// POST /api/daemons/drafts/:id/expand — Trigger prompt expansion
router.post(
  "/drafts/:id/expand",
  ...requireAuth(),
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const draftId = req.params.id;
      const pool = getPool();

      // Get draft
      const { rows: draftRows } = await pool.query(
        `SELECT id, admin_prompt, expanded_fields, emote_upload_ids
         FROM daemon_creation_drafts
         WHERE id = $1 AND status = 'draft'`,
        [draftId],
      );
      if (draftRows.length === 0) {
        res.status(404).json({ error: "Draft not found" });
        return;
      }

      const draft = draftRows[0];
      const adminPrompt = req.body.adminPrompt || draft.admin_prompt;

      if (!adminPrompt || typeof adminPrompt !== "string") {
        res.status(400).json({ error: "adminPrompt is required (in body or saved on draft)" });
        return;
      }

      const clearedFields = req.body.clearedFields || [];

      // Get emote labels from uploads
      let emoteLabels: string[] = [];
      if (draft.emote_upload_ids && draft.emote_upload_ids.length > 0) {
        const { rows: emoteRows } = await pool.query(
          "SELECT label FROM daemon_asset_uploads WHERE id = ANY($1) AND label IS NOT NULL",
          [draft.emote_upload_ids],
        );
        emoteLabels = emoteRows.map((r: { label: string }) => r.label);
      }

      // Mark as processing
      await pool.query(
        `UPDATE daemon_creation_drafts
         SET expansion_status = 'processing', admin_prompt = $1, updated_at = now()
         WHERE id = $2`,
        [adminPrompt, draftId],
      );

      // Run prompt expansion
      const { expandPrompt } = await import("@the-street/ai-service");
      const result = await expandPrompt({
        adminPrompt,
        existingFields: draft.expanded_fields || undefined,
        clearedFields,
        emoteLabels,
      });

      // Save results
      await pool.query(
        `UPDATE daemon_creation_drafts
         SET expanded_fields = $1, expansion_status = 'ready', updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(result.expandedFields), draftId],
      );

      res.json({
        success: true,
        expandedFields: result.expandedFields,
        suggestedEmoteDescriptions: result.suggestedEmoteDescriptions,
      });
    } catch (err) {
      console.error("POST /api/daemons/drafts/:id/expand error:", err);

      // Mark as failed
      const pool = getPool();
      await pool.query(
        `UPDATE daemon_creation_drafts
         SET expansion_status = 'failed', updated_at = now()
         WHERE id = $1`,
        [req.params.id],
      ).catch(() => {});

      const message = err instanceof Error ? err.message : "Prompt expansion failed";
      res.status(500).json({ error: message });
    }
  },
);

// POST /api/daemons/drafts/:id/finalize — Finalize draft into daemon entity
router.post(
  "/drafts/:id/finalize",
  ...requireAuth(),
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const draftId = req.params.id;
      const userId = (req as AuthedRequest).userId;
      const pool = getPool();

      // Get draft with full details
      const { rows: draftRows } = await pool.query(
        `SELECT * FROM daemon_creation_drafts
         WHERE id = $1 AND status = 'draft'`,
        [draftId],
      );
      if (draftRows.length === 0) {
        res.status(404).json({ error: "Draft not found" });
        return;
      }

      const draft = draftRows[0];

      // Must have expanded fields
      if (!draft.expanded_fields || draft.expansion_status !== "ready") {
        res.status(400).json({ error: "Draft must have expanded fields (run /expand first)" });
        return;
      }

      // Check all asset uploads have conversion_status = 'ready'
      const allUploadIds: string[] = [];
      if (draft.character_upload_id) allUploadIds.push(draft.character_upload_id);
      if (draft.emote_upload_ids && draft.emote_upload_ids.length > 0) {
        allUploadIds.push(...draft.emote_upload_ids);
      }

      if (allUploadIds.length > 0) {
        const { rows: uploadRows } = await pool.query(
          `SELECT id, conversion_status FROM daemon_asset_uploads
           WHERE id = ANY($1)`,
          [allUploadIds],
        );

        const notReady = uploadRows.filter(
          (r: { conversion_status: string }) => r.conversion_status !== "ready",
        );
        if (notReady.length > 0) {
          res.status(400).json({
            error: "All asset uploads must have conversion_status = 'ready' before finalizing",
            pendingUploads: notReady.map((r: { id: string; conversion_status: string }) => ({
              id: r.id,
              status: r.conversion_status,
            })),
          });
          return;
        }
      }

      const expandedFields = draft.expanded_fields;

      // Build emote assignments from emote uploads
      const availableEmotes: { emoteId: string; label: string; promptDescription: string }[] = [];
      if (draft.emote_upload_ids && draft.emote_upload_ids.length > 0) {
        const { rows: emoteRows } = await pool.query(
          "SELECT id, label FROM daemon_asset_uploads WHERE id = ANY($1) AND upload_type = 'emote'",
          [draft.emote_upload_ids],
        );
        for (const row of emoteRows) {
          availableEmotes.push({
            emoteId: row.id,
            label: row.label || row.id,
            promptDescription: `Performs the "${row.label || "custom"}" emote`,
          });
        }
      }

      // Use a transaction for finalization
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Create daemon entity (inactive — placement assigns it to a plot later)
        const definition = {
          name: expandedFields.name,
          description: expandedFields.backstory,
          appearance: {},
          behavior: {
            type: "roamer" as const,
            greetingMessage: "",
            farewellMessage: "",
            interactionRadius: 5,
            roamingEnabled: expandedFields.behaviorPreferences?.initiatesConversation ?? true,
          },
          personality: {
            traits: expandedFields.traits || [],
            backstory: expandedFields.backstory,
            speechStyle: expandedFields.voiceDescription,
            interests: expandedFields.interests || [],
            quirks: expandedFields.quirks || [],
          },
        };

        const { rows: daemonRows } = await client.query(
          `INSERT INTO daemons
            (owner_id, name, description, daemon_definition, appearance, behavior,
             position_x, position_y, position_z, rotation, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0, 0, false)
           RETURNING id`,
          [
            userId,
            expandedFields.name,
            expandedFields.backstory || "",
            JSON.stringify(definition),
            JSON.stringify(definition.appearance),
            JSON.stringify(definition.behavior),
          ],
        );
        const daemonId = daemonRows[0].id as string;

        // Build and compile PersonalityManifest
        const manifest: PersonalityManifest = {
          daemonId,
          version: 0,
          identity: {
            name: expandedFields.name,
            voiceDescription: expandedFields.voiceDescription,
            backstory: expandedFields.backstory,
          },
          compiledSystemPrompt: "",
          compiledTokenCount: 0,
          compiledAt: 0,
          interests: expandedFields.interests || [],
          dislikes: expandedFields.dislikes || [],
          mutableTraits: [],
          availableEmotes,
          behaviorPreferences: expandedFields.behaviorPreferences || {
            crowdAffinity: 0,
            territoriality: 0.5,
            conversationLength: "moderate" as const,
            initiatesConversation: true,
          },
          maxConversationTurns: draft.max_conversation_turns,
          maxDailyCalls: draft.max_daily_calls,
          dailyBudgetResetsAt: draft.daily_budget_resets_at,
          rememberVisitors: draft.remember_visitors,
        };

        // Run compiler
        const { compile } = await import("@the-street/ai-service");
        const compileResult = compile(manifest, "daemon_creation");

        // Store compiled manifest in DB
        await client.query(
          `INSERT INTO personality_manifests
            (daemon_id, version, name, voice_description, backstory,
             compiled_system_prompt, compiled_token_count, compiled_at,
             interests, dislikes, mutable_traits, available_emotes,
             crowd_affinity, territoriality, conversation_length, initiates_conversation,
             max_conversation_turns, max_daily_calls, daily_budget_resets_at, remember_visitors)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
          [
            daemonId,
            compileResult.manifest.version,
            compileResult.manifest.identity.name,
            compileResult.manifest.identity.voiceDescription,
            compileResult.manifest.identity.backstory,
            compileResult.manifest.compiledSystemPrompt,
            compileResult.manifest.compiledTokenCount,
            new Date(compileResult.manifest.compiledAt),
            compileResult.manifest.interests,
            compileResult.manifest.dislikes,
            JSON.stringify(compileResult.manifest.mutableTraits),
            JSON.stringify(compileResult.manifest.availableEmotes),
            compileResult.manifest.behaviorPreferences.crowdAffinity,
            compileResult.manifest.behaviorPreferences.territoriality,
            compileResult.manifest.behaviorPreferences.conversationLength,
            compileResult.manifest.behaviorPreferences.initiatesConversation,
            compileResult.manifest.maxConversationTurns,
            compileResult.manifest.maxDailyCalls,
            compileResult.manifest.dailyBudgetResetsAt,
            compileResult.manifest.rememberVisitors,
          ],
        );

        // Link asset uploads to daemon
        if (allUploadIds.length > 0) {
          await client.query(
            `UPDATE daemon_asset_uploads SET daemon_id = $1 WHERE id = ANY($2)`,
            [daemonId, allUploadIds],
          );
        }

        // Mark draft as finalized
        await client.query(
          `UPDATE daemon_creation_drafts
           SET status = 'finalized', updated_at = now()
           WHERE id = $1`,
          [draftId],
        );

        await client.query("COMMIT");

        console.log(`[Daemon Draft] Finalized draft ${draftId} → daemon ${daemonId}`);

        res.json({
          success: true,
          daemonId,
          name: expandedFields.name,
          manifestVersion: compileResult.manifest.version,
          compiledTokenCount: compileResult.manifest.compiledTokenCount,
        });
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("POST /api/daemons/drafts/:id/finalize error:", err);
      const message = err instanceof Error ? err.message : "Finalization failed";
      res.status(500).json({ error: message });
    }
  },
);

// DELETE /api/daemons/drafts/:id — Abandon a draft
router.delete(
  "/drafts/:id",
  ...requireAuth(),
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const draftId = req.params.id;
      const pool = getPool();

      const { rowCount } = await pool.query(
        `UPDATE daemon_creation_drafts
         SET status = 'abandoned', updated_at = now()
         WHERE id = $1 AND status = 'draft'`,
        [draftId],
      );

      if (rowCount === 0) {
        res.status(404).json({ error: "Draft not found" });
        return;
      }

      res.json({ success: true });
    } catch (err) {
      console.error("DELETE /api/daemons/drafts/:id error:", err);
      res.status(500).json({ error: "Failed to abandon draft" });
    }
  },
);

// DELETE /api/daemons/:id — Remove daemon (owner only)
router.delete(
  "/:id",
  ...requireAuth(),
  async (req, res) => {
    try {
      const userId = (req as AuthedRequest).userId;
      const daemonId = req.params.id as string;
      const pool = getPool();

      const authedReq = req as AuthedRequest;
      const { rowCount } = isAdmin(authedReq)
        ? await pool.query(
            "UPDATE daemons SET is_active = false WHERE id = $1",
            [daemonId],
          )
        : await pool.query(
            "UPDATE daemons SET is_active = false WHERE id = $1 AND owner_id = $2",
            [daemonId, userId],
          );

      if (rowCount === 0) {
        res.status(404).json({ error: "Daemon not found or not owned by you" });
        return;
      }

      // Notify running DaemonManager to despawn for all connected clients
      const dm = getActiveDaemonManager();
      if (dm) {
        dm.removeDaemon(daemonId);
      }

      res.json({ success: true });
    } catch (err) {
      console.error("DELETE /api/daemons/:id error:", err);
      res.status(500).json({ error: "Failed to delete daemon" });
    }
  },
);

// GET /api/daemons/:id/activity — Get recent daemon activity
router.get(
  "/:id/activity",
  ...requireAuth(),
  async (req, res) => {
    try {
      const daemonId = req.params.id as string;
      const dm = getActiveDaemonManager();

      if (!dm) {
        res.json({ activity: [] });
        return;
      }

      const activity = dm.getDaemonActivity(daemonId, 15);
      res.json({ activity });
    } catch (err) {
      console.error("GET /api/daemons/:id/activity error:", err);
      res.status(500).json({ error: "Failed to get activity" });
    }
  },
);

// ==================== World Placement API ====================

// GET /api/daemons/placeable — List finalized daemons without active placements (admin only)
router.get(
  "/placeable",
  ...requireAuth(),
  async (req, res) => {
    try {
      const authedReq = req as AuthedRequest;
      if (!isAdmin(authedReq)) {
        res.status(403).json({ error: "Admin only" });
        return;
      }

      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT d.id, d.name, d.description, d.is_active,
                dp.id as placement_id, dp.active as placement_active
         FROM daemons d
         LEFT JOIN daemon_placements dp ON dp.daemon_id = d.id
         WHERE dp.id IS NULL
         ORDER BY d.created_at DESC`,
      );

      res.json({ daemons: rows });
    } catch (err) {
      console.error("GET /api/daemons/placeable error:", err);
      res.status(500).json({ error: "Failed to list placeable daemons" });
    }
  },
);

// GET /api/daemons/:id — Get a single daemon's full details
router.get(
  "/:id",
  ...requireAuth(),
  async (req, res) => {
    try {
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT d.id, d.name, d.description, d.daemon_definition, d.appearance, d.behavior,
                d.position_x, d.position_y, d.position_z, d.rotation, d.is_active,
                d.plot_uuid, d.owner_id, d.created_at,
                (SELECT dau.id FROM daemon_asset_uploads dau
                 WHERE dau.daemon_id = d.id AND dau.upload_type = 'character' LIMIT 1) as character_upload_id
         FROM daemons d WHERE d.id = $1`,
        [req.params.id],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "Daemon not found" });
        return;
      }
      const r = rows[0];
      res.json({
        id: r.id,
        name: r.name,
        description: r.description,
        definition: r.daemon_definition,
        behavior: r.behavior,
        position: { x: r.position_x, y: r.position_y, z: r.position_z },
        rotation: r.rotation,
        isActive: r.is_active,
        plotUuid: r.plot_uuid,
        ownerId: r.owner_id,
        characterUploadId: r.character_upload_id,
        createdAt: r.created_at,
      });
    } catch (err) {
      console.error("GET /api/daemons/:id error:", err);
      res.status(500).json({ error: "Failed to get daemon" });
    }
  },
);

// PUT /api/daemons/:id — Update daemon definition
router.put(
  "/:id",
  ...requireAuth(),
  async (req, res) => {
    try {
      const userId = (req as AuthedRequest).userId;
      const daemonId = req.params.id as string;
      const { definition } = req.body;

      if (!definition) {
        res.status(400).json({ error: "definition is required" });
        return;
      }

      const pool = getPool();
      const authedReq = req as AuthedRequest;
      const { rowCount } = isAdmin(authedReq)
        ? await pool.query(
            `UPDATE daemons SET
              name = $1,
              description = $2,
              daemon_definition = $3,
              appearance = $4,
              behavior = $5,
              mesh_description = $6
             WHERE id = $7 AND is_active = true`,
            [
              definition.name,
              definition.description || "",
              JSON.stringify(definition),
              JSON.stringify(definition.appearance),
              JSON.stringify(definition.behavior),
              definition.meshDescription || null,
              daemonId,
            ],
          )
        : await pool.query(
            `UPDATE daemons SET
              name = $1,
              description = $2,
              daemon_definition = $3,
              appearance = $4,
              behavior = $5,
              mesh_description = $6
             WHERE id = $7 AND owner_id = $8 AND is_active = true`,
            [
              definition.name,
              definition.description || "",
              JSON.stringify(definition),
              JSON.stringify(definition.appearance),
              JSON.stringify(definition.behavior),
              definition.meshDescription || null,
              daemonId,
              userId,
            ],
          );

      if (rowCount === 0) {
        res.status(404).json({ error: "Daemon not found or not owned by you" });
        return;
      }

      // Notify running DaemonManager to reload definition
      const dm = getActiveDaemonManager();
      if (dm) {
        dm.updateDaemonDefinition?.(daemonId, definition);
      }

      res.json({ success: true });
    } catch (err) {
      console.error("PUT /api/daemons/:id error:", err);
      const message = err instanceof Error ? err.message : "Update failed";
      res.status(500).json({ error: message });
    }
  },
);

// GET /api/daemons/:id/activity-log — Paginated activity log
router.get(
  "/:id/activity-log",
  ...requireAuth(),
  async (req, res) => {
    try {
      const authedReq = req as AuthedRequest;
      if (!isAdmin(authedReq)) {
        res.status(403).json({ error: "Admin only" });
        return;
      }

      const daemonId = req.params.id as string;
      const types = req.query.types
        ? (req.query.types as string).split(",") as LogEntryType[]
        : undefined;
      const visitorId = req.query.visitorId as string | undefined;
      const after = req.query.after ? Number(req.query.after) : undefined;
      const before = req.query.before ? Number(req.query.before) : undefined;
      const sessionId = req.query.sessionId as string | undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const cursor = req.query.cursor as string | undefined;

      const result = await queryActivityLog({
        daemonId,
        types,
        visitorId,
        after,
        before,
        sessionId,
        limit,
        cursor,
      });

      res.json(result);
    } catch (err) {
      console.error("GET /api/daemons/:id/activity-log error:", err);
      res.status(500).json({ error: "Failed to query activity log" });
    }
  },
);

// GET /api/daemons/:id/token-summary — Token usage breakdown
router.get(
  "/:id/token-summary",
  ...requireAuth(),
  async (req, res) => {
    try {
      const authedReq = req as AuthedRequest;
      if (!isAdmin(authedReq)) {
        res.status(403).json({ error: "Admin only" });
        return;
      }

      const daemonId = req.params.id as string;
      const window = (req.query.window as string) || "30d";

      if (!["30d", "90d", "all"].includes(window)) {
        res.status(400).json({ error: "window must be 30d, 90d, or all" });
        return;
      }

      const result = await getTokenSummary(daemonId, window as "30d" | "90d" | "all");
      res.json(result);
    } catch (err) {
      console.error("GET /api/daemons/:id/token-summary error:", err);
      res.status(500).json({ error: "Failed to get token summary" });
    }
  },
);

// GET /api/daemons/:id/placement — Get placement for a daemon
router.get(
  "/:id/placement",
  ...requireAuth(),
  async (req, res) => {
    try {
      const authedReq = req as AuthedRequest;
      if (!isAdmin(authedReq)) {
        res.status(403).json({ error: "Admin only" });
        return;
      }

      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT dp.*, p.position as plot_position, p.neighborhood, p.ring
         FROM daemon_placements dp
         JOIN plots p ON p.uuid = dp.plot_uuid
         WHERE dp.daemon_id = $1`,
        [req.params.id],
      );

      if (rows.length === 0) {
        res.json({ placement: null });
        return;
      }

      const row = rows[0];
      res.json({
        placement: {
          daemonId: row.daemon_id,
          plotUUID: row.plot_uuid,
          spawnPoint: { x: row.spawn_x, y: row.spawn_y, z: row.spawn_z },
          facingDirection: row.facing_direction,
          roamRadius: row.roam_radius,
          interactionRange: row.interaction_range,
          active: row.active,
        },
      });
    } catch (err) {
      console.error("GET /api/daemons/:id/placement error:", err);
      res.status(500).json({ error: "Failed to get placement" });
    }
  },
);

// POST /api/daemons/:id/placement — Create placement for a daemon
router.post(
  "/:id/placement",
  ...requireAuth(),
  async (req, res) => {
    try {
      const authedReq = req as AuthedRequest;
      if (!isAdmin(authedReq)) {
        res.status(403).json({ error: "Admin only" });
        return;
      }

      const daemonId = req.params.id as string;
      const { plotUUID, spawnPoint, facingDirection, roamRadius, interactionRange } = req.body;

      if (!plotUUID || !spawnPoint) {
        res.status(400).json({ error: "plotUUID and spawnPoint are required" });
        return;
      }

      const roam = roamRadius ?? 5;
      const interaction = interactionRange ?? 10;

      const pool = getPool();

      // Verify daemon exists
      const { rows: daemonRows } = await pool.query(
        "SELECT id FROM daemons WHERE id = $1",
        [daemonId],
      );
      if (daemonRows.length === 0) {
        res.status(404).json({ error: "Daemon not found" });
        return;
      }

      // Verify plot exists and get bounds for spawn point validation
      const { rows: plotRows } = await pool.query(
        "SELECT uuid, position FROM plots WHERE uuid = $1",
        [plotUUID],
      );
      if (plotRows.length === 0) {
        res.status(404).json({ error: "Plot not found" });
        return;
      }

      // spawnPoint is plot-relative (0,0 = plot center)
      // Validate within plot bounds, then convert to world coordinates for storage
      const plotPlacement = getPlotPosition(plotRows[0].position, V1_CONFIG);
      const halfW = plotPlacement.bounds.width / 2;
      const halfD = plotPlacement.bounds.depth / 2;
      if (Math.abs(spawnPoint.x) > halfW || Math.abs(spawnPoint.z) > halfD) {
        res.status(400).json({ error: "spawnPoint is outside plot bounds" });
        return;
      }

      // Convert plot-relative to world coordinates
      const cos = Math.cos(plotPlacement.rotation);
      const sin = Math.sin(plotPlacement.rotation);
      const worldX = plotPlacement.position.x + spawnPoint.x * cos - spawnPoint.z * sin;
      const worldZ = plotPlacement.position.z + spawnPoint.x * sin + spawnPoint.z * cos;

      // Check for existing placement
      const { rows: existing } = await pool.query(
        "SELECT id FROM daemon_placements WHERE daemon_id = $1",
        [daemonId],
      );
      if (existing.length > 0) {
        res.status(409).json({ error: "Daemon already has a placement. Use PUT to update." });
        return;
      }

      const { rows: inserted } = await pool.query(
        `INSERT INTO daemon_placements
          (daemon_id, plot_uuid, spawn_x, spawn_y, spawn_z,
           facing_direction, roam_radius, interaction_range)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          daemonId, plotUUID,
          worldX, spawnPoint.y ?? 0, worldZ,
          facingDirection ?? 0, roam, interaction,
        ],
      );

      const row = inserted[0];
      res.json({
        placement: {
          daemonId: row.daemon_id,
          plotUUID: row.plot_uuid,
          spawnPoint: { x: row.spawn_x, y: row.spawn_y, z: row.spawn_z },
          facingDirection: row.facing_direction,
          roamRadius: row.roam_radius,
          interactionRange: row.interaction_range,
          active: row.active,
        },
      });
    } catch (err) {
      console.error("POST /api/daemons/:id/placement error:", err);
      res.status(500).json({ error: "Failed to create placement" });
    }
  },
);

// PUT /api/daemons/:id/placement — Update placement for a daemon
router.put(
  "/:id/placement",
  ...requireAuth(),
  async (req, res) => {
    try {
      const authedReq = req as AuthedRequest;
      if (!isAdmin(authedReq)) {
        res.status(403).json({ error: "Admin only" });
        return;
      }

      const daemonId = req.params.id as string;
      const { plotUUID, spawnPoint, facingDirection, roamRadius, interactionRange } = req.body;

      const pool = getPool();

      // Load existing placement
      const { rows: existing } = await pool.query(
        "SELECT * FROM daemon_placements WHERE daemon_id = $1",
        [daemonId],
      );
      if (existing.length === 0) {
        res.status(404).json({ error: "No placement found. Use POST to create." });
        return;
      }

      const current = existing[0];
      const newPlotUUID = plotUUID ?? current.plot_uuid;
      const newSpawnX = spawnPoint?.x ?? current.spawn_x;
      const newSpawnY = spawnPoint?.y ?? current.spawn_y;
      const newSpawnZ = spawnPoint?.z ?? current.spawn_z;
      const newFacing = facingDirection ?? current.facing_direction;
      const newRoam = roamRadius ?? current.roam_radius;
      const newInteraction = interactionRange ?? current.interaction_range;

      // If spawnPoint provided (plot-relative), validate and convert to world coords
      let finalSpawnX = newSpawnX;
      let finalSpawnY = newSpawnY;
      let finalSpawnZ = newSpawnZ;

      if (plotUUID || spawnPoint) {
        const { rows: plotRows } = await pool.query(
          "SELECT uuid, position FROM plots WHERE uuid = $1",
          [newPlotUUID],
        );
        if (plotRows.length === 0) {
          res.status(404).json({ error: "Plot not found" });
          return;
        }

        const plotPlacement = getPlotPosition(plotRows[0].position, V1_CONFIG);

        if (spawnPoint) {
          // spawnPoint is plot-relative — validate bounds
          const halfW = plotPlacement.bounds.width / 2;
          const halfD = plotPlacement.bounds.depth / 2;
          if (Math.abs(spawnPoint.x) > halfW || Math.abs(spawnPoint.z) > halfD) {
            res.status(400).json({ error: "spawnPoint is outside plot bounds" });
            return;
          }

          // Convert to world coordinates
          const cos = Math.cos(plotPlacement.rotation);
          const sin = Math.sin(plotPlacement.rotation);
          finalSpawnX = plotPlacement.position.x + spawnPoint.x * cos - spawnPoint.z * sin;
          finalSpawnY = spawnPoint.y ?? 0;
          finalSpawnZ = plotPlacement.position.z + spawnPoint.x * sin + spawnPoint.z * cos;
        }
      }

      const { rows: updated } = await pool.query(
        `UPDATE daemon_placements
         SET plot_uuid = $1, spawn_x = $2, spawn_y = $3, spawn_z = $4,
             facing_direction = $5, roam_radius = $6, interaction_range = $7,
             updated_at = now()
         WHERE daemon_id = $8
         RETURNING *`,
        [newPlotUUID, finalSpawnX, finalSpawnY, finalSpawnZ, newFacing, newRoam, newInteraction, daemonId],
      );

      const row = updated[0];
      res.json({
        placement: {
          daemonId: row.daemon_id,
          plotUUID: row.plot_uuid,
          spawnPoint: { x: row.spawn_x, y: row.spawn_y, z: row.spawn_z },
          facingDirection: row.facing_direction,
          roamRadius: row.roam_radius,
          interactionRange: row.interaction_range,
          active: row.active,
        },
      });
    } catch (err) {
      console.error("PUT /api/daemons/:id/placement error:", err);
      res.status(500).json({ error: "Failed to update placement" });
    }
  },
);

// POST /api/daemons/:id/activate — Activate daemon (appears in world)
router.post(
  "/:id/activate",
  ...requireAuth(),
  async (req, res) => {
    try {
      const authedReq = req as AuthedRequest;
      if (!isAdmin(authedReq)) {
        res.status(403).json({ error: "Admin only" });
        return;
      }

      const daemonId = req.params.id as string;
      const pool = getPool();

      // Must have a placement
      const { rows: placementRows } = await pool.query(
        "SELECT * FROM daemon_placements WHERE daemon_id = $1",
        [daemonId],
      );
      if (placementRows.length === 0) {
        res.status(400).json({ error: "Daemon must have a placement before activation" });
        return;
      }

      const placement = placementRows[0];

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Set daemon active and update position to spawn point
        await client.query(
          `UPDATE daemons
           SET is_active = true, plot_uuid = $1,
               position_x = $2, position_y = $3, position_z = $4,
               rotation = $5
           WHERE id = $6`,
          [
            placement.plot_uuid,
            placement.spawn_x, placement.spawn_y, placement.spawn_z,
            placement.facing_direction, daemonId,
          ],
        );

        // Mark placement as active
        await client.query(
          "UPDATE daemon_placements SET active = true, updated_at = now() WHERE daemon_id = $1",
          [daemonId],
        );

        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
      } finally {
        client.release();
      }

      // Notify DaemonManager to spawn in world
      const dm = getActiveDaemonManager();
      if (dm) {
        const { rows: daemonRows } = await pool.query(
          "SELECT * FROM daemons WHERE id = $1",
          [daemonId],
        );
        if (daemonRows.length > 0) {
          const d = daemonRows[0];
          const def = {
            ...d.daemon_definition,
            position: { x: d.position_x, y: d.position_y, z: d.position_z },
            rotation: d.rotation,
          };
          dm.addDaemon(d.id, def, d.behavior);
        }
      }

      res.json({ success: true, active: true });
    } catch (err) {
      console.error("POST /api/daemons/:id/activate error:", err);
      res.status(500).json({ error: "Failed to activate daemon" });
    }
  },
);

// POST /api/daemons/:id/deactivate — Deactivate daemon (remove from world, preserve data)
router.post(
  "/:id/deactivate",
  ...requireAuth(),
  async (req, res) => {
    try {
      const authedReq = req as AuthedRequest;
      if (!isAdmin(authedReq)) {
        res.status(403).json({ error: "Admin only" });
        return;
      }

      const daemonId = req.params.id as string;
      const pool = getPool();

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Deactivate daemon
        await client.query(
          "UPDATE daemons SET is_active = false WHERE id = $1",
          [daemonId],
        );

        // Mark placement as inactive
        await client.query(
          "UPDATE daemon_placements SET active = false, updated_at = now() WHERE daemon_id = $1",
          [daemonId],
        );

        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
      } finally {
        client.release();
      }

      // Notify DaemonManager to remove from world
      const dm = getActiveDaemonManager();
      if (dm) {
        dm.removeDaemon(daemonId);
      }

      res.json({ success: true, active: false });
    } catch (err) {
      console.error("POST /api/daemons/:id/deactivate error:", err);
      res.status(500).json({ error: "Failed to deactivate daemon" });
    }
  },
);

// GET /api/daemons/:id/emotes — List emote uploads for a daemon
router.get(
  "/:id/emotes",
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.query(
        `SELECT id, label FROM daemon_asset_uploads
         WHERE daemon_id = $1 AND upload_type = 'emote' AND conversion_status = 'ready'
         ORDER BY label`,
        [req.params.id],
      );
      res.json(result.rows);
    } catch (err) {
      console.error("Failed to fetch emotes:", err);
      res.status(500).json({ error: "Failed to fetch emotes" });
    }
  },
);

// PATCH /api/daemons/:id/idle-animation — Set idle animation label
router.patch(
  "/:id/idle-animation",
  async (req, res) => {
    try {
      const pool = getPool();
      const { label } = req.body;
      await pool.query(
        `UPDATE daemons SET behavior = behavior || $1::jsonb WHERE id = $2`,
        [JSON.stringify({ idleAnimationLabel: label || null }), req.params.id],
      );
      res.json({ ok: true });
    } catch (err) {
      console.error("Failed to update idle animation:", err);
      res.status(500).json({ error: "Failed to update idle animation" });
    }
  },
);

// POST /api/daemons/:id/directive — Send an admin directive to a daemon
router.post(
  "/:id/directive",
  ...requireAuth(),
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const { directive } = req.body;
      if (!directive || typeof directive !== "string") {
        res.status(400).json({ error: "directive is required" });
        return;
      }

      const manager = getActiveDaemonManager();
      if (!manager) {
        res.status(503).json({ error: "Daemon manager not active" });
        return;
      }

      manager.setDirective(req.params.id, directive.slice(0, 500));
      res.json({ ok: true });
    } catch (err) {
      console.error("Failed to set directive:", err);
      res.status(500).json({ error: "Failed to set directive" });
    }
  },
);

// GET /api/daemons/:id/desires — List active desires
router.get(
  "/:id/desires",
  ...requireAuth(),
  requireRole("super_admin"),
  async (req, res) => {
    const manager = getActiveDaemonManager();
    if (!manager) {
      res.status(503).json({ error: "Daemon manager not active" });
      return;
    }
    res.json({ desires: manager.getDesires(req.params.id) });
  },
);

// DELETE /api/daemons/:id/directive — Remove a specific desire by index
router.delete(
  "/:id/directive",
  ...requireAuth(),
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const index = parseInt(req.body?.index, 10);
      if (isNaN(index) || index < 0) {
        res.status(400).json({ error: "Valid index is required" });
        return;
      }

      const manager = getActiveDaemonManager();
      if (!manager) {
        res.status(503).json({ error: "Daemon manager not active" });
        return;
      }

      manager.removeDesire(req.params.id, index);
      res.json({ ok: true, desires: manager.getDesires(req.params.id) });
    } catch (err) {
      console.error("Failed to remove desire:", err);
      res.status(500).json({ error: "Failed to remove desire" });
    }
  },
);

// POST /api/daemons/:id/upload-character — Upload/replace FBX character model for a placed daemon
router.post(
  "/:id/upload-character",
  ...requireAuth(),
  requireRole("super_admin"),
  async (req, res) => {
    try {
      const daemonId = req.params.id;
      const pool = getPool();

      // Verify daemon exists
      const { rows: daemonRows } = await pool.query(
        "SELECT id FROM daemons WHERE id = $1",
        [daemonId],
      );
      if (daemonRows.length === 0) {
        res.status(404).json({ error: "Daemon not found" });
        return;
      }

      // Read raw binary
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks);

      if (body.length < 23) {
        res.status(400).json({ error: "File too small to be a valid FBX" });
        return;
      }
      if (body.length > MAX_FBX_SIZE) {
        res.status(400).json({ error: `File too large (max ${MAX_FBX_SIZE / 1024 / 1024}MB)` });
        return;
      }

      // Validate FBX binary magic bytes
      if (!body.subarray(0, FBX_BINARY_MAGIC.length).equals(FBX_BINARY_MAGIC)) {
        res.status(400).json({ error: "Invalid FBX file (bad magic bytes)" });
        return;
      }

      const originalFilename = (req.headers["x-original-filename"] as string) || "character.fbx";

      // Create asset upload record
      const { rows: uploadRows } = await pool.query(
        `INSERT INTO daemon_asset_uploads (upload_type, fbx_filename, daemon_id, conversion_status)
         VALUES ('character', $1, $2, 'ready')
         RETURNING id`,
        [originalFilename, daemonId],
      );
      const uploadId = uploadRows[0].id as string;

      // Write FBX to disk
      const dir = join(UPLOAD_DIR, uploadId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "model.fbx"), body);

      console.log(`[Daemon] Character FBX uploaded for ${daemonId}: ${uploadId} (${(body.length / 1024 / 1024).toFixed(2)} MB)`);

      // Notify DaemonManager to broadcast model update to all clients
      const dm = getActiveDaemonManager();
      if (dm) {
        dm.updateCharacterModel(daemonId, uploadId);
      }

      res.json({ success: true, uploadId, filename: originalFilename, size: body.length });
    } catch (err) {
      console.error("POST /api/daemons/:id/upload-character error:", err);
      res.status(500).json({ error: "Character upload failed" });
    }
  },
);

// GET /api/daemons/assets/:uploadId/model — Serve uploaded FBX file (character or emote)
router.get(
  "/assets/:uploadId/model",
  async (req, res) => {
    const dir = join(UPLOAD_DIR, req.params.uploadId);
    // Character uploads use model.fbx, emote uploads use emote.fbx
    const modelPath = join(dir, "model.fbx");
    const emotePath = join(dir, "emote.fbx");
    const filePath = existsSync(modelPath) ? modelPath : existsSync(emotePath) ? emotePath : null;
    if (!filePath) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=86400");
    createReadStream(filePath).pipe(res);
  },
);

export default router;
