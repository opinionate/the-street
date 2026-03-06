import type {
  Vector3,
  PlayerState,
  PlotSnapshot,
  WorldObject,
  InteractionType,
  AvatarDefinition,
  DaemonState,
  DaemonMood,
  UserRole,
} from "./types.js";

// Valid emote IDs shared between client and server
export const VALID_EMOTE_IDS = ["dance", "shrug", "nod", "cry", "wave", "bow", "cheer", "laugh"] as const;
export type EmoteId = typeof VALID_EMOTE_IDS[number];

// Client -> Server messages
export type ClientMessage =
  | { type: "move"; position: Vector3; rotation: number }
  | { type: "interact"; objectId: string; interaction: InteractionType }
  | { type: "chat"; content: string }
  | {
      type: "object_place";
      plotUUID: string;
      objectDefinition: WorldObject;
    }
  | { type: "object_remove"; objectId: string }
  | {
      type: "object_update_state";
      objectId: string;
      stateKey: string;
      stateValue: unknown;
    }
  | { type: "daemon_interact"; daemonId: string; message?: string }
  | { type: "daemon_recall"; daemonId: string }
  | { type: "daemon_toggle_roam"; daemonId: string; enabled: boolean }
  | { type: "emote"; emoteId: EmoteId }
  | { type: "avatar_update"; avatarDefinition: AvatarDefinition };

// Server -> Client messages
export type ServerMessage =
  | { type: "player_join"; player: PlayerState }
  | { type: "player_leave"; userId: string }
  | {
      type: "player_move";
      userId: string;
      position: Vector3;
      rotation: number;
    }
  | {
      type: "object_state_change";
      objectId: string;
      stateData: Record<string, unknown>;
    }
  | {
      type: "object_placed";
      objectId: string;
      plotUUID: string;
      objectDefinition: WorldObject;
    }
  | { type: "object_removed"; objectId: string }
  | {
      type: "chat";
      senderId: string;
      senderName: string;
      content: string;
      position: Vector3;
    }
  | {
      type: "world_snapshot";
      yourUserId: string;
      yourRole: UserRole;
      players: PlayerState[];
      plots: PlotSnapshot[];
      daemons?: DaemonState[];
    }
  | { type: "player_avatar_update"; userId: string; avatarDefinition: AvatarDefinition }
  | { type: "daemon_spawn"; daemon: DaemonState }
  | { type: "daemon_despawn"; daemonId: string }
  | { type: "daemon_move"; daemonId: string; position: Vector3; rotation: number; action: string }
  | { type: "daemon_chat"; daemonId: string; daemonName: string; content: string; targetUserId?: string; targetDaemonId?: string }
  | { type: "daemon_emote"; daemonId: string; emote: string; mood: DaemonMood }
  | { type: "daemon_animated_emote"; daemonId: string; emoteId: string }
  | { type: "daemon_thought"; daemonId: string; thought: string }
  | { type: "player_emote"; userId: string; emoteId: EmoteId };

// Message type constants for Colyseus
export const MSG = {
  MOVE: "move",
  INTERACT: "interact",
  CHAT: "chat",
  OBJECT_PLACE: "object_place",
  OBJECT_REMOVE: "object_remove",
  OBJECT_UPDATE_STATE: "object_update_state",
  PLAYER_JOIN: "player_join",
  PLAYER_LEAVE: "player_leave",
  PLAYER_MOVE: "player_move",
  OBJECT_STATE_CHANGE: "object_state_change",
  OBJECT_PLACED: "object_placed",
  OBJECT_REMOVED: "object_removed",
  WORLD_SNAPSHOT: "world_snapshot",
  PLAYER_AVATAR_UPDATE: "player_avatar_update",
  DAEMON_INTERACT: "daemon_interact",
  DAEMON_RECALL: "daemon_recall",
  DAEMON_TOGGLE_ROAM: "daemon_toggle_roam",
  DAEMON_SPAWN: "daemon_spawn",
  DAEMON_DESPAWN: "daemon_despawn",
  DAEMON_MOVE: "daemon_move",
  DAEMON_CHAT: "daemon_chat",
  DAEMON_EMOTE: "daemon_emote",
  DAEMON_ANIMATED_EMOTE: "daemon_animated_emote",
  DAEMON_THOUGHT: "daemon_thought",
  EMOTE: "emote",
  PLAYER_EMOTE: "player_emote",
  AVATAR_UPDATE: "avatar_update",
} as const;

// Rate limits
export const RATE_LIMITS = {
  aiGeneration: { maxPerMinute: 10 },
  chat: { maxPerSecond: 1 },
  objectPlacement: { maxPerMinute: 5 },
  assetUpload: { maxPerMinute: 3 },
} as const;
