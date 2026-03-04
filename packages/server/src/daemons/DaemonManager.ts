import { getPool } from "../database/pool.js";
import type {
  DaemonState,
  DaemonDefinition,
  DaemonBehavior,
  DaemonMood,
  DaemonAction,
  Vector3,
} from "@the-street/shared";
import { V1_CONFIG, getStreetPosition } from "@the-street/shared";

interface PlayerInfo {
  userId: string;
  position: Vector3;
  sessionId: string;
  displayName?: string;
}

interface ConversationMemory {
  playerId: string;
  playerName: string;
  messages: { role: "player" | "daemon"; content: string }[];
  lastInteraction: number;
}

interface DaemonDaemonConversation {
  otherDaemonId: string;
  lastConversation: number;
  isActive: boolean;
  pendingLines: Array<{ speakerDaemonId: string; message: string; mood: DaemonMood; delay: number }>;
  lineIndex: number;
  lineTimer: number;
}

interface DaemonInstance {
  state: DaemonState;
  behavior: DaemonBehavior;
  greetCooldowns: Map<string, number>;
  idleTimer: number;
  patrolIndex: number;
  // Personality & agency
  conversationMemory: Map<string, ConversationMemory>; // playerId -> memory
  moodTimer: number;         // countdown to mood shift
  moodDecayTimer: number;    // time since last interaction (boredom builds)
  // Roaming
  roamTarget: Vector3 | null;
  roamWaitTimer: number;     // pause at destination
  roamHomeTimer: number;     // periodic return home
  isReturningHome: boolean;
  // Daemon-daemon
  daemonConversations: Map<string, DaemonDaemonConversation>; // otherDaemonId -> state
  conversationCooldown: number; // global cooldown before seeking new conversation
  // Overhear
  lastOverhearReaction: number;
  // Control
  isMuted: boolean;
  isRecalled: boolean;
}

type BroadcastFn = (type: string, data: unknown) => void;

// Rate limit AI calls per daemon
const AI_COOLDOWN_MS = 5_000;      // Min 5s between AI responses per daemon
const DAEMON_CHAT_COOLDOWN_MS = 120_000; // 2 min between daemon-daemon conversations (per pair)
const ROAM_SPEED = 1.5;            // units per second
const ROAM_PAUSE_MIN = 8;          // seconds to pause at destination
const ROAM_PAUSE_MAX = 20;
const ROAM_HOME_INTERVAL = 120;    // return home every 2 minutes
const MOOD_DECAY_INTERVAL = 60;    // mood trends toward bored after 60s of no interaction
const CONVERSATION_EXCHANGES = 3;  // lines per daemon in a conversation
const OVERHEAR_CHANCE = 0.15;      // 15% chance a daemon reacts to nearby chat
const OVERHEAR_COOLDOWN_MS = 30_000; // 30s cooldown per daemon for overhear reactions

export class DaemonManager {
  private daemons = new Map<string, DaemonInstance>();
  private broadcast: BroadcastFn;
  private sendToClient: (sessionId: string, type: string, data: unknown) => void;
  private plotUuids: string[] = [];
  private lastAiCall = new Map<string, number>(); // daemonId -> timestamp
  private aiConversationQueue: Array<() => Promise<void>> = [];
  private processingAi = false;

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

      // Ensure personality exists (backwards compat with pre-personality daemons)
      if (!definition.personality) {
        definition.personality = {
          traits: ["friendly"],
          backstory: `${definition.name} is a resident of The Street.`,
          speechStyle: "casual",
          interests: ["the street"],
          quirks: [],
        };
      }

      const state: DaemonState = {
        daemonId: row.id,
        definition,
        currentPosition: { x: row.position_x, y: row.position_y, z: row.position_z },
        currentRotation: row.rotation,
        currentAction: "idle",
        mood: "neutral",
      };

