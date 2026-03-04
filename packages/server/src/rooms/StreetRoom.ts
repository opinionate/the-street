import colyseus from "colyseus";
const { Room } = colyseus;
type Client = InstanceType<typeof colyseus.Room>["clients"] extends { toArray(): (infer C)[] } ? C : any;
import { Schema, MapSchema, defineTypes } from "@colyseus/schema";
import { getPool } from "../database/pool.js";
import { checkChatRateLimit } from "../middleware/rate-limit.js";
import {
  MAX_CLIENTS,
  TICK_RATE,
  CHAT_RADIUS,
  POSITION_SAVE_INTERVAL,
  getDefaultSpawnPoint,
  getPlotPosition,
  V1_CONFIG,
} from "@the-street/shared";
import type {
  Vector3,
  PlayerState as IPlayerState,
  PlotSnapshot,
  WorldObject,
  AvatarDefinition,
} from "@the-street/shared";
import { DaemonManager } from "../daemons/DaemonManager.js";

// Colyseus schema for syncing player state
export class PlayerSchema extends Schema {
  userId: string = "";
  displayName: string = "";
  avatarIndex: number = 0;
  posX: number = 0;
  posY: number = 0;
  posZ: number = 0;
  rotation: number = 0;
  velX: number = 0;
  velY: number = 0;
  velZ: number = 0;
}
defineTypes(PlayerSchema, {
  userId: "string",
  displayName: "string",
  avatarIndex: "number",
  posX: "number",
  posY: "number",
  posZ: "number",
  rotation: "number",
  velX: "number",
  velY: "number",
  velZ: "number",
});

export class StreetRoomState extends Schema {
  players = new MapSchema<PlayerSchema>();
}
defineTypes(StreetRoomState, {
  players: { map: PlayerSchema },
});

// Max movement speed in units/tick for anti-cheat
const MAX_SPEED = 15; // units per tick at 20Hz

interface ClientAuth {
  userId: string;
  clerkId: string;
  displayName: string;
  avatarIndex: number;
  lastPosition: Vector3 | null;
}

// Track which plot a player is currently on
interface PlotVisit {
  plotUuid: string;
  metricsId: string;
  enteredAt: Date;
}

// Module-level reference so the REST API can reach the daemon manager
let activeDaemonManager: DaemonManager | null = null;
export function getActiveDaemonManager(): DaemonManager | null {
  return activeDaemonManager;
}

export class StreetRoom extends Room<StreetRoomState> {
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private saveInterval: ReturnType<typeof setInterval> | null = null;
  private daemonSaveInterval: ReturnType<typeof setInterval> | null = null;
  private playerVisits = new Map<string, PlotVisit | null>();
  private plotCache: PlotSnapshot[] = [];
  private daemonManager: DaemonManager | null = null;

  override maxClients = MAX_CLIENTS;

  override onCreate(): void {
    this.setState(new StreetRoomState());

    // Register message handlers
    this.onMessage("move", (client, data) => this.handleMove(client, data));
    this.onMessage("chat", (client, data) => this.handleChat(client, data));
    this.onMessage("interact", (client, data) =>
      this.handleInteract(client, data),
    );
    this.onMessage("object_place", (client, data) =>
      this.handleObjectPlace(client, data),
    );
    this.onMessage("object_remove", (client, data) =>
      this.handleObjectRemove(client, data),
    );
    this.onMessage("object_update_state", (client, data) =>
      this.handleObjectUpdateState(client, data),
    );
    this.onMessage("daemon_interact", (client, data) =>
      this.handleDaemonInteract(client, data),
    );
    this.onMessage("daemon_recall", (client, data) =>
      this.handleDaemonRecall(client, data),
    );
    this.onMessage("daemon_toggle_roam", (client, data) =>
      this.handleDaemonToggleRoam(client, data),
    );

    // Initialize daemon manager
    this.daemonManager = new DaemonManager(
      (type, data) => this.broadcast(type, data),
      (sessionId, type, data) => {
        const client = this.clients.find((c) => c.sessionId === sessionId);
        if (client) client.send(type, data);
      },
    );
    activeDaemonManager = this.daemonManager;

    // Server tick at 20Hz
    this.tickInterval = setInterval(() => this.tick(), 1000 / TICK_RATE);

    // Save positions every 30 seconds
    this.saveInterval = setInterval(
      () => this.saveAllPositions(),
      POSITION_SAVE_INTERVAL * 1000,
    );

    // Save daemon state every 60 seconds
    this.daemonSaveInterval = setInterval(
      () => this.daemonManager?.saveState().catch(() => {}),
      60_000,
    );

    // Load plot cache and daemons
    this.loadPlots()
      .then(() => this.loadDaemons())
      .then(() => this.daemonManager?.loadSavedState())
      .catch((err) => console.error("Failed to load plots/daemons:", err));
  }

