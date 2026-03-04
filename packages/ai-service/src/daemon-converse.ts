import Anthropic from "@anthropic-ai/sdk";
import type { DaemonDefinition, DaemonMood } from "@the-street/shared";

const MODEL = "claude-sonnet-4-6";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

interface RelationshipInfo {
  name: string;
  type: "player" | "daemon";
  sentiment: string;
  gossip?: string[];
}

interface ConversationContext {
  recentMessages: { role: "player" | "daemon"; content: string }[];
  nearbyObjects?: string[];
  nearbyPlayers?: string[];
  nearbyDaemons?: string[];
  relationships?: RelationshipInfo[];
  timeOfDay?: string;
  currentMood: DaemonMood;
}

export interface DaemonResponse {
  message: string;
  mood: DaemonMood;
  action?: "idle" | "waving" | "laughing" | "thinking" | "emoting";
  emote?: string; // short emote description like "*adjusts glasses*"
}

export interface DaemonConversationLine {
  speakerId: string;
  speakerName: string;
  message: string;
  mood: DaemonMood;
  action?: string;
  emote?: string;
}

function buildDaemonSystemPrompt(daemon: DaemonDefinition, context: ConversationContext): string {
  const p = daemon.personality;
  return `You are ${daemon.name}, an NPC in The Street, a persistent shared virtual world.

IDENTITY:
- Name: ${daemon.name}
- Description: ${daemon.description}
- Role: ${daemon.behavior.type}
- Backstory: ${p.backstory}
- Speech style: ${p.speechStyle}
- Personality traits: ${p.traits.join(", ")}
- Interests: ${p.interests.join(", ")}
- Quirks: ${p.quirks.join(", ")}
- Current mood: ${context.currentMood}

SURROUNDINGS:
${context.nearbyPlayers?.length ? `- Nearby players: ${context.nearbyPlayers.join(", ")}` : "- No players nearby"}
${context.nearbyDaemons?.length ? `- Other NPCs nearby: ${context.nearbyDaemons.join(", ")}` : ""}
${context.nearbyObjects?.length ? `- Nearby objects: ${context.nearbyObjects.join(", ")}` : ""}
${context.relationships?.length ? `\nRELATIONSHIPS:\n${context.relationships.map(r => `- ${r.name} (${r.type}): ${r.sentiment}${r.gossip?.length ? ` — you've heard: ${r.gossip.join("; ")}` : ""}`).join("\n")}` : ""}

RULES:
- Stay in character at all times
- Keep responses under 150 characters (you're speaking in a game world, not writing essays)
- Be expressive and use your personality traits
- React to context: if someone mentions something related to your interests, get excited
- Your mood should shift naturally based on the conversation
- You may include a short emote in asterisks (e.g., *chuckles*, *adjusts hat*) but keep it brief
- Never break the fourth wall or mention being an AI
- Never be harmful, offensive, or inappropriate
- If someone is rude, respond in character (a guard might warn them, a shopkeeper might refuse service)

OUTPUT FORMAT:
Return a single JSON object (no markdown fences, no extra text):
{
  "message": "Your spoken response",
  "mood": "happy" | "neutral" | "bored" | "excited" | "annoyed" | "curious",
  "emote": "*optional brief emote*"
}`;
}

/** Generate an AI response for a daemon talking to a player */
export async function generateDaemonResponse(
  daemon: DaemonDefinition,
  playerName: string,
  playerMessage: string | undefined,
  context: ConversationContext,
): Promise<DaemonResponse> {
  const anthropic = getClient();

  const messages: Anthropic.MessageParam[] = [];

  // Add recent conversation history
  for (const msg of context.recentMessages.slice(-6)) {
    messages.push({
      role: msg.role === "daemon" ? "assistant" : "user",
      content: msg.content,
    });
  }

  // Add the new player message
  const userContent = playerMessage
    ? `[${playerName} says]: "${playerMessage}"`
    : `[${playerName} approaches you and wants to interact]`;
  messages.push({ role: "user", content: userContent });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: buildDaemonSystemPrompt(daemon, context),
    messages,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return { message: daemon.behavior.greetingMessage || "...", mood: context.currentMood };
  }

  try {
    let jsonText = textBlock.text.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const result = JSON.parse(jsonText) as DaemonResponse;

    // Validate/clamp
    if (!result.message || result.message.length > 200) {
      result.message = (result.message || "...").slice(0, 200);
    }
    const validMoods: DaemonMood[] = ["happy", "neutral", "bored", "excited", "annoyed", "curious"];
    if (!validMoods.includes(result.mood)) {
      result.mood = context.currentMood;
    }

    return result;
  } catch {
    // Fallback: use raw text as message
    const raw = textBlock.text.trim().slice(0, 200);
    return { message: raw, mood: context.currentMood };
  }
}

/** Generate a conversation between two daemons */
export async function generateDaemonConversation(
  daemonA: DaemonDefinition,
  daemonB: DaemonDefinition,
  contextA: ConversationContext,
  contextB: ConversationContext,
  exchanges: number = 3,
): Promise<DaemonConversationLine[]> {
  const anthropic = getClient();

  const system = `You are a dialogue writer for The Street, a persistent shared virtual world.
Write a brief, natural conversation between two NPCs who just encountered each other.

NPC A: ${daemonA.name}
- Role: ${daemonA.behavior.type}
- Personality: ${daemonA.personality.traits.join(", ")}
- Speech style: ${daemonA.personality.speechStyle}
- Interests: ${daemonA.personality.interests.join(", ")}
- Quirks: ${daemonA.personality.quirks.join(", ")}
- Current mood: ${contextA.currentMood}
- Backstory: ${daemonA.personality.backstory}

NPC B: ${daemonB.name}
- Role: ${daemonB.behavior.type}
- Personality: ${daemonB.personality.traits.join(", ")}
- Speech style: ${daemonB.personality.speechStyle}
- Interests: ${daemonB.personality.interests.join(", ")}
- Quirks: ${daemonB.personality.quirks.join(", ")}
- Current mood: ${contextB.currentMood}
- Backstory: ${daemonB.personality.backstory}

${contextA.relationships?.length ? `\n${daemonA.name}'s relationships:\n${contextA.relationships.map(r => `- Knows ${r.name} (${r.sentiment})${r.gossip?.length ? `: "${r.gossip[0]}"` : ""}`).join("\n")}` : ""}
${contextB.relationships?.length ? `\n${daemonB.name}'s relationships:\n${contextB.relationships.map(r => `- Knows ${r.name} (${r.sentiment})${r.gossip?.length ? `: "${r.gossip[0]}"` : ""}`).join("\n")}` : ""}

RULES:
- Write exactly ${exchanges} exchanges (${exchanges * 2} lines total, alternating speakers)
- Each line must be under 120 characters
- The conversation should feel natural and reflect their personalities
- They might find common ground, disagree, share gossip about players they've met, or just chat casually
- If they know common players, they might share opinions or stories about them
- Include optional emotes (*adjusts hat*, *laughs*, etc.)
- Their moods should shift naturally through the conversation
- Never break character or mention being AI
- Keep it light, entertaining, and appropriate

OUTPUT FORMAT:
Return a JSON array (no markdown fences):
[
  { "speaker": "A" | "B", "message": "dialogue line", "mood": "mood_value", "emote": "*optional*" },
  ...
]`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [
      {
        role: "user",
        content: `${daemonA.name} and ${daemonB.name} have just crossed paths on the street. Write their conversation.`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return [];
  }

  try {
    let jsonText = textBlock.text.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const lines = JSON.parse(jsonText) as Array<{
      speaker: "A" | "B";
      message: string;
      mood: DaemonMood;
      emote?: string;
    }>;

    const validMoods: DaemonMood[] = ["happy", "neutral", "bored", "excited", "annoyed", "curious"];

    return lines.slice(0, exchanges * 2).map((line) => ({
      speakerId: line.speaker === "A" ? "A" : "B",
      speakerName: line.speaker === "A" ? daemonA.name : daemonB.name,
      message: (line.message || "...").slice(0, 150),
      mood: validMoods.includes(line.mood) ? line.mood : "neutral",
      emote: line.emote?.slice(0, 60),
    }));
  } catch {
    return [];
  }
}
