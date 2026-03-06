import type {
  ConversationSession,
  ConversationTurn,
  LogEntry,
  Actor,
  BehaviorEventPayload,
  PersonalityManifest,
  DaemonEvent,
  WorldStateContext,
  VisitorImpression,
  DaemonRelationship,
} from "@the-street/shared";
import { runInference, type InferenceResult } from "./InferenceController.js";
import { getPool } from "../database/pool.js";

const VISITOR_TIMEOUT_MS = 60_000;
const DAEMON_TIMEOUT_MS = 30_000;
const SUMMARIZATION_TURN_THRESHOLD = 4;
const MAX_QUEUED_EVENTS = 5;

export interface SessionCallbacks {
  /** Broadcast daemon speech to clients */
  onDaemonSpeech: (daemonId: string, thought: InferenceResult["thought"], session: ConversationSession) => void;
  /** Broadcast busy response to non-participant */
  onBusyResponse: (daemonId: string, speakerId: string, speakerName: string) => void;
  /** End session in behavior tree */
  onSessionEnd: (daemonId: string, sessionId: string, reason: string) => void;
  /** Fire summarization */
  onSummarize: (daemonId: string, session: ConversationSession, turns: ConversationTurn[]) => void;
  /** Get manifest for a daemon */
  getManifest: (daemonId: string) => PersonalityManifest | null;
  /** Get world state context */
  getWorldState: (daemonId: string) => WorldStateContext;
  /** Get visitor impression if available */
  getVisitorImpression: (daemonId: string, visitorId: string) => VisitorImpression | undefined;
  /** Get daemon relationship if available */
  getDaemonRelationship: (daemonId: string, targetDaemonId: string) => DaemonRelationship | undefined;
}

interface ActiveSession {
  session: ConversationSession;
  turns: ConversationTurn[];
  lastMessageAt: number;
  pendingInference: boolean;
  queuedEvents: DaemonEvent[];
}

/**
 * Manages ConversationSession lifecycle for daemons.
 *
 * Handles session creation, turn tracking, timeout monitoring,
 * DB persistence, busy responses, and summarization triggers.
 */
export class ConversationSessionManager {
  private activeSessions = new Map<string, ActiveSession>(); // daemonId -> session
  private callbacks: SessionCallbacks;

  constructor(callbacks: SessionCallbacks) {
    this.callbacks = callbacks;
  }

  /** Check if a daemon has an active session */
  hasActiveSession(daemonId: string): boolean {
    return this.activeSessions.has(daemonId);
  }

  /** Get the active session for a daemon */
  getActiveSession(daemonId: string): ConversationSession | null {
    return this.activeSessions.get(daemonId)?.session ?? null;
  }

  /** Get conversation turns for the active session */
  getActiveTurns(daemonId: string): ConversationTurn[] {
    return this.activeSessions.get(daemonId)?.turns ?? [];
  }

  /**
   * Start a new conversation session.
   * Called when behavior tree transitions to in_conversation.
   */
  async startSession(
    daemonId: string,
    participantId: string,
    participantName: string,
    participantType: "visitor" | "daemon",
  ): Promise<ConversationSession> {
    // End any existing session first
    if (this.activeSessions.has(daemonId)) {
      await this.endSession(daemonId, "ended_natural");
    }

    const session: ConversationSession = {
      sessionId: crypto.randomUUID(),
      daemonId,
      participantId,
      participantType,
      startedAt: Date.now(),
      turnCount: 0,
      status: "active",
    };

    this.activeSessions.set(daemonId, {
      session,
      turns: [],
      lastMessageAt: Date.now(),
      pendingInference: false,
      queuedEvents: [],
    });

    // Persist to DB
    await this.persistSessionCreate(session);

    console.log(`[SessionManager] Started session ${session.sessionId} for daemon=${daemonId} participant=${participantId}`);
    return session;
  }

