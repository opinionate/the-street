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
import { StreetRoom } from "./rooms/StreetRoom.js";
import { StagingRoom } from "./rooms/StagingRoom.js";

import authRoutes from "./api/auth.js";
import plotRoutes from "./api/plots.js";
import generationRoutes from "./api/generation.js";
import assetRoutes from "./api/assets.js";
import metricsRoutes from "./api/metrics.js";
import moderationRoutes from "./api/moderation.js";

const API_PORT = parseInt(process.env.API_PORT || "3000", 10);
const COLYSEUS_PORT = parseInt(process.env.COLYSEUS_PORT || "2567", 10);

async function main(): Promise<void> {
  // Run database migrations
  const pool = getPool();
  await runMigrations(pool);
  console.log("Database migrations complete");

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
