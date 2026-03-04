import { getPool } from "../database/pool.js";
import type {
  DaemonState,
  DaemonDefinition,
  DaemonBehavior,
  Vector3,
} from "@the-street/shared";

interface PlayerInfo {
  userId: string;
  position: Vector3;
  sessionId: string;
}

interface DaemonInstance {
  state: DaemonState;
  behavior: DaemonBehavior;
  greetCooldowns: Map<string, number>; // userId -> last greet timestamp
  idleTimer: number;
  patrolIndex: number;
}

type BroadcastFn = (type: string, data: unknown) => void;

export class DaemonManager {
  private daemons = new Map<string, DaemonInstance>();
  private broadcast: BroadcastFn;
  private sendToClient: (sessionId: string, type: string, data: unknown) => void;
  private plotUuids: string[] = [];

  constructor(
    broadcast: BroadcastFn,
    sendToClient: (sessionId: string, type: string, data: unknown) => void,
  ) {
    this.broadcast = broadcast;
    this.sendToClient = sendToClient;
  }

  async loadDaemons(plotUuids: string[]): Promise<void> {
    this.plotUuids = plotUuids;
    const pool = getPool();

    const placeholders = plotUuids.map((_, i) => `$${i + 1}`).join(",");
    if (plotUuids.length === 0) return;

    const { rows } = await pool.query(
      `SELECT id, plot_uuid, name, description, daemon_definition, appearance, behavior,
              position_x, position_y, position_z, rotation
       FROM daemons WHERE plot_uuid IN (${placeholders}) AND is_active = true`,
      plotUuids,
    );

    for (const row of rows) {
      const definition: DaemonDefinition = row.daemon_definition;
      const behavior: DaemonBehavior = row.behavior;

      const state: DaemonState = {
        daemonId: row.id,
        definition,
        currentPosition: { x: row.position_x, y: row.position_y, z: row.position_z },
        currentRotation: row.rotation,
        currentAction: "idle",
      };

      this.daemons.set(row.id, {
        state,
        behavior,
        greetCooldowns: new Map(),
        idleTimer: Math.random() * 15, // stagger idle chatter
        patrolIndex: 0,
      });
    }
  }

  getDaemonStates(): DaemonState[] {
    return Array.from(this.daemons.values()).map((d) => d.state);
  }

  tick(dt: number, players: PlayerInfo[]): void {
    for (const [_daemonId, daemon] of this.daemons) {
      switch (daemon.behavior.type) {
        case "greeter":
          this.tickGreeter(daemon, dt, players);
          break;
        case "shopkeeper":
          this.tickShopkeeper(daemon, dt, players);
          break;
        case "guide":
          this.tickGuide(daemon, dt, players);
          break;
        case "guard":
          this.tickGuard(daemon, dt, players);
          break;
      }

      // Idle chatter (all types)
      this.tickIdleChatter(daemon, dt, players);
    }
  }