  /**
   * Handle a speech event for an active session.
   * Routes to inference controller and processes the result.
   */
  async handleSpeech(
    daemonId: string,
    event: DaemonEvent,
  ): Promise<void> {
    const active = this.activeSessions.get(daemonId);
    if (!active) {
      console.warn(`[SessionManager] handleSpeech called but no active session for daemon=${daemonId}`);
      return;
    }

    const manifest = this.callbacks.getManifest(daemonId);
    if (!manifest) {
      console.warn(`[SessionManager] No manifest found for daemon=${daemonId}`);
      return;
    }

    if (active.pendingInference) {
      // Queue event if inference is already running
      this.queueEvent(daemonId, event);
      return;
    }

    active.pendingInference = true;
    active.lastMessageAt = Date.now();

    // Record the incoming speech as a turn
    const speakerActor: Actor = {
      actorType: event.eventType.startsWith("daemon") ? "daemon" : "visitor",
      actorId: event.sourceId,
      actorName: event.sourceName,
    };

    active.turns.push({
      speaker: speakerActor,
      speech: event.speech || "",
      timestamp: Date.now(),
    });

    try {
      const worldState = this.callbacks.getWorldState(daemonId);
      const visitorImpression = active.session.participantType === "visitor"
        ? this.callbacks.getVisitorImpression(daemonId, active.session.participantId)
        : undefined;
      const daemonRelationship = active.session.participantType === "daemon"
        ? this.callbacks.getDaemonRelationship(daemonId, active.session.participantId)
        : undefined;

      const result = await runInference({
        manifest,
        event,
        session: active.session,
        conversationHistory: active.turns,
        worldState,
        visitorImpression,
        daemonRelationship,
      });

      // Apply session update from inference
      if (result.sessionUpdate) {
        if (result.sessionUpdate.turnCount !== undefined) {
          active.session.turnCount = result.sessionUpdate.turnCount;
        }
        if (result.sessionUpdate.status) {
          active.session.status = result.sessionUpdate.status;
        }
        if (result.sessionUpdate.endedAt) {
          active.session.endedAt = result.sessionUpdate.endedAt;
        }
      }

      // Record daemon response as a turn
      if (result.thought.speech) {
        active.turns.push({
          speaker: {
            actorType: "daemon",
            actorId: daemonId,
            actorName: manifest.identity.name,
          },
          speech: result.thought.speech,
          emote: result.thought.emote,
          movement: result.thought.movement,
          timestamp: Date.now(),
        });
      }

      active.lastMessageAt = Date.now();

      // Persist log entry
      await this.persistLogEntry(result.logEntry);

      // Notify about daemon speech
      this.callbacks.onDaemonSpeech(daemonId, result.thought, active.session);

      // Check if session should end
      const shouldEnd = result.thought.endConversation
        || result.thought.suppressSpeech
        || (active.session.status !== "active");

      if (shouldEnd && !this.hasPendingInput(daemonId)) {
        const endStatus = active.session.status !== "active"
          ? active.session.status
          : "ended_natural";
        await this.endSession(daemonId, endStatus);
        return;
      }

      // Update DB with current session state
      await this.persistSessionUpdate(active.session);

    } catch (err) {
      console.error(`[SessionManager] Inference failed for daemon=${daemonId}:`, err);
    } finally {
      active.pendingInference = false;
    }

    // Process any queued events
    this.drainQueuedEvents(daemonId);
  }

  /**
   * Handle a non-participant trying to speak during an active session.
   * Logs as behavior_event and sends scripted busy response.
   */
  async handleBusyInterrupt(
    daemonId: string,
    speakerId: string,
    speakerName: string,
  ): Promise<void> {
    const active = this.activeSessions.get(daemonId);
    if (!active) return;

    // Log as behavior_event
    const logEntry: LogEntry = {
      entryId: crypto.randomUUID(),
      daemonId,
      type: "behavior_event",
      timestamp: Date.now(),
      actors: [
        { actorType: "daemon", actorId: daemonId },
        { actorType: "visitor", actorId: speakerId, actorName: speakerName },
      ],
      payload: {
        eventType: "busy_response",
        details: {
          activeParticipant: active.session.participantId,
          interruptingVisitor: speakerId,
          interruptingVisitorName: speakerName,
        },
      } as BehaviorEventPayload,
    };

    await this.persistLogEntry(logEntry);
    this.callbacks.onBusyResponse(daemonId, speakerId, speakerName);
  }

  /**
   * Handle participant departure — end session with departed status.
   */
  async handleDeparture(daemonId: string, participantId: string): Promise<void> {
    const active = this.activeSessions.get(daemonId);
    if (!active || active.session.participantId !== participantId) return;

    await this.endSession(daemonId, "ended_departed");
  }

  /**
   * Tick for timeout-based session endings.
   * Should be called periodically (e.g. every 1-5 seconds).
   */
  async tick(): Promise<void> {
    const now = Date.now();

    for (const [daemonId, active] of this.activeSessions) {
      if (active.pendingInference) continue;

      const timeout = active.session.participantType === "visitor"
        ? VISITOR_TIMEOUT_MS
        : DAEMON_TIMEOUT_MS;

      if (now - active.lastMessageAt > timeout) {
        console.log(`[SessionManager] Session timeout for daemon=${daemonId} (${active.session.participantType} timeout: ${timeout}ms)`);
        await this.endSession(daemonId, "ended_timeout");
      }
    }
  }

