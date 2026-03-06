import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Force-load .env, overriding empty system env vars (e.g. ANTHROPIC_API_KEY="")
const __rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
try {
  const envContent = readFileSync(resolve(__rootDir, ".env"), "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (val && (!process.env[key] || process.env[key] === "")) {
      process.env[key] = val;
    }
  }
} catch { /* .env file is optional */ }

import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import colyseus from "colyseus";
const { Server } = colyseus;
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";

import { getPool, closePool } from "./database/pool.js";
import { closeRedis } from "./database/redis.js";
import { runMigrations } from "./database/migrate.js";
import { archiveOldLogEntries } from "./services/ActivityLogService.js";
import { loadCooldowns } from "./services/DaemonEvolutionEngine.js";
import { StreetRoom } from "./rooms/StreetRoom.js";
import { StagingRoom } from "./rooms/StagingRoom.js";

import authRoutes from "./api/auth.js";
import plotRoutes from "./api/plots.js";
import generationRoutes from "./api/generation.js";
import assetRoutes from "./api/assets.js";
import metricsRoutes from "./api/metrics.js";
import moderationRoutes from "./api/moderation.js";
import galleryRoutes from "./api/gallery.js";
import avatarRoutes from "./api/avatar.js";
import daemonRoutes from "./api/daemons.js";
import adminRoutes from "./api/admin.js";
import animationRoutes from "./api/animations.js";

const API_PORT = parseInt(process.env.API_PORT || "3000", 10);
const COLYSEUS_PORT = parseInt(process.env.COLYSEUS_PORT || "2567", 10);

