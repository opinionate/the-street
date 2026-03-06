import type { Vector3 } from "@the-street/shared";
import { PriorityEventQueue } from "./PriorityEventQueue.js";
import { EventPriority, type WorldEvent } from "./WorldEventBus.js";

/**
 * Behavior tree states for a daemon.
 *
 * Idle -> Attention -> InConversation -> PostInteraction -> Idle
 *
 * Idle: ambient patrol, emotes, governed by crowdAffinity/territoriality
 * Attention: visitor/daemon entered proximity, evaluate handoff to inference
 * InConversation: active session with one participant, scripted busy for others
 * PostInteraction: 5s cooldown, summarization/relationship hooks
 */
export type BehaviorState = "idle" | "attention" | "in_conversation" | "post_interaction";

export interface ConversationContext {
  participantId: string;
  participantName: string;
  participantType: "visitor" | "daemon";
  turnCount: number;
  startedAt: number;
}

export interface BehaviorCallbacks {
  /** Start idle ambient behavior (patrol, emotes) */
  onEnterIdle: (daemonId: string) => void;
  /** Daemon noticed someone — evaluate for conversation handoff */
  onEnterAttention: (daemonId: string, event: WorldEvent) => void;
  /** Hand off to inference controller for conversation */
  onStartConversation: (daemonId: string, participantId: string, participantName: string, participantType: "visitor" | "daemon", speech?: string) => void;
  /** Non-participant spoke during active conversation — scripted busy response */
  onBusyResponse: (daemonId: string, speakerId: string, speakerName: string) => void;
  /** Fire post-interaction hooks (summarization, relationship update) */
  onPostInteraction: (daemonId: string, context: ConversationContext) => void;
  /** Check if a visitor is known (has prior interactions) */
  isKnownVisitor: (daemonId: string, visitorId: string) => boolean;
  /** Get distance between two positions */
  getDistance: (a: Vector3, b: Vector3) => number;
  /** Get daemon position */
  getDaemonPosition: (daemonId: string) => Vector3 | null;
  /** Get daemon interaction radius */
  getDaemonRadius: (daemonId: string) => number;
}

const POST_INTERACTION_COOLDOWN_MS = 5000;
const ATTENTION_TIMEOUT_MS = 3000; // How long to stay in attention before deciding

/**
 * Per-daemon behavior tree implementing the event-driven state machine.
 */
export class DaemonBehaviorTree {
  readonly daemonId: string;
  private _state: BehaviorState = "idle";
  private eventQueue = new PriorityEventQueue();
  private conversation: ConversationContext | null = null;
  private postInteractionTimer = 0;
  private attentionTimer = 0;
  private attentionEvent: WorldEvent | null = null;
  private callbacks: BehaviorCallbacks;

  constructor(daemonId: string, callbacks: BehaviorCallbacks) {
    this.daemonId = daemonId;
    this.callbacks = callbacks;
  }

  get state(): BehaviorState {
    return this._state;
  }

  get currentConversation(): ConversationContext | null {
    return this.conversation;
  }

  get queueDepth(): number {
    return this.eventQueue.length;
  }

  /** Handle an incoming world event. */
  handleEvent(event: WorldEvent): void {
    switch (this._state) {
      case "idle":
        this.handleEventIdle(event);
        break;
      case "attention":
        this.handleEventAttention(event);
        break;
      case "in_conversation":
        this.handleEventInConversation(event);
        break;
      case "post_interaction":
        this.handleEventPostInteraction(event);
        break;
    }
  }

  /** Low-frequency tick for time-based transitions (called every 10s for idle, more often for active states). */
  tick(dtMs: number): void {
    switch (this._state) {
      case "attention":
        this.attentionTimer -= dtMs;
        if (this.attentionTimer <= 0) {
          // Attention timed out without escalation — return to idle
          this.transitionTo("idle");
        }
        break;

      case "post_interaction":
        this.postInteractionTimer -= dtMs;
        if (this.postInteractionTimer <= 0) {
          // Cooldown complete — drain any queued events, then go idle
          this.drainPostInteractionQueue();
          this.transitionTo("idle");
        }
        break;

      // idle and in_conversation don't need time-based transitions here
    }
  }

  /** Transition to a new state. */
  private transitionTo(newState: BehaviorState): void {
    this._state = newState;

    switch (newState) {
      case "idle":
        this.conversation = null;
        this.attentionEvent = null;
        this.callbacks.onEnterIdle(this.daemonId);
        break;

      case "attention":
        this.attentionTimer = ATTENTION_TIMEOUT_MS;
        break;

      case "in_conversation":
        // conversation context set by caller before transition
        break;

      case "post_interaction":
        this.postInteractionTimer = POST_INTERACTION_COOLDOWN_MS;
        if (this.conversation) {
          this.callbacks.onPostInteraction(this.daemonId, this.conversation);
        }
        break;
    }
  }

