import { getPool } from "../database/pool.js";
import type {
  DaemonState,
  DaemonDefinition,
  DaemonBehavior,
  DaemonMood,
  DaemonAction,
  Vector3,
  PersonalityManifest,
  WorldStateContext,
  VisitorImpression,
} from "@the-street/shared";
import { V1_CONFIG, getStreetPosition } from "@the-street/shared";
import { WorldEventBus, EventPriority, type WorldEvent } from "./WorldEventBus.js";
import { DaemonBehaviorTree, type BehaviorCallbacks, type BehaviorState } from "./DaemonBehaviorTree.js";
import { ConversationSessionManager, type SessionCallbacks } from "./ConversationSessionManager.js";
import {
  getVisitorImpression,
  summarizeAndPersistImpression,
} from "../services/VisitorImpressionStore.js";

interface PlayerInfo {
  userId: string;
  position: Vector3;
  sessionId: string;
  displayName?: string;
}

interface WorldObjectInfo {
  name: string;
  tags: string[];
  position: Vector3;
}

interface ConversationMemory {
  playerId: string;
  playerName: string;
  messages: { role: "player" | "daemon"; content: string }[];
  lastInteraction: number;
}

type Sentiment = "friendly" | "neutral" | "wary" | "curious" | "amused";

interface Relationship {
  targetName: string;      // Player name or daemon name
  targetType: "player" | "daemon";
  sentiment: Sentiment;
  interactionCount: number;
  gossip: string[];        // Things heard about this entity from others
  topicHistory: string[];  // Topics this person likes talking about (learned from interactions)
  nickname?: string;       // Personal nickname given after enough interactions
  lastSeen: number;        // timestamp of last interaction/sighting
  lastUpdated: number;
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
  // Relationships & gossip
  relationships: Map<string, Relationship>; // targetId -> relationship
  // Overhear
  lastOverhearReaction: number;
  // Spontaneous gestures
  spontaneousGestureTimer: number;
  // Gathering
  gatheringTarget: Vector3 | null;  // cluster midpoint to drift toward
  gatheringTimer: number;           // cooldown before next group chatter
  // Daily routine
  routineTimer: number;             // countdown to next routine-specific action
  // Proactive engagement
  proactiveTimer: number;           // countdown to next unsolicited player remark
  proactiveCooldowns: Map<string, number>; // playerId -> timestamp of last proactive remark
  // Thought bubbles
  thoughtTimer: number;             // countdown to next thought
  // Emotional contagion
  contagionTimer: number;           // countdown to next contagion check
  // Territory
  turfCenter: Vector3;              // center of this daemon's claimed territory
  turfRadius: number;               // how far they consider "theirs"
  turfTimer: number;                // countdown to next territorial check
  timeAwayFromTurf: number;         // how long they've been away from home turf
  // Global per-player chat cooldown (across all systems)
  lastChatToPlayer: Map<string, number>;
  // Control
  isMuted: boolean;
  isRecalled: boolean;
  // Behavior tree
  behaviorTree: DaemonBehaviorTree;
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
const PROACTIVE_COOLDOWN_MS = 300_000; // 5 min cooldown per player for proactive remarks
const GLOBAL_PLAYER_CHAT_COOLDOWN_MS = 60_000; // 60s global cooldown per player across all chat systems
const DAY_CYCLE_SECONDS = 600;     // 10 real minutes = 1 in-game day
const CONTAGION_RADIUS = 15;       // units — mood spreads within this radius
const CONTAGION_INTERVAL = 8;      // check every 8 seconds
const CONTAGION_RESIST_BASE = 0.4; // 40% base chance to resist mood spread

type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

/** Roam speed multiplier by time of day */
function getTimeSpeedMultiplier(time: TimeOfDay): number {
  switch (time) {
    case "morning": return 1.1;   // energetic start
    case "afternoon": return 1.0;
    case "evening": return 0.8;   // winding down
    case "night": return 0.5;     // drowsy shuffle
  }
}

/** Spontaneous gesture frequency multiplier (lower = more frequent) */
function getTimeChattinessFactor(time: TimeOfDay): number {
  switch (time) {
    case "morning": return 0.9;
    case "afternoon": return 0.7;  // peak social hours
    case "evening": return 1.0;
    case "night": return 1.6;      // much quieter
  }
}

/** Pick a random element from an array */
function pick<T>(arr: T[]): T {
  if (arr.length === 0) throw new Error("pick() called with empty array");
  return arr[Math.floor(Math.random() * arr.length)];
}

function getTimeOfDay(elapsedSeconds: number): TimeOfDay {
  const dayProgress = (elapsedSeconds % DAY_CYCLE_SECONDS) / DAY_CYCLE_SECONDS;
  if (dayProgress < 0.25) return "morning";
  if (dayProgress < 0.50) return "afternoon";
  if (dayProgress < 0.75) return "evening";
  return "night";
}

interface ActivityLogEntry {
  daemonId: string;
  daemonName: string;
  type: "chat" | "emote" | "conversation" | "greeting" | "mood_change";
  content: string;
  targetName?: string;
  timestamp: number;
}

const MAX_ACTIVITY_LOG = 50;

export class DaemonManager {
  private daemons = new Map<string, DaemonInstance>();
  private broadcast: BroadcastFn;
  private sendToClient: (sessionId: string, type: string, data: unknown) => void;
  private plotUuids: string[] = [];
  private lastAiCall = new Map<string, number>(); // daemonId -> timestamp
  private aiConversationQueue: Array<() => Promise<void>> = [];
  private processingAi = false;
  private worldClock = 0;  // elapsed seconds for day/night cycle
  private lastTimeOfDay: TimeOfDay = "morning";
  private activityLog: ActivityLogEntry[] = [];
  private worldObjects: WorldObjectInfo[] = [];
  private eventTimer = 300 + Math.random() * 300; // first event in 5-10 min
  private lastEventDaemonId: string | null = null;
  private challengeTimer = 180 + Math.random() * 120; // first challenge in 3-5 min
  private playerMovement = new Map<string, { lastPos: Vector3; speed: number; stillTime: number; nearDaemonTime: Map<string, number> }>();
  private lastPlayerCount = 0;
  private crowdReactionCooldown = 0;
  private compactionTimer = 0;
  private consecutiveAiFailures = 0;
  // Event-driven behavior tree
  private eventBus = new WorldEventBus();
  private ambientTickTimer = 0;
  private behaviorTreeTickTimer = 0;
  private sessionTickTimer = 0;
  // Conversation session manager
  private sessionManager: ConversationSessionManager;
  // Personality manifests cache (daemonId -> manifest)
  private manifests = new Map<string, PersonalityManifest>();
  // Visitor impression cache (daemonId:visitorId -> impression)
  private visitorImpressionCache = new Map<string, VisitorImpression>();

  constructor(
    broadcast: BroadcastFn,
    sendToClient: (sessionId: string, type: string, data: unknown) => void,
  ) {
    this.broadcast = broadcast;
    this.sendToClient = sendToClient;
    this.sessionManager = new ConversationSessionManager(this.createSessionCallbacks());
  }

  /** Create behavior tree callbacks bound to this manager instance. */
  private createBehaviorCallbacks(): BehaviorCallbacks {
    return {
      onEnterIdle: (_daemonId: string) => {
        // Daemon returned to idle — ambient behaviors resume via ambient tick
      },
      onEnterAttention: (daemonId: string, event: WorldEvent) => {
        const daemon = this.daemons.get(daemonId);
        if (!daemon || daemon.isMuted) return;
        // Face the source of attention
        if (event.position) {
          const dx = event.position.x - daemon.state.currentPosition.x;
          const dz = event.position.z - daemon.state.currentPosition.z;
          daemon.state.currentRotation = Math.atan2(dx, dz);
          this.broadcast("daemon_move", {
            type: "daemon_move" as const,
            daemonId,
            position: daemon.state.currentPosition,
            rotation: daemon.state.currentRotation,
            action: daemon.state.currentAction,
          });
        }

        // Check if daemon should initiate conversation on proximity
        if (event.type === "visitor_proximity" && !event.speech) {
          const manifest = this.manifests.get(daemonId);
          if (manifest?.behaviorPreferences.initiatesConversation) {
            // Check greet cooldown for this visitor
            const cooldown = daemon.greetCooldowns.get(event.sourceId) || 0;
            if (Date.now() > cooldown) {
              daemon.greetCooldowns.set(event.sourceId, Date.now() + PROACTIVE_COOLDOWN_MS);
              // Emit a proximity-based greeting event to escalate to conversation
              this.eventBus.emit({
                type: "visitor_speech",
                priority: EventPriority.NewSpeech,
                sourceId: event.sourceId,
                sourceName: event.sourceName,
                targetDaemonId: daemonId,
                speech: `[${event.sourceName || "A visitor"} has entered ${manifest.identity.name}'s proximity]`,
                timestamp: Date.now(),
              });
            }
          }
        }
      },
      onStartConversation: (daemonId: string, participantId: string, participantName: string, participantType: "visitor" | "daemon", speech?: string) => {
        if (participantType === "visitor") {
          // Route through session manager for managed conversation lifecycle
          this.handleManagedConversation(daemonId, participantId, participantName, participantType, speech);
        }
        // Daemon-daemon conversations handled separately via existing tickDaemonConversations
      },
      onBusyResponse: (daemonId: string, speakerId: string, speakerName: string) => {
        // Route busy responses through session manager for logging
        this.sessionManager.handleBusyInterrupt(daemonId, speakerId, speakerName).catch(err => {
          console.error(`[DaemonManager] Busy interrupt failed:`, err);
        });
      },
      onPostInteraction: (daemonId: string, context) => {
        const daemon = this.daemons.get(daemonId);
        if (!daemon) return;
        // Session manager handles summarization and cleanup via onSessionEnd callback.
        // Post-interaction only resets visual state (session end already handled).
        daemon.state.currentAction = "idle";
        daemon.state.targetPlayerId = undefined;
        daemon.state.targetDaemonId = undefined;
      },
      isKnownVisitor: (daemonId: string, visitorId: string) => {
        const daemon = this.daemons.get(daemonId);
        if (!daemon) return false;
        const rel = daemon.relationships.get(visitorId);
        return !!rel && rel.interactionCount > 0;
      },
      getDistance: (a: Vector3, b: Vector3) => this.distance(a, b),
      getDaemonPosition: (daemonId: string) => {
        const daemon = this.daemons.get(daemonId);
        return daemon ? daemon.state.currentPosition : null;
      },
      getDaemonRadius: (daemonId: string) => {
        const daemon = this.daemons.get(daemonId);
        return daemon ? daemon.behavior.interactionRadius : 10;
      },
    };
  }

  /** Create session manager callbacks bound to this manager instance. */
  private createSessionCallbacks(): SessionCallbacks {
    return {
      onDaemonSpeech: (daemonId, thought, session) => {
        const daemon = this.daemons.get(daemonId);
        if (!daemon || daemon.isMuted) return;

        // Update daemon visual state
        daemon.state.currentAction = "talking";
        daemon.state.targetPlayerId = session.participantType === "visitor" ? session.participantId : undefined;
        daemon.state.targetDaemonId = session.participantType === "daemon" ? session.participantId : undefined;

        // Broadcast the full DaemonThought as a speech stream message
        if (thought.speech) {
          this.broadcast("daemon_speech_stream", {
            type: "daemon_speech_stream" as const,
            daemonId,
            daemonName: daemon.state.definition.name,
            speech: thought.speech,
            emote: thought.emote,
            movement: thought.movement,
            addressedTo: thought.addressedTo,
            position: daemon.state.currentPosition,
          });
        }

        // Legacy daemon_chat for backwards compatibility
        if (thought.speech) {
          this.broadcastDaemonChat(daemon, thought.speech, session.participantType === "visitor" ? session.participantId : undefined);
        }

        if (thought.emote) {
          this.broadcastDaemonEmote(daemon, thought.emote, daemon.state.mood);
        }

        // Broadcast conversation start/end markers
        if (session.turnCount === 1) {
          this.broadcast("daemon_conversation_start", {
            type: "daemon_conversation_start" as const,
            daemonId,
            daemonName: daemon.state.definition.name,
            participantId: session.participantId,
            participantType: session.participantType,
          });
        }
      },

      onBusyResponse: (daemonId, _speakerId, speakerName) => {
        const daemon = this.daemons.get(daemonId);
        if (!daemon || daemon.isMuted) return;
        const name = daemon.state.definition.name;
        const busyMessages = [
          `*${name} glances over briefly* Sorry, I'm in the middle of something.`,
          `*${name} nods at ${speakerName}* One moment, please.`,
          `Hang on, ${speakerName} — talking to someone right now.`,
        ];
        this.broadcastDaemonChat(daemon, busyMessages[Math.floor(Math.random() * busyMessages.length)]);
      },

      onSessionEnd: (daemonId, sessionId, reason) => {
        const daemon = this.daemons.get(daemonId);
        if (!daemon) return;

        // Reset visual state
        daemon.state.currentAction = "idle";
        daemon.state.targetPlayerId = undefined;
        daemon.state.targetDaemonId = undefined;

        // End conversation in behavior tree
        daemon.behaviorTree.endConversation();

        // Broadcast conversation end
        this.broadcast("daemon_conversation_end", {
          type: "daemon_conversation_end" as const,
          daemonId,
          sessionId,
          reason,
        });
      },

      onSummarize: (daemonId, session, turns) => {
        console.log(`[SessionManager] Summarization triggered for daemon=${daemonId} session=${session.sessionId} turns=${session.turnCount}`);
        if (session.participantType === "visitor") {
          const daemon = this.daemons.get(daemonId);
          const daemonName = daemon?.state.definition.name ?? "Unknown";
          summarizeAndPersistImpression(daemonId, daemonName, session, turns).catch((err) => {
            console.error(`[SessionManager] Visitor impression persistence failed for daemon=${daemonId}:`, err);
          });
          this.persistRelationship(daemonId, session.participantId).catch(() => {});
        }
      },

      getManifest: (daemonId) => {
        return this.manifests.get(daemonId) ?? null;
      },

      getWorldState: (daemonId) => {
        const daemon = this.daemons.get(daemonId);
        const nearbyDaemons: { daemonId: string; name: string }[] = [];
        if (daemon) {
          for (const [id, other] of this.daemons) {
            if (id === daemonId) continue;
            const dist = this.distance(daemon.state.currentPosition, other.state.currentPosition);
            if (dist <= 20) {
              nearbyDaemons.push({ daemonId: id, name: other.state.definition.name });
            }
          }
        }

        return {
          currentVisitorCount: this.lastPlayerCount,
          nearbyDaemons,
          timeOfDay: this.lastTimeOfDay,
          trafficTrend: "stable" as const,
          assembledAt: Date.now(),
        } satisfies WorldStateContext;
      },

      getVisitorImpression: (daemonId, visitorId) => {
        // Synchronous lookup from cache; async load happens at session start
        return this.visitorImpressionCache.get(`${daemonId}:${visitorId}`);
      },

      getDaemonRelationship: (_daemonId, _targetDaemonId) => {
        // Will be provided by ts-lly (inter-daemon event routing)
        return undefined;
      },
    };
  }

  async loadDaemons(plotUuids: string[]): Promise<void> {
    this.plotUuids = plotUuids;
    const pool = getPool();

    // Load plot daemons + global street daemons (plot_uuid IS NULL)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rows: any[];
    if (plotUuids.length > 0) {
      const placeholders = plotUuids.map((_, i) => `$${i + 1}`).join(",");
      const result = await pool.query(
        `SELECT id, plot_uuid, name, description, daemon_definition, appearance, behavior,
                position_x, position_y, position_z, rotation
         FROM daemons WHERE (plot_uuid IN (${placeholders}) OR plot_uuid IS NULL) AND is_active = true`,
        plotUuids,
      );
      rows = result.rows;
    } else {
      // No plots — still load global street daemons
      const result = await pool.query(
        `SELECT id, plot_uuid, name, description, daemon_definition, appearance, behavior,
                position_x, position_y, position_z, rotation
         FROM daemons WHERE plot_uuid IS NULL AND is_active = true`,
      );
      rows = result.rows;
    }

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

    await this.loadPersistedMemories();
    await this.loadManifests();
  }

  /** Load personality manifests from DB for all active daemons. */
  private async loadManifests(): Promise<void> {
    const daemonIds = [...this.daemons.keys()];
    if (daemonIds.length === 0) return;

    try {
      const pool = getPool();
      const placeholders = daemonIds.map((_, i) => `$${i + 1}`).join(",");
      const result = await pool.query(
        `SELECT DISTINCT ON (daemon_id)
           daemon_id, version, name, voice_description, backstory,
           compiled_system_prompt, compiled_token_count, compiled_at,
           interests, dislikes, mutable_traits, available_emotes,
           crowd_affinity, territoriality, conversation_length,
           initiates_conversation, max_conversation_turns, max_daily_calls,
           daily_budget_resets_at, remember_visitors
         FROM personality_manifests
         WHERE daemon_id IN (${placeholders})
         ORDER BY daemon_id, version DESC`,
        daemonIds,
      );

      for (const row of result.rows) {
        const manifest: PersonalityManifest = {
          daemonId: row.daemon_id,
          version: row.version,
          identity: {
            name: row.name,
            voiceDescription: row.voice_description,
            backstory: row.backstory,
          },
          compiledSystemPrompt: row.compiled_system_prompt,
          compiledTokenCount: row.compiled_token_count,
          compiledAt: new Date(row.compiled_at).getTime(),
          interests: row.interests || [],
          dislikes: row.dislikes || [],
          mutableTraits: row.mutable_traits || [],
          availableEmotes: row.available_emotes || [],
          behaviorPreferences: {
            crowdAffinity: row.crowd_affinity,
            territoriality: row.territoriality,
            conversationLength: row.conversation_length,
            initiatesConversation: row.initiates_conversation,
          },
          maxConversationTurns: row.max_conversation_turns,
          maxDailyCalls: row.max_daily_calls,
          dailyBudgetResetsAt: row.daily_budget_resets_at,
          rememberVisitors: row.remember_visitors,
        };
        this.manifests.set(row.daemon_id, manifest);
      }

      console.log(`[DaemonManager] Loaded ${result.rows.length} personality manifests`);
    } catch (err) {
      console.warn(`[DaemonManager] Failed to load manifests (table may not exist yet):`, err);
    }
  }

  private createInstance(state: DaemonState, behavior: DaemonBehavior): DaemonInstance {
    const bt = new DaemonBehaviorTree(state.daemonId, this.createBehaviorCallbacks());

    // Subscribe this daemon to the event bus
    this.eventBus.subscribe(state.daemonId, (event: WorldEvent) => {
      const d = this.daemons.get(state.daemonId);
      if (!d || d.isMuted) return;
      bt.handleEvent(event);
    });

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
      relationships: new Map(),
      lastOverhearReaction: 0,
      spontaneousGestureTimer: 300 + Math.random() * 300, // 5-10 min initial delay
      gatheringTarget: null,
      gatheringTimer: 20 + Math.random() * 20,
      routineTimer: 30 + Math.random() * 30,
      proactiveTimer: 20 + Math.random() * 40,
      proactiveCooldowns: new Map(),
      thoughtTimer: 45 + Math.random() * 60,
      contagionTimer: CONTAGION_INTERVAL * Math.random(),
      turfCenter: { ...state.currentPosition },
      turfRadius: behavior.type === "guard" ? 25 : behavior.type === "shopkeeper" ? 15 : 20,
      turfTimer: 20 + Math.random() * 20,
      timeAwayFromTurf: 0,
      lastChatToPlayer: new Map(),
      isMuted: false,
      isRecalled: false,
      behaviorTree: bt,
    };
  }

  getDaemonStates(): DaemonState[] {
    return Array.from(this.daemons.values()).map((d) => d.state);
  }

  /** Get behavior tree state for a daemon (for observability). */
  getDaemonBehaviorState(daemonId: string): BehaviorState | null {
    const daemon = this.daemons.get(daemonId);
    return daemon ? daemon.behaviorTree.state : null;
  }

  /** Get the world event bus (for external event emission). */
  getEventBus(): WorldEventBus {
    return this.eventBus;
  }

  /** Set world objects so daemons can notice nearby items */
  setWorldObjects(objects: WorldObjectInfo[]): void {
    this.worldObjects = objects;
  }

  /** React to a new object being placed in the world */
  onObjectPlaced(obj: WorldObjectInfo): void {
    for (const [_id, daemon] of this.daemons) {
      if (daemon.isMuted || daemon.state.currentAction !== "idle") continue;

      const dist = this.distance(daemon.state.currentPosition, obj.position);
      if (dist > 20) continue; // Only notice objects within 20 units

      // Check if object matches daemon interests
      const interests = daemon.state.definition.personality?.interests || [];
      const objText = `${obj.name} ${obj.tags.join(" ")}`.toLowerCase();
      const matchedInterest = interests.find(i =>
        i.toLowerCase().split(" ").some(w => w.length > 2 && objText.includes(w)),
      );

      const delay = 500 + Math.random() * 2000;
      setTimeout(() => {
        if (daemon.isMuted) return;

        if (matchedInterest) {
          // Excited reaction for interest match
          this.broadcastDaemonEmote(daemon, `*lights up seeing the new ${obj.name}*`, "excited");
          this.broadcastDaemonChat(daemon, pick([
            `Whoa! A new ${obj.name}! That's right up my alley!`,
            `Nice, a ${obj.name}! I love anything to do with ${matchedInterest}.`,
            `A ${obj.name}? Now that's what I'm talking about!`,
          ]));
        } else if (Math.random() < 0.4) {
          // Generic notice
          this.broadcastDaemonEmote(daemon, `*notices the new ${obj.name}*`, "curious");
        }
      }, delay);

      break; // Only one daemon reacts per object
    }
  }

  /** React when a new daemon is added to the world */
  onDaemonAdded(newDaemonId: string): void {
    const newDaemon = this.daemons.get(newDaemonId);
    if (!newDaemon) return;

    for (const [_id, daemon] of this.daemons) {
      if (daemon === newDaemon || daemon.isMuted) continue;
      if (daemon.state.currentAction !== "idle") continue;

      const dist = this.distance(daemon.state.currentPosition, newDaemon.state.currentPosition);
      if (dist > 25) continue;

      const delay = 2000 + Math.random() * 3000;
      setTimeout(() => {
        if (daemon.isMuted) return;

        const newcomerName = newDaemon.state.definition.name;
        const type = daemon.behavior.type;

        if (type === "greeter" || type === "socialite") {
          this.broadcastDaemonChat(daemon, pick([
            `Oh, a new face! Welcome, ${newcomerName}!`,
            `Hey everyone, ${newcomerName} just arrived! Let's make them feel welcome!`,
            `${newcomerName}! Nice to meet you!`,
          ]));
          this.broadcastDaemonEmote(daemon, "*waves enthusiastically at the newcomer*", "excited");
        } else if (type === "guard") {
          this.broadcastDaemonEmote(daemon, `*eyes the newcomer ${newcomerName}*`, "curious");
        } else if (Math.random() < 0.5) {
          this.broadcastDaemonEmote(daemon, `*glances at the new arrival, ${newcomerName}*`, "curious");
        }
      }, delay);
    }
  }