  handleInteract(daemonId: string, playerId: string, playerSessionId: string): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) return;

    const behavior = daemon.behavior;

    // Shopkeeper / guard respond to direct interaction
    if (behavior.responses) {
      // Send a generic interaction response
      const keys = Object.keys(behavior.responses);
      const responseKey = keys.length > 0 ? keys[0] : null;
      const response = responseKey ? behavior.responses[responseKey] : behavior.greetingMessage;

      if (response) {
        daemon.state.currentAction = "talking";
        daemon.state.targetPlayerId = playerId;

        this.broadcast("daemon_chat", {
          type: "daemon_chat" as const,
          daemonId: daemon.state.daemonId,
          daemonName: daemon.state.definition.name,
          content: response,
          targetUserId: playerId,
        });

        // Return to idle after a delay
        setTimeout(() => {
          daemon.state.currentAction = "idle";
          daemon.state.targetPlayerId = undefined;
        }, 3000);
      }
    } else if (behavior.greetingMessage) {
      this.broadcast("daemon_chat", {
        type: "daemon_chat" as const,
        daemonId: daemon.state.daemonId,
        daemonName: daemon.state.definition.name,
        content: behavior.greetingMessage,
        targetUserId: playerId,
      });
    }
  }

  private tickGreeter(daemon: DaemonInstance, _dt: number, players: PlayerInfo[]): void {
    const radius = daemon.behavior.interactionRadius;
    const now = Date.now();
    const COOLDOWN_MS = 30_000; // 30 second cooldown per player

    for (const player of players) {
      const dist = this.distance(daemon.state.currentPosition, player.position);
      if (dist > radius) continue;

      const lastGreet = daemon.greetCooldowns.get(player.userId) || 0;
      if (now - lastGreet < COOLDOWN_MS) continue;

      // Greet this player
      daemon.greetCooldowns.set(player.userId, now);
      daemon.state.currentAction = "waving";
      daemon.state.targetPlayerId = player.userId;

      const message = daemon.behavior.greetingMessage || `Hello, traveler!`;
      this.broadcast("daemon_chat", {
        type: "daemon_chat" as const,
        daemonId: daemon.state.daemonId,
        daemonName: daemon.state.definition.name,
        content: message,
        targetUserId: player.userId,
      });

      // Return to idle
      setTimeout(() => {
        daemon.state.currentAction = "idle";
        daemon.state.targetPlayerId = undefined;
      }, 3000);

      break; // greet one player at a time
    }
  }

  private tickShopkeeper(daemon: DaemonInstance, _dt: number, _players: PlayerInfo[]): void {
    // Shopkeepers are reactive — they respond via handleInteract
    // Just ensure they face nearest player
    // (no-op for now, interaction-driven)
  }

  private tickGuide(daemon: DaemonInstance, dt: number, players: PlayerInfo[]): void {
    const path = daemon.behavior.patrolPath;
    if (!path || path.length < 2) {
      // No patrol path — act like a greeter
      this.tickGreeter(daemon, dt, players);
      return;
    }

    const target = path[daemon.patrolIndex];
    const pos = daemon.state.currentPosition;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.5) {
      // Reached waypoint — advance
      daemon.patrolIndex = (daemon.patrolIndex + 1) % path.length;
      daemon.state.currentAction = "idle";
    } else {
      // Move toward waypoint
      const speed = 2; // units per second
      const step = Math.min(speed * dt, dist);
      pos.x += (dx / dist) * step;
      pos.z += (dz / dist) * step;
      daemon.state.currentRotation = Math.atan2(-dx, -dz);
      daemon.state.currentAction = "walking";

      this.broadcast("daemon_move", {
        type: "daemon_move" as const,
        daemonId: daemon.state.daemonId,
        position: pos,
        rotation: daemon.state.currentRotation,
        action: "walking",
      });
    }

    // Also greet nearby players while patrolling
    this.tickGreeter(daemon, dt, players);
  }

  private tickGuard(daemon: DaemonInstance, _dt: number, players: PlayerInfo[]): void {
    const radius = daemon.behavior.interactionRadius;
    const now = Date.now();
    const COOLDOWN_MS = 60_000;

    for (const player of players) {
      const dist = this.distance(daemon.state.currentPosition, player.position);
      if (dist > radius) continue;

      const lastWarn = daemon.greetCooldowns.get(player.userId) || 0;
      if (now - lastWarn < COOLDOWN_MS) continue;

      daemon.greetCooldowns.set(player.userId, now);
      const message = daemon.behavior.greetingMessage || "Halt! This area is being watched.";

      this.broadcast("daemon_chat", {
        type: "daemon_chat" as const,
        daemonId: daemon.state.daemonId,
        daemonName: daemon.state.definition.name,
        content: message,
        targetUserId: player.userId,
      });

      break;
    }
  }

  private tickIdleChatter(daemon: DaemonInstance, dt: number, players: PlayerInfo[]): void {
    if (!daemon.behavior.idleMessages || daemon.behavior.idleMessages.length === 0) return;
    if (daemon.state.currentAction !== "idle") return;

    daemon.idleTimer -= dt;
    if (daemon.idleTimer > 0) return;

    // Only chatter if a player is somewhat nearby
    const hasNearby = players.some(
      (p) => this.distance(daemon.state.currentPosition, p.position) < daemon.behavior.interactionRadius * 2,
    );
    if (!hasNearby) {
      daemon.idleTimer = 10;
      return;
    }

    // Pick random idle message
    const msgs = daemon.behavior.idleMessages;
    const msg = msgs[Math.floor(Math.random() * msgs.length)];

    this.broadcast("daemon_chat", {
      type: "daemon_chat" as const,
      daemonId: daemon.state.daemonId,
      daemonName: daemon.state.definition.name,
      content: msg,
    });

    daemon.idleTimer = 15 + Math.random() * 20; // 15-35 seconds between idle chatter
  }

  private distance(a: Vector3, b: Vector3): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