      this.daemons.set(row.id, this.createInstance(state, behavior));
    }
  }

  private createInstance(state: DaemonState, behavior: DaemonBehavior): DaemonInstance {
    return {
      state,
      behavior,
      greetCooldowns: new Map(),
      idleTimer: Math.random() * 15,
      patrolIndex: 0,
      conversationMemory: new Map(),
      moodTimer: 30 + Math.random() * 30,
      moodDecayTimer: 0,
      roamTarget: null,
      roamWaitTimer: 0,
      roamHomeTimer: ROAM_HOME_INTERVAL * (0.5 + Math.random() * 0.5),
      isReturningHome: false,
      daemonConversations: new Map(),
      conversationCooldown: 10 + Math.random() * 20, // stagger initial conversations
      lastOverhearReaction: 0,
      isMuted: false,
      isRecalled: false,
    };
  }

  getDaemonStates(): DaemonState[] {
    return Array.from(this.daemons.values()).map((d) => d.state);
  }

  addDaemon(id: string, definition: DaemonDefinition, behavior: DaemonBehavior): void {
    // Ensure personality exists
    if (!definition.personality) {
      definition.personality = {
        traits: ["friendly"],
        backstory: `${definition.name} just arrived on The Street.`,
        speechStyle: "casual",
        interests: ["exploring"],
        quirks: [],
      };
    }

    const state: DaemonState = {
      daemonId: id,
      definition,
      currentPosition: { ...definition.position },
      currentRotation: definition.rotation,
      currentAction: "idle",
      mood: "neutral",
    };

    this.daemons.set(id, this.createInstance(state, behavior));

    this.broadcast("daemon_spawn", {
      type: "daemon_spawn" as const,
      daemon: state,
    });
  }

  removeDaemon(id: string): void {
    this.daemons.delete(id);
    this.broadcast("daemon_despawn", {
      type: "daemon_despawn" as const,
      daemonId: id,
    });
  }

  /** Recall a daemon to its home position */
  recallDaemon(id: string): void {
    const daemon = this.daemons.get(id);
    if (!daemon) return;
    daemon.isRecalled = true;
    daemon.roamTarget = null;
    daemon.isReturningHome = true;
  }

  /** Toggle roaming for a daemon */
  setRoaming(id: string, enabled: boolean): void {
    const daemon = this.daemons.get(id);
    if (!daemon) return;
    daemon.behavior.roamingEnabled = enabled;
    if (!enabled) {
      daemon.isReturningHome = true;
      daemon.roamTarget = null;
    } else {
      daemon.isRecalled = false;
    }
  }

  /** Mute/unmute a daemon */
  setMuted(id: string, muted: boolean): void {
    const daemon = this.daemons.get(id);
    if (!daemon) return;
    daemon.isMuted = muted;
  }

  /** Called when a player sends a chat message — daemons may overhear and react */
  onPlayerChat(playerId: string, playerName: string, content: string, position: Vector3): void {
    const now = Date.now();

    for (const [_id, daemon] of this.daemons) {
      if (daemon.isMuted) continue;
      if (daemon.state.currentAction !== "idle") continue;
      if (now - daemon.lastOverhearReaction < OVERHEAR_COOLDOWN_MS) continue;

      // Check distance
      const dist = this.distance(daemon.state.currentPosition, position);
      if (dist > daemon.behavior.interactionRadius * 1.5) continue;

      // Random chance to react
      if (Math.random() > OVERHEAR_CHANCE) continue;

      daemon.lastOverhearReaction = now;

      // Queue AI reaction
      this.queueAiConversation(async () => {
        try {
          const { generateDaemonResponse } = await import("@the-street/ai-service");

          const context = {
            recentMessages: [] as { role: "player" | "daemon"; content: string }[],
            nearbyPlayers: [playerName],
            currentMood: daemon.state.mood,
          };

          const response = await generateDaemonResponse(
            daemon.state.definition,
            playerName,
            `[Overheard nearby]: "${content}"`,
            context,
          );

          daemon.state.mood = response.mood;
          daemon.moodDecayTimer = 0;

          const fullMessage = response.emote
            ? `${response.emote} ${response.message}`
            : response.message;

          this.broadcast("daemon_chat", {
            type: "daemon_chat" as const,
            daemonId: daemon.state.daemonId,
            daemonName: daemon.state.definition.name,
            content: fullMessage,
          });
        } catch (err) {
          console.error("Daemon overhear reaction failed:", err);
        }
      });

      break; // Only one daemon reacts per chat message
    }
  }

  tick(dt: number, players: PlayerInfo[]): void {
    for (const [_daemonId, daemon] of this.daemons) {
      // Update mood
      this.tickMood(daemon, dt);

      // Behavior-specific logic
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
        case "roamer":
          this.tickRoamer(daemon, dt, players);
          break;
        case "socialite":
          this.tickSocialite(daemon, dt, players);
          break;
      }

      // Free roaming (for all types that have it enabled)
      if (daemon.behavior.roamingEnabled && !daemon.isRecalled) {
        this.tickRoaming(daemon, dt);
      }

      // Return home if recalled
      if (daemon.isReturningHome) {
        this.tickReturnHome(daemon, dt);
      }

      // Idle chatter (all types)
      this.tickIdleChatter(daemon, dt, players);

      // Daemon-daemon conversations
      this.tickDaemonConversations(daemon, dt);
    }

    // Detect daemon-daemon proximity for new conversations
    this.detectDaemonProximity();

    // Process AI conversation queue
    this.processAiQueue();
  }

  /** Handle player interacting with a daemon — triggers AI conversation */
  handleInteract(daemonId: string, playerId: string, playerSessionId: string, playerMessage?: string, playerName?: string): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon || daemon.isMuted) return;

    // Rate limit AI calls
    const now = Date.now();
    const lastCall = this.lastAiCall.get(daemonId) || 0;
    if (now - lastCall < AI_COOLDOWN_MS) {
      // Fallback to canned response
      this.sendCannedResponse(daemon, playerId);
      return;
    }

    // Get or create conversation memory
    let memory = daemon.conversationMemory.get(playerId);
    if (!memory || now - memory.lastInteraction > 300_000) {
      // New conversation or stale (>5 min)
      memory = { playerId, playerName: playerName || "Traveler", messages: [], lastInteraction: now };
      daemon.conversationMemory.set(playerId, memory);
    }
    if (playerName) memory.playerName = playerName;
    memory.lastInteraction = now;

    const resolvedPlayerName = memory.playerName;

    // Queue AI response
    this.queueAiConversation(async () => {
      try {
        this.lastAiCall.set(daemonId, Date.now());

        const { generateDaemonResponse } = await import("@the-street/ai-service");

        // Build context
        const nearbyDaemons = this.getNearbyDaemonNames(daemon, 15);
        const context = {
          recentMessages: memory!.messages.slice(-6),
          nearbyDaemons,
          currentMood: daemon.state.mood,
        };

        const response = await generateDaemonResponse(
          daemon.state.definition,
          resolvedPlayerName,
          playerMessage,
          context,
        );

        // Update daemon state
        daemon.state.currentAction = "talking";
        daemon.state.targetPlayerId = playerId;
        daemon.state.mood = response.mood;
        daemon.moodDecayTimer = 0;

        // Store in memory
        if (playerMessage) {
          memory!.messages.push({ role: "player", content: playerMessage });
        }
        memory!.messages.push({ role: "daemon", content: response.message });
        // Keep memory bounded
        if (memory!.messages.length > 20) {
          memory!.messages = memory!.messages.slice(-12);
        }

        // Broadcast emote if present
        if (response.emote) {
          this.broadcast("daemon_emote", {
            type: "daemon_emote" as const,
            daemonId: daemon.state.daemonId,
            emote: response.emote,
            mood: response.mood,
          });
        }

        // Broadcast chat
        const fullMessage = response.emote
          ? `${response.emote} ${response.message}`
          : response.message;

        this.broadcast("daemon_chat", {
          type: "daemon_chat" as const,
          daemonId: daemon.state.daemonId,
          daemonName: daemon.state.definition.name,
          content: fullMessage,
          targetUserId: playerId,
        });

        // Return to idle after a delay
        setTimeout(() => {
          if (daemon.state.targetPlayerId === playerId) {
            daemon.state.currentAction = "idle";
            daemon.state.targetPlayerId = undefined;
          }
        }, 4000);
      } catch (err) {
        console.error(`AI conversation failed for daemon ${daemonId}:`, err);
        this.sendCannedResponse(daemon, playerId);
      }
    });
  }

  private sendCannedResponse(daemon: DaemonInstance, playerId: string): void {
    const behavior = daemon.behavior;

    if (behavior.responses) {
      const keys = Object.keys(behavior.responses);
      const responseKey = keys.length > 0 ? keys[Math.floor(Math.random() * keys.length)] : null;
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

  // ─── Mood System ──────────────────────────────────────────────

  private tickMood(daemon: DaemonInstance, dt: number): void {
    daemon.moodDecayTimer += dt;

    // Mood drifts toward bored if no interactions
    if (daemon.moodDecayTimer > MOOD_DECAY_INTERVAL && daemon.state.mood !== "bored") {
      if (daemon.state.currentAction === "idle") {
        daemon.state.mood = "bored";
        daemon.moodDecayTimer = 0;

        this.broadcast("daemon_emote", {
          type: "daemon_emote" as const,
          daemonId: daemon.state.daemonId,
          emote: this.getBoredEmote(daemon),
          mood: "bored" as DaemonMood,
        });
      }
    }
  }

  private getBoredEmote(daemon: DaemonInstance): string {
    const quirks = daemon.state.definition.personality?.quirks || [];
    if (quirks.length > 0) {
      return `*${quirks[Math.floor(Math.random() * quirks.length)]}*`;
    }
    const defaults = ["*yawns*", "*looks around*", "*taps foot*", "*stretches*", "*sighs*"];
    return defaults[Math.floor(Math.random() * defaults.length)];
  }

  // ─── Behavior Ticks ───────────────────────────────────────────

  private tickGreeter(daemon: DaemonInstance, _dt: number, players: PlayerInfo[]): void {
    if (daemon.isMuted) return;
    const radius = daemon.behavior.interactionRadius;
    const now = Date.now();
    const COOLDOWN_MS = 30_000;

    for (const player of players) {
      const dist = this.distance(daemon.state.currentPosition, player.position);
      if (dist > radius) continue;

      const lastGreet = daemon.greetCooldowns.get(player.userId) || 0;
      if (now - lastGreet < COOLDOWN_MS) continue;

      daemon.greetCooldowns.set(player.userId, now);
      daemon.state.currentAction = "waving";
      daemon.state.targetPlayerId = player.userId;
      daemon.state.mood = "happy";
      daemon.moodDecayTimer = 0;

      const message = daemon.behavior.greetingMessage || "Hello, traveler!";
      this.broadcast("daemon_chat", {
        type: "daemon_chat" as const,
        daemonId: daemon.state.daemonId,
        daemonName: daemon.state.definition.name,
        content: message,
        targetUserId: player.userId,
      });

      setTimeout(() => {
        daemon.state.currentAction = "idle";
        daemon.state.targetPlayerId = undefined;
      }, 3000);

      break;
    }
  }

  private tickShopkeeper(daemon: DaemonInstance, _dt: number, _players: PlayerInfo[]): void {
    // Shopkeepers are reactive — they respond via handleInteract
  }

  private tickGuide(daemon: DaemonInstance, dt: number, players: PlayerInfo[]): void {
    const path = daemon.behavior.patrolPath;
    if (!path || path.length < 2) {
      this.tickGreeter(daemon, dt, players);
      return;
    }

    const target = path[daemon.patrolIndex];
    const pos = daemon.state.currentPosition;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.5) {
      daemon.patrolIndex = (daemon.patrolIndex + 1) % path.length;
      daemon.state.currentAction = "idle";
    } else {
      const speed = 2;
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

    this.tickGreeter(daemon, dt, players);
  }

  private tickGuard(daemon: DaemonInstance, _dt: number, players: PlayerInfo[]): void {
    if (daemon.isMuted) return;
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

  private tickRoamer(daemon: DaemonInstance, dt: number, players: PlayerInfo[]): void {
    // Roamers greet nearby players and wander
    this.tickGreeter(daemon, dt, players);
  }

  private tickSocialite(daemon: DaemonInstance, dt: number, players: PlayerInfo[]): void {
    // Socialites actively seek out other daemons
    // The conversation detection happens in detectDaemonProximity
    // They also greet players
    this.tickGreeter(daemon, dt, players);

    // If bored and no active conversations, lower conversation cooldown faster
    if (daemon.state.mood === "bored" && daemon.conversationCooldown > 0) {
      daemon.conversationCooldown -= dt * 2; // Double speed toward next conversation
    }
  }

  // ─── Free Roaming ─────────────────────────────────────────────

  private tickRoaming(daemon: DaemonInstance, dt: number): void {
    // Don't roam while in conversation
    if (daemon.state.currentAction === "talking" || daemon.state.currentAction === "thinking") return;
    if (daemon.isReturningHome) return;

    // Decrement home timer
    daemon.roamHomeTimer -= dt;
    if (daemon.roamHomeTimer <= 0) {
      daemon.isReturningHome = true;
      daemon.roamTarget = null;
      daemon.roamHomeTimer = ROAM_HOME_INTERVAL * (0.8 + Math.random() * 0.4);
      return;
    }

    // Waiting at destination?
    if (daemon.roamWaitTimer > 0) {
      daemon.roamWaitTimer -= dt;
      daemon.state.currentAction = "idle";
      return;
    }

    // Need a new target?
    if (!daemon.roamTarget) {
      daemon.roamTarget = this.pickRoamTarget(daemon);
      return;
    }

    // Walk toward target
    this.moveToward(daemon, daemon.roamTarget, ROAM_SPEED, dt);

    const dist = this.distance(daemon.state.currentPosition, daemon.roamTarget);
    if (dist < 1.0) {
      // Arrived — pause
      daemon.roamTarget = null;
      daemon.roamWaitTimer = ROAM_PAUSE_MIN + Math.random() * (ROAM_PAUSE_MAX - ROAM_PAUSE_MIN);
      daemon.state.currentAction = "idle";
    }
  }

  private tickReturnHome(daemon: DaemonInstance, dt: number): void {
    const home = daemon.behavior.homePosition || daemon.state.definition.position;
    if (!home) {
      daemon.isReturningHome = false;
      return;
    }

    this.moveToward(daemon, home, ROAM_SPEED * 1.5, dt); // Walk faster when going home

    const dist = this.distance(daemon.state.currentPosition, home);
    if (dist < 1.0) {
      daemon.isReturningHome = false;
      daemon.state.currentAction = "idle";
      if (daemon.isRecalled) {
        // Stay home
        daemon.behavior.roamingEnabled = false;
      }
    }
  }

  private pickRoamTarget(daemon: DaemonInstance): Vector3 {
    const home = daemon.behavior.homePosition || daemon.state.definition.position;
    const maxRadius = daemon.behavior.roamRadius || 100;

    // Pick a random point on the street ring
    const randomAngle = Math.random() * Math.PI * 2;
    const streetPos = getStreetPosition(randomAngle, V1_CONFIG);

    // Check if within roam radius of home
    const distFromHome = this.distance(streetPos, home);
    if (distFromHome > maxRadius) {
      // Pick a closer point — interpolate toward home
      const ratio = maxRadius / distFromHome;
      return {
        x: home.x + (streetPos.x - home.x) * ratio,
        y: 0,
        z: home.z + (streetPos.z - home.z) * ratio,
      };
    }

    return streetPos;
  }

  private moveToward(daemon: DaemonInstance, target: Vector3, speed: number, dt: number): void {
    const pos = daemon.state.currentPosition;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.1) return;

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

  // ─── Daemon-Daemon Conversations ──────────────────────────────

  private detectDaemonProximity(): void {
    const daemonList = Array.from(this.daemons.entries());

    for (let i = 0; i < daemonList.length; i++) {
      const [idA, daemonA] = daemonList[i];
      if (daemonA.isMuted || daemonA.conversationCooldown > 0) continue;
      if (daemonA.behavior.canConverseWithDaemons === false) continue;
      if (daemonA.state.currentAction === "talking") continue;

      for (let j = i + 1; j < daemonList.length; j++) {
        const [idB, daemonB] = daemonList[j];
        if (daemonB.isMuted || daemonB.conversationCooldown > 0) continue;
        if (daemonB.behavior.canConverseWithDaemons === false) continue;
        if (daemonB.state.currentAction === "talking") continue;

        const dist = this.distance(daemonA.state.currentPosition, daemonB.state.currentPosition);
        if (dist > 8) continue; // Must be within 8 units

        // Check cooldown for this specific pair
        const convA = daemonA.daemonConversations.get(idB);
        const convB = daemonB.daemonConversations.get(idA);
        const now = Date.now();
        if (convA && now - convA.lastConversation < DAEMON_CHAT_COOLDOWN_MS) continue;

        // Start a conversation!
        this.startDaemonConversation(idA, daemonA, idB, daemonB);
        break; // One new conversation per tick per daemon
      }
    }
  }

  private startDaemonConversation(
    idA: string, daemonA: DaemonInstance,
    idB: string, daemonB: DaemonInstance,
  ): void {
    const now = Date.now();

    // Set cooldowns
    daemonA.conversationCooldown = 30 + Math.random() * 30;
    daemonB.conversationCooldown = 30 + Math.random() * 30;

    // Mark conversation state
    const convStateA: DaemonDaemonConversation = {
      otherDaemonId: idB,
      lastConversation: now,
      isActive: true,
      pendingLines: [],
      lineIndex: 0,
      lineTimer: 0,
    };
    const convStateB: DaemonDaemonConversation = {
      otherDaemonId: idA,
      lastConversation: now,
      isActive: true,
      pendingLines: [],
      lineIndex: 0,
      lineTimer: 0,
    };
    daemonA.daemonConversations.set(idB, convStateA);
    daemonB.daemonConversations.set(idA, convStateB);

    // Face each other
    const dx = daemonB.state.currentPosition.x - daemonA.state.currentPosition.x;
    const dz = daemonB.state.currentPosition.z - daemonA.state.currentPosition.z;
    daemonA.state.currentRotation = Math.atan2(-dx, -dz);
    daemonB.state.currentRotation = Math.atan2(dx, dz);
    daemonA.state.currentAction = "thinking";
    daemonB.state.currentAction = "thinking";
    daemonA.state.targetDaemonId = idB;
    daemonB.state.targetDaemonId = idA;

    // Queue AI generation
    this.queueAiConversation(async () => {
      try {
        const { generateDaemonConversation } = await import("@the-street/ai-service");

        const contextA = {
          recentMessages: [] as { role: "player" | "daemon"; content: string }[],
          nearbyDaemons: [daemonB.state.definition.name],
          currentMood: daemonA.state.mood,
        };
        const contextB = {
          recentMessages: [] as { role: "player" | "daemon"; content: string }[],
          nearbyDaemons: [daemonA.state.definition.name],
          currentMood: daemonB.state.mood,
        };

        const lines = await generateDaemonConversation(
          daemonA.state.definition,
          daemonB.state.definition,
          contextA,
          contextB,
          CONVERSATION_EXCHANGES,
        );

        if (lines.length === 0) {
          this.endDaemonConversation(idA, daemonA, idB, daemonB);
          return;
        }

        // Schedule lines with delays
        let cumulativeDelay = 1.0; // Start after 1 second
        const scheduledLines: typeof convStateA.pendingLines = [];

        for (const line of lines) {
          const speakerDaemonId = line.speakerId === "A" ? idA : idB;
          scheduledLines.push({
            speakerDaemonId,
            message: line.emote ? `${line.emote} ${line.message}` : line.message,
            mood: line.mood,
            delay: cumulativeDelay,
          });
          cumulativeDelay += 2.5 + Math.random() * 1.5; // 2.5-4s between lines
        }

        // Set pending lines on both conversation states
        convStateA.pendingLines = scheduledLines;
        convStateB.pendingLines = scheduledLines;
        convStateA.lineTimer = 0;
        convStateB.lineTimer = 0;

        // Update actions
        daemonA.state.currentAction = "talking";
        daemonB.state.currentAction = "talking";
        daemonA.moodDecayTimer = 0;
        daemonB.moodDecayTimer = 0;
      } catch (err) {
        console.error("Daemon conversation generation failed:", err);
        this.endDaemonConversation(idA, daemonA, idB, daemonB);
      }
    });
  }

  private tickDaemonConversations(daemon: DaemonInstance, dt: number): void {
    // Decrement conversation cooldown
    if (daemon.conversationCooldown > 0) {
      daemon.conversationCooldown -= dt;
    }

    for (const [otherId, conv] of daemon.daemonConversations) {
      if (!conv.isActive || conv.pendingLines.length === 0) continue;

      conv.lineTimer += dt;

      // Process lines that are due
      while (conv.lineIndex < conv.pendingLines.length) {
        const line = conv.pendingLines[conv.lineIndex];
        if (conv.lineTimer < line.delay) break;

        // Only the daemon whose ID matches the speaker broadcasts (avoid duplicates)
        if (line.speakerDaemonId === daemon.state.daemonId) {
          const otherDaemon = this.daemons.get(otherId);
          const targetDaemonId = line.speakerDaemonId === daemon.state.daemonId ? otherId : daemon.state.daemonId;

          daemon.state.mood = line.mood;

          this.broadcast("daemon_chat", {
            type: "daemon_chat" as const,
            daemonId: line.speakerDaemonId,
            daemonName: daemon.state.definition.name,
            content: line.message,
            targetDaemonId,
          });
        }

        conv.lineIndex++;
      }

      // Conversation finished
      if (conv.lineIndex >= conv.pendingLines.length) {
        const otherDaemon = this.daemons.get(otherId);
        if (otherDaemon) {
          this.endDaemonConversation(daemon.state.daemonId, daemon, otherId, otherDaemon);
        } else {
          conv.isActive = false;
          daemon.state.currentAction = "idle";
          daemon.state.targetDaemonId = undefined;
        }
      }
    }
  }

  private endDaemonConversation(
    idA: string, daemonA: DaemonInstance,
    idB: string, daemonB: DaemonInstance,
  ): void {
    const convA = daemonA.daemonConversations.get(idB);
    const convB = daemonB.daemonConversations.get(idA);
    if (convA) convA.isActive = false;
    if (convB) convB.isActive = false;

    if (daemonA.state.targetDaemonId === idB) {
      daemonA.state.currentAction = "idle";
      daemonA.state.targetDaemonId = undefined;
    }
    if (daemonB.state.targetDaemonId === idA) {
      daemonB.state.currentAction = "idle";
      daemonB.state.targetDaemonId = undefined;
    }
  }

  // ─── Idle Chatter ─────────────────────────────────────────────

  private tickIdleChatter(daemon: DaemonInstance, dt: number, players: PlayerInfo[]): void {
    if (daemon.isMuted) return;
    if (!daemon.behavior.idleMessages || daemon.behavior.idleMessages.length === 0) return;
    if (daemon.state.currentAction !== "idle") return;

    daemon.idleTimer -= dt;
    if (daemon.idleTimer > 0) return;

    const hasNearby = players.some(
      (p) => this.distance(daemon.state.currentPosition, p.position) < daemon.behavior.interactionRadius * 2,
    );
    if (!hasNearby) {
      daemon.idleTimer = 10;
      return;
    }

    const msgs = daemon.behavior.idleMessages;
    const msg = msgs[Math.floor(Math.random() * msgs.length)];

    this.broadcast("daemon_chat", {
      type: "daemon_chat" as const,
      daemonId: daemon.state.daemonId,
      daemonName: daemon.state.definition.name,
      content: msg,
    });

    daemon.idleTimer = 15 + Math.random() * 20;
  }

  // ─── AI Queue ─────────────────────────────────────────────────

  private queueAiConversation(fn: () => Promise<void>): void {
    this.aiConversationQueue.push(fn);
  }

  private async processAiQueue(): Promise<void> {
    if (this.processingAi || this.aiConversationQueue.length === 0) return;
    this.processingAi = true;

    const fn = this.aiConversationQueue.shift()!;
    try {
      await fn();
    } catch (err) {
      console.error("AI queue processing error:", err);
    }
    this.processingAi = false;
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private getNearbyDaemonNames(daemon: DaemonInstance, radius: number): string[] {
    const names: string[] = [];
    for (const [_id, other] of this.daemons) {
      if (other === daemon) continue;
      if (this.distance(daemon.state.currentPosition, other.state.currentPosition) < radius) {
        names.push(other.state.definition.name);
      }
    }
    return names;
  }

  private distance(a: Vector3, b: Vector3): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // ─── Memory Persistence ─────────────────────────────────────

  /** Save all daemon moods and positions to DB (called periodically and on shutdown) */
  async saveState(): Promise<void> {
    const pool = getPool();
    const promises: Promise<void>[] = [];

    for (const [id, daemon] of this.daemons) {
      const p = pool.query(
        `UPDATE daemons SET
           current_mood = $2,
           position_x = $3, position_y = $4, position_z = $5,
           rotation = $6
         WHERE id = $1`,
        [
          id,
          daemon.state.mood,
          daemon.state.currentPosition.x,
          daemon.state.currentPosition.y,
          daemon.state.currentPosition.z,
          daemon.state.currentRotation,
        ],
      ).then(() => {});
      promises.push(p);

      // Save conversation memories for players
      for (const [playerId, memory] of daemon.conversationMemory) {
        if (memory.messages.length === 0) continue;

        // Summarize the last few messages
        const lastMessages = memory.messages.slice(-4);
        const summary = lastMessages.map(m =>
          `${m.role === "daemon" ? daemon.state.definition.name : memory.playerName}: ${m.content}`
        ).join(" | ");

        const mp = pool.query(
          `INSERT INTO daemon_memories (daemon_id, player_id, memory_type, summary, mood, interaction_count, last_interaction)
           VALUES ($1, $2, 'conversation', $3, $4, $5, now())
           ON CONFLICT ON CONSTRAINT daemon_memories_pkey DO NOTHING`,
          [id, playerId, summary.slice(0, 500), daemon.state.mood, memory.messages.length],
        ).then(() => {}).catch(() => {
          // If player_id is not a valid UUID (e.g. session ID), skip
        });
        promises.push(mp);
      }
    }

    await Promise.allSettled(promises);
  }

  /** Load saved moods from DB after loadDaemons */
  async loadSavedState(): Promise<void> {
    const pool = getPool();

    for (const [id, daemon] of this.daemons) {
      // Load mood from daemons table
      try {
        const { rows } = await pool.query(
          "SELECT current_mood FROM daemons WHERE id = $1",
          [id],
        );
        if (rows.length > 0 && rows[0].current_mood) {
          const validMoods = ["happy", "neutral", "bored", "excited", "annoyed", "curious"];
          if (validMoods.includes(rows[0].current_mood)) {
            daemon.state.mood = rows[0].current_mood;
          }
        }
      } catch {
        // Non-critical
      }

      // Load recent memories for context
      try {
        const { rows: memories } = await pool.query(
          `SELECT player_id, summary, interaction_count, last_interaction
           FROM daemon_memories
           WHERE daemon_id = $1 AND memory_type = 'conversation'
           ORDER BY last_interaction DESC
           LIMIT 10`,
          [id],
        );

        for (const mem of memories) {
          if (mem.player_id && !daemon.conversationMemory.has(mem.player_id)) {
            daemon.conversationMemory.set(mem.player_id, {
              playerId: mem.player_id,
              playerName: "Returning visitor",
              messages: [{ role: "daemon" as const, content: `[Previous meeting: ${mem.summary}]` }],
              lastInteraction: new Date(mem.last_interaction).getTime(),
            });
          }
        }
      } catch {
        // Non-critical
      }
    }
  }
}
