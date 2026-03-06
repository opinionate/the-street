import type { ExpandedManifestFields } from "@the-street/shared";
import { MODEL, getClient, stripJsonFences, sanitizeUserInput } from "./utils.js";

export interface ExpandPromptOptions {
  adminPrompt: string;
  existingFields?: Partial<ExpandedManifestFields>;
  clearedFields?: (keyof ExpandedManifestFields)[];
  emoteLabels?: string[];
}

export interface ExpandPromptResult {
  expandedFields: ExpandedManifestFields;
  suggestedEmoteDescriptions?: Record<string, string>;
}

const EXPANSION_SYSTEM_PROMPT = `You are an AI assistant that expands natural language daemon (NPC) descriptions into structured manifest fields for The Street, a persistent shared virtual world.

Given an admin's description of a daemon, produce a JSON object with these fields:

{
  "name": "string — infer a fitting name if admin didn't provide one",
  "voiceDescription": "string — how this daemon sounds when speaking (tone, cadence, vocabulary level, accent if any)",
  "backstory": "string — 2-4 sentences explaining who they are, where they came from, and what drives them",
  "interests": ["string array — 3-6 topics/activities this daemon enjoys or is knowledgeable about"],
  "dislikes": ["string array — 2-4 things this daemon avoids or dislikes"],
  "behaviorPreferences": {
    "crowdAffinity": "number -1.0 to 1.0 — negative means prefers solitude, positive means seeks crowds",
    "territoriality": "number 0.0 to 1.0 — how attached they are to their spawn location",
    "conversationLength": "\"brief\" | \"moderate\" | \"extended\" — how long they prefer to talk",
    "initiatesConversation": "boolean — whether they approach players to start conversations"
  },
  "expansionNotes": "string — reasoning for behavioral numeric choices and any inferences made"
}

GUIDELINES:
- Name: If the admin provides a name, use it exactly. Otherwise infer one that fits the personality.
- Voice: Describe speaking style concretely (e.g. "warm baritone with a slight drawl, uses folksy metaphors" not just "friendly").
- Backstory: Should feel grounded and specific. Reference The Street as their world. 2-4 sentences.
- Interests: Mix expected and unexpected. A guard might like poetry. A shopkeeper might love astronomy.
- Dislikes: Make them specific and personality-driven, not generic.
- Behavior numbers: Map personality traits to numbers with clear reasoning.
  - A shy introvert: crowdAffinity=-0.7, initiatesConversation=false
  - A gregarious socialite: crowdAffinity=0.9, initiatesConversation=true
  - A territorial shopkeeper: territoriality=0.8
  - A wandering bard: territoriality=0.1
- expansionNotes: Explain WHY you chose the numeric values and what you inferred from the description.

OUTPUT FORMAT:
Return ONLY a JSON object matching the structure above. No markdown fences, no extra text.
All numeric fields must be actual numbers (not strings).
conversationLength must be exactly one of: "brief", "moderate", "extended".`;

const EMOTE_SUGGESTION_ADDENDUM = `

Additionally, add a "suggestedEmoteDescriptions" field mapping each emote label to a brief in-character description (max 10 words each).

Example: "suggestedEmoteDescriptions": { "wave": "Gives a lazy two-finger salute" }`;

function buildReexpansionContext(
  existing: Partial<ExpandedManifestFields>,
  cleared: (keyof ExpandedManifestFields)[],
): string {
  const clearedSet = new Set(cleared);
  const preserved: string[] = [];

  for (const [key, value] of Object.entries(existing)) {
    if (clearedSet.has(key as keyof ExpandedManifestFields)) {
      continue;
    }
    if (value !== undefined && value !== null) {
      preserved.push(`  "${key}": ${JSON.stringify(value)}`);
    }
  }

  if (preserved.length === 0) return "";

  return `\n\nThe admin has previously expanded this daemon and manually edited some fields. PRESERVE these values exactly unless the new prompt clearly contradicts them:\n{\n${preserved.join(",\n")}\n}\n\nFields explicitly cleared by admin (re-generate these fresh): ${cleared.length > 0 ? cleared.join(", ") : "none"}`;
}