  // ─── State-specific event handlers ──────────────────────────

  private handleEventIdle(event: WorldEvent): void {
    if (event.type === "ambient_tick" || event.type === "crowd_change" || event.type === "time_change") {
      // Ambient events stay in idle — no state transition
      return;
    }

    if (event.type === "visitor_speech" || event.type === "daemon_speech") {
      // Direct speech — go straight to attention → conversation handoff
      this.attentionEvent = event;
      this.transitionTo("attention");
      this.callbacks.onEnterAttention(this.daemonId, event);
      // Immediately escalate speech to conversation
      this.escalateToConversation(event);
      return;
    }

    if (event.type === "visitor_proximity" || event.type === "daemon_proximity") {
      // Someone entered proximity — enter attention state
      this.attentionEvent = event;
      this.transitionTo("attention");
      this.callbacks.onEnterAttention(this.daemonId, event);
      return;
    }

    if (event.type === "visitor_departure") {
      // Handle farewell inline without state transition
      return;
    }
  }

  private handleEventAttention(event: WorldEvent): void {
    if (event.type === "visitor_speech" || event.type === "daemon_speech") {
      // Speech during attention — escalate to conversation
      this.escalateToConversation(event);
      return;
    }

    // Queue other events while in attention
    this.eventQueue.enqueue(event);
  }

  private handleEventInConversation(event: WorldEvent): void {
    if (!this.conversation) return;

    if (event.type === "visitor_speech" || event.type === "daemon_speech") {
      if (event.sourceId === this.conversation.participantId) {
        // Active participant speech — highest priority, route to inference
        this.conversation.turnCount++;
        this.callbacks.onStartConversation(
          this.daemonId,
          event.sourceId,
          event.sourceName || "Unknown",
          this.conversation.participantType,
          event.speech,
        );
        return;
      }

      // Non-participant speech — handle inline with scripted busy response
      this.callbacks.onBusyResponse(this.daemonId, event.sourceId, event.sourceName || "someone");
      return;
    }

    if (event.type === "visitor_departure" && event.sourceId === this.conversation.participantId) {
      // Active participant left — end conversation
      this.endConversation();
      return;
    }

    // Queue non-speech events (up to depth cap)
    this.eventQueue.enqueue(event);
  }

  private handleEventPostInteraction(event: WorldEvent): void {
    // Queue events during cooldown (depth cap enforced by PriorityEventQueue)
    this.eventQueue.enqueue(event);
  }

  // ─── Conversation management ──────────────────────────

  /** Escalate from attention to active conversation. */
  private escalateToConversation(event: WorldEvent): void {
    const participantType: "visitor" | "daemon" =
      event.type === "daemon_speech" || event.type === "daemon_proximity" ? "daemon" : "visitor";

    this.conversation = {
      participantId: event.sourceId,
      participantName: event.sourceName || "Unknown",
      participantType,
      turnCount: 1,
      startedAt: Date.now(),
    };

    this.transitionTo("in_conversation");
    this.callbacks.onStartConversation(
      this.daemonId,
      event.sourceId,
      event.sourceName || "Unknown",
      participantType,
      event.speech,
    );
  }

  /** End the current conversation and transition to post-interaction. */
  endConversation(): void {
    if (this._state !== "in_conversation") return;
    this.transitionTo("post_interaction");
  }

  /** Force return to idle (e.g., daemon recalled). */
  forceIdle(): void {
    this.eventQueue.clear();
    this.conversation = null;
    this.attentionEvent = null;
    this.transitionTo("idle");
  }

  /** Classify an event's priority based on context. */
  classifyPriority(event: WorldEvent): EventPriority {
    if (this.conversation && event.sourceId === this.conversation.participantId) {
      return EventPriority.ActiveParticipantSpeech;
    }

    if (event.type === "visitor_speech" || event.type === "daemon_speech") {
      return EventPriority.NewSpeech;
    }

    if (event.type === "visitor_proximity") {
      const isKnown = this.callbacks.isKnownVisitor(this.daemonId, event.sourceId);
      return isKnown ? EventPriority.KnownVisitorReturning : EventPriority.UnknownVisitor;
    }

    return EventPriority.Ambient;
  }

  // ─── Queue drain ──────────────────────────

  /** Process queued events after post-interaction cooldown. */
  private drainPostInteractionQueue(): void {
    // Process up to 3 queued events to avoid spam
    let processed = 0;
    while (this.eventQueue.hasEvents && processed < 3) {
      const event = this.eventQueue.dequeue();
      if (!event) break;

      // Re-evaluate events in idle context
      if (event.type === "visitor_speech" || event.type === "daemon_speech" ||
          event.type === "visitor_proximity" || event.type === "daemon_proximity") {
        // These are stale — the visitor may have left. Don't auto-escalate.
        // The idle state will pick up fresh events from the bus.
      }
      processed++;
    }
    this.eventQueue.clear();
  }
}
