import { getPool } from "../database/pool.js";
import { appendLogEntry } from "./ActivityLogService.js";
import type { ConversationSession, DaemonRelationship } from "@the-street/shared";
import Anthropic from "@anthropic-ai/sdk";

const SUMMARIZE_MODEL = "claude-haiku-4-5-20251001";

interface RelationshipRow {
  daemon_id: string;
  target_daemon_id: string;
  target_daemon_name: string;
  interaction_count: number;
  last_interaction: string;
  relationship: string;
  relational_valence: string;
}

/**
 * Load a daemon's relationship with another daemon from DB.
 */
export async function getDaemonRelationship(
  daemonId: string,
  targetDaemonId: string,
): Promise<DaemonRelationship | null> {
  const pool = getPool();
  const { rows } = await pool.query<RelationshipRow>(
    `SELECT * FROM daemon_relationships
     WHERE daemon_id = $1 AND target_daemon_id = $2`,
    [daemonId, targetDaemonId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    targetDaemonId: row.target_daemon_id,
    targetDaemonName: row.target_daemon_name,
    interactionCount: row.interaction_count,
    lastInteraction: new Date(row.last_interaction).getTime(),
    relationship: row.relationship,
    relationalValence: row.relational_valence as DaemonRelationship["relationalValence"],
  };
}

/**
 * Summarize an inter-daemon session and persist relationship records for BOTH daemons.
 */
export async function summarizeAndPersistDaemonRelationship(
  daemonId: string,
  daemonName: string,
  targetDaemonId: string,
  targetDaemonName: string,
  session: ConversationSession,
  conversationSummary: string,
): Promise<void> {
  const pool = getPool();
  const now = new Date();

  // AI summarization for relationship description + valence
  let relationship = conversationSummary || "Had a brief exchange.";
  let valence: DaemonRelationship["relationalValence"] = "neutral";

  if (session.turnCount >= 4) {
    try {
      const anthropic = new Anthropic();
      const startTime = Date.now();

      const response = await anthropic.messages.create({
        model: SUMMARIZE_MODEL,
        max_tokens: 200,
        system: `You summarize inter-daemon relationships. Given a conversation summary between two daemons, produce a JSON object with:
- "relationship": 1-2 sentence description of how they relate
- "valence": one of "rival", "neutral", "allied", "subordinate", "dominant"

Return ONLY the JSON object, no markdown fences.`,
        messages: [
          {
            role: "user",
            content: `${daemonName} and ${targetDaemonName} had a conversation (${session.turnCount} turns). Summary: ${conversationSummary}`,
          },
        ],
      });

      const latencyMs = Date.now() - startTime;
      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") {
        try {
          const parsed = JSON.parse(textBlock.text.trim());
          if (parsed.relationship) relationship = parsed.relationship;
          const validValences = ["rival", "neutral", "allied", "subordinate", "dominant"];
          if (validValences.includes(parsed.valence)) valence = parsed.valence;
        } catch {
          // Use defaults
        }
      }

      // Log the summarization call
      await appendLogEntry({
        entryId: crypto.randomUUID(),
        daemonId,
        type: "conversation_summary",
        timestamp: Date.now(),
        actors: [
          { actorType: "daemon", actorId: daemonId, actorName: daemonName },
          { actorType: "daemon", actorId: targetDaemonId, actorName: targetDaemonName },
        ],
        tokensIn: response.usage?.input_tokens,
        tokensOut: response.usage?.output_tokens,
        modelUsed: SUMMARIZE_MODEL,
        inferenceLatencyMs: latencyMs,
        payload: {
          sessionId: session.sessionId,
          participantId: targetDaemonId,
          participantType: "daemon" as const,
          duration: session.endedAt ? (session.endedAt - session.startedAt) / 1000 : 0,
          turnCount: session.turnCount,
          impressionGenerated: relationship,
        },
      });
    } catch (err) {
      console.error(`[DaemonRelationshipStore] Summarization failed for ${daemonId} <-> ${targetDaemonId}:`, err);
    }
  }

  // Upsert relationship for daemon -> target
  await pool.query(
    `INSERT INTO daemon_relationships
       (daemon_id, target_daemon_id, target_daemon_name, interaction_count, last_interaction, relationship, relational_valence)
     VALUES ($1, $2, $3, 1, $4, $5, $6)
     ON CONFLICT (daemon_id, target_daemon_id)
     DO UPDATE SET
       interaction_count = daemon_relationships.interaction_count + 1,
       last_interaction = $4,
       relationship = $5,
       relational_valence = $6,
       updated_at = now()`,
    [daemonId, targetDaemonId, targetDaemonName, now, relationship, valence],
  );

  // Upsert reverse relationship for target -> daemon
  // Mirror the valence (subordinate <-> dominant, others stay same)
  let reverseValence = valence;
  if (valence === "subordinate") reverseValence = "dominant";
  else if (valence === "dominant") reverseValence = "subordinate";

  await pool.query(
    `INSERT INTO daemon_relationships
       (daemon_id, target_daemon_id, target_daemon_name, interaction_count, last_interaction, relationship, relational_valence)
     VALUES ($1, $2, $3, 1, $4, $5, $6)
     ON CONFLICT (daemon_id, target_daemon_id)
     DO UPDATE SET
       interaction_count = daemon_relationships.interaction_count + 1,
       last_interaction = $4,
       relationship = $5,
       relational_valence = $6,
       updated_at = now()`,
    [targetDaemonId, daemonId, daemonName, now, relationship, reverseValence],
  );
}