export async function expandPrompt(options: ExpandPromptOptions): Promise<ExpandPromptResult> {
  const { adminPrompt, existingFields, clearedFields = [], emoteLabels = [] } = options;

  const sanitizedPrompt = sanitizeUserInput(adminPrompt, 5000);

  let systemPrompt = EXPANSION_SYSTEM_PROMPT;

  if (existingFields && Object.keys(existingFields).length > 0) {
    systemPrompt += buildReexpansionContext(existingFields, clearedFields);
  }

  if (emoteLabels.length > 0) {
    systemPrompt += EMOTE_SUGGESTION_ADDENDUM;
  }

  const userMessage = emoteLabels.length > 0
    ? `Expand this daemon description:\n<description>${sanitizedPrompt}</description>\n\nAvailable emote labels: ${emoteLabels.join(", ")}`
    : `Expand this daemon description:\n<description>${sanitizedPrompt}</description>`;

  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from AI during prompt expansion");
  }

  const jsonText = stripJsonFences(textBlock.text.trim());
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(jsonText) as Record<string, unknown>;
  } catch (parseErr) {
    // AI response was likely truncated (stop_reason: max_tokens) — attempt repair
    console.warn(`[prompt-expand] JSON parse failed (stop_reason=${response.stop_reason}), attempting repair...`);
    console.warn(`[prompt-expand] Last 200 chars: ${jsonText.slice(-200)}`);
    const repaired = repairTruncatedJson(jsonText);
    try {
      raw = JSON.parse(repaired) as Record<string, unknown>;
    } catch {
      // If repair also fails, throw original error with context
      throw new Error(`AI returned invalid JSON (stop_reason=${response.stop_reason}): ${(parseErr as Error).message}`);
    }
  }

  const expandedFields = validateExpandedFields(raw);

  // Merge preserved fields back in for re-expansion
  if (existingFields && Object.keys(existingFields).length > 0) {
    const clearedSet = new Set(clearedFields);
    for (const [key, value] of Object.entries(existingFields)) {
      const k = key as keyof ExpandedManifestFields;
      if (!clearedSet.has(k) && value !== undefined && value !== null) {
        (expandedFields as unknown as Record<string, unknown>)[k] = value;
      }
    }
  }

  const result: ExpandPromptResult = { expandedFields };

  if (emoteLabels.length > 0 && raw.suggestedEmoteDescriptions) {
    const suggestions = raw.suggestedEmoteDescriptions as Record<string, string>;
    const filtered: Record<string, string> = {};
    for (const label of emoteLabels) {
      if (typeof suggestions[label] === "string") {
        filtered[label] = suggestions[label].slice(0, 200);
      }
    }
    if (Object.keys(filtered).length > 0) {
      result.suggestedEmoteDescriptions = filtered;
    }
  }

  return result;
}

function validateExpandedFields(raw: Record<string, unknown>): ExpandedManifestFields {
  const name = typeof raw.name === "string" && raw.name.length > 0
    ? raw.name.slice(0, 50)
    : "Unnamed Daemon";

  const voiceDescription = typeof raw.voiceDescription === "string" && raw.voiceDescription.length > 0
    ? raw.voiceDescription.slice(0, 300)
    : "Speaks in a neutral, conversational tone.";

  const backstory = typeof raw.backstory === "string" && raw.backstory.length > 0
    ? raw.backstory.slice(0, 600)
    : `${name} appeared on The Street one day, drawn by its energy.`;

  const interests = Array.isArray(raw.interests)
    ? (raw.interests as unknown[]).filter((i): i is string => typeof i === "string").slice(0, 6)
    : ["the street", "meeting people"];

  const dislikes = Array.isArray(raw.dislikes)
    ? (raw.dislikes as unknown[]).filter((i): i is string => typeof i === "string").slice(0, 4)
    : [];

  const rawBP = (typeof raw.behaviorPreferences === "object" && raw.behaviorPreferences !== null)
    ? raw.behaviorPreferences as Record<string, unknown>
    : {};

  const crowdAffinity = clamp(toNumber(rawBP.crowdAffinity, 0), -1, 1);
  const territoriality = clamp(toNumber(rawBP.territoriality, 0.5), 0, 1);
  const conversationLength = validateConversationLength(rawBP.conversationLength);
  const initiatesConversation = typeof rawBP.initiatesConversation === "boolean"
    ? rawBP.initiatesConversation
    : true;

  const expansionNotes = typeof raw.expansionNotes === "string"
    ? raw.expansionNotes.slice(0, 1000)
    : "";

  return {
    name,
    voiceDescription,
    backstory,
    interests,
    dislikes,
    behaviorPreferences: {
      crowdAffinity,
      territoriality,
      conversationLength,
      initiatesConversation,
    },
    expansionNotes,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && !isNaN(value)) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) return parsed;
  }
  return fallback;
}

