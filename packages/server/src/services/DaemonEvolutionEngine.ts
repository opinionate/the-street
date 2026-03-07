import type {
  PersonalityManifest,
  MutableTrait,
  ConversationSession,
  ManifestAmendmentPayload,
} from "@the-street/shared";
import { getPool } from "../database/pool.js";
import { appendLogEntry } from "./ActivityLogService.js";
import { compile, setManifest, type CompileReason } from "@the-street/ai-service";
import Anthropic from "@anthropic-ai/sdk";

const CLASSIFIER_MODEL = "claude-haiku-4-5-20251001";
const AMENDMENT_MODEL = "claude-haiku-4-5-20251001";
const COOLDOWN_DAYS = 30;

// --- Cooldown tracking ---

interface CooldownRecord {
  traitId: string;
  daemonId: string;
  lastAmendedAt: number; // epoch ms
}

const cooldowns = new Map<string, CooldownRecord>(); // key: `${daemonId}:${traitId}`

function cooldownKey(daemonId: string, traitId: string): string {
  return `${daemonId}:${traitId}`;
}

function isOnCooldown(daemonId: string, traitId: string): boolean {
  const record = cooldowns.get(cooldownKey(daemonId, traitId));
  if (!record) return false;
  const elapsed = Date.now() - record.lastAmendedAt;
  return elapsed < COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
}

function setCooldown(daemonId: string, traitId: string): void {
  cooldowns.set(cooldownKey(daemonId, traitId), {
    traitId,
    daemonId,
    lastAmendedAt: Date.now(),
  });
}

// --- Load cooldowns from DB on startup ---

export async function loadCooldowns(): Promise<void> {
  const pool = getPool();
  const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  const { rows } = await pool.query(
    `SELECT daemon_id, payload->>'traitId' as trait_id, timestamp
     FROM daemon_activity_log
     WHERE type = 'manifest_amendment'
       AND payload->>'validatorDecision' = 'accepted'
       AND timestamp >= $1
     ORDER BY timestamp DESC`,
    [cutoff],
  );

  for (const row of rows) {
    const key = cooldownKey(row.daemon_id, row.trait_id);
    if (!cooldowns.has(key)) {
      cooldowns.set(key, {
        traitId: row.trait_id,
        daemonId: row.daemon_id,
        lastAmendedAt: new Date(row.timestamp).getTime(),
      });
    }
  }
}

// --- Trigger evaluation ---

export interface TriggerEvent {
  type: "session_end" | "visitor_milestone" | "world_event";
  description: string;
  daemonId: string;
  session?: ConversationSession;
  metadata?: Record<string, unknown>;
}

/**
 * Evaluate all mutable traits for potential amendments after a trigger event.
 * Returns the number of amendments accepted.
 */
export async function evaluateTraitTriggers(
  manifest: PersonalityManifest,
  event: TriggerEvent,
): Promise<number> {
  const eligibleTraits = manifest.mutableTraits.filter(
    (t) => !isOnCooldown(manifest.daemonId, t.traitId),
  );

  if (eligibleTraits.length === 0) return 0;

  let accepted = 0;

  for (const trait of eligibleTraits) {
    try {
      const matched = await classifyTrigger(trait, event, manifest);
      if (!matched) continue;

      const proposal = await proposeAmendment(trait, event, manifest);
      if (!proposal) continue;

      const valid = validateProposal(trait, proposal);

      // Log the amendment attempt regardless of outcome
      await logAmendment(manifest, trait, event, proposal, valid);

      if (valid.accepted) {
        // Apply the amendment
        trait.currentValue = proposal.proposedValue;
        setCooldown(manifest.daemonId, trait.traitId);

        // Persist trait update to DB
        await persistTraitUpdate(manifest.daemonId, trait);

        // Recompile manifest
        const { manifest: recompiled, logEntry: recompileLog } = compile(
          manifest,
          "amendment_accepted" as CompileReason,
        );
        setManifest(recompiled);

        // Persist compiled manifest to DB
        await persistManifest(recompiled);

        // Log the recompile
        await appendLogEntry({
          entryId: crypto.randomUUID(),
          daemonId: manifest.daemonId,
          type: "manifest_recompile",
          timestamp: Date.now(),
          actors: [{ actorType: "system", actorId: "evolution-engine" }],
          payload: recompileLog,
        });

        // Update manifest reference for subsequent trait evaluations
        Object.assign(manifest, recompiled);
        accepted++;
      }
    } catch (err) {
      console.error(
        `[EvolutionEngine] Trait evaluation failed for ${trait.traitId} on daemon ${manifest.daemonId}:`,
        err,
      );
    }
  }

  return accepted;
}

// --- Classifier: does this event match the trait's trigger conditions? ---

async function classifyTrigger(
  trait: MutableTrait,
  event: TriggerEvent,
  manifest: PersonalityManifest,
): Promise<boolean> {
  const anthropic = new Anthropic();
  const startTime = Date.now();

  try {
    const response = await anthropic.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: 50,
      system: `You are a trigger classifier. Given a daemon trait's trigger conditions and an event, determine if the event matches. Respond with ONLY "yes" or "no".`,
      messages: [
        {
          role: "user",
          content: `Daemon: ${manifest.identity.name}
Trait: ${trait.name} (current: ${trait.currentValue}, range: ${trait.range})
Trigger conditions: ${trait.triggerConditions}
Event type: ${event.type}
Event description: ${event.description}

Does this event match the trigger conditions for this trait?`,
        },
      ],
    });

    const latencyMs = Date.now() - startTime;
    const textBlock = response.content.find((b) => b.type === "text");
    const answer = textBlock && textBlock.type === "text" ? textBlock.text.trim().toLowerCase() : "no";

    // Log the classifier call
    await appendLogEntry({
      entryId: crypto.randomUUID(),
      daemonId: manifest.daemonId,
      type: "behavior_event",
      timestamp: Date.now(),
      actors: [{ actorType: "system", actorId: "evolution-engine" }],
      tokensIn: response.usage?.input_tokens,
      tokensOut: response.usage?.output_tokens,
      modelUsed: CLASSIFIER_MODEL,
      inferenceLatencyMs: latencyMs,
      payload: {
        eventType: `trigger_classify:${trait.traitId}`,
        result: answer,
      },
    });

    return answer === "yes";
  } catch (err) {
    console.error(`[EvolutionEngine] Classifier failed for trait ${trait.traitId}:`, err);
    return false;
  }
}

