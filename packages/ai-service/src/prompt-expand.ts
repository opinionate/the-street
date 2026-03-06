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

Additionally, for each emote label provided, suggest a short promptDescription (1 sentence) that describes how this daemon would perform that emote, given their personality.

Add a "suggestedEmoteDescriptions" field to your output:
{
  ...expanded fields...,
  "suggestedEmoteDescriptions": {
    "emote-label": "How this daemon performs this emote, in character"
  }
}`;

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
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from AI during prompt expansion");
  }

  const jsonText = stripJsonFences(textBlock.text.trim());
  const raw = JSON.parse(jsonText) as Record<string, unknown>;

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
