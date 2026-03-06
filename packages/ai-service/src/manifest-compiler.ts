import type {
  PersonalityManifest,
  MutableTrait,
  EmoteAssignment,
  ManifestRecompilePayload,
} from "@the-street/shared";

const TOKEN_BUDGET = 1500;

// ~4 chars per token is a standard approximation for English text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

type TruncationLevel = "full" | "no_trait_ranges" | "no_interest_detail" | "short_backstory";

function formatEmotes(emotes: EmoteAssignment[]): string {
  if (emotes.length === 0) return "";
  const lines = emotes.map(e => `- ${e.emoteId} ("${e.label}"): ${e.promptDescription}`);
  return `\nAVAILABLE EMOTES (use sparingly, when they fit naturally):\n${lines.join("\n")}`;
}

function formatTraits(traits: MutableTrait[], level: TruncationLevel): string {
  if (traits.length === 0) return "";
  const lines = traits.map(t => {
    if (level === "full") {
      return `- ${t.name}: ${t.currentValue} (range: ${t.range}, shifts when: ${t.triggerConditions})`;
    }
    return `- ${t.name}: ${t.currentValue}`;
  });
  return `\nMUTABLE TRAITS:\n${lines.join("\n")}`;
}

function formatInterests(interests: string[], dislikes: string[], level: TruncationLevel): string {
  if (level === "no_interest_detail" || level === "short_backstory") {
    const shortInterests = interests.slice(0, 3).join(", ");
    const shortDislikes = dislikes.slice(0, 2).join(", ");
    let result = "";
    if (shortInterests) result += `\nInterests: ${shortInterests}`;
    if (shortDislikes) result += `\nDislikes: ${shortDislikes}`;
    return result;
  }
  let result = "";
  if (interests.length > 0) result += `\nINTERESTS (topics that engage you):\n${interests.map(i => `- ${i}`).join("\n")}`;
  if (dislikes.length > 0) result += `\nDISLIKES (topics that bore or annoy you):\n${dislikes.map(d => `- ${d}`).join("\n")}`;
  return result;
}

function formatBackstory(backstory: string, level: TruncationLevel): string {
  if (level === "short_backstory") {
    // Truncate to first sentence, capped at 120 chars
    const match = backstory.match(/^[^.!?]+[.!?]/);
    const short = match ? match[0].trim() : backstory.slice(0, 120);
    return short.length > 120 ? short.slice(0, 117) + "..." : short;
  }
  return backstory;
}

function buildPrompt(manifest: PersonalityManifest, level: TruncationLevel): string {
  const { identity, interests, dislikes, mutableTraits, availableEmotes, behaviorPreferences } = manifest;

  const backstory = formatBackstory(identity.backstory, level);
  const emoteBlock = formatEmotes(availableEmotes);
  const traitBlock = formatTraits(mutableTraits, level);
  const interestBlock = formatInterests(interests, dislikes, level);

  return `You are ${identity.name}. ${identity.voiceDescription}

BACKSTORY:
${backstory}
${interestBlock}
${traitBlock}
${emoteBlock}

BEHAVIOR:
- Conversation style: ${behaviorPreferences.conversationLength}
- Crowd affinity: ${behaviorPreferences.crowdAffinity > 0 ? "enjoys crowds" : behaviorPreferences.crowdAffinity < 0 ? "prefers solitude" : "neutral about crowds"}
- ${behaviorPreferences.initiatesConversation ? "You initiate conversations with passersby" : "You wait for others to approach you"}
- Territoriality: ${behaviorPreferences.territoriality > 0.5 ? "protective of your space" : "relaxed about your surroundings"}

OUTPUT FORMAT:
You MUST respond with a single JSON object (no markdown fences, no extra text):
{
  "speech": "What you say out loud (optional, omit or null to stay silent)",
  "emote": "emote_id from the list above (optional)",
  "movement": "approach" | "retreat" | "idle" | "face" | "patrol",
  "addressedTo": "ambient" or a specific participant ID,
  "internalState": "Your private inner monologue — write this in your own voice, as yourself",
  "suppressSpeech": false,
  "endConversation": false
}

RULES:
- Stay in character at all times. Never mention being an AI.
- "internalState" is YOUR private thoughts — write as ${identity.name} would think, in first person.
- Keep speech under 150 characters. You're talking in a virtual world, not writing essays.
- Use emotes sparingly and only when they fit the moment.
- Set "endConversation" to true when the interaction has reached a natural end.
- "suppressSpeech" means you observe silently — use when watching, thinking, or eavesdropping.
- Never be harmful, offensive, or inappropriate.`;
}

// In-memory manifest store (will be backed by DB in production)
const manifestStore = new Map<string, PersonalityManifest>();

export type CompileReason = "daemon_creation" | "admin_edit" | "amendment_accepted";

export interface CompileResult {
  manifest: PersonalityManifest;
  logEntry: ManifestRecompilePayload;
}

/**
 * Compile a PersonalityManifest into a system prompt.
 * Applies truncation cascade if the prompt exceeds the 1500-token budget.
 * Stores the compiled manifest and returns it along with a recompile log payload.
 */
export function compile(manifest: PersonalityManifest, reason: CompileReason): CompileResult {
  const previousVersion = manifest.version;
  const previousTokenCount = manifest.compiledTokenCount;

  // Truncation cascade: try each level until under budget
  const levels: TruncationLevel[] = ["full", "no_trait_ranges", "no_interest_detail", "short_backstory"];
  let prompt = "";
  let tokenCount = 0;

  for (const level of levels) {
    prompt = buildPrompt(manifest, level);
    tokenCount = estimateTokens(prompt);
    if (tokenCount <= TOKEN_BUDGET) break;
  }

  const newVersion = previousVersion + 1;

  const compiled: PersonalityManifest = {
    ...manifest,
    compiledSystemPrompt: prompt,
    compiledTokenCount: tokenCount,
    compiledAt: Date.now(),
    version: newVersion,
  };

  manifestStore.set(manifest.daemonId, compiled);

  const logEntry: ManifestRecompilePayload = {
    reason: reason === "daemon_creation" ? "admin_edit" : reason === "amendment_accepted" ? "amendment_accepted" : "admin_edit",
    previousVersion,
    newVersion,
    previousTokenCount,
    newTokenCount: tokenCount,
  };

  return { manifest: compiled, logEntry };
}

/**
 * Retrieve a previously compiled manifest by daemon ID.
 */
export function getManifest(daemonId: string): PersonalityManifest | undefined {
  return manifestStore.get(daemonId);
}

/**
 * Store a manifest directly (e.g., when loading from DB).
 */
export function setManifest(manifest: PersonalityManifest): void {
  manifestStore.set(manifest.daemonId, manifest);
}