// --- Amendment proposal ---

interface AmendmentProposal {
  proposedValue: string;
  reasoning: string;
}

async function proposeAmendment(
  trait: MutableTrait,
  event: TriggerEvent,
  manifest: PersonalityManifest,
): Promise<AmendmentProposal | null> {
  const anthropic = new Anthropic();
  const startTime = Date.now();

  try {
    const response = await anthropic.messages.create({
      model: AMENDMENT_MODEL,
      max_tokens: 150,
      system: `You propose trait amendments for daemon personality evolution. Given a trait and triggering event, propose a new value within the trait's range. Return ONLY a JSON object:
{"proposedValue": "new value string", "reasoning": "1-2 sentence explanation"}`,
      messages: [
        {
          role: "user",
          content: `Daemon: ${manifest.identity.name}
Trait: ${trait.name}
Current value: ${trait.currentValue}
Allowed range: ${trait.range}
Trigger conditions: ${trait.triggerConditions}
Triggering event: ${event.description}

Propose a new value for this trait based on the event.`,
        },
      ],
    });

    const latencyMs = Date.now() - startTime;
    const textBlock = response.content.find((b) => b.type === "text");

    // Log the proposal call
    await appendLogEntry({
      entryId: crypto.randomUUID(),
      daemonId: manifest.daemonId,
      type: "behavior_event",
      timestamp: Date.now(),
      actors: [{ actorType: "system", actorId: "evolution-engine" }],
      tokensIn: response.usage?.input_tokens,
      tokensOut: response.usage?.output_tokens,
      modelUsed: AMENDMENT_MODEL,
      inferenceLatencyMs: latencyMs,
      payload: {
        eventType: `amendment_propose:${trait.traitId}`,
      },
    });

    if (textBlock && textBlock.type === "text") {
      const parsed = JSON.parse(textBlock.text.trim());
      if (parsed.proposedValue && parsed.reasoning) {
        return { proposedValue: String(parsed.proposedValue), reasoning: String(parsed.reasoning) };
      }
    }
    return null;
  } catch (err) {
    console.error(`[EvolutionEngine] Proposal failed for trait ${trait.traitId}:`, err);
    return null;
  }
}

// --- Validator ---

interface ValidationResult {
  accepted: boolean;
  rejectionReason?: string;
}

function validateProposal(
  trait: MutableTrait,
  proposal: AmendmentProposal,
): ValidationResult {
  // Basic validation: proposed value must differ from current
  if (proposal.proposedValue === trait.currentValue) {
    return { accepted: false, rejectionReason: "Proposed value identical to current" };
  }

  // Value must not be empty
  if (!proposal.proposedValue.trim()) {
    return { accepted: false, rejectionReason: "Empty proposed value" };
  }

  // Value must be reasonable length (not an essay)
  if (proposal.proposedValue.length > 200) {
    return { accepted: false, rejectionReason: "Proposed value too long (>200 chars)" };
  }

  return { accepted: true };
}

// --- Logging ---

async function logAmendment(
  manifest: PersonalityManifest,
  trait: MutableTrait,
  event: TriggerEvent,
  proposal: AmendmentProposal,
  validation: ValidationResult,
): Promise<void> {
  const payload: ManifestAmendmentPayload = {
    triggeringEvent: event.description,
    triggeringEventType: event.type,
    traitId: trait.traitId,
    traitName: trait.name,
    previousValue: trait.currentValue,
    proposedValue: proposal.proposedValue,
    validatorDecision: validation.accepted ? "accepted" : "rejected",
    rejectionReason: validation.rejectionReason,
  };

  await appendLogEntry({
    entryId: crypto.randomUUID(),
    daemonId: manifest.daemonId,
    type: "manifest_amendment",
    timestamp: Date.now(),
    actors: [{ actorType: "system", actorId: "evolution-engine" }],
    payload,
  });
}

// --- DB persistence helpers ---

async function persistTraitUpdate(daemonId: string, trait: MutableTrait): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE personality_manifests
     SET mutable_traits = (
       SELECT jsonb_agg(
         CASE
           WHEN elem->>'traitId' = $2
           THEN jsonb_set(elem, '{currentValue}', to_jsonb($3::text))
           ELSE elem
         END
       )
       FROM jsonb_array_elements(mutable_traits) elem
     )
     WHERE daemon_id = $1`,
    [daemonId, trait.traitId, trait.currentValue],
  );
}

async function persistManifest(manifest: PersonalityManifest): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE personality_manifests
     SET compiled_system_prompt = $2,
         compiled_token_count = $3,
         compiled_at = $4,
         version = $5
     WHERE daemon_id = $1`,
    [
      manifest.daemonId,
      manifest.compiledSystemPrompt,
      manifest.compiledTokenCount,
      new Date(manifest.compiledAt),
      manifest.version,
    ],
  );
}
