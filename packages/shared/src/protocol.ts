import type {
  Vector3,
  PlayerState,
  PlotSnapshot,
  WorldObject,
  InteractionType,
} from "./types.js";

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
    };

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
      players: PlayerState[];
      plots: PlotSnapshot[];
    };

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
} as const;

// Rate limits
export const RATE_LIMITS = {
  aiGeneration: { maxPerMinute: 10 },
  chat: { maxPerSecond: 1 },
  objectPlacement: { maxPerMinute: 5 },
  assetUpload: { maxPerMinute: 3 },
} as const;
