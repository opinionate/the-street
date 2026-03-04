import { Client, Room } from "colyseus.js";
import type {
  PlayerState,
  Vector3,
  PlotSnapshot,
  WorldObject,
  AvatarDefinition,
  DaemonState,
  DaemonMood,
} from "@the-street/shared";

export interface NetworkCallbacks {
  onWorldSnapshot: (players: PlayerState[], plots: PlotSnapshot[], daemons?: DaemonState[]) => void;
  onPlayerJoin: (player: PlayerState) => void;
  onPlayerLeave: (userId: string) => void;
  onPlayerMove: (userId: string, position: Vector3, rotation: number) => void;
  onChat: (
    senderId: string,
    senderName: string,
    content: string,
    position: Vector3
  ) => void;
  onObjectPlaced: (
    objectId: string,
    plotUUID: string,
    objectDefinition: WorldObject
  ) => void;
  onObjectRemoved: (objectId: string) => void;
  onObjectStateChange: (
    objectId: string,
    stateData: Record<string, unknown>
  ) => void;
  onPlayerAvatarUpdate?: (userId: string, avatarDefinition: AvatarDefinition) => void;
  onDaemonSpawn?: (daemon: DaemonState) => void;
  onDaemonDespawn?: (daemonId: string) => void;
  onDaemonMove?: (daemonId: string, position: Vector3, rotation: number, action: string) => void;
  onDaemonChat?: (daemonId: string, daemonName: string, content: string, targetUserId?: string, targetDaemonId?: string) => void;
  onDaemonEmote?: (daemonId: string, emote: string, mood: DaemonMood) => void;
}

export class NetworkManager {
  private client: Client;
  private room: Room | null = null;
  private callbacks: NetworkCallbacks;

  constructor(serverUrl: string, callbacks: NetworkCallbacks) {
    this.client = new Client(serverUrl);
    this.callbacks = callbacks;
  }

  async connect(token?: string): Promise<void> {
    try {
      this.room = await this.client.joinOrCreate("street", { token });
      this.setupMessageHandlers();
      console.log("Connected to street room:", this.room.sessionId);
    } catch (err) {
      console.error("Failed to connect:", err);
      throw err;
    }
  }

  private setupMessageHandlers(): void {
    if (!this.room) return;

    this.room.onMessage("world_snapshot", (data) => {
      this.callbacks.onWorldSnapshot(data.players, data.plots, data.daemons);
    });

    this.room.onMessage("player_join", (data) => {
      this.callbacks.onPlayerJoin(data.player);
    });

    this.room.onMessage("player_leave", (data) => {
      this.callbacks.onPlayerLeave(data.userId);
    });

    this.room.onMessage("player_move", (data) => {
      this.callbacks.onPlayerMove(data.userId, data.position, data.rotation);
    });

    this.room.onMessage("chat", (data) => {
      this.callbacks.onChat(
        data.senderId,
        data.senderName,
        data.content,
        data.position
      );
    });

    this.room.onMessage("object_placed", (data) => {
      this.callbacks.onObjectPlaced(
        data.objectId,
        data.plotUUID,
        data.objectDefinition
      );
    });

    this.room.onMessage("object_removed", (data) => {
      this.callbacks.onObjectRemoved(data.objectId);
    });

    this.room.onMessage("object_state_change", (data) => {
      this.callbacks.onObjectStateChange(data.objectId, data.stateData);
    });

    this.room.onMessage("player_avatar_update", (data) => {
      this.callbacks.onPlayerAvatarUpdate?.(data.userId, data.avatarDefinition);
    });

    this.room.onMessage("daemon_spawn", (data) => {
      this.callbacks.onDaemonSpawn?.(data.daemon);
    });

    this.room.onMessage("daemon_despawn", (data) => {
      this.callbacks.onDaemonDespawn?.(data.daemonId);
    });

    this.room.onMessage("daemon_move", (data) => {
      this.callbacks.onDaemonMove?.(data.daemonId, data.position, data.rotation, data.action);
    });

    this.room.onMessage("daemon_chat", (data) => {
      this.callbacks.onDaemonChat?.(data.daemonId, data.daemonName, data.content, data.targetUserId, data.targetDaemonId);
    });

    this.room.onMessage("daemon_emote", (data) => {
      this.callbacks.onDaemonEmote?.(data.daemonId, data.emote, data.mood);
    });

    this.room.onError((code, message) => {
      console.error("Room error:", code, message);
    });

    this.room.onLeave((code) => {
      console.log("Left room:", code);
    });
  }

  sendMove(position: Vector3, rotation: number): void {
    this.room?.send("move", { position, rotation });
  }

  sendChat(content: string): void {
    this.room?.send("chat", { content });
  }

  sendInteract(objectId: string, interaction: string): void {
    this.room?.send("interact", { objectId, interaction });
  }

  sendObjectPlace(plotUUID: string, objectDefinition: WorldObject): void {
    this.room?.send("object_place", { plotUUID, objectDefinition });
  }

  sendObjectRemove(objectId: string): void {
    this.room?.send("object_remove", { objectId });
  }

  sendDaemonInteract(daemonId: string, message?: string): void {
    this.room?.send("daemon_interact", { daemonId, message });
  }

  sendDaemonRecall(daemonId: string): void {
    this.room?.send("daemon_recall", { daemonId });
  }

  sendDaemonToggleRoam(daemonId: string, enabled: boolean): void {
    this.room?.send("daemon_toggle_roam", { daemonId, enabled });
  }

  getSessionId(): string | null {
    return this.room?.sessionId ?? null;
  }

  disconnect(): void {
    this.room?.leave();
  }
}
