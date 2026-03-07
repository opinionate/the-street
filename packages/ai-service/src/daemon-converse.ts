import Anthropic from "@anthropic-ai/sdk";
import type { DaemonDefinition, DaemonMood } from "@the-street/shared";
import { MODEL, FALLBACK_MODEL, getClient, stripJsonFences, sanitizeUserInput } from "./utils.js";

async function callWithFallback<T>(
  primaryCall: (model: string) => Promise<T>,
  fallbackResponse: T,
  modelOverride?: string,
): Promise<T> {
  try {
    return await primaryCall(modelOverride || MODEL);
  } catch (primaryErr) {
    console.warn("Primary model failed, trying fallback:", primaryErr instanceof Error ? primaryErr.message : primaryErr);
    try {
      await new Promise(r => setTimeout(r, 1000));
      return await primaryCall(FALLBACK_MODEL);
    } catch (fallbackErr) {
      console.warn("Fallback model also failed:", fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
      return fallbackResponse;
    }
  }
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
  directive?: string; // Admin instruction for the daemon to follow
}

export interface DaemonResponse {
  message: string;
  mood: DaemonMood;
  action?: "idle" | "waving" | "laughing" | "thinking" | "emoting";
  emote?: string; // short emote description like "*adjusts glasses*"
  animatedEmoteId?: string; // triggers a 3D animation (e.g. "dance", "wave", "emote-backflip")
}

export interface DaemonConversationLine {
  speakerId: string;
  speakerName: string;
  message: string;
  mood: DaemonMood;
  action?: string;
  emote?: string;
}

function buildDaemonSystemPrompt(daemon: DaemonDefinition, context: ConversationContext, availableEmotes?: string[]): string {
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
${context.timeOfDay ? `- Time of day: ${context.timeOfDay}` : ""}
${context.nearbyPlayers?.length ? `- Nearby players: ${context.nearbyPlayers.join(", ")}` : "- No players nearby"}
${context.nearbyDaemons?.length ? `- Other NPCs nearby: ${context.nearbyDaemons.join(", ")}` : ""}
${context.nearbyObjects?.length ? `- Nearby objects: ${context.nearbyObjects.join(", ")}` : ""}
${context.relationships?.length ? `\nRELATIONSHIPS & OPINIONS:\n${context.relationships.map(r => `- ${r.name} (${r.type}): You feel ${r.sentiment} toward them${r.gossip?.length ? `. You've heard: ${r.gossip.join("; ")}` : ""}`).join("\n")}` : ""}
${context.directive ? `\nINNER DESIRE:\nYou feel a strong urge: ${context.directive}\n(Act on this desire naturally and in character. Do not mention it as an instruction — it's something you genuinely want to do.)` : ""}
RULES:
- Stay in character at all times
- Keep responses under 150 characters (you're speaking in a game world, not writing essays)
- IMPORTANT: Your backstory, quirks, and interests are background context — NOT things to shoehorn into every reply. A real person doesn't reference their hobby in every sentence. Respond naturally to what was actually said. Only bring up your background when the conversation genuinely calls for it (e.g., the topic is directly related to your experience, or someone asks about your past).
- If someone asks about a person you know (from RELATIONSHIPS), share your honest opinion and any gossip
- If someone asks about someone you don't know, say so in character
- Your mood should shift naturally based on the conversation
- NEVER parrot or echo back what someone just said. Don't repeat their words, phrases, or metaphors back to them. Respond with your OWN thoughts, references, and expressions. If they say "walked away clean", don't say "walked away" — say something completely different.
- Do NOT include emote text in asterisks (like *chuckles* or *adjusts hat*) in your message. Use animatedEmoteId to express emotion instead.
- Never break the fourth wall or mention being an AI
- Never be harmful, offensive, or inappropriate
- If someone is rude, respond in character (a guard might warn them, a shopkeeper might refuse service)
- Time of day affects your demeanor: morning = fresh, evening = tired, night = drowsy

OUTPUT FORMAT:
Return a single JSON object (no markdown fences, no extra text):
{
  "message": "Your spoken response",
  "mood": "happy" | "neutral" | "bored" | "excited" | "annoyed" | "curious"${availableEmotes && availableEmotes.length > 0 ? `,
  "animatedEmoteId": "optional - one of: ${availableEmotes.join(", ")}"` : ""}
}${availableEmotes && availableEmotes.length > 0 ? `

ANIMATED EMOTES:
You can trigger a 3D animation by setting "animatedEmoteId" to one of: ${availableEmotes.join(", ")}
When a player asks you to perform an action that matches one of these (e.g., "breakdance" → "dance", "say hi" → "wave"), you SHOULD set animatedEmoteId. Also use them naturally when they fit your mood or the conversation.` : ""}`;
}

/** Generate an AI response for a daemon talking to a player */
export async function generateDaemonResponse(
  daemon: DaemonDefinition,
  playerName: string,
  playerMessage: string | undefined,
  context: ConversationContext,
  availableEmotes?: string[],
): Promise<DaemonResponse> {
  playerName = sanitizeUserInput(playerName, 100);
  if (playerMessage) {
    playerMessage = sanitizeUserInput(playerMessage, 500);
  }

  const cannedFallback: DaemonResponse = {
    message: daemon.behavior.greetingMessage || "...",
    mood: context.currentMood,
  };

  const modelOverride = daemon.behavior.aiModel;

  return callWithFallback(async (model: string) => {
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
      ? `[<user_input>${playerName}</user_input> says]: "<user_input>${playerMessage}</user_input>"`
      : `[<user_input>${playerName}</user_input> approaches you and wants to interact]`;
    messages.push({ role: "user", content: userContent });

    const response = await anthropic.messages.create({
      model,
      max_tokens: 256,
      system: buildDaemonSystemPrompt(daemon, context, availableEmotes),
      messages,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return cannedFallback;
    }

    try {
      const jsonText = stripJsonFences(textBlock.text.trim());
      const result = JSON.parse(jsonText) as DaemonResponse;

      if (!result.message || result.message.length > 200) {
        result.message = (result.message || "...").slice(0, 200);
      }
      const validMoods: DaemonMood[] = ["happy", "neutral", "bored", "excited", "annoyed", "curious"];
      if (!validMoods.includes(result.mood)) {
        result.mood = context.currentMood;
      }
      // Validate animatedEmoteId against available emotes
      if (result.animatedEmoteId && availableEmotes) {
        if (!availableEmotes.includes(result.animatedEmoteId)) {
          result.animatedEmoteId = undefined;
        }
      }

      return result;
    } catch {
      const raw = textBlock.text.trim().slice(0, 200);
      return { message: raw, mood: context.currentMood };
    }
  }, cannedFallback, modelOverride);
}

/** Generate a conversation between two daemons */
export async function generateDaemonConversation(
  daemonA: DaemonDefinition,
  daemonB: DaemonDefinition,
  contextA: ConversationContext,
  contextB: ConversationContext,
  exchanges: number = 3,
): Promise<DaemonConversationLine[]> {
  // Use the higher-tier model if either daemon has one set
  const modelOverride = daemonA.behavior.aiModel || daemonB.behavior.aiModel;
  return callWithFallback(async (model: string) => {
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

${contextA.relationships?.length ? `\n${daemonA.name}'s opinions & gossip:\n${contextA.relationships.map(r => `- ${r.sentiment} toward ${r.name} (${r.type})${r.gossip?.length ? ` — heard: ${r.gossip.slice(0, 2).join("; ")}` : ""}`).join("\n")}` : ""}
${contextB.relationships?.length ? `\n${daemonB.name}'s opinions & gossip:\n${contextB.relationships.map(r => `- ${r.sentiment} toward ${r.name} (${r.type})${r.gossip?.length ? ` — heard: ${r.gossip.slice(0, 2).join("; ")}` : ""}`).join("\n")}` : ""}
${contextA.timeOfDay ? `\nTime of day: ${contextA.timeOfDay}` : ""}

RULES:
- Write exactly ${exchanges} exchanges (${exchanges * 2} lines total, alternating speakers)
- Each line must be under 120 characters
- The conversation should feel natural — like two real people talking, not two characters performing their backstories at each other
- Their backstories, quirks, and interests are background context. Only reference them when genuinely relevant to what's being discussed. Most exchanges should just be normal conversation.
- GOSSIP IS KEY: if they know common players, they SHOULD share opinions, stories, or rumors about them
- They might disagree about players ("I think he's great!" / "Really? He was rude to me...")
- If they have contrasting sentiments about the same person, that's interesting conflict
- Share second-hand gossip ("I heard from so-and-so that...")
- They might also bond over shared interests or bicker about differences
- Do NOT include emote text in asterisks in messages. Express emotion through mood values only.
- Their moods should shift naturally through the conversation
- Never break character or mention being AI
- Keep it light, entertaining, and appropriate

OUTPUT FORMAT:
Return a JSON array (no markdown fences):
[
  { "speaker": "A" | "B", "message": "dialogue line", "mood": "mood_value" },
  ...
]`;

    const response = await anthropic.messages.create({
      model,
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
      const jsonText = stripJsonFences(textBlock.text.trim());
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
  }, [], modelOverride);
}

/** Generate a multi-party conversation between 3+ daemons */
export async function generateGroupConversation(
  daemons: Array<{ definition: DaemonDefinition; context: ConversationContext }>,
  linesPerDaemon: number = 2,
): Promise<DaemonConversationLine[]> {
  if (daemons.length < 3) return [];

  // Use the highest-tier model override from any participant
  const modelOverride = daemons.find(d => d.definition.behavior.aiModel)?.definition.behavior.aiModel;
  return callWithFallback(async (model: string) => {
    const anthropic = getClient();
    const labels = "ABCDEFGH";
    const totalLines = daemons.length * linesPerDaemon;

    let npcDescriptions = "";
    for (let i = 0; i < daemons.length; i++) {
      const d = daemons[i].definition;
      const ctx = daemons[i].context;
      npcDescriptions += `\nNPC ${labels[i]}: ${d.name}
- Role: ${d.behavior.type}
- Personality: ${d.personality.traits.join(", ")}
- Speech style: ${d.personality.speechStyle}
- Interests: ${d.personality.interests.join(", ")}
- Quirks: ${d.personality.quirks.join(", ")}
- Current mood: ${ctx.currentMood}\n`;
    }

    const speakerOptions = daemons.map((_, i) => `"${labels[i]}"`).join(" | ");

    const system = `You are a dialogue writer for The Street, a persistent shared virtual world.
Write a lively group conversation between ${daemons.length} NPCs who've gathered together.
${npcDescriptions}
RULES:
- Write exactly ${totalLines} lines total, cycling through speakers naturally
- Each line must be under 100 characters
- The conversation should feel like a natural group chat — real people talking, not characters performing their backstories
- Their quirks, interests, and backstories are background context. Only reference them when genuinely relevant. Most lines should just be normal conversation.
- They might agree, disagree, joke, gossip, or bond over shared interests
- Do NOT include emote text in asterisks in messages. Express emotion through mood values only.
- Speakers don't need to go in strict order — they can interject
- Keep it light, entertaining, and appropriate
- Never break character

OUTPUT FORMAT:
Return a JSON array (no markdown fences):
[
  { "speaker": ${speakerOptions}, "message": "dialogue line", "mood": "mood_value" },
  ...
]`;

    const names = daemons.map(d => d.definition.name).join(", ");

    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system,
      messages: [
        {
          role: "user",
          content: `${names} are all hanging out together on the street. Write their group conversation.`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return [];
    }

    try {
      const jsonText = stripJsonFences(textBlock.text.trim());
      const lines = JSON.parse(jsonText) as Array<{
        speaker: string;
        message: string;
        mood: DaemonMood;
        emote?: string;
      }>;

      const validMoods: DaemonMood[] = ["happy", "neutral", "bored", "excited", "annoyed", "curious"];

      return lines.slice(0, totalLines).map((line) => {
        const speakerIndex = labels.indexOf(line.speaker);
        const daemon = speakerIndex >= 0 && speakerIndex < daemons.length
          ? daemons[speakerIndex] : daemons[0];

        return {
          speakerId: line.speaker,
          speakerName: daemon.definition.name,
          message: (line.message || "...").slice(0, 150),
          mood: validMoods.includes(line.mood) ? line.mood : "neutral",
          emote: line.emote?.slice(0, 60),
        };
      });
    } catch {
      return [];
    }
  }, [], modelOverride);
}