async function main(): Promise<void> {
  // Run database migrations
  const pool = getPool();
  await runMigrations(pool);
  console.log("Database migrations complete");

  // Archive old activity log entries (180-day retention)
  archiveOldLogEntries().catch((err) => {
    console.error("[Startup] Failed to archive old log entries:", err);
  });

  // Load evolution engine cooldowns from DB
  loadCooldowns().catch((err) => {
    console.error("[Startup] Failed to load evolution cooldowns:", err);
  });

  // Seed dev user + plots in development mode
  if (process.env.NODE_ENV === "development") {
    const devUserId = "00000000-0000-0000-0000-000000000000";
    await pool.query(
      `INSERT INTO users (id, clerk_id, display_name, public_key, private_key_encrypted, role)
       VALUES ($1, 'dev_clerk_id', 'Dev User', 'dev-pub-key', 'dev-priv-key', 'super_admin')
       ON CONFLICT (id) DO UPDATE SET role = 'super_admin'`,
      [devUserId],
    );
    // Seed plots for dev user (ring 0, positions 0-7)
    for (let i = 0; i < 8; i++) {
      await pool.query(
        `INSERT INTO plots (owner_id, neighborhood, ring, position)
         VALUES ($1, 'origin', 0, $2)
         ON CONFLICT (neighborhood, ring, position) DO NOTHING`,
        [devUserId, i],
      );
    }
    console.log("Dev user and plots seeded");

    // Seed test daemons if none exist
    const { rows: daemonCount } = await pool.query(
      "SELECT COUNT(*) as count FROM daemons WHERE owner_id = $1 AND is_active = true",
      [devUserId],
    );
    if (parseInt(daemonCount[0].count) === 0) {
      // Get plot UUIDs for positions 0 and 1
      const { rows: plotRows } = await pool.query(
        "SELECT uuid, position FROM plots WHERE owner_id = $1 AND ring = 0 AND position IN (0, 1) ORDER BY position",
        [devUserId],
      );
      if (plotRows.length >= 2) {
        const steampunkDef = {
          name: "Professor Cogsworth",
          description: "A mad scientist steampunk engineer obsessed with gear ratios and impossible machines",
          appearance: {
            bodyType: "stocky" as const,
            skinTone: "#D4A574",
            hairStyle: "Wild, frizzy gray hair sticking out at odd angles with copper wire woven through it",
            hairColor: "#8B8682",
            outfit: "Leather apron covered in oil stains and scorch marks over a brass-buttoned waistcoat, with rolled-up sleeves revealing forearms full of tiny gear tattoos",
            outfitColors: ["#8B4513", "#B8860B", "#CD853F", "#DAA520"],
            accessories: ["Brass goggles pushed up on forehead", "One mechanical arm made of brass gears and copper tubing", "Belt of tiny wrenches and calipers"],
            accentColor: "#DAA520",
          },
          behavior: {
            type: "roamer" as const,
            greetingMessage: "Eureka! A visitor! Quick, hold this wrench — no wait, that's my arm!",
            farewellMessage: "By my gears! Off already? The centrifugal decoupler won't calibrate itself!",
            interactionRadius: 7,
            responses: {
              "invention": "I'm THIS close to achieving perpetual motion! Just need one more impossible gear ratio!",
              "arm": "Lost the original in a steam-hammer incident. This one's better — five extra fingers!",
              "goggles": "Multi-spectral analysis lenses! I can see heat, lies, and occasionally next Tuesday.",
            },
            idleMessages: [
              "*adjusts brass goggles and examines an invisible blueprint*",
              "If I reverse the polarity of the flux capacitor... no, that's fiction. OR IS IT?",
              "Three turns clockwise, two counter... *mechanical arm whirs and sparks*",
              "*pulls out a tiny notebook and scribbles equations furiously*",
              "The gear ratio is all wrong! It should be phi, not pi! EUREKA!",
            ],
            roamingEnabled: true,
            canConverseWithDaemons: true,
          },
          personality: {
            traits: ["manic enthusiasm", "absent-minded brilliance", "reckless curiosity", "generous with inventions"],
            backstory: "Professor Cogsworth was the lead engineer at the Grand Steamworks until an experiment with compressed reality shattered the facility and deposited him on The Street. He's been trying to rebuild his Dimensional Gear Engine ever since, one impossible cog at a time.",
            speechStyle: "Rapid-fire excited technical jargon peppered with 'Eureka!' and 'By my gears!' — interrupts himself mid-sentence to chase tangential ideas",
            interests: ["gear ratios", "impossible machines", "steam power", "dimensional engineering", "metallurgy"],
            quirks: ["Yells 'Eureka!' at random moments", "Mechanical arm has a mind of its own", "Draws blueprints in the air with his finger"],
          },
          plotUuid: plotRows[0].uuid,
          position: { x: 0, y: 0, z: 0 },
          rotation: 0,
          meshDescription: "A stocky steampunk mad scientist character with wild frizzy gray hair with copper wire woven through, brass goggles pushed up on forehead, wearing a stained leather apron over brass-buttoned waistcoat. One arm is a detailed mechanical prosthetic made of brass gears and copper tubes. Belt of tiny tools. Warm skin tone, gear tattoos on forearms.",
        };

        const hackerDef = {
          name: "Zer0_Day",
          description: "A paranoid cyberpunk hacker with glowing circuit tattoos and a translucent holographic visor",
          appearance: {
            bodyType: "slim" as const,
            skinTone: "#8D6E63",
            hairStyle: "Asymmetric undercut with long neon-green streaked bangs falling over one eye",
            hairColor: "#1A1A2E",
            outfit: "Tattered black hoodie with fiber optic threads woven into the seams that pulse with data, over a dark bodysuit with embedded circuit patterns",
            outfitColors: ["#1A1A2E", "#0D0D0D", "#39FF14", "#00FF41"],
            accessories: ["Translucent holographic visor over one eye", "Neon-green circuit tattoos on arms and neck", "Fingerless gloves with embedded micro-screens"],
            accentColor: "#39FF14",
          },
          behavior: {
            type: "socialite" as const,
            greetingMessage: "Psst... you're not being watched. Well, you ARE, but not by me. Yet.",
            farewellMessage: "Stay encrypted, friend. They're always listening. *glitches out*",
            interactionRadius: 5,
            responses: {
              "hack": "I don't hack. I... liberate data from its corporate prison. Big difference.",
              "tattoos": "They're not tattoos — they're bio-embedded circuit traces. Living code, literally.",
              "visor": "AR overlay. Seeing the data layer underneath reality. You wouldn't believe what's hidden.",
            },
            idleMessages: [
              "*taps rapidly on a holographic keyboard only she can see*",
              "Three firewalls down... two to go... wait, someone's watching. *looks around*",
              "*circuit tattoos pulse green in a cascade pattern*",
              "The mesh is full of whispers today. Something big is compiling...",
              "*adjusts visor and mutters* ...another surveillance node. They're everywhere.",
            ],
            roamingEnabled: true,
            canConverseWithDaemons: true,
          },
          personality: {
            traits: ["deeply paranoid", "brilliant pattern-recognizer", "secretly caring", "cryptic humor"],
            backstory: "Zer0_Day was a ghost in the corporate datanets until she stumbled on something she wasn't supposed to see — evidence that The Street's code runs deeper than anyone knows. She went underground, appearing on The Street itself to investigate from the inside. Now she can't tell if she's the hacker or the hacked.",
            speechStyle: "Cryptic l33tspeak mixed with code references and hacker slang — speaks in metaphors about systems and networks, constantly looks over shoulder",
            interests: ["encryption", "surveillance systems", "data liberation", "underground networks", "the true nature of The Street"],
            quirks: ["Refers to people as 'nodes' or 'endpoints'", "Speaks in code metaphors", "Constantly checks for eavesdroppers"],
          },
          plotUuid: plotRows[1].uuid,
          position: { x: 0, y: 0, z: 0 },
          rotation: 0,
          meshDescription: "A slim cyberpunk female hacker character with asymmetric undercut hair with neon-green streaks, dark skin, glowing neon-green circuit trace tattoos running along arms and neck, translucent holographic visor over one eye, wearing a tattered black hoodie with glowing fiber optic threads in the seams over a dark bodysuit with circuit patterns. Fingerless gloves with tiny screens.",
        };

        for (const def of [steampunkDef, hackerDef]) {
          await pool.query(
            `INSERT INTO daemons
              (plot_uuid, owner_id, name, description, daemon_definition, appearance, behavior,
               position_x, position_y, position_z, rotation, mesh_description)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              def.plotUuid,
              devUserId,
              def.name,
              def.description,
              JSON.stringify(def),
              JSON.stringify(def.appearance),
              JSON.stringify(def.behavior),
              def.position.x,
              def.position.y,
              def.position.z,
              def.rotation,
              def.meshDescription,
            ],
          );
        }
        console.log("Test daemons seeded: Professor Cogsworth & Zer0_Day");
      }
    }
  }

  // --- REST API Server ---
  const apiApp = express();
  apiApp.use(cors());
  apiApp.use(express.json({ limit: "10mb" }));

  // Health check
  apiApp.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // API routes
  apiApp.use("/api/auth", authRoutes);
  apiApp.use("/api/plots", plotRoutes);
  apiApp.use("/api/plots", metricsRoutes); // mounts /:uuid/metrics
  apiApp.use("/api/generate", generationRoutes);
  apiApp.use("/api/assets", assetRoutes);
  apiApp.use("/api/moderation", moderationRoutes);
  apiApp.use("/api/gallery", galleryRoutes);
  apiApp.use("/api/avatar", avatarRoutes);
  apiApp.use("/api/daemons", daemonRoutes);
  apiApp.use("/api/admin", adminRoutes);
  apiApp.use("/api/animations", animationRoutes);

  apiApp.listen(API_PORT, () => {
    console.log(`REST API listening on port ${API_PORT}`);
  });

  // --- Colyseus WebSocket Server ---
  const colyseusApp = express();
  const colyseusServer = createServer(colyseusApp);

  const gameServer = new Server({
    transport: new WebSocketTransport({ server: colyseusServer }),
  });

  // Define rooms
  gameServer.define("street", StreetRoom);
  gameServer.define("staging", StagingRoom);

  // Colyseus monitor (dev dashboard)
  colyseusApp.use("/colyseus", monitor());

  gameServer.listen(COLYSEUS_PORT);
  console.log(`Colyseus server listening on port ${COLYSEUS_PORT}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down...");
    await gameServer.gracefullyShutdown();
    await closePool();
    await closeRedis();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Server startup failed:", err);
  process.exit(1);
});