  /**
   * End a session with the given status.
   * Persists to DB, fires summarization if threshold met, and notifies behavior tree.
   */
  async endSession(
    daemonId: string,
    status: ConversationSession["status"],
  ): Promise<void> {
    const active = this.activeSessions.get(daemonId);
    if (!active) return;

    active.session.status = status;
    active.session.endedAt = Date.now();

    // Persist final session state
    await this.persistSessionUpdate(active.session);

    console.log(`[SessionManager] Ended session ${active.session.sessionId} daemon=${daemonId} status=${status} turns=${active.session.turnCount}`);

    // Fire summarization if turn threshold met
    if (active.session.turnCount >= SUMMARIZATION_TURN_THRESHOLD) {
      try {
        this.callbacks.onSummarize(daemonId, active.session, [...active.turns]);
      } catch (err) {
        console.error(`[SessionManager] Summarization callback failed for daemon=${daemonId}:`, err);
      }
    }

    // Clean up
    this.activeSessions.delete(daemonId);

    // Notify behavior tree
    this.callbacks.onSessionEnd(daemonId, active.session.sessionId, status);
  }

  /**
   * Force-end all sessions (e.g. on daemon recall or server shutdown).
   */
  async endAllSessions(): Promise<void> {
    const daemonIds = [...this.activeSessions.keys()];
    for (const daemonId of daemonIds) {
      await this.endSession(daemonId, "ended_natural");
    }
  }

  // --- Event queuing during PostInteraction ---

  private queueEvent(daemonId: string, event: DaemonEvent): void {
    const active = this.activeSessions.get(daemonId);
    if (!active) return;

    if (active.queuedEvents.length >= MAX_QUEUED_EVENTS) {
      console.log(`[SessionManager] Event queue full for daemon=${daemonId}, discarding event type=${event.eventType}`);
      return;
    }

    active.queuedEvents.push(event);
  }

  private drainQueuedEvents(daemonId: string): void {
    const active = this.activeSessions.get(daemonId);
    if (!active || active.pendingInference) return;

    const next = active.queuedEvents.shift();
    if (next && next.speech) {
      // Process next queued speech event
      this.handleSpeech(daemonId, next).catch(err => {
        console.error(`[SessionManager] Failed to process queued event for daemon=${daemonId}:`, err);
      });
    }
  }

  private hasPendingInput(daemonId: string): boolean {
    const active = this.activeSessions.get(daemonId);
    if (!active) return false;
    return active.queuedEvents.some(e => !!e.speech);
  }

  // --- DB persistence ---

  private async persistSessionCreate(session: ConversationSession): Promise<void> {
    try {
      const pool = getPool();
      await pool.query(
        `INSERT INTO conversation_sessions (id, daemon_id, participant_id, participant_type, started_at, turn_count, status)
         VALUES ($1, $2, $3, $4, to_timestamp($5::double precision / 1000), $6, $7)`,
        [
          session.sessionId,
          session.daemonId,
          session.participantId,
          session.participantType,
          session.startedAt,
          session.turnCount,
          session.status,
        ],
      );
    } catch (err) {
      console.error(`[SessionManager] Failed to persist session create:`, err);
    }
  }

  private async persistSessionUpdate(session: ConversationSession): Promise<void> {
    try {
      const pool = getPool();
      await pool.query(
        `UPDATE conversation_sessions
         SET turn_count = $1, status = $2, ended_at = CASE WHEN $3::double precision IS NOT NULL THEN to_timestamp($3::double precision / 1000) ELSE ended_at END
         WHERE id = $4`,
        [
          session.turnCount,
          session.status,
          session.endedAt ?? null,
          session.sessionId,
        ],
      );
    } catch (err) {
      console.error(`[SessionManager] Failed to persist session update:`, err);
    }
  }

  private async persistLogEntry(entry: LogEntry): Promise<void> {
    try {
      const pool = getPool();
      await pool.query(
        `INSERT INTO daemon_activity_log (id, daemon_id, type, timestamp, actors, tokens_in, tokens_out, model_used, inference_latency_ms, payload)
         VALUES ($1, $2, $3, to_timestamp($4::double precision / 1000), $5, $6, $7, $8, $9, $10)`,
        [
          entry.entryId,
          entry.daemonId,
          entry.type,
          entry.timestamp,
          JSON.stringify(entry.actors),
          entry.tokensIn ?? null,
          entry.tokensOut ?? null,
          entry.modelUsed ?? null,
          entry.inferenceLatencyMs ?? null,
          JSON.stringify(entry.payload),
        ],
      );
    } catch (err) {
      console.error(`[SessionManager] Failed to persist log entry:`, err);
    }
  }
}