  override async onAuth(
    _client: Client,
    options: { token: string },
  ): Promise<ClientAuth> {
    // Dev bypass — skip Clerk auth in development
    if (process.env.NODE_ENV === "development" || !process.env.CLERK_SECRET_KEY) {
      return {
        userId: "00000000-0000-0000-0000-000000000000",
        clerkId: "dev_clerk_id",
        displayName: "Dev User",
        avatarIndex: 0,
        lastPosition: null,
      };
    }

    if (!options?.token) {
      throw new Error("Authentication required");
    }

    const pool = getPool();

    const { verifyToken } = await import("@clerk/express");
    const payload = await verifyToken(options.token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });

    const clerkId = payload.sub;
    const { rows } = await pool.query(
      "SELECT id, display_name, avatar_definition, last_position FROM users WHERE clerk_id = $1",
      [clerkId],
    );

    if (rows.length === 0) {
      throw new Error("User not registered");
    }

    const user = rows[0];
    return {
      userId: user.id,
      clerkId,
      displayName: user.display_name,
      avatarIndex: user.avatar_definition?.avatarIndex ?? 0,
      lastPosition: user.last_position,
    };
  }

  override onJoin(client: Client, _options?: unknown, auth?: ClientAuth): void {
    if (!auth) return;
    const spawn = auth.lastPosition ?? getDefaultSpawnPoint();
    const player = new PlayerSchema();
    player.userId = auth.userId;
    player.displayName = auth.displayName;
    player.avatarIndex = auth.avatarIndex;
    player.posX = spawn.x;
    player.posY = spawn.y;
    player.posZ = spawn.z;
    player.rotation = 0;

    this.state.players.set(client.sessionId, player);
    this.playerVisits.set(client.sessionId, null);

    // Send world snapshot to joining client
    const players: IPlayerState[] = [];
    this.state.players.forEach((p: PlayerSchema) => {
      players.push({
        userId: p.userId,
        displayName: p.displayName,
        avatarDefinition: { avatarIndex: p.avatarIndex },
        position: { x: p.posX, y: p.posY, z: p.posZ },
        rotation: p.rotation,
        velocity: { x: p.velX, y: p.velY, z: p.velZ },
      });
    });

    client.send("world_snapshot", {
      type: "world_snapshot" as const,
      players,
      plots: this.plotCache,
      daemons: this.daemonManager?.getDaemonStates() || [],
    });

    // Broadcast join to others
    this.broadcast(
      "player_join",
      {
        type: "player_join" as const,
        player: {
          userId: auth.userId,
          displayName: auth.displayName,
          avatarDefinition: { avatarIndex: auth.avatarIndex },
          position: spawn,
          rotation: 0,
          velocity: { x: 0, y: 0, z: 0 },
        },
      },
      { except: client },
    );

    // Update last_seen
    getPool()
      .query("UPDATE users SET last_seen_at = now() WHERE id = $1", [
        auth.userId,
      ])
      .catch(() => {});
  }

  override async onLeave(
    client: Client,
    _consented: boolean,
  ): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Save final position
    await this.savePlayerPosition(player);

    // Close any active plot visit
    await this.exitPlot(client.sessionId);

    // Broadcast leave
    this.broadcast("player_leave", {
      type: "player_leave" as const,
      userId: player.userId,
    });

    this.state.players.delete(client.sessionId);
    this.playerVisits.delete(client.sessionId);
  }

  override async onDispose(): Promise<void> {
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.saveInterval) clearInterval(this.saveInterval);
    if (this.daemonSaveInterval) clearInterval(this.daemonSaveInterval);
    // Save daemon state before shutdown
    await this.daemonManager?.saveState().catch((err) =>
      console.error("Failed to save daemon state:", err),
    );
    activeDaemonManager = null;
  }

  private handleMove(
    client: Client,
    data: { position: Vector3; rotation: number },
  ): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Anti-cheat: reject impossible movement speeds
    const dx = data.position.x - player.posX;
    const dy = data.position.y - player.posY;
    const dz = data.position.z - player.posZ;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > MAX_SPEED) return;

    // Update position
    player.posX = data.position.x;
    player.posY = data.position.y;
    player.posZ = data.position.z;
    player.rotation = data.rotation;

    // Broadcast to other clients
    this.broadcast(
      "player_move",
      {
        type: "player_move" as const,
        userId: player.userId,
        position: data.position,
        rotation: data.rotation,
      },
      { except: client },
    );

    // Track plot entry/exit
    this.updatePlotVisit(client.sessionId, data.position).catch(() => {});
  }

  private async handleChat(
    client: Client,
    data: { content: string },
  ): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Rate limit: 1 message/second
    const allowed = await checkChatRateLimit(player.userId);
    if (!allowed) return; // silently drop

    if (!data.content || data.content.length > 500) return;

    const senderPos = { x: player.posX, y: player.posY, z: player.posZ };

    // Store chat message
    getPool()
      .query(
        `INSERT INTO chat_messages (sender_id, content, position_x, position_y, position_z, neighborhood, ring)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          player.userId,
          data.content,
          senderPos.x,
          senderPos.y,
          senderPos.z,
          "origin",
          0,
        ],
      )
      .catch(() => {});

    // Broadcast to clients within chat radius
    const chatMsg = {
      type: "chat" as const,
      senderId: player.userId,
      senderName: player.displayName,
      content: data.content,
      position: senderPos,
    };

    this.clients.forEach((c) => {
      const other = this.state.players.get(c.sessionId);
      if (!other) return;
      const d = Math.sqrt(
        (other.posX - senderPos.x) ** 2 +
          (other.posY - senderPos.y) ** 2 +
          (other.posZ - senderPos.z) ** 2,
      );
      if (d <= CHAT_RADIUS) {
        c.send("chat", chatMsg);
      }
    });

    // Let daemons overhear nearby chat
    if (this.daemonManager) {
      this.daemonManager.onPlayerChat(
        player.userId,
        player.displayName,
        data.content,
        senderPos,
      );
    }
  }

  private handleInteract(
    client: Client,
    data: { objectId: string; interaction: string },
  ): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Validate interaction and broadcast state change
    this.broadcast("object_state_change", {
      type: "object_state_change" as const,
      objectId: data.objectId,
      stateData: { interaction: data.interaction, triggeredBy: player.userId },
    });
  }

  private async handleObjectPlace(
    client: Client,
    data: { plotUUID: string; objectDefinition: WorldObject },
  ): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const pool = getPool();

    // Verify plot ownership
    const { rows } = await pool.query(
      "SELECT uuid FROM plots WHERE uuid = $1 AND owner_id = $2",
      [data.plotUUID, player.userId],
    );
    if (rows.length === 0) return;

    const obj = data.objectDefinition;
    const result = await pool.query(
      `INSERT INTO world_objects
        (plot_uuid, name, description, tags, object_definition, render_cost,
         origin_x, origin_y, origin_z,
         scale_x, scale_y, scale_z,
         rotation_x, rotation_y, rotation_z, rotation_w,
         asset_hash, modified_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id`,
      [
        data.plotUUID,
        obj.name,
        obj.description,
        obj.tags,
        JSON.stringify(obj),
        obj.renderCost,
        obj.origin.x,
        obj.origin.y,
        obj.origin.z,
        obj.scale.x,
        obj.scale.y,
        obj.scale.z,
        obj.rotation.x,
        obj.rotation.y,
        obj.rotation.z,
        obj.rotation.w,
        obj.meshDefinition.type === "novel"
          ? obj.meshDefinition.assetHash
          : null,
        player.userId,
      ],
    );

    this.broadcast("object_placed", {
      type: "object_placed" as const,
      objectId: result.rows[0].id,
      plotUUID: data.plotUUID,
      objectDefinition: obj,
    });
  }

  private async handleObjectRemove(
    client: Client,
    data: { objectId: string },
  ): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const pool = getPool();

    // Verify ownership via plot
    const { rows } = await pool.query(
      `SELECT wo.id FROM world_objects wo
       JOIN plots p ON p.uuid = wo.plot_uuid
       WHERE wo.id = $1 AND p.owner_id = $2`,
      [data.objectId, player.userId],
    );
    if (rows.length === 0) return;

    await pool.query("DELETE FROM world_objects WHERE id = $1", [
      data.objectId,
    ]);

    this.broadcast("object_removed", {
      type: "object_removed" as const,
      objectId: data.objectId,
    });
  }

  private async handleObjectUpdateState(
    client: Client,
    data: { objectId: string; stateKey: string; stateValue: unknown },
  ): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Validate stateKey to prevent path injection
    if (!/^[a-zA-Z0-9_]+$/.test(data.stateKey)) return;

    const pool = getPool();
    await pool.query(
      `UPDATE world_objects
       SET state_data = jsonb_set(state_data, $2::text[], $3::jsonb),
           modified_at = now(), modified_by = $4
       WHERE id = $1`,
      [
        data.objectId,
        [data.stateKey],
        JSON.stringify(data.stateValue),
        player.userId,
      ],
    );

    this.broadcast("object_state_change", {
      type: "object_state_change" as const,
      objectId: data.objectId,
      stateData: { [data.stateKey]: data.stateValue },
    });
  }

  private async loadDaemons(): Promise<void> {
    if (!this.daemonManager) return;
    const plotUuids = this.plotCache.map((p) => p.uuid);
    await this.daemonManager.loadDaemons(plotUuids);
  }

  private handleDaemonInteract(
    client: Client,
    data: { daemonId: string; message?: string },
  ): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !this.daemonManager) return;
    this.daemonManager.handleInteract(data.daemonId, player.userId, client.sessionId, data.message, player.displayName);
  }

  private async handleDaemonRecall(
    client: Client,
    data: { daemonId: string },
  ): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player || !this.daemonManager) return;

    // Verify ownership
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT id FROM daemons WHERE id = $1 AND owner_id = $2",
      [data.daemonId, player.userId],
    );
    if (rows.length === 0) return;

    this.daemonManager.recallDaemon(data.daemonId);
  }

  private async handleDaemonToggleRoam(
    client: Client,
    data: { daemonId: string; enabled: boolean },
  ): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player || !this.daemonManager) return;

    // Verify ownership
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT id FROM daemons WHERE id = $1 AND owner_id = $2",
      [data.daemonId, player.userId],
    );
    if (rows.length === 0) return;

    this.daemonManager.setRoaming(data.daemonId, data.enabled);
  }

  private tick(): void {
    // Batch position updates are handled by Colyseus schema sync

    // Tick daemons
    if (this.daemonManager) {
      const players: { userId: string; position: Vector3; sessionId: string; displayName?: string }[] = [];
      this.state.players.forEach((p: PlayerSchema, sessionId: string) => {
        players.push({
          userId: p.userId,
          position: { x: p.posX, y: p.posY, z: p.posZ },
          sessionId,
          displayName: p.displayName,
        });
      });
      this.daemonManager.tick(1 / TICK_RATE, players);
    }
  }

  private async loadPlots(): Promise<void> {
    const pool = getPool();
    const { rows: plots } = await pool.query(
      `SELECT p.uuid, p.owner_id, p.neighborhood, p.ring, p.position,
              u.display_name as owner_name
       FROM plots p JOIN users u ON u.id = p.owner_id
       WHERE p.neighborhood = 'origin' AND p.ring = 0
       ORDER BY p.position`,
    );

    this.plotCache = await Promise.all(
      plots.map(async (plot) => {
        const { rows: objects } = await pool.query(
          "SELECT object_definition FROM world_objects WHERE plot_uuid = $1",
          [plot.uuid],
        );

        const placement = getPlotPosition(plot.position, V1_CONFIG);
        return {
          uuid: plot.uuid,
          ownerId: plot.owner_id,
          ownerName: plot.owner_name,
          neighborhood: plot.neighborhood,
          ring: plot.ring,
          position: plot.position,
          placement,
          objects: objects.map(
            (o: { object_definition: WorldObject }) => o.object_definition,
          ),
        };
      }),
    );
  }

  private async savePlayerPosition(player: PlayerSchema): Promise<void> {
    const pos = {
      x: player.posX,
      y: player.posY,
      z: player.posZ,
      rotation: player.rotation,
    };
    await getPool().query(
      "UPDATE users SET last_position = $1, last_seen_at = now() WHERE id = $2",
      [JSON.stringify(pos), player.userId],
    );
  }

  private async saveAllPositions(): Promise<void> {
    const promises: Promise<void>[] = [];
    this.state.players.forEach((player: PlayerSchema) => {
      promises.push(this.savePlayerPosition(player));
    });
    await Promise.allSettled(promises);
  }

  private async updatePlotVisit(
    sessionId: string,
    position: Vector3,
  ): Promise<void> {
    const player = this.state.players.get(sessionId);
    if (!player) return;

    // Determine which plot the player is in (if any)
    const currentPlotUuid = this.findPlotAtPosition(position);
    const currentVisit = this.playerVisits.get(sessionId);

    if (currentVisit?.plotUuid === currentPlotUuid) return;

    // Exited previous plot
    if (currentVisit) {
      await this.exitPlot(sessionId);
    }

    // Entered new plot
    if (currentPlotUuid) {
      await this.enterPlot(sessionId, currentPlotUuid, player.userId);
    }
  }

  private findPlotAtPosition(position: Vector3): string | null {
    for (const plot of this.plotCache) {
      const p = plot.placement;
      const dx = position.x - p.position.x;
      const dz = position.z - p.position.z;
      // Rotate world-space offset into the plot's local frame
      const cos = Math.cos(-p.rotation);
      const sin = Math.sin(-p.rotation);
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      if (
        Math.abs(localX) <= p.bounds.width / 2 &&
        Math.abs(localZ) <= p.bounds.depth / 2
      ) {
        return plot.uuid;
      }
    }
    return null;
  }

  private async enterPlot(
    sessionId: string,
    plotUuid: string,
    visitorId: string,
  ): Promise<void> {
    const pool = getPool();

    // Check if this is a repeat visit
    const { rows } = await pool.query(
      "SELECT id FROM plot_metrics WHERE plot_uuid = $1 AND visitor_id = $2 LIMIT 1",
      [plotUuid, visitorId],
    );
    const isRepeat = rows.length > 0;

    const result = await pool.query(
      `INSERT INTO plot_metrics (plot_uuid, visitor_id, entered_at, visit_type)
       VALUES ($1, $2, now(), $3) RETURNING id`,
      [plotUuid, visitorId, isRepeat ? "repeat" : "normal"],
    );

    this.playerVisits.set(sessionId, {
      plotUuid,
      metricsId: result.rows[0].id,
      enteredAt: new Date(),
    });
  }

  private async exitPlot(sessionId: string): Promise<void> {
    const visit = this.playerVisits.get(sessionId);
    if (!visit) return;

    const dwellSeconds = Math.floor(
      (Date.now() - visit.enteredAt.getTime()) / 1000,
    );
    const visitType = dwellSeconds < 5 ? "rapid_exit" : undefined;

    const pool = getPool();
    const updates = ["exited_at = now()", "dwell_seconds = $2"];
    const params: unknown[] = [visit.metricsId, dwellSeconds];

    if (visitType) {
      updates.push("visit_type = $3");
      params.push(visitType);
    }

    await pool.query(
      `UPDATE plot_metrics SET ${updates.join(", ")} WHERE id = $1`,
      params,
    );

    this.playerVisits.set(sessionId, null);
  }
}
