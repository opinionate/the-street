import type { Vector3 } from "@the-street/shared";

/**
 * Event priority levels for daemon behavior tree processing.
 * Lower number = higher priority.
 */
export enum EventPriority {
  ActiveParticipantSpeech = 1,
  NewSpeech = 2,
  KnownVisitorReturning = 3,
  UnknownVisitor = 4,
  Ambient = 5,
}

export type WorldEventType =
  | "visitor_speech"
  | "visitor_proximity"
  | "visitor_departure"
  | "daemon_proximity"
  | "daemon_speech"
  | "object_placed"
  | "object_removed"
  | "player_sprint"
  | "ambient_tick"
  | "crowd_change"
  | "time_change";

export interface WorldEvent {
  type: WorldEventType;
  priority: EventPriority;
  sourceId: string;
  sourceName?: string;
  targetDaemonId?: string; // If set, only this daemon receives the event
  position?: Vector3;
  speech?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

type EventHandler = (event: WorldEvent) => void;

/**
 * Central event bus for the daemon world.
 * All world events flow through here; daemons subscribe to receive them.
 */
export class WorldEventBus {
  private handlers = new Map<string, Set<EventHandler>>(); // daemonId -> handlers
  private globalHandlers = new Set<EventHandler>();

  /** Subscribe a daemon to receive events */
  subscribe(daemonId: string, handler: EventHandler): void {
    let set = this.handlers.get(daemonId);
    if (!set) {
      set = new Set();
      this.handlers.set(daemonId, set);
    }
    set.add(handler);
  }

  /** Unsubscribe a daemon from events */
  unsubscribe(daemonId: string): void {
    this.handlers.delete(daemonId);
  }

  /** Subscribe to all events (for global systems like crowd awareness) */
  subscribeGlobal(handler: EventHandler): void {
    this.globalHandlers.add(handler);
  }

  /** Emit an event. If targetDaemonId is set, only that daemon receives it. */
  emit(event: WorldEvent): void {
    if (event.targetDaemonId) {
      const handlers = this.handlers.get(event.targetDaemonId);
      if (handlers) {
        for (const h of handlers) h(event);
      }
    } else {
      // Broadcast to all daemon handlers
      for (const [, handlers] of this.handlers) {
        for (const h of handlers) h(event);
      }
    }

    // Global handlers always receive
    for (const h of this.globalHandlers) h(event);
  }
}