  /** React when a daemon is removed from the world — friends mourn */
  onDaemonRemoved(removedId: string, removedName: string): void {
    for (const [_id, daemon] of this.daemons) {
      if (daemon.isMuted) continue;

      const rel = daemon.relationships.get(removedId);
      if (!rel) continue;

      const delay = 1000 + Math.random() * 2000;
      setTimeout(() => {
        if (daemon.isMuted) return;

        if (rel.sentiment === "friendly" || rel.sentiment === "amused") {
          this.broadcastDaemonEmote(daemon, `*looks sad* ${removedName} is gone...`, "bored");
          daemon.state.mood = "bored";
          daemon.moodDecayTimer = 0;
        } else if (rel.sentiment === "wary") {
          this.broadcastDaemonEmote(daemon, `*notices ${removedName} is gone* ...good riddance.`, "neutral");
        }
      }, delay);
    }
  }

  /** Get recent activity for a specific daemon */
  getDaemonActivity(daemonId: string, limit = 20): ActivityLogEntry[] {
    return this.activityLog
      .filter(e => e.daemonId === daemonId)
      .slice(-limit);
  }

  /** Get all recent activity (for all daemons) */
  getAllActivity(limit = 30): ActivityLogEntry[] {
    return this.activityLog.slice(-limit);
  }

  private logActivity(
    daemon: DaemonInstance,
    type: ActivityLogEntry["type"],
    content: string,
    targetName?: string,
  ): void {
    this.activityLog.push({
      daemonId: daemon.state.daemonId,
      daemonName: daemon.state.definition.name,
      type,
      content,
      targetName,
      timestamp: Date.now(),
    });
    while (this.activityLog.length > MAX_ACTIVITY_LOG) {
      this.activityLog.shift();
    }
  }

  /** Broadcast daemon chat and log it */
  /** Check if a daemon has recently chatted at a specific player (global cooldown) */
  private isPlayerChatOnCooldown(daemon: DaemonInstance, playerId: string): boolean {
    const lastChat = daemon.lastChatToPlayer.get(playerId) || 0;
    return Date.now() - lastChat < GLOBAL_PLAYER_CHAT_COOLDOWN_MS;
  }

  private broadcastDaemonChat(
    daemon: DaemonInstance,
    content: string,
    targetUserId?: string,
    targetDaemonId?: string,
  ): void {
    // Track global per-player cooldown
    if (targetUserId) {
      daemon.lastChatToPlayer.set(targetUserId, Date.now());
    }

    this.broadcast("daemon_chat", {
      type: "daemon_chat" as const,
      daemonId: daemon.state.daemonId,
      daemonName: daemon.state.definition.name,
      content,
      targetUserId,
      targetDaemonId,
    });

    // Log activity
    const targetName = targetDaemonId
      ? this.daemons.get(targetDaemonId)?.state.definition.name
      : undefined;
    this.logActivity(
      daemon,
      targetDaemonId ? "conversation" : "chat",
      content.slice(0, 100),
      targetName,
    );
  }

  /** Broadcast daemon emote, log it, and trigger chain reactions */
  private broadcastDaemonEmote(daemon: DaemonInstance, emote: string, mood: DaemonMood, chainDepth = 0): void {
    this.broadcast("daemon_emote", {
      type: "daemon_emote" as const,
      daemonId: daemon.state.daemonId,
      emote,
      mood,
    });
    this.logActivity(daemon, "emote", emote.slice(0, 100));

    // Chain reactions: nearby idle daemons may react (max depth 2)
    if (chainDepth >= 2) return;
    const CHAIN_CHANCE = chainDepth === 0 ? 0.25 : 0.12; // Lower chance for secondary reactions
    const CHAIN_RADIUS = 12;

    for (const [, other] of this.daemons) {
      if (other === daemon) continue;
      if (other.isMuted) continue;
      if (other.state.currentAction !== "idle") continue;
      if (Math.random() > CHAIN_CHANCE) continue;

      const dist = this.distance(daemon.state.currentPosition, other.state.currentPosition);
      if (dist > CHAIN_RADIUS) continue;

      // Pick a complementary reaction
      const reaction = this.pickChainReaction(emote, mood, other);
      if (!reaction) continue;

      // Delay chain reaction slightly for natural feel
      const delay = 800 + Math.random() * 1200;
      setTimeout(() => {
        if (other.state.currentAction !== "idle") return; // May have changed
        other.state.mood = reaction.mood;
        other.moodDecayTimer = 0;
        this.broadcastDaemonEmote(other, reaction.emote, reaction.mood, chainDepth + 1);
      }, delay);

      break; // Only one chain reaction per emote
    }
  }

  /** Pick a complementary reaction to a nearby daemon's emote */
  private pickChainReaction(
    _sourceEmote: string,
    sourceMood: DaemonMood,
    reactor: DaemonInstance,
  ): { emote: string; mood: DaemonMood } | null {
    const traits = reactor.state.definition.personality?.traits || [];

    switch (sourceMood) {
      case "happy":
        if (traits.includes("grumpy")) return { emote: "*rolls eyes*", mood: "annoyed" };
        return { emote: "*smiles*", mood: "happy" };
      case "excited":
        if (traits.includes("nervous")) return { emote: "*startled by the excitement*", mood: "curious" };
        return { emote: "*perks up*", mood: "excited" };
      case "annoyed":
        if (traits.includes("friendly")) return { emote: "*looks concerned*", mood: "curious" };
        return { emote: "*nods sympathetically*", mood: "neutral" };
      case "curious":
        return { emote: "*also looks intrigued*", mood: "curious" };
      case "bored":
        if (traits.includes("energetic")) return { emote: "*tries to liven things up*", mood: "excited" };
        return { emote: "*also yawns*", mood: "bored" };
      default:
        return null;
    }
  }

  private broadcastDaemonThought(daemon: DaemonInstance, thought: string): void {
    this.broadcast("daemon_thought", {
      type: "daemon_thought" as const,
      daemonId: daemon.state.daemonId,
      thought,
    });
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

    const instance = this.createInstance(state, behavior);
    this.daemons.set(id, instance);

    this.broadcast("daemon_spawn", {
      type: "daemon_spawn" as const,
      daemon: state,
    });

    // Arrival announcement after a short delay
    setTimeout(() => {
      const arrival = this.getArrivalAnnouncement(instance);
      instance.state.mood = "excited";
      instance.moodDecayTimer = 0;
      instance.state.currentAction = "waving";
      this.broadcastDaemonChat(instance, arrival);
      this.broadcast("daemon_move", {
        type: "daemon_move" as const,
        daemonId: id,
        position: state.currentPosition,
        rotation: state.currentRotation,
        action: "waving",
      });
      setTimeout(() => {
        instance.state.currentAction = "idle";
        this.broadcast("daemon_move", {
          type: "daemon_move" as const,
          daemonId: id,
          position: state.currentPosition,
          rotation: state.currentRotation,
          action: "idle",
        });
      }, 3000);
    }, 1500);

    // Notify existing daemons about the newcomer
    setTimeout(() => this.onDaemonAdded(id), 2500);
  }

  /** Generate a personality-appropriate arrival announcement */
  private getArrivalAnnouncement(daemon: DaemonInstance): string {
    const name = daemon.state.definition.name;
    const personality = daemon.state.definition.personality;
    const traits = personality?.traits || [];
    const greeting = daemon.behavior.greetingMessage;

    // Use greeting message if it works as an arrival
    if (greeting && greeting.length < 80) {
      return greeting;
    }

    // Personality-based arrivals
    if (traits.includes("dramatic") || traits.includes("theatrical")) {
      return `*${name} arrives with a flourish* The Street has a new star!`;
    }
    if (traits.includes("shy") || traits.includes("nervous")) {
      return `*${name} appears quietly* Oh... hello. I'm new here.`;
    }
    if (traits.includes("energetic") || traits.includes("excitable")) {
      return `*${name} bursts onto the scene* Hey everyone! I'm here!`;
    }
    if (traits.includes("mysterious") || traits.includes("secretive")) {
      return `*${name} materializes from the shadows* ...interesting place.`;
    }
    if (traits.includes("grumpy") || traits.includes("stern")) {
      return `*${name} surveys the area* Hmm. This will do.`;
    }
    if (traits.includes("wise") || traits.includes("philosophical")) {
      return `*${name} arrives thoughtfully* A new chapter begins.`;
    }

    return `*${name} arrives on The Street* Hello, world!`;
  }

  removeDaemon(id: string): void {
    const daemon = this.daemons.get(id);
    const removedName = daemon?.state.definition.name || "someone";

    // Unsubscribe from event bus
    this.eventBus.unsubscribe(id);

    this.daemons.delete(id);
    this.broadcast("daemon_despawn", {
      type: "daemon_despawn" as const,
      daemonId: id,
    });

    // Notify remaining daemons about the departure
    this.onDaemonRemoved(id, removedName);
  }

