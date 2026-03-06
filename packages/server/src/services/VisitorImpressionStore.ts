import type {
  VisitorImpression,
  LogEntry,
  Actor,
  BehaviorEventPayload,
  ConversationTurn,
  ConversationSummaryPayload,
} from "@the-street/shared";
import { getPool } from "../database/pool.js";
import { getClient, stripJsonFences } from "@the-street/ai-service";
import { appendLogEntry } from "./ActivityLogService.js";

const MAX_VISITOR_IMPRESSIONS = 200;
const WARM_UPGRADE_THRESHOLD = 5;
const SUMMARIZATION_MODEL = "claude-haiku-4-5-20251001";

// --- Read ---

export async function getVisitorImpression(
  daemonId: string,
  visitorId: string,
): Promise<VisitorImpression | undefined> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT user_id, visit_count, last_seen, impression, relationship_valence
     FROM daemon_visitor_impressions
     WHERE daemon_id = $1 AND user_id = $2`,
    [daemonId, visitorId],
  );

  if (rows.length === 0) return undefined;

  const row = rows[0];
  return {
    userId: row.user_id,
    visitCount: row.visit_count,
    lastSeen: new Date(row.last_seen).getTime(),
    impression: row.impression,
    relationshipValence: row.relationship_valence,
  };
}

// --- LRU eviction ---

async function evictExcessImpressions(daemonId: string): Promise<void> {
  const pool = getPool();

  const { rows: evicted } = await pool.query(
    `WITH ranked AS (
       SELECT id, user_id, visit_count, relationship_valence,
              ROW_NUMBER() OVER (ORDER BY last_seen DESC) AS rn
       FROM daemon_visitor_impressions
       WHERE daemon_id = $1
     )
     DELETE FROM daemon_visitor_impressions
     WHERE id IN (SELECT id FROM ranked WHERE rn > $2)
     RETURNING user_id, visit_count, relationship_valence`,
    [daemonId, MAX_VISITOR_IMPRESSIONS],
  );

  for (const row of evicted) {
    const payload: BehaviorEventPayload = {
      eventType: "visitor_impression_evicted",
      details: {
        evictedUserId: row.user_id,
        visitCount: row.visit_count,
        relationshipValence: row.relationship_valence,
        reason: "lru_cap_exceeded",
        cap: MAX_VISITOR_IMPRESSIONS,
      },
    };

    const logEntry: LogEntry = {
      entryId: crypto.randomUUID(),
      daemonId,
      type: "behavior_event",
      timestamp: Date.now(),
      actors: [{ actorType: "daemon", actorId: daemonId }] as Actor[],
      payload,
    };

    appendLogEntry(logEntry).catch((err) => {
      console.error("[VisitorImpressionStore] Failed to log eviction:", err);
    });
  }

  if (evicted.length > 0) {
    console.log(`[VisitorImpressionStore] Evicted ${evicted.length} impressions for daemon=${daemonId} (LRU cap=${MAX_VISITOR_IMPRESSIONS})`);
  }
}

// --- Summarization + persistence ---

export async function summarizeAndPersistImpression(
  daemonId: string,
  daemonName: string,
  session: { sessionId: string; participantId: string; turnCount: number; startedAt: number; endedAt?: number },
  turns: ConversationTurn[],
): Promise<void> {
  const startTime = Date.now();

  const transcript = turns
    .map((t) => {
      const speaker = t.speaker.actorType === "daemon" ? daemonName : (t.speaker.actorName || "Visitor");
      return `${speaker}: ${t.speech}`;
    })
    .join("\n");

  let existing: VisitorImpression | undefined;
  try {
    existing = await getVisitorImpression(daemonId, session.participantId);
  } catch {
    // Continue without existing context
  }

  const existingContext = existing
    ? `\nPrevious impression: "${existing.impression}" (valence: ${existing.relationshipValence}, visits: ${existing.visitCount})`
    : "\nThis is the first interaction with this visitor.";

  const systemPrompt = `You are a memory summarizer for an NPC named "${daemonName}". Given a conversation transcript, produce a JSON object with:
- "impression": A 1-2 sentence summary of your impression of this visitor. What stood out? How did they make you feel? Be specific and personal.
- "relationshipValence": One of "hostile", "neutral", "warm", "trusted" based on how the conversation went.

Consider the visitor's tone, topics discussed, and overall interaction quality.${existingContext}

Respond with ONLY a JSON object, no markdown fences.`;

  let impression = "";
  let valence: VisitorImpression["relationshipValence"] = "neutral";
  let tokensIn = 0;
  let tokensOut = 0;

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: SUMMARIZATION_MODEL,
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: "user", content: `Conversation transcript:\n${transcript}` }],
    });

    tokensIn = response.usage.input_tokens;
    tokensOut = response.usage.output_tokens;

    const textBlock = response.content.find((b) => b.type === "text");
    const rawText = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";

    try {
      const parsed = JSON.parse(stripJsonFences(rawText));
      if (typeof parsed.impression === "string") {
        impression = parsed.impression.slice(0, 500);
      }
      const validValences = ["hostile", "neutral", "warm", "trusted"] as const;
      if (validValences.includes(parsed.relationshipValence)) {
        valence = parsed.relationshipValence;
      }
    } catch {
      impression = rawText.slice(0, 500) || "Had a conversation.";
    }
  } catch (err) {
    console.error(`[VisitorImpressionStore] Summarization call failed for daemon=${daemonId}:`, err);
    impression = `Had a ${turns.length}-turn conversation.`;
  }

  // Auto-upgrade to warm when visit count reaches threshold
  if (existing && existing.visitCount + 1 >= WARM_UPGRADE_THRESHOLD && valence === "neutral") {
    valence = "warm";
  }

  // Persist the impression (upsert increments visit_count)
  const pool = getPool();
  await pool.query(
    `INSERT INTO daemon_visitor_impressions
       (daemon_id, user_id, visit_count, last_seen, impression, relationship_valence, updated_at)
     VALUES ($1, $2, 1, now(), $3, $4, now())
     ON CONFLICT (daemon_id, user_id) DO UPDATE SET
       visit_count = daemon_visitor_impressions.visit_count + 1,
       last_seen = now(),
       impression = EXCLUDED.impression,
       relationship_valence = EXCLUDED.relationship_valence,
       updated_at = now()`,
    [daemonId, session.participantId, impression, valence],
  );

  // Run LRU eviction
  await evictExcessImpressions(daemonId);

  const latencyMs = Date.now() - startTime;
  const duration = (session.endedAt ?? Date.now()) - session.startedAt;

  // Log as conversation_summary
  const summaryPayload: ConversationSummaryPayload = {
    sessionId: session.sessionId,
    participantId: session.participantId,
    participantType: "visitor",
    duration,
    turnCount: session.turnCount,
    impressionGenerated: impression,
  };

  const logEntry: LogEntry = {
    entryId: crypto.randomUUID(),
    daemonId,
    type: "conversation_summary",
    timestamp: Date.now(),
    actors: [
      { actorType: "daemon", actorId: daemonId, actorName: daemonName },
      { actorType: "visitor", actorId: session.participantId },
    ],
    tokensIn,
    tokensOut,
    modelUsed: SUMMARIZATION_MODEL,
    inferenceLatencyMs: latencyMs,
    payload: summaryPayload,
  };

  appendLogEntry(logEntry).catch((err) => {
    console.error("[VisitorImpressionStore] Failed to log conversation summary:", err);
  });

  console.log(`[VisitorImpressionStore] Persisted impression for daemon=${daemonId} visitor=${session.participantId} valence=${valence} latency=${latencyMs}ms`);
}