function validateConversationLength(value: unknown): "brief" | "moderate" | "extended" {
  if (value === "brief" || value === "moderate" || value === "extended") {
    return value;
  }
  return "moderate";
}

/**
 * Attempt to repair JSON truncated mid-output (e.g. from max_tokens cutoff).
 * Strategy: walk backward from the truncation point to find the last complete
 * key-value pair, then close any open containers.
 */
function repairTruncatedJson(text: string): string {
  // Find the last position where a complete value ends.
  // Walk backward to find the last complete string, number, boolean, null, ], or }
  // that is part of a valid key-value pair.
  let repaired = text;

  // First, check if we're inside an unterminated string
  let inString = false;
  for (let i = 0; i < repaired.length; i++) {
    if (repaired[i] === "\\" && inString) {
      i++; // skip escaped char
      continue;
    }
    if (repaired[i] === '"') {
      inString = !inString;
    }
  }

  if (inString) {
    // Strip any trailing incomplete escape sequence (e.g. truncated after \)
    // so that appending " actually closes the string instead of creating \"
    while (repaired.endsWith("\\")) {
      repaired = repaired.slice(0, -1);
    }
    repaired += '"';
  }

  // Now strip any trailing incomplete key-value pair.
  // After closing a string, we might have: ..."value", "orphanKey": "closedVal"
  // or ..."value", "orphanKey" (key with no value)
  // Strategy: repeatedly trim trailing junk until we have valid-looking JSON tail.

  // Remove trailing content that looks like an incomplete pair:
  //   - trailing comma + whitespace
  //   - a dangling key (quoted string followed by colon with no/incomplete value)
  //   - a dangling value after a colon
  for (let attempt = 0; attempt < 5; attempt++) {
    repaired = repaired.replace(/,\s*$/, "");

    // Remove dangling "key": "value" or "key": partial at the end
    // Pattern: comma or { followed by "key": <something incomplete>
    // We look for a trailing "key": that doesn't end with a complete value
    const danglingKeyValue = repaired.match(/,\s*"[^"]*"\s*:\s*"[^"]*"\s*$/);
    if (danglingKeyValue) {
      // Check if removing it helps by counting braces
      const without = repaired.slice(0, repaired.length - danglingKeyValue[0].length);
      // Only remove if the remaining braces/brackets are unbalanced
      if (countOpen(without).braces > 0 || countOpen(without).brackets > 0) {
        // It's fine, keep it — it's a complete pair, we just need closing braces
        break;
      }
    }

    // Remove a dangling "key":  (with no value after colon)
    const danglingKey = repaired.match(/,?\s*"[^"]*"\s*:\s*$/);
    if (danglingKey) {
      repaired = repaired.slice(0, repaired.length - danglingKey[0].length);
      continue;
    }

    // Remove a lone trailing quoted string that looks like an orphan key (no colon after it)
    const orphanString = repaired.match(/,\s*"[^"]*"\s*$/);
    if (orphanString) {
      repaired = repaired.slice(0, repaired.length - orphanString[0].length);
      continue;
    }

    break;
  }

  repaired = repaired.replace(/,\s*$/, "");

  // Close any open containers
  const { braces, brackets } = countOpen(repaired);
  for (let i = 0; i < brackets; i++) repaired += "]";
  for (let i = 0; i < braces; i++) repaired += "}";

  return repaired;
}

function countOpen(text: string): { braces: number; brackets: number } {
  let braces = 0;
  let brackets = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && inString) {
      i++;
      continue;
    }
    if (text[i] === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (text[i] === "{") braces++;
    else if (text[i] === "}") braces--;
    else if (text[i] === "[") brackets++;
    else if (text[i] === "]") brackets--;
  }
  return { braces, brackets };
}