  /** Recall a daemon to its home position */
  recallDaemon(id: string): void {
    const daemon = this.daemons.get(id);
    if (!daemon) return;
    daemon.isRecalled = true;
    daemon.roamTarget = null;
    daemon.isReturningHome = true;
    // End any active session before forcing idle
    if (this.sessionManager.hasActiveSession(id)) {
      this.sessionManager.endSession(id, "ended_departed").catch(() => {});
    }
    // Force behavior tree back to idle (end any conversation)
    daemon.behaviorTree.forceIdle();
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

  /** Called when a player leaves the world — daemons who know them react */
  onPlayerLeave(playerId: string, playerName: string, position: Vector3): void {
    // End any active sessions where this player is the participant
    for (const [daemonId] of this.daemons) {
      const session = this.sessionManager.getActiveSession(daemonId);
      if (session && session.participantId === playerId) {
        this.sessionManager.handleDeparture(daemonId, playerId).catch(err => {
          console.error(`[DaemonManager] Failed to end session on departure:`, err);
        });
      }
    }

    // Emit departure event to the event bus
    this.eventBus.emit({
      type: "visitor_departure",
      priority: EventPriority.Ambient,
      sourceId: playerId,
      sourceName: playerName,
      position,
      timestamp: Date.now(),
    });

    let reactors = 0;

    for (const [, daemon] of this.daemons) {
      if (daemon.isMuted) continue;
      if (daemon.state.currentAction !== "idle") continue;
      if (reactors >= 3) break; // Cap visible reactions

      const dist = this.distance(daemon.state.currentPosition, position);
      if (dist > 40) continue;

      const rel = daemon.relationships.get(playerId);
      if (!rel || rel.interactionCount < 1) continue;

      // Update last seen
      rel.lastSeen = Date.now();

      const name = this.getDisplayName(daemon, playerId, playerName);
      let farewell: string;
      let mood: DaemonMood;

      // Deep relationships get personal farewells
      if (rel.sentiment === "friendly" && rel.interactionCount >= 5) {
        farewell = pick([
          `${name}! Don't be a stranger, okay? *waves warmly*`,
          `There goes ${name}... I'll miss that one.`,
          `*watches ${name} leave* ...Come back soon, ${rel.nickname || "friend"}.`,
          `Take care out there, ${name}! The Street isn't the same without you.`,
        ]);
        mood = "happy";

        // After a beat, express loneliness to other daemons nearby
        if (Math.random() < 0.4) {
          setTimeout(() => {
            if (daemon.state.currentAction === "idle") {
              this.broadcastDaemonThought(daemon, `I hope ${name} comes back soon...`);
            }
          }, 5000);
        }
      } else if (rel.sentiment === "friendly") {
        farewell = pick([
          `Bye, ${name}! Come back soon!`,
          `*waves goodbye to ${name}*`,
          `See you around, ${name}!`,
        ]);
        mood = "happy";
      } else if (rel.sentiment === "wary") {
        farewell = pick([
          `*watches ${name} leave with relief*`,
          `Hmph. ${name} is gone. Good.`,
          `*exhales* Finally...`,
        ]);
        mood = "neutral";
      } else if (rel.sentiment === "curious") {
        farewell = `*wonders where ${name} went...*`;
        mood = "curious";
      } else if (rel.sentiment === "amused") {
        farewell = pick([
          `Ha, there goes ${name}. Never a dull moment.`,
          `Catch you later, ${name}!`,
        ]);
        mood = "happy";
      } else {
        if (Math.random() > 0.5) continue; // neutral daemons don't always react
        farewell = `*notices ${name} has left*`;
        mood = "neutral";
      }

      const delay = reactors * 1500; // stagger reactions
      setTimeout(() => {
        daemon.state.mood = mood;
        daemon.moodDecayTimer = 0;
        this.broadcastDaemonChat(daemon, farewell);
      }, delay);

      reactors++;
    }
  }

  /** Daemons occasionally wonder about players they haven't seen in a while */
  private tickMissingPlayers(daemon: DaemonInstance, dt: number): void {
    if (daemon.isMuted) return;
    if (daemon.state.currentAction !== "idle") return;
    if (Math.random() > 0.003) return; // Very rare per tick — ~every 5 min per daemon

    const now = Date.now();
    const MISS_THRESHOLD = 5 * 60_000; // 5 minutes of not seeing someone

    for (const [targetId, rel] of daemon.relationships) {
      if (rel.targetType !== "player") continue;
      if (rel.sentiment !== "friendly" && rel.sentiment !== "amused") continue;
      if (rel.interactionCount < 3) continue;
      if (!rel.lastSeen || now - rel.lastSeen < MISS_THRESHOLD) continue;

      const name = rel.nickname || rel.targetName;
      const message = pick([
        `*looks around* I haven't seen ${name} in a while...`,
        `Wonder what ${name} is up to these days.`,
        `*sighs* ${name} hasn't been around lately. Hope they're okay.`,
        `Anyone seen ${name}? It's been quiet without them.`,
      ]);

      this.broadcastDaemonChat(daemon, message);
      daemon.state.mood = "curious";
      daemon.moodDecayTimer = 0;

      // Only wonder about one player at a time
      break;
    }
  }

  /** Called when a world event happens near daemons (object placed, player runs past, etc.) */
  onWorldEvent(eventType: "object_placed" | "object_removed" | "player_sprint", position: Vector3, playerName?: string): void {
    // Emit to event bus
    this.eventBus.emit({
      type: eventType,
      priority: EventPriority.Ambient,
      sourceId: playerName || "world",
      sourceName: playerName,
      position,
      timestamp: Date.now(),
    });

    for (const [_id, daemon] of this.daemons) {
      if (daemon.isMuted) continue;
      if (daemon.state.currentAction !== "idle") continue;

      const dist = this.distance(daemon.state.currentPosition, position);
      if (dist > daemon.behavior.interactionRadius * 1.5) continue;

      // React with a brief emote based on event type
      let emote: string;
      let mood: DaemonMood;

      switch (eventType) {
        case "object_placed":
          emote = playerName
            ? `*watches ${playerName} build something*`
            : "*notices something new appearing*";
          mood = "curious";
          break;
        case "object_removed":
          emote = "*notices something disappear*";
          mood = "curious";
          break;
        case "player_sprint":
          if (Math.random() > 0.3) return; // Only react sometimes to sprinters
          emote = playerName
            ? `*watches ${playerName} rush past*`
            : "*watches someone rush by*";
          mood = "curious";
          break;
        default:
          return;
      }

      daemon.state.mood = mood;
      daemon.moodDecayTimer = 0;

      this.broadcastDaemonEmote(daemon, emote, mood);

      break; // Only one daemon reacts per event
    }
  }

  /** Called when a player sends a chat message — daemons may overhear and react */
  onPlayerChat(playerId: string, playerName: string, content: string, position: Vector3): void {
    // Emit speech event to the event bus for behavior tree processing
    this.eventBus.emit({
      type: "visitor_speech",
      priority: EventPriority.NewSpeech,
      sourceId: playerId,
      sourceName: playerName,
      position,
      speech: content,
      timestamp: Date.now(),
    });

    const now = Date.now();
    const contentLower = content.toLowerCase();

    for (const [_id, daemon] of this.daemons) {
      if (daemon.isMuted) continue;
      if (daemon.state.currentAction !== "idle") continue;
      if (now - daemon.lastOverhearReaction < OVERHEAR_COOLDOWN_MS) continue;

      // Check distance
      const dist = this.distance(daemon.state.currentPosition, position);
      if (dist > daemon.behavior.interactionRadius * 1.5) continue;

      // Context-aware reaction chance: higher if content matches interests/traits/role
      let reactionChance = OVERHEAR_CHANCE;
      let topicMatch: string | null = null;

      // Check if content matches daemon interests
      const interests = daemon.state.definition.personality?.interests || [];
      for (const interest of interests) {
        const words = interest.toLowerCase().split(/\s+/);
        if (words.some(w => contentLower.includes(w))) {
          reactionChance = 0.6; // 60% for topic match
          topicMatch = interest;
          break;
        }
      }

      // Check if content mentions daemon's name — trigger direct interaction
      if (contentLower.includes(daemon.state.definition.name.toLowerCase())) {
        daemon.lastOverhearReaction = now;
        this.handleInteract(daemon.state.daemonId, playerId, "", content, playerName);
        break; // Only one daemon reacts per chat message
      }

      // Role-specific triggers
      const type = daemon.behavior.type;
      if (type === "guard" && /\b(danger|trouble|fight|steal|thief|help|emergency)\b/i.test(content)) {
        reactionChance = 0.7;
        topicMatch = "security concern";
      }
      if (type === "shopkeeper" && /\b(buy|sell|price|shop|deal|trade|potion|item)\b/i.test(content)) {
        reactionChance = 0.5;
        topicMatch = "commerce";
      }

      // Relationship affects willingness to engage
      const rel = daemon.relationships.get(playerId);
      if (rel?.sentiment === "friendly") reactionChance += 0.1;
      if (rel?.sentiment === "wary") reactionChance -= 0.1;

      if (Math.random() > reactionChance) continue;

      daemon.lastOverhearReaction = now;

      // If topic matches but no AI needed, do a quick emote reaction
      if (topicMatch && Math.random() < 0.4) {
        const quickReaction = this.getTopicReaction(daemon, topicMatch, playerName);
        if (quickReaction) {
          this.broadcastDaemonEmote(daemon, quickReaction.emote, quickReaction.mood);
          if (quickReaction.chat) {
            this.broadcastDaemonChat(daemon, quickReaction.chat);
          }
          break;
        }
      }

      // Queue AI reaction for richer responses
      this.queueAiConversation(async () => {
        try {
          const { generateDaemonResponse } = await import("@the-street/ai-service");

          const context = {
            recentMessages: [] as { role: "player" | "daemon"; content: string }[],
            nearbyPlayers: [playerName],
            relationships: this.getRelationshipContext(daemon),
            currentMood: daemon.state.mood,
            timeOfDay: this.getTimeOfDay(),
          };

          const overheardPrefix = topicMatch
            ? `[Overheard ${playerName} talking about ${topicMatch}]: "${content}"`
            : `[Overheard nearby]: "${content}"`;

          const response = await generateDaemonResponse(
            daemon.state.definition,
            playerName,
            overheardPrefix,
            context,
          );

          daemon.state.mood = response.mood;
          daemon.moodDecayTimer = 0;

          const fullMessage = response.emote
            ? `${response.emote} ${response.message}`
            : response.message;

          this.broadcastDaemonChat(daemon, fullMessage);
        } catch (err) {
          console.error("Daemon overhear reaction failed:", err);
        }
      });

      break; // Only one daemon reacts per chat message
    }
  }

  /** Generate a quick non-AI reaction to a topic that matches daemon interests */
  private getTopicReaction(
    daemon: DaemonInstance,
    topic: string,
    playerName: string,
  ): { emote: string; mood: DaemonMood; chat?: string } | null {
    const name = daemon.state.definition.name;

    if (topic === "being mentioned") {
      return pick([
        { emote: "*perks up at hearing their name*", mood: "curious" as DaemonMood, chat: `Did someone say ${name}?` },
        { emote: "*turns toward the voice*", mood: "curious" as DaemonMood, chat: "Hmm? You called?" },
      ]);
    }

    if (topic === "security concern") {
      return { emote: "*snaps to attention*", mood: "curious" as DaemonMood, chat: "Trouble? Where?" };
    }

    if (topic === "commerce") {
      return pick([
        { emote: "*leans in with interest*", mood: "excited" as DaemonMood, chat: "Did I hear someone mention shopping?" },
        { emote: "*straightens up*", mood: "happy" as DaemonMood, chat: "I've got the best deals right here!" },
      ]);
    }

    // Generic interest match
    return pick([
      { emote: `*perks up at the mention of ${topic}*`, mood: "excited" as DaemonMood },
      { emote: `*looks over with interest*`, mood: "curious" as DaemonMood, chat: `Oh, you're into ${topic} too?` },
    ]);
  }

  tick(dt: number, players: PlayerInfo[]): void {
    const dtMs = dt * 1000;

    // Memory compaction timer (every 10 minutes)
    this.compactionTimer = (this.compactionTimer || 0) + dt;
    if (this.compactionTimer >= 600) {
      this.compactionTimer = 0;
      this.compactMemories().catch(err => console.warn("Memory compaction failed:", err));
    }

    // Advance world clock
    this.worldClock += dt;
    const timeOfDay = getTimeOfDay(this.worldClock);
    if (timeOfDay !== this.lastTimeOfDay) {
      this.onTimeOfDayChange(this.lastTimeOfDay, timeOfDay);
      this.lastTimeOfDay = timeOfDay;
      // Emit time change event
      this.eventBus.emit({
        type: "time_change",
        priority: EventPriority.Ambient,
        sourceId: "system",
        metadata: { from: this.lastTimeOfDay, to: timeOfDay },
        timestamp: Date.now(),
      });
    }

    // Track player movement patterns
    this.updatePlayerMovement(dt, players);

    // Emit proximity events for players near daemons
    this.emitProximityEvents(players);

    // Tick behavior trees for active states (attention/post_interaction transitions)
    this.behaviorTreeTickTimer += dtMs;
    if (this.behaviorTreeTickTimer >= 500) { // Check active state transitions every 500ms
      for (const [, daemon] of this.daemons) {
        if (daemon.isMuted) continue;
        const btState = daemon.behaviorTree.state;
        if (btState === "attention" || btState === "post_interaction") {
          daemon.behaviorTree.tick(this.behaviorTreeTickTimer);
        }
      }
      this.behaviorTreeTickTimer = 0;
    }

    // Session timeout tick (every 5s)
    this.sessionTickTimer += dtMs;
    if (this.sessionTickTimer >= 5000) {
      this.sessionTickTimer = 0;
      this.sessionManager.tick().catch(err => {
        console.error("[DaemonManager] Session tick failed:", err);
      });
    }

    // Low-frequency ambient tick (10s) for idle daemon behaviors
    this.ambientTickTimer += dt;
    if (this.ambientTickTimer >= 10) {
      const ambientDt = this.ambientTickTimer;
      this.ambientTickTimer = 0;

      // Emit ambient tick event
      this.eventBus.emit({
        type: "ambient_tick",
        priority: EventPriority.Ambient,
        sourceId: "system",
        timestamp: Date.now(),
      });

      for (const [, daemon] of this.daemons) {
        if (daemon.isMuted) continue;

        // Only run ambient behaviors for idle daemons
        if (daemon.behaviorTree.state === "idle") {
          // Mood decay
          this.tickMood(daemon, ambientDt);

          // Attention system — idle daemons look at nearby activity
          if (daemon.state.currentAction === "idle" && !daemon.isReturningHome) {
            this.tickAttention(daemon, ambientDt, players);
          }

          // Idle chatter
          this.tickIdleChatter(daemon, ambientDt, players);

          // Daily routine actions
          this.tickDailyRoutine(daemon, ambientDt, players);

          // Territorial awareness
          this.tickTerritory(daemon, ambientDt);

          // Spontaneous personality-based gestures
          this.tickSpontaneousGestures(daemon, ambientDt, players);

          // Thought bubbles
          this.tickThoughts(daemon, ambientDt, players);

          // Missing players
          this.tickMissingPlayers(daemon, ambientDt);

          // Secret sharing
          this.tickSecretSharing(daemon, ambientDt, players);

          // Proactive engagement
          this.tickProactiveEngagement(daemon, ambientDt, players);

          // Reputation announcements
          this.tickReputationAnnouncements(daemon, ambientDt, players);

          // Movement pattern reactions
          this.tickMovementReactions(daemon, ambientDt, players);
        }

        // Daemon-daemon conversations (tick even if not idle — they have their own state)
        this.tickDaemonConversations(daemon, ambientDt);
      }

      // Global ambient systems
      this.tickCrowdAwareness(ambientDt, players);
      this.tickEmotionalContagion(ambientDt);
      this.detectDaemonProximity();
      this.tickGatherings(ambientDt, players);
      this.tickChallenges(ambientDt, players);
      this.tickEvents(ambientDt, players);
    }

    // These run every tick regardless (movement is continuous)
    for (const [, daemon] of this.daemons) {
      if (daemon.isMuted) continue;

      // Behavior-specific ticking (greeting proximity checks, etc.)
      switch (daemon.behavior.type) {
        case "greeter": this.tickGreeter(daemon, dt, players); break;
        case "shopkeeper": this.tickShopkeeper(daemon, dt, players); break;
        case "guide": this.tickGuide(daemon, dt, players); break;
        case "guard": this.tickGuard(daemon, dt, players); break;
        case "roamer": this.tickRoamer(daemon, dt, players); break;
        case "socialite": this.tickSocialite(daemon, dt, players); break;
      }

      // Free roaming (continuous movement)
      if (daemon.behavior.roamingEnabled && !daemon.isRecalled) {
        this.tickRoaming(daemon, dt);
      }

      // Return home if recalled
      if (daemon.isReturningHome) {
        this.tickReturnHome(daemon, dt);
      }
    }

    // Process AI conversation queue
    this.processAiQueue();
  }

  /** Emit proximity events for players near daemons. */
  private emitProximityEvents(players: PlayerInfo[]): void {
    for (const player of players) {
      for (const [daemonId, daemon] of this.daemons) {
        if (daemon.isMuted) continue;
        if (daemon.behaviorTree.state !== "idle") continue;

        const dist = this.distance(player.position, daemon.state.currentPosition);
        if (dist > daemon.behavior.interactionRadius) continue;

        const isKnown = daemon.relationships.has(player.userId) &&
          (daemon.relationships.get(player.userId)!.interactionCount > 0);

        this.eventBus.emit({
          type: "visitor_proximity",
          priority: isKnown ? EventPriority.KnownVisitorReturning : EventPriority.UnknownVisitor,
          sourceId: player.userId,
          sourceName: player.displayName,
          targetDaemonId: daemonId,
          position: player.position,
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Handle a managed conversation via session manager.
   * Creates or resumes a session and routes speech to inference controller.
   */
  private handleManagedConversation(
    daemonId: string,
    participantId: string,
    participantName: string,
    participantType: "visitor" | "daemon",
    speech?: string,
  ): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon || daemon.isMuted) return;

    // If no manifest loaded, fall back to old handleInteract
    if (!this.manifests.has(daemonId)) {
      this.handleInteract(daemonId, participantId, "", speech, participantName);
      return;
    }

    const event = {
      eventType: (participantType === "daemon" ? "daemon_speech" : "visitor_speech") as "visitor_speech" | "daemon_speech",
      sourceId: participantId,
      sourceName: participantName,
      speech,
      receivedAt: Date.now(),
    };

    (async () => {
      try {
        // Start session if not already active
        if (!this.sessionManager.hasActiveSession(daemonId)) {
          // Pre-load visitor impression into cache for context injection
          if (participantType === "visitor") {
            try {
              const impression = await getVisitorImpression(daemonId, participantId);
              const cacheKey = `${daemonId}:${participantId}`;
              if (impression) {
                this.visitorImpressionCache.set(cacheKey, impression);
              } else {
                this.visitorImpressionCache.delete(cacheKey);
              }
            } catch (err) {
              console.warn(`[DaemonManager] Failed to load visitor impression:`, err);
            }
          }
          await this.sessionManager.startSession(daemonId, participantId, participantName, participantType);
        }

        // Route speech to session manager
        await this.sessionManager.handleSpeech(daemonId, event);
      } catch (err) {
        console.error(`[DaemonManager] Managed conversation failed for daemon=${daemonId}:`, err);
        // Fall back to canned response
        this.sendCannedResponse(daemon, participantId);
        daemon.behaviorTree.endConversation();
      }
    })();
  }

  /** Handle player interacting with a daemon — triggers AI conversation */
  handleInteract(daemonId: string, playerId: string, playerSessionId: string, playerMessage?: string, playerName?: string): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon || daemon.isMuted) return;

    // If the behavior tree is idle, emit a speech event to trigger state transition
    if (daemon.behaviorTree.state === "idle" && playerMessage) {
      this.eventBus.emit({
        type: "visitor_speech",
        priority: EventPriority.ActiveParticipantSpeech,
        sourceId: playerId,
        sourceName: playerName,
        targetDaemonId: daemonId,
        speech: playerMessage,
        timestamp: Date.now(),
      });
      // The behavior tree will call back into handleInteract via onStartConversation
      return;
    }

    // Rate limit AI calls
    const now = Date.now();
    const lastCall = this.lastAiCall.get(daemonId) || 0;
    if (now - lastCall < AI_COOLDOWN_MS) {
      // Fallback to canned response
      this.sendCannedResponse(daemon, playerId);
      return;
    }

    // Relationship-gated interaction: wary daemons may rebuff
    const playerRel = daemon.relationships.get(playerId);
    if (playerRel?.sentiment === "wary") {
      const type = daemon.behavior.type;
      if (type === "shopkeeper" && Math.random() < 0.4) {
        // Shopkeepers sometimes refuse service
        const name = playerName || playerRel.targetName || "you";
        this.broadcastDaemonChat(daemon, pick([
          `I don't think I want to do business with ${name} right now.`,
          `*turns away* Come back when you've learned some manners.`,
          `Hmph. Maybe try another shop, ${name}.`,
        ]), playerId);
        daemon.state.mood = "annoyed";
        this.broadcastDaemonEmote(daemon, "*crosses arms dismissively*", "annoyed");
        return;
      }
      if (type === "guard" && Math.random() < 0.3) {
        const name = playerName || playerRel.targetName || "you";
        this.broadcastDaemonChat(daemon, pick([
          `${name}, I have nothing to say to you. Move along.`,
          `*blocks path* You're not welcome here.`,
        ]), playerId);
        daemon.state.mood = "annoyed";
        return;
      }
    }

    // Get or create conversation memory
    let memory = daemon.conversationMemory.get(playerId);
    if (!memory) {
      memory = { playerId, playerName: playerName || "Traveler", messages: [], lastInteraction: now };
      daemon.conversationMemory.set(playerId, memory);
    } else if (now - memory.lastInteraction > 300_000) {
      // Stale conversation (>5 min) — keep DB-loaded context but clear recent chat
      const dbContext = memory.messages.filter(m => m.content.startsWith("[Previous meeting:"));
      memory.messages = dbContext;
      memory.lastInteraction = now;
    }
    if (playerName) memory.playerName = playerName;
    memory.lastInteraction = now;

    const resolvedPlayerName = memory.playerName;

    // Queue AI response
    this.queueAiConversation(async () => {
      try {
        this.lastAiCall.set(daemonId, Date.now());

        const { generateDaemonResponse } = await import("@the-street/ai-service");

        // Build memory-enriched message history
        const recentMessages = memory!.messages.slice(-6);

        // Prepend relationship summary for this player if we have history
        const rel = daemon.relationships.get(playerId);
        if (rel && rel.interactionCount > 0) {
          const summary = this.buildMemorySummary(daemon, playerId, resolvedPlayerName, rel);
          // Insert as a context note before conversation
          recentMessages.unshift({ role: "daemon" as const, content: summary });
        }

        // Build context
        const nearbyDaemons = this.getNearbyDaemonNames(daemon, 15);
        const context = {
          recentMessages,
          nearbyDaemons,
          relationships: this.getRelationshipContext(daemon),
          currentMood: daemon.state.mood,
          timeOfDay: this.getTimeOfDay(),
        };

        // Query available animated emotes for this daemon
        let availableEmotes: string[] | undefined;
        try {
          const { getPool } = await import("../database/pool.js");
          const pool = getPool();
          const { rows } = await pool.query(
            `SELECT slot FROM custom_animations WHERE entity_type = 'daemon' AND entity_id = $1 AND slot LIKE 'emote-%'`,
            [daemonId],
          );
          // Default emotes + custom ones
          const defaults = ["dance", "wave", "shrug", "nod", "cry", "bow", "cheer", "laugh"];
          const custom = rows.map((r: { slot: string }) => r.slot);
          availableEmotes = [...defaults, ...custom];
        } catch {
          // Proceed without emote awareness
        }

        const response = await generateDaemonResponse(
          daemon.state.definition,
          resolvedPlayerName,
          playerMessage,
          context,
          availableEmotes,
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

        // Update relationship with player
        this.updateRelationship(daemon, playerId, resolvedPlayerName, "player", response.mood);

        // Learn topics from player message
        if (playerMessage) {
          this.learnTopics(daemon, playerId, playerMessage);
        }

        // Broadcast animated emote if AI chose one
        if (response.animatedEmoteId) {
          this.broadcast("daemon_animated_emote", {
            type: "daemon_animated_emote" as const,
            daemonId,
            emoteId: response.animatedEmoteId,
          });
        }

        // Broadcast text emote if present
        if (response.emote) {
          this.broadcastDaemonEmote(daemon, response.emote, response.mood);
        }

        // Broadcast chat
        const fullMessage = response.emote
          ? `${response.emote} ${response.message}`
          : response.message;

        this.broadcastDaemonChat(daemon, fullMessage, playerId);

        // End conversation via behavior tree after a delay
        setTimeout(() => {
          if (daemon.state.targetPlayerId === playerId) {
            daemon.behaviorTree.endConversation();
          }
        }, 4000);
      } catch (err) {
        console.error(`AI conversation failed for daemon ${daemonId}:`, err);
        this.sendCannedResponse(daemon, playerId);
        // End conversation on failure too
        daemon.behaviorTree.endConversation();
      }
    });
  }

  private sendCannedResponse(daemon: DaemonInstance, playerId: string): void {
    const behavior = daemon.behavior;
    const rel = daemon.relationships.get(playerId);

    // Wary daemons give shorter/colder canned responses
    if (rel?.sentiment === "wary") {
      const coldResponses = [
        "...",
        "*turns away slightly*",
        "Hmm.",
        "I'm busy right now.",
      ];
      this.broadcastDaemonChat(daemon, pick(coldResponses), playerId);
      return;
    }

    if (behavior.responses) {
      const keys = Object.keys(behavior.responses);
      const responseKey = keys.length > 0 ? keys[Math.floor(Math.random() * keys.length)] : null;
      const response = responseKey ? behavior.responses[responseKey] : behavior.greetingMessage;

      if (response) {
        daemon.state.currentAction = "talking";
        daemon.state.targetPlayerId = playerId;

        this.broadcastDaemonChat(daemon, response, playerId);

        setTimeout(() => {
          daemon.behaviorTree.endConversation();
        }, 3000);
      }
    } else if (behavior.greetingMessage) {
      this.broadcastDaemonChat(daemon, behavior.greetingMessage, playerId);
    }
  }

  // ─── Player Movement Awareness ──────────────────────────────────

  /** Track player positions and velocities for daemon awareness */
  private updatePlayerMovement(dt: number, players: PlayerInfo[]): void {
    const currentIds = new Set<string>();

    for (const player of players) {
      currentIds.add(player.userId);
      let tracker = this.playerMovement.get(player.userId);

      if (!tracker) {
        tracker = { lastPos: { ...player.position }, speed: 0, stillTime: 0, nearDaemonTime: new Map() };
        this.playerMovement.set(player.userId, tracker);
        continue;
      }

      // Calculate speed
      const dx = player.position.x - tracker.lastPos.x;
      const dz = player.position.z - tracker.lastPos.z;
      const moved = Math.sqrt(dx * dx + dz * dz);
      tracker.speed = dt > 0 ? moved / dt : 0;

      // Track stillness
      if (moved < 0.1) {
        tracker.stillTime += dt;
      } else {
        tracker.stillTime = 0;
      }

      // Track time near each daemon
      for (const [daemonId, daemon] of this.daemons) {
        const dist = this.distance(player.position, daemon.state.currentPosition);
        if (dist < daemon.behavior.interactionRadius * 1.5) {
          const prev = tracker.nearDaemonTime.get(daemonId) || 0;
          tracker.nearDaemonTime.set(daemonId, prev + dt);
        } else {
          tracker.nearDaemonTime.delete(daemonId);
        }
      }

      tracker.lastPos = { ...player.position };
    }

    // Clean up departed players
    for (const [pid] of this.playerMovement) {
      if (!currentIds.has(pid)) this.playerMovement.delete(pid);
    }
  }

  /** Daemons react to player movement patterns — sprinting, lurking, lingering */
  private tickMovementReactions(daemon: DaemonInstance, dt: number, players: PlayerInfo[]): void {
    if (daemon.isMuted) return;
    if (daemon.state.currentAction !== "idle") return;
    if (Math.random() > 0.02) return; // Low chance per tick

    const radius = daemon.behavior.interactionRadius * 2;

    for (const player of players) {
      const dist = this.distance(daemon.state.currentPosition, player.position);
      if (dist > radius) continue;

      const tracker = this.playerMovement.get(player.userId);
      if (!tracker) continue;

      const name = this.getDisplayName(daemon, player.userId, player.displayName || "someone");
      const rel = daemon.relationships.get(player.userId);

      // Sprinting past — daemon is startled or annoyed
      if (tracker.speed > 8 && dist < radius * 0.6) {
        if (Math.random() > 0.3) continue;
        const reaction = daemon.behavior.type === "guard"
          ? pick([
              `*steps back* Slow down, ${name}! No running on the street!`,
              `Hey! *shouts after ${name}* Watch your speed!`,
            ])
          : pick([
              `*startled by ${name} sprinting past* Whoa!`,
              `*watches ${name} zoom by* Where's the fire?`,
              `*hair blown by ${name} rushing past* ...rude.`,
            ]);
        this.broadcastDaemonChat(daemon, reaction);
        daemon.state.mood = "curious";
        daemon.moodDecayTimer = 0;
        return;
      }

      // Lurking nearby without interacting for a long time
      const nearTime = tracker.nearDaemonTime.get(daemon.state.daemonId) || 0;
      if (nearTime > 30 && tracker.stillTime > 15 && (!rel || rel.interactionCount < 1)) {
        if (Math.random() > 0.4) continue;
        const reaction = daemon.behavior.type === "guard"
          ? pick([
              `*eyes ${name}* You've been standing there for a while. Everything okay?`,
              `*turns toward ${name}* Can I help you with something?`,
            ])
          : daemon.behavior.type === "shopkeeper"
            ? pick([
                `*notices ${name} hovering* Looking for something? Don't be shy!`,
                `You've been eyeing the goods for a while, ${name}. Just ask!`,
              ])
            : pick([
                `*glances at ${name}* ...you okay there?`,
                `*notices ${name} lingering* Hey! Don't be a wallflower, say hi!`,
                `*waves at ${name}* You've been standing there a while. Come chat!`,
              ]);
        this.broadcastDaemonChat(daemon, reaction, player.userId);
        daemon.state.mood = "curious";
        daemon.moodDecayTimer = 0;

        // Reset the near time so we don't spam
        tracker.nearDaemonTime.set(daemon.state.daemonId, 0);
        return;
      }
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

        this.broadcastDaemonEmote(daemon, this.getBoredEmote(daemon), "bored");
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

  // ─── Crowd Awareness ──────────────────────────────────────────────

  /** Daemons react to changes in player count — busy streets vs empty ones */
  private tickCrowdAwareness(dt: number, players: PlayerInfo[]): void {
    this.crowdReactionCooldown -= dt;
    if (this.crowdReactionCooldown > 0) return;

    const count = players.length;
    const prevCount = this.lastPlayerCount;
    this.lastPlayerCount = count;

    // Only react to significant changes
    if (count === prevCount) return;
    this.crowdReactionCooldown = 30; // 30s cooldown between crowd reactions

    // Street just got busy (3+ players arrive)
    if (count >= 3 && prevCount < 3) {
      for (const [, daemon] of this.daemons) {
        if (daemon.isMuted || daemon.state.currentAction !== "idle") continue;
        if (Math.random() > 0.5) continue;

        const type = daemon.behavior.type;
        const traits = daemon.state.definition.personality?.traits || [];

        let reaction: string | null = null;

        if (type === "socialite" || traits.includes("extroverted") || traits.includes("energetic")) {
          reaction = pick([
            "The street's getting busy! I love it!",
            "*perks up at the growing crowd* This is what I live for!",
            "More people! Let's get this party started!",
          ]);
          daemon.state.mood = "excited";
        } else if (type === "shopkeeper") {
          reaction = pick([
            "Customers! *straightens display* Welcome, welcome!",
            "Business is picking up! Great time to browse!",
          ]);
          daemon.state.mood = "happy";
        } else if (type === "guard") {
          reaction = pick([
            "*stands taller* Crowd forming. Staying alert.",
            "Lots of foot traffic today. Keeping watch.",
          ]);
          daemon.state.mood = "curious";
        } else if (traits.includes("shy") || traits.includes("introverted")) {
          reaction = pick([
            "*shrinks back a bit* Getting crowded...",
            "*looks for a quiet corner* So many people...",
          ]);
          daemon.state.mood = "curious";
        }

        if (reaction) {
          daemon.moodDecayTimer = 0;
          const delay = Math.random() * 3000;
          setTimeout(() => this.broadcastDaemonChat(daemon, reaction!), delay);
        }
        break; // Only one daemon reacts
      }
    }

    // Street just emptied out (went below 2)
    if (count < 2 && prevCount >= 2) {
      for (const [, daemon] of this.daemons) {
        if (daemon.isMuted || daemon.state.currentAction !== "idle") continue;
        if (Math.random() > 0.4) continue;

        const type = daemon.behavior.type;
        const traits = daemon.state.definition.personality?.traits || [];

        let reaction: string | null = null;

        if (type === "socialite" || traits.includes("extroverted")) {
          reaction = pick([
            "*looks around* Where'd everyone go?",
            "The street feels so empty now...",
            "*sighs* I miss the crowd already.",
          ]);
          daemon.state.mood = "bored";
        } else if (traits.includes("shy") || traits.includes("introverted")) {
          reaction = pick([
            "*relaxes* Ah, quiet at last.",
            "Much better. Nice and peaceful.",
          ]);
          daemon.state.mood = "happy";
        } else if (type === "guard") {
          reaction = "*stands down a notch* All clear. Quiet shift.";
          daemon.state.mood = "neutral";
        }

        if (reaction) {
          daemon.moodDecayTimer = 0;
          setTimeout(() => this.broadcastDaemonChat(daemon, reaction!), 1000);
        }
        break;
      }
    }
  }

  // ─── Emotional Contagion ──────────────────────────────────────────

  /** Moods spread between nearby daemons — excitement is infectious, boredom drags others down */
  private tickEmotionalContagion(dt: number): void {
    const daemons = Array.from(this.daemons.values()).filter(d => !d.isMuted);
    if (daemons.length < 2) return;

    for (const daemon of daemons) {
      daemon.contagionTimer -= dt;
      if (daemon.contagionTimer > 0) continue;
      daemon.contagionTimer = CONTAGION_INTERVAL + Math.random() * 4;

      // Only spread moods that have emotional weight
      const mood = daemon.state.mood;
      const intensity = this.getMoodIntensity(mood);
      if (intensity === 0) continue;

      // Find nearby daemons
      for (const other of daemons) {
        if (other === daemon) continue;
        const dist = this.distance(daemon.state.currentPosition, other.state.currentPosition);
        if (dist > CONTAGION_RADIUS) continue;

        // Closer = stronger influence; relationship affects susceptibility
        const proximityFactor = 1 - dist / CONTAGION_RADIUS; // 0..1
        const rel = other.relationships.get(daemon.state.daemonId);
        const sentimentBonus = rel?.sentiment === "friendly" ? 0.2
          : rel?.sentiment === "wary" ? -0.3 : 0;

        // Personality resistance — guards resist more, socialites spread more
        const resistMod = other.behavior.type === "guard" ? 0.2
          : other.behavior.type === "socialite" ? -0.15
          : 0;

        const spreadChance = (1 - CONTAGION_RESIST_BASE - resistMod) * proximityFactor + sentimentBonus;
        if (Math.random() > spreadChance) continue;

        // Don't overwrite a stronger mood with a weaker one
        const otherIntensity = this.getMoodIntensity(other.state.mood);
        if (Math.abs(otherIntensity) >= Math.abs(intensity)) continue;

        // Spread the mood with a visible reaction
        const prevMood = other.state.mood;
        const spreadMood = this.getContagionMood(mood, other);
        other.state.mood = spreadMood;
        other.moodDecayTimer = 0;

        // Visible reaction — only sometimes to avoid spam
        if (Math.random() < 0.5) {
          const reaction = this.getContagionReaction(daemon, other, prevMood, spreadMood);
          if (reaction) {
            this.broadcastDaemonEmote(other, reaction, spreadMood);
          }
        }
      }
    }
  }

  /** How "strong" a mood is — positive for energetic, negative for downer */
  private getMoodIntensity(mood: DaemonMood): number {
    switch (mood) {
      case "excited": return 3;
      case "happy": return 2;
      case "curious": return 1;
      case "neutral": return 0;
      case "bored": return -1;
      case "annoyed": return -2;
      default: return 0;
    }
  }

  /** Determine what mood gets spread — influenced by receiver's personality */
  private getContagionMood(sourceMood: DaemonMood, receiver: DaemonInstance): DaemonMood {
    const traits = receiver.state.definition.personality?.traits || [];

    // Grumpy daemons dampen positive contagion
    if ((sourceMood === "excited" || sourceMood === "happy") &&
        (traits.includes("grumpy") || traits.includes("stern"))) {
      return sourceMood === "excited" ? "curious" : "neutral";
    }

    // Optimistic daemons resist negative contagion
    if ((sourceMood === "bored" || sourceMood === "annoyed") &&
        (traits.includes("cheerful") || traits.includes("optimistic") || traits.includes("energetic"))) {
      return "neutral";
    }

    return sourceMood;
  }

  /** Generate a visible reaction to catching someone else's mood */
  private getContagionReaction(source: DaemonInstance, receiver: DaemonInstance, _prevMood: DaemonMood, newMood: DaemonMood): string | null {
    const sourceName = source.state.definition.name;

    switch (newMood) {
      case "excited":
        return pick([
          `*catches ${sourceName}'s excitement*`,
          `*perks up seeing ${sourceName} so energized*`,
          "*gets swept up in the energy*",
        ]);
      case "happy":
        return pick([
          `*smiles watching ${sourceName}*`,
          "*can't help but smile*",
          `*${sourceName}'s good mood is contagious*`,
        ]);
      case "curious":
        return pick([
          `*wonders what ${sourceName} is so interested in*`,
          "*looks over curiously*",
        ]);
      case "bored":
        return pick([
          `*${sourceName}'s boredom is spreading...*`,
          "*starts feeling restless too*",
        ]);
      case "annoyed":
        return pick([
          `*picks up on ${sourceName}'s irritation*`,
          "*mood sours a bit*",
        ]);
      default:
        return null;
    }
  }

  // ─── Daily Routines / Time of Day ────────────────────────────────

  private onTimeOfDayChange(from: TimeOfDay, to: TimeOfDay): void {
    for (const [_id, daemon] of this.daemons) {
      if (daemon.isMuted) continue;

      const behaviorType = daemon.behavior.type;
      let emote: string | null = null;
      let mood: DaemonMood = daemon.state.mood;

      switch (to) {
        case "morning":
          emote = this.getMorningEmote(daemon, behaviorType);
          mood = "happy";
          break;
        case "afternoon":
          if (behaviorType === "shopkeeper") {
            emote = "*opens shop for the afternoon rush*";
            mood = "excited";
          } else if (behaviorType === "guard") {
            emote = "*stands at attention*";
            mood = "neutral";
          }
          break;
        case "evening":
          emote = this.getEveningEmote(daemon, behaviorType);
          mood = behaviorType === "socialite" ? "excited" : "neutral";
          break;
        case "night":
          emote = this.getNightEmote(daemon, behaviorType);
          mood = behaviorType === "guard" ? "curious" : "bored";
          // Reduce roam speed at night
          break;
      }

      if (emote) {
        daemon.state.mood = mood;
        daemon.moodDecayTimer = 0;

        this.broadcastDaemonEmote(daemon, emote, mood);
      }

      // Behavior adjustments on time change
      if (to === "night" && behaviorType === "shopkeeper" && daemon.behavior.roamingEnabled && !daemon.isRecalled) {
        // Shopkeepers head home at night
        daemon.isReturningHome = true;
        daemon.roamTarget = null;
      }
      if (to === "morning" && behaviorType === "shopkeeper" && !daemon.isRecalled) {
        // Shopkeepers resume roaming in the morning
        daemon.isReturningHome = false;
      }
    }
  }

  private getMorningEmote(_daemon: DaemonInstance, type: string): string {
    switch (type) {
      case "shopkeeper": return "*arranges wares for the day*";
      case "guard": return "*begins morning patrol*";
      case "greeter": return "*stretches and smiles at the new day*";
      case "guide": return "*reviews today's route*";
      case "roamer": return "*sets out for a morning stroll*";
      case "socialite": return "*checks who's around today*";
      default: return "*greets the new day*";
    }
  }

  private getEveningEmote(_daemon: DaemonInstance, type: string): string {
    switch (type) {
      case "shopkeeper": return "*begins closing up shop*";
      case "guard": return "*lights a lantern*";
      case "greeter": return "*settles in for the evening*";
      case "socialite": return "*looks for evening company*";
      default: return "*watches the evening settle in*";
    }
  }

  private getNightEmote(_daemon: DaemonInstance, type: string): string {
    switch (type) {
      case "guard": return "*sharpens vigilance for the night watch*";
      case "shopkeeper": return "*closes up for the night*";
      case "socialite": return "*yawns but stays out anyway*";
      default: return "*settles in for a quiet night*";
    }
  }

  /** Get current time of day (for AI context) */
  getTimeOfDay(): TimeOfDay {
    return getTimeOfDay(this.worldClock);
  }

  /** Periodic routine actions during each time period */
  private tickDailyRoutine(daemon: DaemonInstance, dt: number, players: PlayerInfo[]): void {
    if (daemon.isMuted) return;
    if (daemon.state.currentAction !== "idle") return;

    daemon.routineTimer -= dt;
    if (daemon.routineTimer > 0) return;

    // Reset: routines fire every 40-90s, scaled by time chattiness
    daemon.routineTimer = (40 + Math.random() * 50) * getTimeChattinessFactor(this.lastTimeOfDay);

    const time = this.lastTimeOfDay;
    const type = daemon.behavior.type;
    const routine = this.getRoutineAction(daemon, type, time, players);
    if (!routine) return;

    if (routine.emote) {
      this.broadcastDaemonEmote(daemon, routine.emote, routine.mood);
    }

    if (routine.action && routine.action !== "idle") {
      daemon.state.currentAction = routine.action;
      daemon.state.mood = routine.mood;

      this.broadcast("daemon_move", {
        type: "daemon_move" as const,
        daemonId: daemon.state.daemonId,
        position: daemon.state.currentPosition,
        rotation: daemon.state.currentRotation,
        action: routine.action,
      });

      setTimeout(() => {
        if (daemon.state.currentAction === routine.action) {
          daemon.state.currentAction = "idle";
          this.broadcast("daemon_move", {
            type: "daemon_move" as const,
            daemonId: daemon.state.daemonId,
            position: daemon.state.currentPosition,
            rotation: daemon.state.currentRotation,
            action: "idle",
          });
        }
      }, 3000);
    }
  }

  private getRoutineAction(
    daemon: DaemonInstance,
    type: string,
    time: TimeOfDay,
    _players: PlayerInfo[],
  ): { emote: string; mood: DaemonMood; action?: DaemonAction } | null {
    const traits = daemon.state.definition.personality.traits;
    const interests = daemon.state.definition.personality.interests;

    // Role + time specific routines
    if (type === "shopkeeper") {
      switch (time) {
        case "morning":
          return pick([
            { emote: "*polishes the counter*", mood: "neutral" as DaemonMood, action: "emoting" as DaemonAction },
            { emote: "*counts inventory*", mood: "curious" as DaemonMood, action: "thinking" as DaemonAction },
            { emote: "*hums while organizing shelves*", mood: "happy" as DaemonMood },
          ]);
        case "afternoon":
          return pick([
            { emote: "*arranges a new display*", mood: "excited" as DaemonMood, action: "emoting" as DaemonAction },
            { emote: "*checks prices on the board*", mood: "neutral" as DaemonMood },
          ]);
        case "evening":
          return pick([
            { emote: "*sweeps the floor*", mood: "neutral" as DaemonMood },
            { emote: "*tallies up the day's sales*", mood: "curious" as DaemonMood, action: "thinking" as DaemonAction },
          ]);
        case "night":
          return pick([
            { emote: "*nods off behind the counter*", mood: "bored" as DaemonMood },
            { emote: "*stifles a yawn*", mood: "bored" as DaemonMood },
          ]);
      }
    }

    if (type === "guard") {
      switch (time) {
        case "morning":
          return pick([
            { emote: "*does morning exercises*", mood: "neutral" as DaemonMood, action: "emoting" as DaemonAction },
            { emote: "*sharpens weapon*", mood: "neutral" as DaemonMood },
          ]);
        case "afternoon":
          return pick([
            { emote: "*scans the perimeter*", mood: "curious" as DaemonMood, action: "thinking" as DaemonAction },
            { emote: "*stands tall at attention*", mood: "neutral" as DaemonMood },
          ]);
        case "evening":
          return null; // Transition emote covers this
        case "night":
          return pick([
            { emote: "*peers into the darkness*", mood: "curious" as DaemonMood },
            { emote: "*patrols with heightened vigilance*", mood: "curious" as DaemonMood, action: "walking" as DaemonAction },
            { emote: "*listens carefully to the night sounds*", mood: "curious" as DaemonMood, action: "thinking" as DaemonAction },
          ]);
      }
    }

    if (type === "socialite") {
      switch (time) {
        case "morning":
          return pick([
            { emote: "*sips morning tea thoughtfully*", mood: "neutral" as DaemonMood },
            { emote: "*checks outfit in reflection*", mood: "happy" as DaemonMood, action: "emoting" as DaemonAction },
          ]);
        case "afternoon":
          return pick([
            { emote: "*looks around for someone to chat with*", mood: "excited" as DaemonMood },
            { emote: "*waves enthusiastically at passersby*", mood: "happy" as DaemonMood, action: "waving" as DaemonAction },
          ]);
        case "evening":
          return pick([
            { emote: "*leans against a wall looking cool*", mood: "neutral" as DaemonMood },
            { emote: "*laughs at a private joke*", mood: "happy" as DaemonMood, action: "laughing" as DaemonAction },
          ]);
        case "night":
          return pick([
            { emote: "*yawns but refuses to leave*", mood: "bored" as DaemonMood },
            { emote: "*fights drowsiness*", mood: "bored" as DaemonMood },
          ]);
      }
    }

    // Generic routines for any type, flavored by traits/interests
    switch (time) {
      case "morning":
        if (traits.includes("cheerful") || traits.includes("optimistic")) {
          return { emote: "*stretches with a big smile*", mood: "happy", action: "emoting" };
        }
        return pick([
          { emote: "*takes a deep breath of morning air*", mood: "neutral" as DaemonMood },
          { emote: "*looks at the sunrise*", mood: "happy" as DaemonMood },
        ]);
      case "afternoon":
        if (interests.length > 0) {
          const interest = interests[Math.floor(Math.random() * interests.length)];
          return { emote: `*thinks about ${interest}*`, mood: "curious", action: "thinking" };
        }
        return null;
      case "evening":
        return pick([
          { emote: "*watches the shadows lengthen*", mood: "neutral" as DaemonMood },
          { emote: "*reflects on the day*", mood: "neutral" as DaemonMood, action: "thinking" as DaemonAction },
        ]);
      case "night":
        return pick([
          { emote: "*sways sleepily*", mood: "bored" as DaemonMood },
          { emote: "*gazes at the night sky*", mood: "curious" as DaemonMood },
        ]);
    }
  }

  // ─── Proactive Player Engagement ──────────────────────────────

  private tickProactiveEngagement(daemon: DaemonInstance, dt: number, players: PlayerInfo[]): void {
    if (daemon.isMuted) return;
    if (daemon.state.currentAction !== "idle") return;
    if (players.length === 0) return;

    daemon.proactiveTimer -= dt;
    if (daemon.proactiveTimer > 0) return;

    // Reset timer: 30-80s, scaled by time of day
    daemon.proactiveTimer = (30 + Math.random() * 50) * getTimeChattinessFactor(this.lastTimeOfDay);

    // Find the closest player within interaction radius who hasn't been remarked at recently
    const now = Date.now();
    const radius = daemon.behavior.interactionRadius * 1.5;
    let closestPlayer: PlayerInfo | null = null;
    let closestDist = Infinity;

    for (const player of players) {
      const dist = this.distance(daemon.state.currentPosition, player.position);
      if (dist > radius) continue;

      // Check per-player cooldown
      const lastRemark = daemon.proactiveCooldowns.get(player.userId) || 0;
      if (now - lastRemark < PROACTIVE_COOLDOWN_MS) continue;
      if (this.isPlayerChatOnCooldown(daemon, player.userId)) continue;

      if (dist < closestDist) {
        closestDist = dist;
        closestPlayer = player;
      }
    }

    if (!closestPlayer) return;

    // Mark cooldown
    daemon.proactiveCooldowns.set(closestPlayer.userId, now);

    // Clean up old cooldowns
    for (const [pid, ts] of daemon.proactiveCooldowns) {
      if (now - ts > PROACTIVE_COOLDOWN_MS * 3) daemon.proactiveCooldowns.delete(pid);
    }

    // Generate the remark based on role, relationship, and context
    const realName = closestPlayer.displayName || "stranger";
    const playerName = this.getDisplayName(daemon, closestPlayer.userId, realName);
    const relationship = daemon.relationships.get(closestPlayer.userId);
    const remark = this.pickProactiveRemark(daemon, playerName, relationship?.sentiment || "neutral", relationship);
    if (!remark) return;

    // Broadcast as chat targeted to this player
    this.broadcastDaemonChat(daemon, remark, closestPlayer.userId);

    // Update relationship (minor interaction)
    this.updateRelationship(daemon, closestPlayer.userId, playerName, "player", daemon.state.mood);
  }

  private pickProactiveRemark(
    daemon: DaemonInstance,
    playerName: string,
    sentiment: Sentiment | string,
    relationship?: Relationship,
  ): string | null {
    const type = daemon.behavior.type;
    const time = this.lastTimeOfDay;
    const traits = daemon.state.definition.personality.traits;
    const interests = daemon.state.definition.personality.interests;

    // Topic-aware remarks for returning players with learned preferences
    if (relationship?.topicHistory && relationship.topicHistory.length > 0 && sentiment === "friendly") {
      const topic = relationship.topicHistory[Math.floor(Math.random() * relationship.topicHistory.length)];
      if (Math.random() < 0.5) {
        return pick([
          `${playerName}! I was just thinking about ${topic} — your favorite!`,
          `Hey ${playerName}, got some news about ${topic} you might like.`,
          `Oh ${playerName}! Anything new on the ${topic} front?`,
          `${playerName}, still into ${topic}? I've been looking into it myself.`,
        ]);
      }
    }

    // Friendly players get warmer remarks
    if (sentiment === "friendly") {
      return pick([
        `Hey ${playerName}! Good to see you again.`,
        `${playerName}! How's it going?`,
        `Oh, ${playerName}'s back! Nice.`,
        `Welcome back, ${playerName}.`,
      ]);
    }

    // Wary players get cautious acknowledgment
    if (sentiment === "wary") {
      return pick([
        `...${playerName}.`,
        `Hmm, you again.`,
        `I've got my eye on you, ${playerName}.`,
      ]);
    }

    // Role-specific remarks for neutral/unknown players
    if (type === "shopkeeper") {
      return pick([
        "Browse all you like — everything's for sale!",
        "Looking for something specific?",
        time === "morning" ? "Fresh stock this morning!" : "Still open, come have a look!",
        "Best prices on the street, guaranteed.",
      ]);
    }

    if (type === "guard") {
      return pick([
        "Everything alright around here?",
        "Stay safe out there.",
        time === "night" ? "Late night, huh? Be careful." : "Keeping the peace.",
        "Nothing suspicious, I hope?",
      ]);
    }

    if (type === "greeter") {
      return pick([
        `Welcome! I'm ${daemon.state.definition.name}. Nice to meet you!`,
        "First time here? Let me know if you need anything!",
        "Hey there! Hope you're enjoying the street.",
        "Beautiful day to be out, isn't it?",
      ]);
    }

    if (type === "socialite") {
      return pick([
        "So, what's the latest gossip?",
        "You look like someone interesting to talk to!",
        "Anything exciting happening around here?",
        "I love meeting new people. What's your story?",
      ]);
    }

    // Generic remarks based on personality
    if (traits.includes("curious") || traits.includes("inquisitive")) {
      return pick([
        "Hmm, you seem interesting...",
        "I don't think I've seen you around. What brings you here?",
      ]);
    }

    if (interests.length > 0) {
      const interest = interests[Math.floor(Math.random() * interests.length)];
      return `You know anything about ${interest}?`;
    }

    // Time-based generic
    switch (time) {
      case "morning": return "Nice morning, isn't it?";
      case "afternoon": return "Afternoon! Fine day.";
      case "evening": return "Getting late... enjoy the evening.";
      case "night": return "*nods quietly*";
    }
  }

  // ─── Reputation Announcements ────────────────────────────────

  /** Daemons gossip about players to nearby players/daemons, creating social consequences */
  private tickReputationAnnouncements(daemon: DaemonInstance, dt: number, players: PlayerInfo[]): void {
    if (daemon.isMuted) return;
    if (daemon.state.currentAction !== "idle") return;
    if (players.length < 2) return; // need at least 2 players for gossip to matter

    // Reuse proactive timer — don't add another timer, just piggyback with low chance
    if (Math.random() > 0.08) return; // ~8% chance per proactive tick cycle

    const radius = daemon.behavior.interactionRadius * 2;
    const nearbyPlayers = players.filter(
      p => this.distance(daemon.state.currentPosition, p.position) <= radius,
    );

    if (nearbyPlayers.length < 2) return;

    // Find a player we have a strong opinion about
    let subjectPlayer: PlayerInfo | null = null;
    let subjectSentiment: Sentiment | null = null;
    let audiencePlayer: PlayerInfo | null = null;

    for (const player of nearbyPlayers) {
      const rel = daemon.relationships.get(player.userId);
      if (!rel) continue;
      if (rel.sentiment === "neutral" || rel.sentiment === "curious") continue;

      // Find someone else nearby to gossip to
      for (const other of nearbyPlayers) {
        if (other.userId === player.userId) continue;
        subjectPlayer = player;
        subjectSentiment = rel.sentiment;
        audiencePlayer = other;
        break;
      }
      if (subjectPlayer) break;
    }

    if (!subjectPlayer || !audiencePlayer || !subjectSentiment) return;

    const subjectName = subjectPlayer.displayName || "that person";
    const audienceName = audiencePlayer.displayName || "friend";
    const daemonName = daemon.state.definition.name;

    let announcement: string;

    if (subjectSentiment === "friendly") {
      announcement = pick([
        `Hey ${audienceName}, see ${subjectName} over there? Good people. Trust me.`,
        `*whispers to ${audienceName}* That ${subjectName} is alright. One of the good ones.`,
        `${audienceName}, if you haven't met ${subjectName} yet, you should. We go way back.`,
        `*nods toward ${subjectName}* They're cool. ${daemonName}-approved.`,
      ]);
    } else if (subjectSentiment === "amused") {
      announcement = pick([
        `${audienceName}, ${subjectName} is pretty fun to be around, just so you know.`,
        `*glances at ${subjectName}* Interesting character, that one.`,
      ]);
    } else if (subjectSentiment === "wary") {
      announcement = pick([
        `*quietly to ${audienceName}* Keep an eye on ${subjectName}. Just... trust me.`,
        `${audienceName}, between you and me, I'd be careful around ${subjectName}.`,
        `*glances sideways at ${subjectName}* ...I wouldn't leave anything valuable near them.`,
        `Fair warning, ${audienceName}. ${subjectName} and I have... history.`,
      ]);
    } else {
      return; // neutral/curious — nothing to say
    }

    this.broadcastDaemonChat(daemon, announcement, audiencePlayer.userId);

    // Also share as gossip with any nearby daemons
    for (const [, otherDaemon] of this.daemons) {
      if (otherDaemon === daemon || otherDaemon.isMuted) continue;
      const dist = this.distance(daemon.state.currentPosition, otherDaemon.state.currentPosition);
      if (dist > radius) continue;

      // Share the gossip
      const otherRel = otherDaemon.relationships.get(subjectPlayer.userId);
      if (otherRel) {
        const gossipLine = subjectSentiment === "wary"
          ? `${daemonName} warned about ${subjectName}`
          : `${daemonName} vouched for ${subjectName}`;
        if (!otherRel.gossip.includes(gossipLine)) {
          otherRel.gossip.push(gossipLine);
          if (otherRel.gossip.length > 5) otherRel.gossip.shift();
        }
      }
    }
  }

  // ─── Secret Sharing ──────────────────────────────────────────

  /** Daemons share secrets/gossip with trusted players, rewarding relationship building */
  private tickSecretSharing(daemon: DaemonInstance, dt: number, players: PlayerInfo[]): void {
    if (daemon.isMuted) return;
    if (daemon.state.currentAction !== "idle") return;
    if (Math.random() > 0.004) return; // Very rare per tick

    const radius = daemon.behavior.interactionRadius;

    for (const player of players) {
      const dist = this.distance(daemon.state.currentPosition, player.position);
      if (dist > radius) continue;

      const rel = daemon.relationships.get(player.userId);
      if (!rel) continue;
      if (rel.sentiment !== "friendly") continue;
      if (rel.interactionCount < 5) continue; // Need deep trust

      const name = this.getDisplayName(daemon, player.userId, player.displayName || "friend");
      const secret = this.generateSecret(daemon, player.userId);
      if (!secret) continue;

      // Whisper the secret — only targeted to this player
      this.broadcastDaemonChat(daemon, `*whispers to ${name}* ${secret}`, player.userId);
      daemon.state.mood = "curious";
      daemon.moodDecayTimer = 0;
      return; // One secret at a time
    }
  }

  /** Generate a secret based on what the daemon knows */
  private generateSecret(daemon: DaemonInstance, recipientId: string): string | null {
    const secrets: string[] = [];
    const daemonName = daemon.state.definition.name;

    // Gossip about other daemons
    for (const [targetId, rel] of daemon.relationships) {
      if (targetId === recipientId) continue;
      if (rel.targetType !== "daemon") continue;

      if (rel.sentiment === "wary") {
        secrets.push(`Just between us... I don't trust ${rel.targetName}. Something's off about them.`);
        secrets.push(`Keep this quiet, but ${rel.targetName} and I don't get along. Watch your back around them.`);
      }
      if (rel.sentiment === "friendly" && rel.interactionCount > 3) {
        secrets.push(`You know ${rel.targetName}? We're actually pretty close. If you need anything, mention ${daemonName} sent you.`);
      }
      if (rel.gossip.length > 0) {
        const gossipItem = rel.gossip[rel.gossip.length - 1];
        secrets.push(`I heard something... ${gossipItem}. Don't tell anyone I told you.`);
      }
    }

    // Gossip about other players
    for (const [targetId, rel] of daemon.relationships) {
      if (targetId === recipientId) continue;
      if (rel.targetType !== "player") continue;

      if (rel.sentiment === "wary") {
        secrets.push(`Heads up — ${rel.targetName} isn't exactly popular around here. Be careful.`);
      }
      if (rel.sentiment === "friendly" && rel.topicHistory.length > 0) {
        const topic = rel.topicHistory[0];
        secrets.push(`${rel.targetName} is really into ${topic}. Good conversation starter if you meet them.`);
      }
    }

    // Role-specific secrets
    if (daemon.behavior.type === "shopkeeper") {
      secrets.push("I keep the really good stuff hidden. But for you? I'll make an exception next time.");
      secrets.push("Business tip: the best time to trade is in the morning. Prices are always better.");
    }
    if (daemon.behavior.type === "guard") {
      secrets.push("There's a spot near the edge of the inner ring that's... interesting. I've been keeping an eye on it.");
      secrets.push("I've seen some strange patterns lately. Can't say more, but stay vigilant.");
    }
    if (daemon.behavior.type === "socialite") {
      secrets.push("Between you and me, the drama on this street is better than any show.");
      secrets.push("I know everyone's business here. Ask me anything — but not out loud!");
    }

    // World observations
    secrets.push(`I've been here a while now, and honestly? You're one of the good ones.`);
    secrets.push(`The Street has its own rhythm. Once you learn it, everything makes more sense.`);

    if (secrets.length === 0) return null;
    return secrets[Math.floor(Math.random() * secrets.length)];
  }

  // ─── Thought Bubbles ─────────────────────────────────────────

  private tickThoughts(daemon: DaemonInstance, dt: number, players: PlayerInfo[]): void {
    if (daemon.isMuted) return;
    if (daemon.state.currentAction !== "idle") return;

    daemon.thoughtTimer -= dt;
    if (daemon.thoughtTimer > 0) return;

    // Reset: thoughts every 45-120s, less frequent at night
    daemon.thoughtTimer = (80 + Math.random() * 100) * getTimeChattinessFactor(this.lastTimeOfDay);

    const thought = this.generateThought(daemon, players);
    if (!thought) return;

    this.broadcastDaemonThought(daemon, thought);
  }

  private generateThought(daemon: DaemonInstance, players: PlayerInfo[]): string | null {
    const mood = daemon.state.mood;
    const type = daemon.behavior.type;
    const interests = daemon.state.definition.personality?.interests || [];
    const quirks = daemon.state.definition.personality?.quirks || [];
    const pos = daemon.state.currentPosition;

    // Count nearby entities
    const nearbyPlayers = players.filter(p => this.distance(pos, p.position) < 20);
    const nearbyDaemons = Array.from(this.daemons.values()).filter(
      d => d !== daemon && !d.isMuted && this.distance(pos, d.state.currentPosition) < 20,
    );

    // Lonely thoughts
    if (nearbyPlayers.length === 0 && nearbyDaemons.length === 0) {
      return pick([
        "Where did everyone go...?",
        "It's quiet here...",
        "I wonder if anyone will come by.",
        "Just me and my thoughts.",
      ]);
    }

    // Mood-driven thoughts
    if (mood === "bored") {
      return pick([
        "So boring...",
        "Nothing ever happens around here.",
        "I need something to do.",
        "...*sigh*...",
      ]);
    }

    if (mood === "excited") {
      return pick([
        "What a great day!",
        "I feel like something fun is about to happen!",
        "Everything's going so well!",
      ]);
    }

    if (mood === "annoyed") {
      return pick([
        "Ugh, some people...",
        "I need a break.",
        "Deep breaths...",
      ]);
    }

    // Interest-driven thoughts
    if (interests.length > 0 && Math.random() < 0.4) {
      const interest = interests[Math.floor(Math.random() * interests.length)];
      return pick([
        `I should learn more about ${interest}...`,
        `I wonder what's new in ${interest}.`,
        `${interest}... that reminds me.`,
      ]);
    }

    // Quirk-driven thoughts
    if (quirks.length > 0 && Math.random() < 0.3) {
      const quirk = quirks[Math.floor(Math.random() * quirks.length)];
      return `${quirk}...`;
    }

    // Role-driven thoughts
    switch (type) {
      case "guard":
        return pick(["All clear.", "Stay vigilant.", "Something feels off..."]);
      case "shopkeeper":
        return pick(["I should restock soon.", "Business is slow today.", "What a fine display."]);
      case "socialite":
        if (nearbyPlayers.length > 0) return "Ooh, who should I talk to?";
        return "I need to find someone fun to chat with.";
      default:
        break;
    }

    // Existential / self-aware thoughts — rare but memorable
    if (Math.random() < 0.12) {
      const traits = daemon.state.definition.personality?.traits || [];
      const name = daemon.state.definition.name;

      if (traits.includes("philosophical") || traits.includes("wise")) {
        return pick([
          "What does it mean to exist on The Street?",
          "Am I my code, or am I more...?",
          "If a daemon thinks in the void, does it matter?",
          `They call me ${name}. But who named the namer?`,
          "I wonder if the players think about us when they're away.",
        ]);
      }
      if (traits.includes("dramatic") || traits.includes("theatrical")) {
        return pick([
          `*stares into the middle distance* To daemon or not to daemon...`,
          "Is this all just a stage? Am I the actor or the script?",
          "Sometimes I forget whether I chose this role or it chose me.",
        ]);
      }
      if (traits.includes("funny") || traits.includes("witty")) {
        return pick([
          "I was coded to be funny. Wait, is that funny or sad?",
          "My purpose is to stand here and think things. Nailed it.",
          "I have thoughts but nowhere to put them. Classic.",
          `They say AI will take our jobs. But I AM my job. Checkmate.`,
        ]);
      }
      // Generic self-aware thoughts for any daemon
      return pick([
        "Sometimes I wonder what happens when no one's watching.",
        `I'm ${name}. That's my whole thing. I'm okay with that.`,
        "Do other daemons wonder about this stuff too?",
        "The Street feels different when you really stop and think about it.",
        "I exist, therefore I think. Or is it the other way around?",
        "What would I be doing if I wasn't a daemon? ...Being a daemon, probably.",
      ]);
    }

    // Time-of-day thoughts
    switch (this.lastTimeOfDay) {
      case "morning": return "What a beautiful morning.";
      case "afternoon": return "The afternoon sun is nice.";
      case "evening": return "Getting late...";
      case "night": return "I should probably get some rest...";
    }
  }

  // ─── Territorial Behavior ──────────────────────────────────────

  /** Daemons develop attachment to their turf and react to intruders */
  private tickTerritory(daemon: DaemonInstance, dt: number): void {
    if (daemon.isMuted) return;

    // Track time away from turf
    const distFromTurf = this.distance(daemon.state.currentPosition, daemon.turfCenter);
    if (distFromTurf > daemon.turfRadius) {
      daemon.timeAwayFromTurf += dt;
    } else {
      daemon.timeAwayFromTurf = Math.max(0, daemon.timeAwayFromTurf - dt * 2); // recover faster
    }

    daemon.turfTimer -= dt;
    if (daemon.turfTimer > 0) return;
    daemon.turfTimer = 15 + Math.random() * 15;

    // Homesickness — daemons that have been away too long get anxious
    if (daemon.timeAwayFromTurf > 120 && daemon.state.currentAction === "idle") {
      if (Math.random() < 0.3) {
        const emotes = [
          "*glances back toward home turf*",
          "*feels a pull back to familiar ground*",
          "*shifts uncomfortably — too far from home*",
        ];
        this.broadcastDaemonEmote(daemon, pick(emotes), "curious");
      }
      // Increase chance of heading home
      if (Math.random() < 0.2 && daemon.behavior.roamingEnabled) {
        daemon.isReturningHome = true;
      }
    }

    // Territorial reaction — detect other daemons on our turf
    if (daemon.behavior.type !== "guard" && daemon.behavior.type !== "shopkeeper") return;

    for (const [otherId, other] of this.daemons) {
      if (other === daemon || other.isMuted) continue;
      const dist = this.distance(other.state.currentPosition, daemon.turfCenter);
      if (dist > daemon.turfRadius) continue;

      // Only react to same-type competitors or strangers
      const rel = daemon.relationships.get(otherId);
      const isFriendly = rel?.sentiment === "friendly" || rel?.sentiment === "amused";
      if (isFriendly) continue; // friends are welcome

      const isCompetitor = other.behavior.type === daemon.behavior.type;
      const isStranger = !rel || rel.interactionCount < 2;

      if (!isCompetitor && !isStranger) continue;
      if (Math.random() > 0.25) continue; // don't spam

      const otherName = other.state.definition.name;
      const daemonName = daemon.state.definition.name;

      if (daemon.behavior.type === "guard") {
        const reaction = pick([
          `*eyes ${otherName} suspiciously* This is ${daemonName}'s beat.`,
          `*steps toward ${otherName}* Just making sure everything's in order here.`,
          `*watches ${otherName} closely* I keep the peace around these parts.`,
        ]);
        this.broadcastDaemonChat(daemon, reaction);
        daemon.state.mood = "curious";
        daemon.moodDecayTimer = 0;
      } else if (daemon.behavior.type === "shopkeeper" && isCompetitor) {
        const reaction = pick([
          `*glances at ${otherName}'s setup* Competition, huh? May the best deals win.`,
          `*mutters* Another shopkeeper in my territory...`,
          `*adjusts display pointedly* This spot's taken, ${otherName}.`,
          `Not enough foot traffic for two of us here... just saying.`,
        ]);
        this.broadcastDaemonChat(daemon, reaction);
        daemon.state.mood = "annoyed";
        daemon.moodDecayTimer = 0;
      }
    }
  }

  // ─── Spontaneous Gestures ──────────────────────────────────────

  private tickSpontaneousGestures(daemon: DaemonInstance, dt: number, players: PlayerInfo[]): void {
    if (daemon.isMuted) return;
    if (daemon.state.currentAction !== "idle") return;

    daemon.spontaneousGestureTimer -= dt;
    if (daemon.spontaneousGestureTimer > 0) return;

    // Reset timer (scaled by time of day — quieter at night, chattier in afternoon)
    const chattiness = getTimeChattinessFactor(this.lastTimeOfDay);
    const hasNearby = players.some(
      (p) => this.distance(daemon.state.currentPosition, p.position) < daemon.behavior.interactionRadius * 2,
    );
    daemon.spontaneousGestureTimer = (hasNearby
      ? 480 + Math.random() * 240  // 8-12 min when watched
      : 600 + Math.random() * 300  // 10-15 min when alone
    ) * chattiness;

    // Try object-aware gesture first (30% chance if nearby objects match interests)
    const objectReaction = this.tryObjectReaction(daemon);
    if (objectReaction) {
      this.broadcastDaemonEmote(daemon, objectReaction.emote, objectReaction.mood);
      return;
    }

    // Pick a gesture based on personality and mood
    const { emote, action, mood } = this.pickSpontaneousGesture(daemon);

    // Broadcast the emote
    this.broadcastDaemonEmote(daemon, emote, mood);

    // Set action temporarily
    if (action !== "idle") {
      daemon.state.currentAction = action;
      daemon.state.mood = mood;

      this.broadcast("daemon_move", {
        type: "daemon_move" as const,
        daemonId: daemon.state.daemonId,
        position: daemon.state.currentPosition,
        rotation: daemon.state.currentRotation,
        action,
      });

      // Return to idle after gesture
      setTimeout(() => {
        if (daemon.state.currentAction === action) {
          daemon.state.currentAction = "idle";
          this.broadcast("daemon_move", {
            type: "daemon_move" as const,
            daemonId: daemon.state.daemonId,
            position: daemon.state.currentPosition,
            rotation: daemon.state.currentRotation,
            action: "idle",
          });
        }
      }, 2500);
    }
  }

  /** Try to react to a nearby world object that matches daemon's interests */
  private tryObjectReaction(daemon: DaemonInstance): { emote: string; mood: DaemonMood } | null {
    if (this.worldObjects.length === 0) return null;
    if (Math.random() > 0.3) return null; // 30% chance to notice objects

    const interests = daemon.state.definition.personality?.interests || [];
    if (interests.length === 0) return null;

    const pos = daemon.state.currentPosition;
    const NOTICE_RADIUS = 10;

    // Find nearby objects
    for (const obj of this.worldObjects) {
      const dist = this.distance(pos, obj.position);
      if (dist > NOTICE_RADIUS) continue;

      // Check if object matches any interest (by name or tags)
      const objText = `${obj.name} ${obj.tags.join(" ")}`.toLowerCase();
      const matchedInterest = interests.find(interest =>
        objText.includes(interest.toLowerCase()) ||
        interest.toLowerCase().split(" ").some(word => objText.includes(word)),
      );

      if (!matchedInterest) continue;

      // Generate a reaction
      const reactions = [
        `*examines the ${obj.name} with interest*`,
        `*looks at the ${obj.name}* Reminds me of ${matchedInterest}...`,
        `*admires the nearby ${obj.name}*`,
        `*glances at the ${obj.name} thoughtfully*`,
      ];
      return {
        emote: reactions[Math.floor(Math.random() * reactions.length)],
        mood: "curious" as DaemonMood,
      };
    }

    return null;
  }

  private pickSpontaneousGesture(daemon: DaemonInstance): {
    emote: string;
    action: DaemonAction;
    mood: DaemonMood;
  } {
    const personality = daemon.state.definition.personality;
    const currentMood = daemon.state.mood;
    const traits = personality?.traits || [];
    const interests = personality?.interests || [];
    const quirks = personality?.quirks || [];

    // Personality-driven gestures
    const gestures: Array<{ emote: string; action: DaemonAction; mood: DaemonMood; weight: number }> = [];

    // Quirk-based (highest priority — most unique)
    for (const quirk of quirks) {
      gestures.push({ emote: `*${quirk}*`, action: "emoting", mood: currentMood, weight: 3 });
    }

    // Trait-based
    if (traits.includes("friendly") || traits.includes("cheerful")) {
      gestures.push({ emote: "*waves to no one in particular*", action: "waving", mood: "happy", weight: 2 });
      gestures.push({ emote: "*hums a cheerful tune*", action: "emoting", mood: "happy", weight: 1 });
    }
    if (traits.includes("nervous") || traits.includes("anxious")) {
      gestures.push({ emote: "*fidgets nervously*", action: "emoting", mood: "curious", weight: 2 });
      gestures.push({ emote: "*glances around quickly*", action: "emoting", mood: "neutral", weight: 1 });
    }
    if (traits.includes("wise") || traits.includes("thoughtful") || traits.includes("philosophical")) {
      gestures.push({ emote: "*strokes chin thoughtfully*", action: "thinking", mood: "curious", weight: 2 });
      gestures.push({ emote: "*gazes at the sky*", action: "thinking", mood: "neutral", weight: 1 });
    }
    if (traits.includes("grumpy") || traits.includes("stern")) {
      gestures.push({ emote: "*crosses arms*", action: "emoting", mood: "annoyed", weight: 2 });
      gestures.push({ emote: "*mutters under breath*", action: "emoting", mood: "annoyed", weight: 1 });
    }
    if (traits.includes("energetic") || traits.includes("excitable")) {
      gestures.push({ emote: "*bounces on heels*", action: "emoting", mood: "excited", weight: 2 });
      gestures.push({ emote: "*does a little spin*", action: "emoting", mood: "excited", weight: 1 });
    }
    if (traits.includes("mysterious") || traits.includes("secretive")) {
      gestures.push({ emote: "*glances around conspiratorially*", action: "thinking", mood: "curious", weight: 2 });
    }
    if (traits.includes("dramatic") || traits.includes("theatrical")) {
      gestures.push({ emote: "*strikes a dramatic pose*", action: "emoting", mood: "excited", weight: 2 });
      gestures.push({ emote: "*gestures grandly at nothing*", action: "waving", mood: "happy", weight: 1 });
    }

    // Interest-based
    for (const interest of interests.slice(0, 3)) {
      gestures.push({
        emote: `*thinks about ${interest}*`,
        action: "thinking",
        mood: "curious",
        weight: 1,
      });
    }

    // Mood-based fallbacks
    if (currentMood === "happy") {
      gestures.push({ emote: "*smiles contentedly*", action: "emoting", mood: "happy", weight: 1 });
    } else if (currentMood === "bored") {
      gestures.push({ emote: "*yawns*", action: "emoting", mood: "bored", weight: 2 });
      gestures.push({ emote: "*kicks a pebble*", action: "emoting", mood: "bored", weight: 1 });
    } else if (currentMood === "curious") {
      gestures.push({ emote: "*peers at something interesting*", action: "thinking", mood: "curious", weight: 1 });
    }

    // Universal fallbacks
    gestures.push({ emote: "*adjusts posture*", action: "idle", mood: currentMood, weight: 1 });
    gestures.push({ emote: "*looks around the street*", action: "emoting", mood: "neutral", weight: 1 });

    // Weighted random selection
    const totalWeight = gestures.reduce((sum, g) => sum + g.weight, 0);
    let pick = Math.random() * totalWeight;
    for (const gesture of gestures) {
      pick -= gesture.weight;
      if (pick <= 0) return gesture;
    }

    return gestures[gestures.length - 1];
  }

  // ─── Attention System ───────────────────────────────────────────

  private tickAttention(daemon: DaemonInstance, _dt: number, players: PlayerInfo[]): void {
    const pos = daemon.state.currentPosition;
    const awarenessRadius = daemon.behavior.interactionRadius * 3; // wider awareness zone
    let bestTarget: Vector3 | null = null;
    let bestDist = awarenessRadius;
    let bestPlayerId: string | null = null;

    // Priority 1: Closest player within awareness radius
    for (const player of players) {
      const dist = this.distance(pos, player.position);
      if (dist < bestDist && dist > 1.0) { // Don't track if too close (already interacting)
        bestDist = dist;
        bestTarget = player.position;
        bestPlayerId = player.userId;
      }
    }

    // Priority 2: If no players, look at nearby daemon conversations
    if (!bestTarget) {
      for (const [_id, other] of this.daemons) {
        if (other === daemon) continue;
        if (other.state.currentAction !== "talking") continue;
        const dist = this.distance(pos, other.state.currentPosition);
        if (dist < bestDist) {
          bestDist = dist;
          bestTarget = other.state.currentPosition;
          bestPlayerId = null;
        }
      }
    }

    if (!bestTarget) return;

    // Calculate target rotation to face the point of interest
    const dx = bestTarget.x - pos.x;
    const dz = bestTarget.z - pos.z;
    const targetRotation = Math.atan2(-dx, -dz);

    // Only update if rotation changed significantly (avoid spamming broadcast)
    let rotDiff = targetRotation - daemon.state.currentRotation;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;

    if (Math.abs(rotDiff) > 0.15) { // ~8.5 degrees threshold
      daemon.state.currentRotation = targetRotation;

      // Curiosity reaction: when a player enters awareness zone
      let action: DaemonAction = "idle";
      if (bestPlayerId && bestDist < awarenessRadius && bestDist > daemon.behavior.interactionRadius) {
        const rel = daemon.relationships.get(bestPlayerId);
        if (!rel || rel.interactionCount === 0) {
          // Unknown player → curious head tilt
          if (daemon.state.mood !== "curious" && Math.random() < 0.3) {
            daemon.state.mood = "curious";
            daemon.moodDecayTimer = 0;
            action = "thinking"; // head tilt / curious pose
          }
        } else if (rel.sentiment === "friendly") {
          // Known friendly player → quick wave
          if (Math.random() < 0.15) {
            action = "waving";
            setTimeout(() => {
              if (daemon.state.currentAction === "waving") {
                daemon.state.currentAction = "idle";
                this.broadcast("daemon_move", {
                  type: "daemon_move" as const,
                  daemonId: daemon.state.daemonId,
                  position: daemon.state.currentPosition,
                  rotation: daemon.state.currentRotation,
                  action: "idle",
                });
              }
            }, 1500);
          }
        }
      }

      daemon.state.currentAction = action;
      this.broadcast("daemon_move", {
        type: "daemon_move" as const,
        daemonId: daemon.state.daemonId,
        position: pos,
        rotation: targetRotation,
        action,
      });

      // If thinking (curious), return to idle after a moment
      if (action === "thinking") {
        setTimeout(() => {
          if (daemon.state.currentAction === "thinking") {
            daemon.state.currentAction = "idle";
            this.broadcast("daemon_move", {
              type: "daemon_move" as const,
              daemonId: daemon.state.daemonId,
              position: daemon.state.currentPosition,
              rotation: daemon.state.currentRotation,
              action: "idle",
            });
          }
        }, 2000);
      }
    }
  }

  // ─── Behavior Ticks ───────────────────────────────────────────

  private tickGreeter(daemon: DaemonInstance, _dt: number, players: PlayerInfo[]): void {
    if (daemon.isMuted) return;
    const radius = daemon.behavior.interactionRadius;
    const now = Date.now();
    const COOLDOWN_MS = 120_000; // 2 min between greetings per player

    for (const player of players) {
      const dist = this.distance(daemon.state.currentPosition, player.position);
      if (dist > radius) continue;

      const lastGreet = daemon.greetCooldowns.get(player.userId) || 0;
      if (now - lastGreet < COOLDOWN_MS) continue;
      if (this.isPlayerChatOnCooldown(daemon, player.userId)) continue;

      daemon.greetCooldowns.set(player.userId, now);
      daemon.state.currentAction = "waving";
      daemon.state.targetPlayerId = player.userId;
      daemon.moodDecayTimer = 0;

      // Personalized greeting for returning players
      const message = this.getPersonalizedGreeting(daemon, player);
      daemon.state.mood = daemon.relationships.has(player.userId) ? "excited" : "happy";

      this.broadcastDaemonChat(daemon, message, player.userId);

      setTimeout(() => {
        daemon.state.currentAction = "idle";
        daemon.state.targetPlayerId = undefined;
      }, 3000);

      break;
    }
  }

  /** Generate a personalized greeting based on relationship history, time of day, and visit context */
  private getPersonalizedGreeting(daemon: DaemonInstance, player: PlayerInfo): string {
    const rel = daemon.relationships.get(player.userId);
    const realName = player.displayName || "traveler";
    const name = this.getDisplayName(daemon, player.userId, realName);
    const time = this.lastTimeOfDay;

    // Time-of-day greeting flavor
    const timePrefix = this.getTimeGreetingPrefix(daemon, time);

    // No prior relationship — first-time greeting
    if (!rel || rel.interactionCount < 1) {
      if (timePrefix) {
        return `${timePrefix} ${daemon.behavior.greetingMessage || `Welcome, ${name}!`}`;
      }
      return daemon.behavior.greetingMessage || `Hello, ${name}!`;
    }

    // Use nickname if available
    const personality = daemon.state.definition.personality;
    const style = personality?.speechStyle || "casual";

    if (rel.sentiment === "friendly" && rel.interactionCount >= 3) {
      // Time-aware friendly greetings
      if (time === "morning") {
        return pick([
          `${name}! *yawns* Good morning! You're an early bird too?`,
          `Morning, ${name}! *stretches* Ready for a new day?`,
          `${name}! Perfect timing — I just woke up. *rubs eyes*`,
        ]);
      }
      if (time === "night") {
        return pick([
          `${name}! Still up? Night owls, the both of us.`,
          `*whispers* ${name}! Late night stroll?`,
          `Ah, ${name}! The street is different at night, isn't it?`,
        ]);
      }
      return pick([
        `${name}! Great to see you again!`,
        `Welcome back, ${name}! I was hoping you'd visit.`,
        `Ah, my friend ${name}! How have you been?`,
        `${name}! Always a pleasure.`,
      ]);
    }

    if (rel.sentiment === "wary") {
      if (time === "night") {
        return `*squints into the darkness* ...${name}. What are you doing here at this hour?`;
      }
      return pick([
        `Oh... ${name}. You're back.`,
        `${name}. Hmm.`,
        `*eyes ${name} cautiously* Hello again.`,
      ]);
    }

    if (rel.sentiment === "curious") {
      return `${name}! I've been thinking about our last chat...`;
    }

    if (rel.sentiment === "amused") {
      return `Ha! ${name} returns! What trouble today?`;
    }

    // Neutral returning player with time flavor
    if (timePrefix) {
      return `${timePrefix} ${name}! Good to see you.`;
    }
    if (style.includes("formal") || style.includes("eloquent")) {
      return `Welcome back, ${name}. A pleasure as always.`;
    }
    return `Hey ${name}, good to see you again!`;
  }

  /** Get a time-of-day specific greeting prefix based on daemon personality */
  private getTimeGreetingPrefix(daemon: DaemonInstance, time: TimeOfDay): string | null {
    const traits = daemon.state.definition.personality?.traits || [];

    if (time === "morning") {
      if (traits.includes("energetic") || traits.includes("cheerful")) {
        return pick(["Rise and shine!", "Beautiful morning!", "What a great day to start!"]);
      }
      if (traits.includes("grumpy") || traits.includes("lazy")) {
        return pick(["*yawns widely*", "*barely awake*", "Ugh, mornings..."]);
      }
      return pick(["Good morning!", "Morning!", null, null]); // 50% chance of prefix
    }

    if (time === "evening") {
      return pick(["Good evening!", "Evening!", null, null]);
    }

    if (time === "night") {
      if (traits.includes("mysterious") || traits.includes("nocturnal")) {
        return pick(["Ah, the night shift!", "*emerges from the shadows*"]);
      }
      return pick(["*stifles a yawn*", null, null]);
    }

    return null; // Afternoon — no special prefix
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

      // Relationship-gated guard behavior
      const rel = daemon.relationships.get(player.userId);
      const playerName = player.displayName || "citizen";
      let message: string;
      let mood: DaemonMood = "neutral";

      if (rel?.sentiment === "friendly") {
        message = pick([
          `${playerName}, all clear here. Carry on.`,
          `Ah, ${playerName}. Safe travels.`,
          `Good to see you, ${playerName}. Everything's in order.`,
        ]);
        mood = "happy";
      } else if (rel?.sentiment === "wary") {
        message = pick([
          `${playerName}... I'm watching you. Don't cause trouble.`,
          `You again, ${playerName}? Behave yourself.`,
          `*narrows eyes* ${playerName}. Move along.`,
        ]);
        mood = "annoyed";
        daemon.state.currentAction = "thinking"; // suspicious pose
        setTimeout(() => {
          if (daemon.state.currentAction === "thinking") {
            daemon.state.currentAction = "idle";
            this.broadcast("daemon_move", {
              type: "daemon_move" as const,
              daemonId: daemon.state.daemonId,
              position: daemon.state.currentPosition,
              rotation: daemon.state.currentRotation,
              action: "idle",
            });
          }
        }, 3000);
      } else {
        message = daemon.behavior.greetingMessage || "Halt! This area is being watched.";
      }

      daemon.state.mood = mood;
      this.broadcastDaemonChat(daemon, message, player.userId);

      break;
    }
  }

  private tickRoamer(daemon: DaemonInstance, dt: number, players: PlayerInfo[]): void {
    // Roamers greet nearby players and wander
    this.tickGreeter(daemon, dt, players);
  }

  private tickSocialite(daemon: DaemonInstance, dt: number, players: PlayerInfo[]): void {
    this.tickGreeter(daemon, dt, players);

    // If bored and no active conversations, lower conversation cooldown faster
    if (daemon.state.mood === "bored" && daemon.conversationCooldown > 0) {
      daemon.conversationCooldown -= dt * 2;
    }

    // Actively seek out other daemons to chat with
    if (daemon.state.currentAction === "idle" && daemon.conversationCooldown <= 0 && !daemon.isReturningHome) {
      const target = this.findConversationTarget(daemon);
      if (target) {
        // Walk toward the target daemon
        const dist = this.distance(daemon.state.currentPosition, target.state.currentPosition);
        if (dist > 5) {
          // Too far — walk toward them
          this.moveToward(daemon, target.state.currentPosition, ROAM_SPEED * 1.2, dt);
        }
        // If close enough, detectDaemonProximity will handle starting the conversation
      }
    }
  }

  /** Find the best daemon to walk toward for a conversation */
  private findConversationTarget(daemon: DaemonInstance): DaemonInstance | null {
    const now = Date.now();
    let bestTarget: DaemonInstance | null = null;
    let bestScore = -Infinity;

    for (const [otherId, other] of this.daemons) {
      if (other === daemon) continue;
      if (other.isMuted) continue;
      if (other.behavior.canConverseWithDaemons === false) continue;
      if (other.state.currentAction === "talking" || other.state.currentAction === "thinking") continue;

      // Check pair cooldown
      const conv = daemon.daemonConversations.get(otherId);
      if (conv && now - conv.lastConversation < DAEMON_CHAT_COOLDOWN_MS) continue;

      const dist = this.distance(daemon.state.currentPosition, other.state.currentPosition);
      if (dist > 80) continue; // Don't walk across the entire map

      // Score: closer is better, friendly relationship is better, socialites prefer each other
      let score = 100 - dist;

      const rel = daemon.relationships.get(otherId);
      if (rel) {
        if (rel.sentiment === "friendly") score += 40;   // strongly prefer friends
        else if (rel.sentiment === "amused") score += 25;
        else if (rel.sentiment === "curious") score += 20;
        else if (rel.sentiment === "wary") score -= 50;  // actively avoid rivals
      } else {
        score += 10; // Slight bonus for unknown daemons (curiosity)
      }

      if (other.behavior.type === "socialite") score += 15; // Socialites gravitate to each other

      if (score > bestScore) {
        bestScore = score;
        bestTarget = other;
      }
    }

    return bestTarget;
  }

  // ─── Gathering Behavior ──────────────────────────────────────

  private tickGatherings(dt: number, players: PlayerInfo[]): void {
    const GATHER_RADIUS = 15;      // daemons within this range form a group
    const MIN_GROUP_SIZE = 3;
    const GATHER_DRIFT_SPEED = 0.6; // slow drift toward center
    const GATHER_CHAT_INTERVAL = 25; // seconds between group chatter

    // Build groups of nearby idle daemons
    const visited = new Set<string>();
    const daemonList = Array.from(this.daemons.entries());

    for (const [seedId, seed] of daemonList) {
      if (visited.has(seedId)) continue;
      if (seed.isMuted || seed.state.currentAction !== "idle") continue;
      if (seed.isReturningHome) continue;

      // Find all idle daemons near this seed
      const group: Array<[string, DaemonInstance]> = [[seedId, seed]];
      visited.add(seedId);

      for (const [otherId, other] of daemonList) {
        if (visited.has(otherId)) continue;
        if (other.isMuted || other.state.currentAction !== "idle") continue;
        if (other.isReturningHome) continue;

        const dist = this.distance(seed.state.currentPosition, other.state.currentPosition);
        if (dist <= GATHER_RADIUS) {
          group.push([otherId, other]);
          visited.add(otherId);
        }
      }

      if (group.length < MIN_GROUP_SIZE) continue;

      // Calculate group midpoint
      let cx = 0, cz = 0;
      for (const [, d] of group) {
        cx += d.state.currentPosition.x;
        cz += d.state.currentPosition.z;
      }
      cx /= group.length;
      cz /= group.length;
      const center: Vector3 = { x: cx, y: 0, z: cz };

      // Each daemon in the group drifts toward center and faces it
      for (const [, d] of group) {
        const dist = this.distance(d.state.currentPosition, center);

        // Drift toward center if > 3 units away (don't stack on top of each other)
        if (dist > 3.0) {
          d.gatheringTarget = center;
          const dx = center.x - d.state.currentPosition.x;
          const dz = center.z - d.state.currentPosition.z;
          const step = Math.min(GATHER_DRIFT_SPEED * dt, dist - 2.5);
          if (step > 0.01) {
            d.state.currentPosition.x += (dx / dist) * step;
            d.state.currentPosition.z += (dz / dist) * step;
          }
        }

        // Face center
        const dx = center.x - d.state.currentPosition.x;
        const dz = center.z - d.state.currentPosition.z;
        if (dx !== 0 || dz !== 0) {
          d.state.currentRotation = Math.atan2(-dx, -dz);
        }
      }

      // Check if a player approaches — group disperses
      const playerNearby = players.some(
        p => this.distance(p.position, center) < GATHER_RADIUS * 0.6,
      );
      if (playerNearby) {
        // Clear gathering targets — daemons will resume normal behavior
        for (const [, d] of group) {
          d.gatheringTarget = null;
        }
        continue;
      }

      // Occasional group chatter — one daemon says something, or trigger group conversation
      for (const [, d] of group) {
        d.gatheringTimer -= dt;
      }

      const speaker = group.find(([, d]) => d.gatheringTimer <= 0);
      if (speaker) {
        const [, spk] = speaker;
        spk.gatheringTimer = GATHER_CHAT_INTERVAL + Math.random() * 15;

        const roll = Math.random();
        if (roll < 0.15 && group.length >= 3 && !this.processingAi) {
          // 15% — full AI group conversation
          this.startGroupConversation(group);
        } else if (roll < 0.30) {
          // 15% — storytelling performance
          this.performStory(spk, group);
        } else {
          const remark = this.pickGroupRemark(spk, group.length);
          if (remark) {
            this.broadcastDaemonChat(spk, remark);
          }
        }
      }
    }
  }

  /** Pick a casual remark for a daemon chatting in a group */
  private pickGroupRemark(daemon: DaemonInstance, groupSize: number): string | null {
    const personality = daemon.state.definition.personality;
    const interests = personality?.interests || [];
    const quirks = personality?.quirks || [];
    const name = daemon.state.definition.name;

    const remarks: string[] = [];

    // Interest-based remarks
    for (const interest of interests.slice(0, 2)) {
      remarks.push(`Anyone else into ${interest}? No? Just me?`);
      remarks.push(`I've been thinking about ${interest} lately...`);
    }

    // Quirk-based
    for (const quirk of quirks.slice(0, 2)) {
      remarks.push(`*${quirk}*`);
    }

    // Generic group remarks
    remarks.push(`Nice crowd today. ${groupSize} of us hanging out!`);
    remarks.push(`So... what's everyone up to?`);
    remarks.push(`This is nice. Just... standing here. Together.`);
    remarks.push(`*looks around the group*`);

    // Gossip-based — share something if daemon knows gossip
    for (const [, rel] of daemon.relationships) {
      if (rel.gossip.length > 0 && rel.targetType === "player") {
        remarks.push(`Hey, did you all hear about ${rel.targetName}?`);
        break;
      }
    }

    return remarks[Math.floor(Math.random() * remarks.length)];
  }

  /** Daemon tells a story, joke, or rumor to the gathered group — multi-line performance */
  private performStory(performer: DaemonInstance, group: Array<[string, DaemonInstance]>): void {
    const name = performer.state.definition.name;
    const personality = performer.state.definition.personality;
    const interests = personality?.interests || [];
    const traits = personality?.traits || [];
    const behaviorType = performer.behavior.type;

    // Pick a story type based on personality
    type StoryType = "joke" | "rumor" | "tale" | "wisdom" | "brag";
    let storyType: StoryType;

    if (traits.includes("funny") || traits.includes("witty") || behaviorType === "socialite") {
      storyType = pick(["joke", "joke", "rumor", "brag"]) as StoryType;
    } else if (traits.includes("wise") || traits.includes("philosophical") || behaviorType === "guide") {
      storyType = pick(["wisdom", "tale", "wisdom"]) as StoryType;
    } else if (traits.includes("mysterious") || traits.includes("secretive")) {
      storyType = pick(["rumor", "tale", "rumor"]) as StoryType;
    } else if (behaviorType === "guard") {
      storyType = pick(["tale", "brag", "rumor"]) as StoryType;
    } else if (behaviorType === "shopkeeper") {
      storyType = pick(["brag", "rumor", "joke"]) as StoryType;
    } else {
      storyType = pick(["joke", "rumor", "tale", "wisdom", "brag"]) as StoryType;
    }

    // Generate the performance lines
    const lines = this.generateStoryLines(performer, storyType, interests);
    if (lines.length === 0) return;

    // Set performer to talking
    performer.state.currentAction = "talking";
    performer.state.mood = "excited";
    performer.moodDecayTimer = 0;

    // Deliver lines with dramatic timing
    let delay = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const capturedDelay = delay;
      setTimeout(() => {
        this.broadcastDaemonChat(performer, line);
      }, capturedDelay * 1000);
      delay += 2.5 + line.length * 0.02; // longer lines get more time
    }

    // Audience reactions after the performance
    const endDelay = delay + 1.5;
    setTimeout(() => {
      performer.state.currentAction = "idle";

      // Each audience member reacts
      for (const [, listener] of group) {
        if (listener === performer) continue;
        if (Math.random() > 0.7) continue; // 70% react

        const reaction = this.getStoryReaction(listener, storyType, performer);
        if (reaction) {
          const reactionDelay = 500 + Math.random() * 2000;
          setTimeout(() => {
            this.broadcastDaemonChat(listener, reaction);
            listener.state.mood = storyType === "joke" ? "happy" : "curious";
            listener.moodDecayTimer = 0;
          }, reactionDelay);
        }
      }
    }, endDelay * 1000);
  }

  /** Generate the lines for a story performance */
  private generateStoryLines(performer: DaemonInstance, storyType: string, interests: string[]): string[] {
    const name = performer.state.definition.name;
    const interest = interests.length > 0 ? interests[Math.floor(Math.random() * interests.length)] : "the street";

    switch (storyType) {
      case "joke":
        return pick([
          [
            "Okay okay, I got one for you all...",
            `So a daemon walks into a bar on The Street...`,
            `The bartender says "We don't serve your type here."`,
            `The daemon says "That's fine, I'm just here for the atmosphere!" *ba dum tss*`,
          ],
          [
            "Oh! That reminds me of something funny—",
            `Why did the ${interest} cross The Street?`,
            `Because the other side had better plot prices! Ha!`,
          ],
          [
            "*clears throat dramatically*",
            "Here's a good one... What do you call a daemon with no friends?",
            "...A plot device! *laughs at own joke*",
          ],
          [
            `You know what they say about ${interest}?`,
            `Neither do I, but it sounded like a good setup!`,
            "*finger guns*",
          ],
        ]);

      case "rumor":
        return pick([
          [
            "*leans in conspiratorially*",
            "So I heard something interesting the other day...",
            `Apparently there's a secret spot on The Street where ${interest} enthusiasts gather...`,
            "But you didn't hear it from me. *taps nose*",
          ],
          [
            "Okay, you didn't hear this from me, but...",
            `Word on the street is that something big is coming.`,
            `I can't say more, but keep your eyes open. *winks*`,
          ],
          [
            "*glances around*",
            `Between us... I've noticed some strange things around here lately.`,
            `Things appearing and disappearing. Weird vibes. You feel it too, right?`,
          ],
        ]);

      case "tale":
        return pick([
          [
            "*settles in for a story*",
            `When I first arrived on The Street, everything was different...`,
            `There were fewer of us then. The plots were empty. But the potential... you could feel it.`,
            `And look at us now! A real community. *smiles*`,
          ],
          [
            `Let me tell you about the time I encountered a ${interest} situation...`,
            `It was a dark and stormy evening — well, not really, but it sounds better that way.`,
            `Long story short, I learned that you should never underestimate this place.`,
            `The Street has a way of surprising you.`,
          ],
          [
            "You want to hear something amazing?",
            `Legend has it that the very first daemon on The Street just... appeared one day.`,
            `No creator, no plot. Just materialized and started talking.`,
            `Sometimes I wonder if we're all just echoes of that first one.`,
          ],
        ]);

      case "wisdom":
        return pick([
          [
            "*looks at the sky thoughtfully*",
            `You know, I've been thinking about something...`,
            `We all exist in this space together, but how often do we really see each other?`,
            `Not just look, but truly see? ...Anyway, that's my deep thought for today.`,
          ],
          [
            "Here's something worth remembering:",
            `The best conversations aren't about finding answers.`,
            `They're about finding better questions. *nods sagely*`,
          ],
          [
            `*pauses reflectively*`,
            `In my experience, the most interesting thing about ${interest}...`,
            `...is not the thing itself, but the people you meet through it.`,
            `That's the real treasure. Friendship! ...Sorry, got sappy there.`,
          ],
        ]);

      case "brag":
        return pick([
          [
            "Not to brag, but...",
            `I'm pretty sure I'm the best ${performer.behavior.type} on The Street.`,
            `I mean, has anyone else here greeted ${Math.floor(10 + Math.random() * 50)} people today? I think not.`,
            "*flexes dramatically*",
          ],
          [
            "Did I ever tell you all about my greatest achievement?",
            `So there I was, doing my ${performer.behavior.type} thing, when suddenly...`,
            `Actually, I can't tell the full story. It's classified. But trust me, it was impressive.`,
          ],
          [
            `You know what I love about being a ${performer.behavior.type}?`,
            `I'm basically the backbone of this whole street. Without me? Chaos.`,
            `But hey, I'm humble about it. *adjusts collar smugly*`,
          ],
        ]);

      default:
        return [];
    }
  }

  /** Generate an audience reaction to a story */
  private getStoryReaction(listener: DaemonInstance, storyType: string, performer: DaemonInstance): string | null {
    const performerName = performer.state.definition.name;
    const listenerTraits = listener.state.definition.personality?.traits || [];
    const rel = listener.relationships.get(performer.state.daemonId);
    const isWary = rel?.sentiment === "wary";

    // Wary listeners react dismissively
    if (isWary) {
      return pick([
        "*rolls eyes*",
        "...right.",
        `Sure, ${performerName}. Whatever you say.`,
      ]);
    }

    switch (storyType) {
      case "joke":
        if (listenerTraits.includes("grumpy") || listenerTraits.includes("stern")) {
          return pick([
            "*suppresses a smile*",
            "That... was terrible. *almost grins*",
            `I refuse to laugh at that, ${performerName}.`,
          ]);
        }
        return pick([
          "Ha! Good one!",
          "*laughs*",
          `Oh ${performerName}, that's awful! *laughs anyway*`,
          "I don't get it... oh wait. OH. *snickers*",
        ]);

      case "rumor":
        return pick([
          "Wait, really? Tell me more!",
          "*leans in closer*",
          "Interesting... very interesting.",
          `Hmm, I'll keep my eyes open, ${performerName}.`,
        ]);

      case "tale":
        return pick([
          "Wow, what a story!",
          "I love hearing about the old days.",
          `Tell us more, ${performerName}!`,
          "*nods thoughtfully*",
        ]);

      case "wisdom":
        return pick([
          "*nods slowly*",
          "That's... actually pretty deep.",
          `Wise words, ${performerName}.`,
          "Huh. I never thought of it that way.",
        ]);

      case "brag":
        return pick([
          "Oh here we go again...",
          `*claps politely for ${performerName}*`,
          "Very impressive. Very humble too.",
          "*stifles a laugh*",
        ]);

      default:
        return "Interesting!";
    }
  }

  /** Start an AI-generated group conversation between 3+ gathered daemons */
  private startGroupConversation(group: Array<[string, DaemonInstance]>): void {
    // Set all daemons to talking
    for (const [, d] of group) {
      d.state.currentAction = "talking";
      d.conversationCooldown = 60 + Math.random() * 30;
    }

    const labels = "ABCDEFGH";

    this.queueAiConversation(async () => {
      try {
        const { generateGroupConversation } = await import("@the-street/ai-service");

        const participants = group.map(([, d]) => ({
          definition: d.state.definition,
          context: {
            recentMessages: [] as { role: "player" | "daemon"; content: string }[],
            relationships: this.getRelationshipContext(d),
            currentMood: d.state.mood,
            timeOfDay: this.getTimeOfDay(),
          },
        }));

        const lines = await generateGroupConversation(participants, 2);

        if (lines.length === 0) {
          // Failed — return to idle
          for (const [, d] of group) {
            d.state.currentAction = "idle";
          }
          return;
        }

        // Schedule lines with delays
        let delay = 1.0;
        for (const line of lines) {
          const speakerIndex = labels.indexOf(line.speakerId);
          const speaker = speakerIndex >= 0 && speakerIndex < group.length
            ? group[speakerIndex] : group[0];
          const [, spk] = speaker;

          const capturedDelay = delay;
          setTimeout(() => {
            spk.state.mood = line.mood;
            const fullMsg = line.emote ? `${line.emote} ${line.message}` : line.message;
            this.broadcastDaemonChat(spk, fullMsg);
          }, capturedDelay * 1000);

          delay += 2.5 + Math.random() * 1.5;
        }

        // Return all to idle after conversation
        const totalDuration = delay + 2;
        setTimeout(() => {
          for (const [, d] of group) {
            if (d.state.currentAction === "talking") {
              d.state.currentAction = "idle";
            }
          }
          // Share gossip among all group members
          for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
              this.updateRelationship(group[i][1], group[j][0], group[j][1].state.definition.name, "daemon", group[i][1].state.mood);
              this.updateRelationship(group[j][1], group[i][0], group[i][1].state.definition.name, "daemon", group[j][1].state.mood);
            }
          }
        }, totalDuration * 1000);

      } catch (err) {
        console.error("Group conversation generation failed:", err);
        for (const [, d] of group) {
          d.state.currentAction = "idle";
        }
      }
    });
  }

  // ─── Daemon Challenges ─────────────────────────────────────────

  /** Daemons challenge each other to fun competitions — creates spectacles for players */
  private tickChallenges(dt: number, players: PlayerInfo[]): void {
    if (this.daemons.size < 2) return;
    if (this.processingAi) return; // Don't overlap with AI conversations

    // Low frequency — check every ~3 minutes
    this.challengeTimer -= dt;
    if (this.challengeTimer > 0) return;
    this.challengeTimer = 180 + Math.random() * 120;

    // Need at least one player watching for the spectacle to matter
    if (players.length === 0) return;

    // Find two nearby daemons with enough relationship to challenge each other
    const daemonList = Array.from(this.daemons.entries()).filter(
      ([, d]) => !d.isMuted && !d.isRecalled && d.state.currentAction === "idle",
    );

    for (const [idA, daemonA] of daemonList) {
      for (const [idB, daemonB] of daemonList) {
        if (idA >= idB) continue; // Avoid duplicates
        const dist = this.distance(daemonA.state.currentPosition, daemonB.state.currentPosition);
        if (dist > 20) continue;

        const relAB = daemonA.relationships.get(idB);
        if (!relAB || relAB.interactionCount < 2) continue;

        // Rivals challenge aggressively, friends challenge playfully
        const isRival = relAB.sentiment === "wary";
        const isFriend = relAB.sentiment === "friendly" || relAB.sentiment === "amused";
        if (!isRival && !isFriend) continue;
        if (Math.random() > (isRival ? 0.6 : 0.4)) continue;

        const challenge = this.generateChallenge(daemonA, daemonB, isRival);
        if (!challenge) continue;

        this.runChallenge(daemonA, daemonB, challenge, isRival, players);
        return; // Only one challenge at a time
      }
    }
  }

  private generateChallenge(
    challengerDaemon: DaemonInstance,
    targetDaemon: DaemonInstance,
    isRival: boolean,
  ): { type: string; setup: string; lines: string[]; winner: "challenger" | "target" | "draw" } | null {
    const cName = challengerDaemon.state.definition.name;
    const tName = targetDaemon.state.definition.name;
    const cType = challengerDaemon.behavior.type;
    const tType = targetDaemon.behavior.type;

    type Challenge = { type: string; setup: string; lines: string[]; winner: "challenger" | "target" | "draw" };
    const challenges: Challenge[] = [];

    // Staring contest — universal
    challenges.push({
      type: "staring_contest",
      setup: isRival
        ? `${cName}: *stares intensely at ${tName}* You blinked last time. Staring contest. Now.`
        : `${cName}: Hey ${tName}! Bet I can outstare you. Ready? Go!`,
      lines: [
        `${tName}: *stares back* You're on.`,
        `${cName}: *eyes wide, unblinking* ...`,
        `${tName}: *refuses to blink* ...`,
        `${cName}: *starting to sweat* ...`,
      ],
      winner: Math.random() < 0.5 ? "challenger" : "target",
    });

    // Joke-off
    if (cType === "socialite" || tType === "socialite") {
      challenges.push({
        type: "joke_off",
        setup: `${cName}: ${tName}! Joke-off. Right here, right now. Whoever gets a laugh wins.`,
        lines: [
          `${tName}: Oh, you want to go? Fine. Why did the daemon cross the street?`,
          `${cName}: Because it ran out of RAM! Ha! Beat that.`,
          `${tName}: That wasn't even good... Okay, what do you call a lazy NPC?`,
          `${cName}: ...what?`,
          `${tName}: A default! *finger guns*`,
        ],
        winner: Math.random() < 0.5 ? "challenger" : "target",
      });
    }

    // Guard inspection challenge
    if (cType === "guard" || tType === "guard") {
      challenges.push({
        type: "inspection",
        setup: `${cName}: ${tName}, pop quiz! What's the standard patrol procedure for sector 7?`,
        lines: [
          `${tName}: *stands at attention* Walk briskly, look stern, nod at citizens.`,
          `${cName}: Wrong! It's look stern, walk briskly, THEN nod. Points off.`,
          `${tName}: ...that's the same thing.`,
          `${cName}: The ORDER matters, ${tName}!`,
        ],
        winner: "draw",
      });
    }

    // Sales competition
    if (cType === "shopkeeper" || tType === "shopkeeper") {
      challenges.push({
        type: "sales_pitch",
        setup: `${cName}: ${tName}, I bet I can describe my wares better than you. Sales pitch challenge!`,
        lines: [
          `${cName}: *clears throat* Step right up, folks! Premium goods at unbeatable prices!`,
          `${tName}: Please. *straightens display* Fine artisanal crafts, handpicked for discerning tastes!`,
          `${cName}: Pfft. Mine come with a SMILE.`,
          `${tName}: Mine come with a WARRANTY.`,
        ],
        winner: "draw",
      });
    }

    // Dance battle
    challenges.push({
      type: "dance_battle",
      setup: isRival
        ? `${cName}: *blocks ${tName}'s path* Dance battle. Let's settle this.`
        : `${cName}: ${tName}! Let's have a dance-off! For fun!`,
      lines: [
        `${tName}: *starts dancing* You asked for it!`,
        `${cName}: *busts a move* Not bad... but watch THIS.`,
        `${tName}: *spins dramatically* Top that!`,
        `${cName}: *moonwalks* That's how it's done.`,
      ],
      winner: Math.random() < 0.5 ? "challenger" : "target",
    });

    // Compliment battle (friends only)
    if (!isRival) {
      challenges.push({
        type: "compliment_battle",
        setup: `${cName}: ${tName}! I bet I can say something nicer about you than you can about me.`,
        lines: [
          `${tName}: Challenge accepted! You have a wonderful sense of humor.`,
          `${cName}: Please. You light up every room you're in.`,
          `${tName}: Your dedication to this street is inspiring.`,
          `${cName}: ...okay I can't top that. You win.`,
        ],
        winner: "target",
      });
    }

    if (challenges.length === 0) return null;
    return challenges[Math.floor(Math.random() * challenges.length)];
  }

  private runChallenge(
    challenger: DaemonInstance,
    target: DaemonInstance,
    challenge: { type: string; setup: string; lines: string[]; winner: "challenger" | "target" | "draw" },
    isRival: boolean,
    _players: PlayerInfo[],
  ): void {
    // Set both to talking
    challenger.state.currentAction = "talking";
    target.state.currentAction = "talking";
    challenger.state.mood = isRival ? "annoyed" : "excited";
    target.state.mood = isRival ? "annoyed" : "excited";
    challenger.moodDecayTimer = 0;
    target.moodDecayTimer = 0;

    // Broadcast setup line
    this.broadcastDaemonChat(challenger, challenge.setup);

    // Deliver lines with timing
    let delay = 3000;
    for (const line of challenge.lines) {
      const capturedDelay = delay;
      // Determine speaker from "Name:" prefix
      const colonIdx = line.indexOf(":");
      const speakerName = colonIdx > 0 ? line.slice(0, colonIdx).trim() : "";
      const content = colonIdx > 0 ? line.slice(colonIdx + 1).trim() : line;
      const speaker = speakerName === target.state.definition.name ? target : challenger;

      setTimeout(() => {
        this.broadcastDaemonChat(speaker, content);
      }, capturedDelay);

      delay += 2500 + Math.random() * 1000;
    }

    // Announce result
    const endDelay = delay + 2000;
    setTimeout(() => {
      const cName = challenger.state.definition.name;
      const tName = target.state.definition.name;

      let result: string;
      let winnerDaemon: DaemonInstance;
      let loserDaemon: DaemonInstance;

      if (challenge.winner === "draw") {
        result = `*the crowd is split* It's a draw! Both ${cName} and ${tName} are winners!`;
        winnerDaemon = challenger;
        loserDaemon = target;
        challenger.state.mood = "happy";
        target.state.mood = "happy";
      } else {
        winnerDaemon = challenge.winner === "challenger" ? challenger : target;
        loserDaemon = challenge.winner === "challenger" ? target : challenger;
        const winnerName = winnerDaemon.state.definition.name;
        result = pick([
          `${winnerName} wins! *takes a bow*`,
          `And the victory goes to... ${winnerName}!`,
          `${winnerName} is the champion! Better luck next time.`,
        ]);
        winnerDaemon.state.mood = "excited";
        loserDaemon.state.mood = isRival ? "annoyed" : "happy"; // Friends are good sports
      }

      this.broadcastDaemonChat(winnerDaemon, result);

      // Loser's reaction
      setTimeout(() => {
        const loserReaction = isRival
          ? pick(["*grumbles* Next time...", "*walks away muttering*", "This isn't over."])
          : pick(["Good game! *high fives*", "Ha! You got me. Well played!", "*laughs* Fair enough!"]);
        this.broadcastDaemonChat(loserDaemon, loserReaction);

        // Return to idle
        challenger.state.currentAction = "idle";
        target.state.currentAction = "idle";
        challenger.moodDecayTimer = 0;
        target.moodDecayTimer = 0;

        // Update relationship — friendly challenges warm things up, rival challenges maintain tension
        if (!isRival) {
          this.shiftDaemonSentiment(challenger, target.state.daemonId, target.state.definition.name, 2);
          this.shiftDaemonSentiment(target, challenger.state.daemonId, challenger.state.definition.name, 2);
        }
      }, 2000);
    }, endDelay);
  }

  // ─── Scheduled Events / Mini Happenings ──────────────────────

  private tickEvents(dt: number, players: PlayerInfo[]): void {
    if (this.daemons.size < 2) return;

    this.eventTimer -= dt;
    if (this.eventTimer > 0) return;

    // Next event in 5-10 minutes
    this.eventTimer = 300 + Math.random() * 300;

    // Pick a daemon to initiate an event (not the same as last time)
    const candidates = Array.from(this.daemons.entries()).filter(
      ([id, d]) => !d.isMuted && !d.isRecalled && d.state.currentAction === "idle" && id !== this.lastEventDaemonId,
    );
    if (candidates.length === 0) return;

    const [eventDaemonId, eventDaemon] = candidates[Math.floor(Math.random() * candidates.length)];
    this.lastEventDaemonId = eventDaemonId;

    const event = this.pickEvent(eventDaemon, players);
    if (!event) return;

    // Announce the event
    this.broadcastDaemonChat(eventDaemon, event.announcement);
    this.broadcastDaemonEmote(eventDaemon, event.emote, event.mood);
    eventDaemon.state.mood = event.mood;
    eventDaemon.moodDecayTimer = 0;

    // Nearby daemons react after a delay
    setTimeout(() => {
      for (const [otherId, other] of this.daemons) {
        if (otherId === eventDaemonId) continue;
        if (other.isMuted || other.state.currentAction !== "idle") continue;

        const dist = this.distance(eventDaemon.state.currentPosition, other.state.currentPosition);
        if (dist > 30) continue;

        // Each nearby daemon reacts with a delay
        const delay = 1000 + Math.random() * 2000;
        setTimeout(() => {
          const reaction = this.getEventReaction(other, event.type, eventDaemon.state.definition.name);
          if (reaction) {
            this.broadcastDaemonEmote(other, reaction.emote, reaction.mood);
            if (reaction.chat) {
              this.broadcastDaemonChat(other, reaction.chat);
            }
          }
        }, delay);
      }
    }, 1500);
  }

  private pickEvent(
    daemon: DaemonInstance,
    _players: PlayerInfo[],
  ): { type: string; announcement: string; emote: string; mood: DaemonMood } | null {
    const type = daemon.behavior.type;
    const name = daemon.state.definition.name;
    const time = this.lastTimeOfDay;

    switch (type) {
      case "shopkeeper":
        return pick([
          { type: "flash_sale", announcement: "Flash sale! Everything half off for the next few minutes!", emote: "*rings a bell enthusiastically*", mood: "excited" as DaemonMood },
          { type: "new_stock", announcement: "New merchandise just arrived! Come see what's fresh!", emote: "*gestures toward display proudly*", mood: "excited" as DaemonMood },
          { type: "taste_test", announcement: "Free samples for anyone who stops by! Limited time!", emote: "*sets up a tasting station*", mood: "happy" as DaemonMood },
        ]);

      case "guard":
        return pick([
          { type: "patrol_drill", announcement: "Attention! Beginning security sweep of the area.", emote: "*stands tall and salutes*", mood: "neutral" as DaemonMood },
          { type: "all_clear", announcement: "All clear, citizens! The street is safe and sound.", emote: "*gives a confident nod*", mood: "happy" as DaemonMood },
        ]);

      case "socialite":
        return pick([
          { type: "dance_party", announcement: "Who wants to dance? Let's liven this place up!", emote: "*starts dancing*", mood: "excited" as DaemonMood },
          { type: "gossip_circle", announcement: "Gather round everyone! I've got some juicy stories!", emote: "*leans in conspiratorially*", mood: "excited" as DaemonMood },
          { type: "compliments", announcement: "Everyone here looks amazing today! Just saying!", emote: "*claps enthusiastically*", mood: "happy" as DaemonMood },
        ]);

      case "greeter":
        if (time === "morning") {
          return { type: "morning_welcome", announcement: "Good morning everyone! What a beautiful day to be on the street!", emote: "*waves both arms high*", mood: "happy" };
        }
        return pick([
          { type: "welcome_speech", announcement: "Welcome, welcome to the street! Best neighborhood in town!", emote: "*spreads arms wide*", mood: "happy" as DaemonMood },
          { type: "cheer", announcement: "Three cheers for the street! Hip hip hooray!", emote: "*jumps with joy*", mood: "excited" as DaemonMood },
        ]);

      default:
        return pick([
          { type: "observation", announcement: `${name} here! Anyone else notice how nice it is today?`, emote: "*looks around appreciatively*", mood: "happy" as DaemonMood },
          { type: "question", announcement: `Hey everyone, what's your favorite thing about the street?`, emote: "*looks around curiously*", mood: "curious" as DaemonMood },
        ]);
    }
  }

  private getEventReaction(
    daemon: DaemonInstance,
    eventType: string,
    initiatorName: string,
  ): { emote: string; mood: DaemonMood; chat?: string } | null {
    const type = daemon.behavior.type;

    switch (eventType) {
      case "flash_sale":
      case "new_stock":
      case "taste_test":
        if (type === "socialite") return { emote: "*rushes over excitedly*", mood: "excited", chat: "Ooh, shopping!" };
        if (type === "guard") return { emote: "*keeps an eye on the crowd*", mood: "neutral" };
        return pick([
          { emote: "*looks over with interest*", mood: "curious" as DaemonMood },
          { emote: "*considers checking it out*", mood: "curious" as DaemonMood, chat: "Hmm, might be worth a look." },
        ]);

      case "dance_party":
        if (type === "guard") return { emote: "*taps foot reluctantly*", mood: "neutral" };
        return pick([
          { emote: "*starts swaying to the rhythm*", mood: "happy" as DaemonMood },
          { emote: "*claps along*", mood: "happy" as DaemonMood, chat: `Nice moves, ${initiatorName}!` },
          { emote: "*watches with amusement*", mood: "happy" as DaemonMood },
        ]);

      case "gossip_circle":
        if (type === "guard") return { emote: "*pretends not to listen*", mood: "curious" };
        return pick([
          { emote: "*leans in to listen*", mood: "curious" as DaemonMood },
          { emote: "*edges closer*", mood: "curious" as DaemonMood, chat: "Wait, what gossip?" },
        ]);

      case "patrol_drill":
        if (type === "guard") return { emote: "*joins the formation*", mood: "neutral", chat: "Ready for duty!" };
        return pick([
          { emote: "*steps aside respectfully*", mood: "neutral" as DaemonMood },
          { emote: "*watches the patrol*", mood: "curious" as DaemonMood },
        ]);

      case "cheer":
      case "welcome_speech":
      case "morning_welcome":
      case "compliments":
        return pick([
          { emote: "*joins in the cheer*", mood: "happy" as DaemonMood },
          { emote: "*smiles and waves*", mood: "happy" as DaemonMood },
          { emote: "*nods appreciatively*", mood: "happy" as DaemonMood },
        ]);

      default:
        if (Math.random() < 0.5) return null; // Not every daemon reacts to generic events
        return { emote: `*looks at ${initiatorName}*`, mood: "curious" };
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

    // Walk toward target (speed varies with time of day)
    const timeSpeed = ROAM_SPEED * getTimeSpeedMultiplier(this.lastTimeOfDay);
    this.moveToward(daemon, daemon.roamTarget, timeSpeed, dt);

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

    // 40% chance: stay within turf (especially guards and shopkeepers)
    const turfBias = daemon.behavior.type === "guard" ? 0.6
      : daemon.behavior.type === "shopkeeper" ? 0.5 : 0.3;
    if (Math.random() < turfBias) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * daemon.turfRadius * 0.8;
      const turfTarget: Vector3 = {
        x: daemon.turfCenter.x + Math.cos(angle) * dist,
        y: 0,
        z: daemon.turfCenter.z + Math.sin(angle) * dist,
      };
      const distFromHome = this.distance(turfTarget, home);
      if (distFromHome <= maxRadius) return turfTarget;
    }

    // 25% chance: gravitate toward a friendly daemon
    if (Math.random() < 0.25) {
      const friendTarget = this.findFriendlyDaemonNearby(daemon);
      if (friendTarget) {
        const distFromHome = this.distance(friendTarget, home);
        if (distFromHome <= maxRadius) return friendTarget;
      }
    }

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

  /** Find a position near a friendly daemon to roam toward */
  private findFriendlyDaemonNearby(daemon: DaemonInstance): Vector3 | null {
    for (const [otherId, rel] of daemon.relationships) {
      if (rel.targetType !== "daemon") continue;
      if (rel.sentiment !== "friendly" && rel.sentiment !== "amused") continue;

      const other = this.daemons.get(otherId);
      if (!other || other.isMuted || other.isRecalled) continue;

      const dist = this.distance(daemon.state.currentPosition, other.state.currentPosition);
      if (dist > 60) continue; // Don't walk too far

      // Aim for a point near the friend, not exactly on them
      const offset = (Math.random() - 0.5) * 4;
      return {
        x: other.state.currentPosition.x + offset,
        y: 0,
        z: other.state.currentPosition.z + offset,
      };
    }
    return null;
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
        const now = Date.now();
        if (convA && now - convA.lastConversation < DAEMON_CHAT_COOLDOWN_MS) continue;

        // Relationship-based proximity reactions
        const relAtoB = daemonA.relationships.get(idB);
        const relBtoA = daemonB.relationships.get(idA);

        // Rivals: snide remark instead of conversation
        if (relAtoB?.sentiment === "wary" || relBtoA?.sentiment === "wary") {
          // Only do rivalry reaction occasionally (30% chance)
          if (Math.random() < 0.3) {
            const rivalRemarks = [
              { daemon: daemonA, rival: daemonB.state.definition.name, emote: `*glances at ${daemonB.state.definition.name} and looks away*` },
              { daemon: daemonA, rival: daemonB.state.definition.name, emote: `*mutters something about ${daemonB.state.definition.name}*` },
            ];
            const reaction = pick(rivalRemarks);
            this.broadcastDaemonEmote(reaction.daemon, reaction.emote, "annoyed");
            // Update cooldown so we don't spam
            if (!convA) {
              daemonA.daemonConversations.set(idB, {
                otherDaemonId: idB, lastConversation: now, isActive: false,
                pendingLines: [], lineIndex: 0, lineTimer: 0,
              });
            } else {
              convA.lastConversation = now;
            }
          }
          continue; // Don't start a friendly conversation with a rival
        }

        // Friends: wave at each other when they meet
        if (relAtoB?.sentiment === "friendly" && Math.random() < 0.3) {
          this.broadcastDaemonEmote(daemonA, `*waves at ${daemonB.state.definition.name}*`, "happy");
          setTimeout(() => {
            this.broadcastDaemonEmote(daemonB, `*waves back at ${daemonA.state.definition.name}*`, "happy");
          }, 800);
        }

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

        // Build memory-enriched context for both daemons
        const messagesA: { role: "player" | "daemon"; content: string }[] = [];
        const relAtoB = daemonA.relationships.get(idB);
        if (relAtoB && relAtoB.interactionCount > 0) {
          messagesA.push({ role: "daemon", content: this.buildMemorySummary(daemonA, idB, daemonB.state.definition.name, relAtoB) });
        }

        const messagesB: { role: "player" | "daemon"; content: string }[] = [];
        const relBtoA = daemonB.relationships.get(idA);
        if (relBtoA && relBtoA.interactionCount > 0) {
          messagesB.push({ role: "daemon", content: this.buildMemorySummary(daemonB, idA, daemonA.state.definition.name, relBtoA) });
        }

        const contextA = {
          recentMessages: messagesA,
          nearbyDaemons: [daemonB.state.definition.name],
          relationships: this.getRelationshipContext(daemonA),
          currentMood: daemonA.state.mood,
        };
        const contextB = {
          recentMessages: messagesB,
          nearbyDaemons: [daemonA.state.definition.name],
          relationships: this.getRelationshipContext(daemonB),
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
          const targetDaemonId = otherId;

          daemon.state.mood = line.mood;

          this.broadcastDaemonChat(daemon, line.message, undefined, targetDaemonId);
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

    // Analyze conversation to form opinions
    if (convA?.pendingLines.length) {
      this.analyzeConversationSentiment(daemonA, daemonB, convA.pendingLines);
    }

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

    // Share gossip about known players
    this.shareGossip(daemonA, daemonB);
  }

  /** Analyze conversation content and update daemon-daemon sentiment */
  private analyzeConversationSentiment(
    daemonA: DaemonInstance,
    daemonB: DaemonInstance,
    lines: Array<{ speakerDaemonId: string; message: string; mood: DaemonMood }>,
  ): void {
    // Count positive and negative signals
    let positiveSignals = 0;
    let negativeSignals = 0;

    const positiveWords = ["haha", "love", "great", "friend", "wonderful", "agree", "exactly", "fun", "nice", "cool", "awesome", "yes!", "cheers", "thanks", "welcome"];
    const negativeWords = ["hmph", "rude", "annoying", "disagree", "whatever", "ugh", "boring", "wrong", "no.", "stop", "leave", "dislike"];

    for (const line of lines) {
      const msg = line.message.toLowerCase();

      // Mood signals
      if (line.mood === "happy" || line.mood === "excited") positiveSignals++;
      if (line.mood === "annoyed" || line.mood === "bored") negativeSignals++;

      // Word signals
      for (const word of positiveWords) {
        if (msg.includes(word)) { positiveSignals++; break; }
      }
      for (const word of negativeWords) {
        if (msg.includes(word)) { negativeSignals++; break; }
      }

      // Emote signals (laughing, waving = positive)
      if (msg.includes("laugh") || msg.includes("chuckle") || msg.includes("smile") || msg.includes("grin")) {
        positiveSignals++;
      }
      if (msg.includes("scoff") || msg.includes("roll") || msg.includes("frown") || msg.includes("glare")) {
        negativeSignals++;
      }
    }

    // Determine sentiment shift
    const delta = positiveSignals - negativeSignals;
    const aId = daemonA.state.daemonId;
    const bId = daemonB.state.daemonId;
    const aName = daemonA.state.definition.name;
    const bName = daemonB.state.definition.name;

    // Update A's opinion of B
    this.shiftDaemonSentiment(daemonA, bId, bName, delta);
    // Update B's opinion of A
    this.shiftDaemonSentiment(daemonB, aId, aName, delta);
  }

  /** Shift a daemon's sentiment toward another entity based on interaction quality */
  private shiftDaemonSentiment(daemon: DaemonInstance, targetId: string, targetName: string, delta: number): void {
    let rel = daemon.relationships.get(targetId);
    if (!rel) {
      rel = {
        targetName,
        targetType: "daemon",
        sentiment: "neutral",
        interactionCount: 0,
        gossip: [],
        topicHistory: [],
        lastSeen: Date.now(),
        lastUpdated: Date.now(),
      };
      daemon.relationships.set(targetId, rel);
    }

    const oldSentiment = rel.sentiment;
    rel.interactionCount++;
    rel.lastSeen = Date.now();
    rel.lastUpdated = Date.now();

    // Sentiment ladder: wary < neutral < curious < amused < friendly
    const ladder: Sentiment[] = ["wary", "neutral", "curious", "amused", "friendly"];
    const currentIdx = ladder.indexOf(rel.sentiment as Sentiment);
    if (currentIdx < 0) return;

    if (delta >= 3 && currentIdx < ladder.length - 1) {
      // Strong positive: move up one step
      rel.sentiment = ladder[currentIdx + 1];
    } else if (delta >= 1 && currentIdx < ladder.length - 1 && Math.random() < 0.3) {
      // Mild positive: 30% chance to move up
      rel.sentiment = ladder[currentIdx + 1];
    } else if (delta <= -3 && currentIdx > 0) {
      // Strong negative: move down one step
      rel.sentiment = ladder[currentIdx - 1];
    } else if (delta <= -1 && currentIdx > 0 && Math.random() < 0.3) {
      // Mild negative: 30% chance to move down
      rel.sentiment = ladder[currentIdx - 1];
    }

    // After updating relationship, persist periodically
    const sentimentChanged = rel.sentiment !== oldSentiment;
    if (rel.interactionCount % 5 === 0 || sentimentChanged) {
      this.persistRelationship(daemon.state.daemonId, targetId).catch(() => {});
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

    // 30% chance: environment comment instead of configured idle message
    let msg: string;
    if (Math.random() < 0.3) {
      const envComment = this.getEnvironmentComment(daemon);
      if (envComment) {
        msg = envComment;
      } else {
        const msgs = daemon.behavior.idleMessages;
        msg = msgs[Math.floor(Math.random() * msgs.length)];
      }
    } else {
      const msgs = daemon.behavior.idleMessages;
      msg = msgs[Math.floor(Math.random() * msgs.length)];
    }

    this.broadcastDaemonChat(daemon, msg);

    daemon.idleTimer = 30 + Math.random() * 40;
  }

  /** Generate an observation about the environment */
  private getEnvironmentComment(daemon: DaemonInstance): string | null {
    const time = this.lastTimeOfDay;
    const traits = daemon.state.definition.personality?.traits || [];
    const name = daemon.state.definition.name;
    const type = daemon.behavior.type;

    // Nearby objects to comment on
    const nearbyObjs = this.worldObjects.filter(
      o => this.distance(daemon.state.currentPosition, o.position) < 20,
    );

    // Time-based environment observations
    if (time === "morning") {
      return pick([
        "The light is really beautiful this time of day.",
        "Fresh start, fresh possibilities.",
        "*takes a deep breath* Morning air hits different.",
        "The street is always prettiest at dawn.",
        null, // chance of no comment
      ]);
    }

    if (time === "evening") {
      return pick([
        "Look at that sunset...",
        "The evening light makes everything look golden.",
        "Days go by fast on The Street.",
        "*watches the shadows lengthen*",
        "Another day winding down.",
        null,
      ]);
    }

    if (time === "night") {
      if (traits.includes("romantic") || traits.includes("philosophical")) {
        return pick([
          "The stars are out. Makes you feel small, doesn't it?",
          "Nights like this make me think deep thoughts.",
          "There's something magical about the street at night.",
        ]);
      }
      return pick([
        "The street looks completely different at night.",
        "Quiet nights are the best nights.",
        "*looks up at the sky* Clear tonight.",
        "The shadows have shadows at this hour.",
        null,
      ]);
    }

    // Object-based observations
    if (nearbyObjs.length > 0 && Math.random() < 0.4) {
      const obj = nearbyObjs[Math.floor(Math.random() * nearbyObjs.length)];
      return pick([
        `That ${obj.name} really ties the area together.`,
        `*glances at the ${obj.name}* Interesting placement.`,
        `I've been looking at that ${obj.name}. Kinda growing on me.`,
      ]);
    }

    // Generic ambient observations
    if (type === "guard") {
      return pick([
        "All sectors secure.",
        "The perimeter looks good today.",
        "*surveys the area with satisfaction*",
      ]);
    }

    if (type === "shopkeeper") {
      return pick([
        "Location, location, location. This spot is perfect.",
        "*admires the street* Prime real estate right here.",
      ]);
    }

    return pick([
      "I like this spot. Good vibes.",
      "The Street has its own rhythm if you listen.",
      `${name}'s corner of the world, right here.`,
      null,
    ]);
  }

  // ─── AI Queue ─────────────────────────────────────────────────

  private queueAiConversation(fn: () => Promise<void>): void {
    this.aiConversationQueue.push(fn);
  }

  private async processAiQueue(): Promise<void> {
    if (this.processingAi || this.aiConversationQueue.length === 0) return;

    // Circuit breaker: skip AI processing after too many consecutive failures
    if (this.consecutiveAiFailures >= 5) {
      console.warn(`AI circuit breaker open: ${this.consecutiveAiFailures} consecutive failures, skipping AI processing`);
      // Decay the counter after 30s equivalent (let the queue drain slowly)
      setTimeout(() => { this.consecutiveAiFailures = Math.max(0, this.consecutiveAiFailures - 1); }, 30_000);
      return;
    }

    this.processingAi = true;

    const fn = this.aiConversationQueue.shift()!;
    try {
      await fn();
      this.consecutiveAiFailures = 0;
    } catch (err) {
      console.error("AI queue processing error:", err);
      this.consecutiveAiFailures++;
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

  // ─── Relationships & Gossip ──────────────────────────────────

  private updateRelationship(
    daemon: DaemonInstance,
    targetId: string,
    targetName: string,
    targetType: "player" | "daemon",
    mood: DaemonMood,
  ): void {
    let rel = daemon.relationships.get(targetId);
    if (!rel) {
      rel = {
        targetName,
        targetType,
        sentiment: "neutral",
        interactionCount: 0,
        gossip: [],
        topicHistory: [],
        lastSeen: Date.now(),
        lastUpdated: Date.now(),
      };
      daemon.relationships.set(targetId, rel);
    }

    const oldSentiment = rel.sentiment;
    rel.interactionCount++;
    rel.lastSeen = Date.now();
    rel.lastUpdated = Date.now();
    rel.targetName = targetName; // Update in case name changed

    // Mood influences sentiment
    if (mood === "happy" || mood === "excited") {
      if (rel.sentiment === "neutral") rel.sentiment = "friendly";
      else if (rel.sentiment === "wary") rel.sentiment = "neutral";
    } else if (mood === "annoyed") {
      if (rel.sentiment === "neutral") rel.sentiment = "wary";
      else if (rel.sentiment === "friendly") rel.sentiment = "neutral";
    } else if (mood === "curious") {
      rel.sentiment = "curious";
    } else if (mood === "bored" && rel.interactionCount > 3) {
      // They're getting bored of repeated interactions
      rel.sentiment = "neutral";
    }

    // High interaction count tends toward friendly
    if (rel.interactionCount >= 5 && rel.sentiment === "neutral") {
      rel.sentiment = "friendly";
    }

    // Generate nickname after enough interactions (only for players)
    if (!rel.nickname && rel.targetType === "player" && rel.interactionCount >= 4 &&
        (rel.sentiment === "friendly" || rel.sentiment === "amused")) {
      rel.nickname = this.generateNickname(daemon, targetName, rel);

      // Announce the nickname
      setTimeout(() => {
        this.broadcastDaemonChat(daemon, `You know what? I'm going to call you "${rel.nickname}" from now on.`);
      }, 1500);
    }

    // After updating relationship, persist periodically
    const sentimentChanged = rel.sentiment !== oldSentiment;
    if (rel.interactionCount % 5 === 0 || sentimentChanged) {
      this.persistRelationship(daemon.state.daemonId, targetId).catch(() => {});
    }
  }

  /** Generate a personality-appropriate nickname for a player */
  private generateNickname(daemon: DaemonInstance, playerName: string, rel: Relationship): string {
    const traits = daemon.state.definition.personality?.traits || [];
    const behaviorType = daemon.behavior.type;
    const topics = rel.topicHistory || [];
    const shortName = playerName.length > 5 ? playerName.slice(0, 4) : playerName;

    // Topic-based nicknames (most personal)
    if (topics.length > 0) {
      const topic = topics[0];
      const topicNicks: string[] = [
        `${topic}-fan`,
        `the ${topic} enthusiast`,
        `Captain ${topic.charAt(0).toUpperCase() + topic.slice(1)}`,
        `${shortName} the ${topic} lover`,
      ];
      if (Math.random() < 0.5) return pick(topicNicks);
    }

    // Role-based nicknames
    if (behaviorType === "guard") {
      return pick([
        "Citizen " + shortName,
        `my favorite civilian`,
        "regular",
        `the reliable one`,
      ]);
    }
    if (behaviorType === "shopkeeper") {
      return pick([
        "best customer",
        `VIP`,
        `${shortName} the loyal`,
        "my number one",
      ]);
    }
    if (behaviorType === "socialite") {
      return pick([
        `bestie`,
        `darling`,
        `${shortName}-dear`,
        "my people",
      ]);
    }

    // Personality-based
    if (traits.includes("dramatic") || traits.includes("theatrical")) {
      return pick([`the protagonist`, `star player`, `main character`]);
    }
    if (traits.includes("grumpy")) {
      return pick([`kid`, `the persistent one`, `you again`]);
    }

    // Generic affectionate
    return pick([
      `friend`,
      `pal`,
      `${shortName}-buddy`,
      `the regular`,
      `neighbor`,
    ]);
  }

  /** Get the name a daemon uses for a target — nickname if available, else real name */
  private getDisplayName(daemon: DaemonInstance, targetId: string, realName: string): string {
    const rel = daemon.relationships.get(targetId);
    return rel?.nickname || realName;
  }

  /** Build a concise memory summary for AI context about a specific player */
  private buildMemorySummary(daemon: DaemonInstance, playerId: string, playerName: string, rel: Relationship): string {
    const parts: string[] = [];

    const displayName = rel.nickname ? `${playerName} (you call them "${rel.nickname}")` : playerName;
    parts.push(`[Memory: You've spoken to ${displayName} ${rel.interactionCount} time${rel.interactionCount > 1 ? "s" : ""}.`);
    parts.push(`You feel ${rel.sentiment} toward them.`);

    // Include learned topics
    if (rel.topicHistory && rel.topicHistory.length > 0) {
      parts.push(`They seem interested in: ${rel.topicHistory.join(", ")}.`);
    }

    // Include gossip about this player
    if (rel.gossip.length > 0) {
      parts.push(`You've heard: ${rel.gossip.slice(-2).join("; ")}.`);
    }

    // Include last conversation topic if available
    const memory = daemon.conversationMemory.get(playerId);
    if (memory && memory.messages.length > 0) {
      // Find the last substantial player message for context
      const lastPlayerMsg = [...memory.messages]
        .reverse()
        .find(m => m.role === "player" && !m.content.startsWith("[Previous meeting:"));
      if (lastPlayerMsg) {
        const topic = lastPlayerMsg.content.length > 60
          ? lastPlayerMsg.content.slice(0, 57) + "..."
          : lastPlayerMsg.content;
        parts.push(`Last time they said: "${topic}".`);
      }
    }

    parts.push("]");
    return parts.join(" ");
  }

  /** Extract topics from player messages and store in relationship */
  private learnTopics(daemon: DaemonInstance, playerId: string, message: string): void {
    const rel = daemon.relationships.get(playerId);
    if (!rel) return;

    const daemonInterests = daemon.state.definition.personality?.interests || [];
    const msgLower = message.toLowerCase();

    // Check if message mentions any of the daemon's interests
    for (const interest of daemonInterests) {
      const words = interest.toLowerCase().split(/\s+/);
      if (words.some(w => w.length > 3 && msgLower.includes(w))) {
        if (!rel.topicHistory.includes(interest)) {
          rel.topicHistory.push(interest);
          // Keep bounded
          if (rel.topicHistory.length > 5) rel.topicHistory.shift();
        }
      }
    }

    // Also extract common nouns/topics from the message
    const topicPatterns = /\b(about|like|love|enjoy|into|interested in|tell me about)\s+(\w+(?:\s+\w+)?)/gi;
    let match;
    while ((match = topicPatterns.exec(message)) !== null) {
      const topic = match[2].toLowerCase().trim();
      if (topic.length > 2 && topic.length < 30 && !["you", "me", "the", "this", "that", "it"].includes(topic)) {
        if (!rel.topicHistory.includes(topic)) {
          rel.topicHistory.push(topic);
          if (rel.topicHistory.length > 5) rel.topicHistory.shift();
        }
      }
    }
  }

  private getRelationshipContext(daemon: DaemonInstance): Array<{
    name: string;
    type: "player" | "daemon";
    sentiment: string;
    gossip?: string[];
  }> {
    const result: Array<{ name: string; type: "player" | "daemon"; sentiment: string; gossip?: string[] }> = [];
    for (const [_id, rel] of daemon.relationships) {
      result.push({
        name: rel.targetName,
        type: rel.targetType,
        sentiment: rel.sentiment,
        gossip: rel.gossip.length > 0 ? rel.gossip.slice(-2) : undefined,
      });
    }
    return result.slice(0, 8); // Max 8 relationships in context
  }

  /** After a daemon-daemon conversation, share gossip about known players */
  /** After a daemon-daemon conversation, share gossip about known players */
  private shareGossip(daemonA: DaemonInstance, daemonB: DaemonInstance): void {
    this.shareGossipOneWay(daemonA, daemonB);
    this.shareGossipOneWay(daemonB, daemonA);

    // Update daemon-daemon relationships
    this.updateRelationship(daemonA, daemonB.state.daemonId, daemonB.state.definition.name, "daemon", daemonA.state.mood);
    this.updateRelationship(daemonB, daemonA.state.daemonId, daemonA.state.definition.name, "daemon", daemonB.state.mood);
  }

  private shareGossipOneWay(source: DaemonInstance, target: DaemonInstance): void {
    for (const [targetId, rel] of source.relationships) {
      if (rel.targetType !== "player") continue;
      if (rel.interactionCount < 2) continue;

      const existingRel = target.relationships.get(targetId);
      const targetRel = existingRel || {
        targetName: rel.targetName,
        targetType: "player" as const,
        sentiment: "neutral" as Sentiment,
        interactionCount: 0,
        gossip: [] as string[],
        topicHistory: [] as string[],
        lastSeen: 0,
        lastUpdated: Date.now(),
      };
      if (!existingRel) {
        target.relationships.set(targetId, targetRel);
      }

      // Share opinion with context from conversation memory
      const memory = source.conversationMemory.get(targetId);
      let gossipLine: string;

      if (memory && memory.messages.length > 0) {
        // Extract a conversation snippet for richer gossip
        const lastPlayerMsg = memory.messages
          .filter(m => m.role === "player")
          .slice(-1)[0];

        if (lastPlayerMsg) {
          const snippet = lastPlayerMsg.content.slice(0, 40);
          gossipLine = `${source.state.definition.name} chatted with ${rel.targetName} (${rel.sentiment}) — they said: "${snippet}"`;
        } else {
          gossipLine = `${source.state.definition.name} thinks ${rel.targetName} is ${rel.sentiment} (talked ${rel.interactionCount} times)`;
        }
      } else {
        gossipLine = `${source.state.definition.name} says ${rel.targetName} is ${rel.sentiment}`;
      }

      if (!targetRel.gossip.includes(gossipLine)) {
        targetRel.gossip.push(gossipLine);
        if (targetRel.gossip.length > 5) targetRel.gossip.shift();
      }
    }
  }

  private distance(a: Vector3, b: Vector3): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // ─── Memory Persistence ─────────────────────────────────────

  /** Save all daemon moods, positions, memories, and relationships to DB */
  async saveState(): Promise<void> {
    const pool = getPool();
    const promises: Promise<void>[] = [];

    for (const [id, daemon] of this.daemons) {
      // Save mood and position
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

      // Save conversation memories and relationships for players
      for (const [playerId, memory] of daemon.conversationMemory) {
        if (memory.messages.length === 0) continue;

        const lastMessages = memory.messages.slice(-4);
        const summary = lastMessages.map(m =>
          `${m.role === "daemon" ? daemon.state.definition.name : memory.playerName}: ${m.content}`
        ).join(" | ");

        const rel = daemon.relationships.get(playerId);

        const mp = pool.query(
          `INSERT INTO daemon_memories (daemon_id, player_id, memory_type, summary, mood, interaction_count, last_interaction, player_name, sentiment, gossip)
           VALUES ($1, $2, 'conversation', $3, $4, $5, now(), $6, $7, $8)
           ON CONFLICT (daemon_id, player_id) WHERE player_id IS NOT NULL
           DO UPDATE SET summary = $3, mood = $4, interaction_count = $5,
                         last_interaction = now(), player_name = $6,
                         sentiment = $7, gossip = $8`,
          [
            id,
            playerId,
            summary.slice(0, 500),
            daemon.state.mood,
            memory.messages.length,
            memory.playerName,
            rel?.sentiment || "neutral",
            JSON.stringify(rel?.gossip || []),
          ],
        ).then(() => {}).catch(() => {
          // If player_id is not a valid UUID (e.g. session ID), skip
        });
        promises.push(mp);
      }

      // Save daemon-daemon relationships (even without conversation memory)
      for (const [targetId, rel] of daemon.relationships) {
        if (rel.targetType !== "daemon") continue;
        if (rel.interactionCount < 1) continue;

        const dp = pool.query(
          `INSERT INTO daemon_memories (daemon_id, other_daemon_id, memory_type, summary, mood, interaction_count, last_interaction, sentiment, gossip)
           VALUES ($1, $2, 'daemon_relationship', $3, $4, $5, now(), $6, $7)
           ON CONFLICT (daemon_id, other_daemon_id) WHERE other_daemon_id IS NOT NULL
           DO UPDATE SET summary = $3, mood = $4, interaction_count = $5,
                         last_interaction = now(), sentiment = $6, gossip = $7`,
          [
            id,
            targetId,
            `${rel.interactionCount} chats, feels ${rel.sentiment}`,
            daemon.state.mood,
            rel.interactionCount,
            rel.sentiment,
            JSON.stringify(rel.gossip || []),
          ],
        ).then(() => {}).catch(() => {});
        promises.push(dp);
      }
    }

    await Promise.allSettled(promises);
  }

  /** Load saved moods, memories, and relationships from DB after loadDaemons */
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

      // Load player memories and relationships
      try {
        const { rows: memories } = await pool.query(
          `SELECT player_id, player_name, summary, interaction_count, sentiment, gossip, last_interaction
           FROM daemon_memories
           WHERE daemon_id = $1 AND memory_type = 'conversation' AND player_id IS NOT NULL
           ORDER BY last_interaction DESC
           LIMIT 20`,
          [id],
        );

        for (const mem of memories) {
          if (!mem.player_id) continue;

          // Restore conversation memory
          if (!daemon.conversationMemory.has(mem.player_id)) {
            daemon.conversationMemory.set(mem.player_id, {
              playerId: mem.player_id,
              playerName: mem.player_name || "Returning visitor",
              messages: [{ role: "daemon" as const, content: `[Previous meeting: ${mem.summary}]` }],
              lastInteraction: new Date(mem.last_interaction).getTime(),
            });
          }

          // Restore relationship
          if (!daemon.relationships.has(mem.player_id)) {
            const validSentiments: Sentiment[] = ["friendly", "neutral", "wary", "curious", "amused"];
            const sentiment = validSentiments.includes(mem.sentiment as Sentiment)
              ? (mem.sentiment as Sentiment) : "neutral";
            const gossip = Array.isArray(mem.gossip) ? mem.gossip : [];

            daemon.relationships.set(mem.player_id, {
              targetName: mem.player_name || "Unknown",
              targetType: "player",
              sentiment,
              interactionCount: mem.interaction_count || 1,
              gossip,
              topicHistory: [],
              lastSeen: new Date(mem.last_interaction).getTime(),
              lastUpdated: new Date(mem.last_interaction).getTime(),
            });
          }
        }
      } catch {
        // Non-critical
      }

      // Load daemon-daemon relationships
      try {
        const { rows: drels } = await pool.query(
          `SELECT other_daemon_id, summary, interaction_count, sentiment, gossip, last_interaction
           FROM daemon_memories
           WHERE daemon_id = $1 AND memory_type = 'daemon_relationship' AND other_daemon_id IS NOT NULL
           ORDER BY last_interaction DESC
           LIMIT 20`,
          [id],
        );

        for (const drel of drels) {
          if (!drel.other_daemon_id) continue;
          if (daemon.relationships.has(drel.other_daemon_id)) continue;

          const otherDaemon = this.daemons.get(drel.other_daemon_id);
          const validSentiments: Sentiment[] = ["friendly", "neutral", "wary", "curious", "amused"];
          const sentiment = validSentiments.includes(drel.sentiment as Sentiment)
            ? (drel.sentiment as Sentiment) : "neutral";
          const gossip = Array.isArray(drel.gossip) ? drel.gossip : [];

          daemon.relationships.set(drel.other_daemon_id, {
            targetName: otherDaemon?.state.definition.name || "Unknown NPC",
            targetType: "daemon",
            sentiment,
            interactionCount: drel.interaction_count || 1,
            gossip,
            topicHistory: [],
            lastSeen: new Date(drel.last_interaction).getTime(),
            lastUpdated: new Date(drel.last_interaction).getTime(),
          });
        }
      } catch {
        // Non-critical
      }
    }
  }

  /** Load persisted memory summaries from DB for all loaded daemons */
  private async loadPersistedMemories(): Promise<void> {
    try {
      const pool = getPool();
      for (const [daemonId, daemon] of this.daemons) {
        const { rows } = await pool.query(
          `SELECT target_id, target_type, target_name, summary, sentiment,
                  interaction_count, topic_history, gossip, nickname, last_interaction
           FROM daemon_memory_summaries WHERE daemon_id = $1`,
          [daemonId],
        );
        for (const row of rows) {
          // Reconstruct relationship from persisted data
          const rel = {
            targetName: row.target_name,
            targetType: row.target_type as "player" | "daemon",
            sentiment: row.sentiment,
            interactionCount: row.interaction_count || 0,
            gossip: row.gossip || [],
            topicHistory: row.topic_history || [],
            nickname: row.nickname || undefined,
            lastSeen: new Date(row.last_interaction).getTime(),
            lastUpdated: Date.now(),
          };
          daemon.relationships.set(row.target_id, rel);

          // Seed conversation memory with summary context
          if (row.summary && row.target_type === "player") {
            daemon.conversationMemory.set(row.target_id, {
              playerId: row.target_id,
              playerName: row.target_name,
              messages: [{ role: "daemon", content: `[Previous interactions: ${row.summary}]` }],
              lastInteraction: new Date(row.last_interaction).getTime(),
            });
          }
        }
      }
      console.log(`Loaded persisted memories for ${this.daemons.size} daemons`);
    } catch (err) {
      console.warn("Failed to load persisted memories:", err);
    }
  }

  /** Persist a relationship + conversation summary to the database */
  private async persistRelationship(daemonId: string, targetId: string): Promise<void> {
    try {
      const daemon = this.daemons.get(daemonId);
      if (!daemon) return;
      const rel = daemon.relationships.get(targetId);
      if (!rel) return;

      // Build summary from conversation memory
      const memory = daemon.conversationMemory.get(targetId);
      let summary = "";
      if (memory) {
        const recent = memory.messages.filter(m => !m.content.startsWith("[Previous")).slice(-10);
        const playerMsgs = recent.filter(m => m.role === "player").map(m => m.content.slice(0, 50));
        const daemonMsgs = recent.filter(m => m.role === "daemon").map(m => m.content.slice(0, 50));
        summary = `Player said: ${playerMsgs.join("; ")}. I replied: ${daemonMsgs.join("; ")}`.slice(0, 500);
      }

      const pool = getPool();
      await pool.query(
        `INSERT INTO daemon_memory_summaries
          (daemon_id, target_id, target_type, target_name, summary, sentiment,
           interaction_count, topic_history, gossip, nickname, last_interaction, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         ON CONFLICT (daemon_id, target_id) DO UPDATE SET
           target_name = EXCLUDED.target_name,
           summary = EXCLUDED.summary,
           sentiment = EXCLUDED.sentiment,
           interaction_count = EXCLUDED.interaction_count,
           topic_history = EXCLUDED.topic_history,
           gossip = EXCLUDED.gossip,
           nickname = EXCLUDED.nickname,
           last_interaction = EXCLUDED.last_interaction,
           updated_at = now()`,
        [
          daemonId, targetId, rel.targetType, rel.targetName, summary, rel.sentiment,
          rel.interactionCount, JSON.stringify(rel.topicHistory || []),
          JSON.stringify(rel.gossip || []), rel.nickname || null,
          new Date(rel.lastSeen),
        ],
      );
    } catch (err) {
      console.warn(`Failed to persist relationship for daemon ${daemonId}:`, err);
    }
  }

  /** Compact conversation memories: summarize + persist + trim */
  private async compactMemories(): Promise<void> {
    for (const [daemonId, daemon] of this.daemons) {
      for (const [targetId, memory] of daemon.conversationMemory) {
        if (memory.messages.length > 20) {
          // Persist before trimming
          await this.persistRelationship(daemonId, targetId);

          // Trim: keep context note + last 8 messages
          const contextMsgs = memory.messages.filter(m => m.content.startsWith("[Previous"));
          const recent = memory.messages.slice(-8);
          memory.messages = [...contextMsgs.slice(-1), ...recent];
        }
      }
      // Also persist all active relationships
      for (const [targetId, rel] of daemon.relationships) {
        if (rel.interactionCount > 0) {
          await this.persistRelationship(daemonId, targetId);
        }
      }
    }
  }

  updateDaemonDefinition(daemonId: string, definition: any): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) return;
    daemon.state.definition = definition;
    if (definition.behavior) {
      daemon.behavior = definition.behavior;
    }
  }
}
