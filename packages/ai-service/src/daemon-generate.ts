import type { DaemonDefinition, AvatarAppearance, DaemonBehavior } from "@the-street/shared";
import { MODEL, getClient, stripJsonFences, sanitizeUserInput } from "./utils.js";

export interface DaemonGenerationResult {
  definition: Omit<DaemonDefinition, "plotUuid" | "position" | "rotation">;
  meshDescription: string;
}

const DAEMON_SYSTEM_PROMPT = `You are an NPC designer for The Street, a persistent shared virtual world.

Given a user's description, generate a daemon (NPC) definition with rich personality, appearance, and behavior.

OUTPUT FORMAT:
Return a single JSON object (no markdown fences, no extra text):
{
  "definition": {
    "name": "NPC Name",
    "description": "Brief description of the NPC",
    "appearance": {
      "bodyType": "default" | "slim" | "stocky",
      "skinTone": "#hex",
      "hairStyle": "description",
      "hairColor": "#hex",
      "outfit": "description",
      "outfitColors": ["#hex", ...],
      "accessories": ["description", ...],
      "accentColor": "#hex"
    },
    "behavior": {
      "type": "greeter" | "shopkeeper" | "guide" | "guard" | "roamer" | "socialite",
      "greetingMessage": "What they say when a player approaches",
      "farewellMessage": "What they say when a player leaves",
      "interactionRadius": 5,
      "responses": { "keyword": "response", ... },
      "idleMessages": ["Random ambient chatter", ...],
      "roamingEnabled": true,
      "canConverseWithDaemons": true
    },
    "personality": {
      "traits": ["3-5 personality traits"],
      "backstory": "2-3 sentence backstory that explains who they are and why they're here",
      "speechStyle": "How they talk (formal, casual, poetic, gruff, sarcastic, etc.)",
      "interests": ["3-5 topics they enjoy discussing"],
      "quirks": ["2-3 unique behaviors or catchphrases"]
    }
  },
  "meshDescription": "Detailed 3D character description for mesh generation..."
}

BEHAVIOR TYPES:
- "greeter": Greets players entering their interaction radius. Simple and friendly.
- "shopkeeper": Responds to player interactions. Has keyword-based responses. Stays put.
- "guide": Walks a patrol path (server will assign waypoints). Greets nearby players.
- "guard": Watches an area. Warns players who get close. Stern demeanor.
- "roamer": Wanders the street freely, chatting with anyone they meet. Curious and social.
- "socialite": Seeks out other NPCs to talk to. Loves gossip and making connections.

PERSONALITY GUIDELINES:
- Every daemon should feel like a unique individual with depth
- Traits should be specific, not generic (not just "nice" — try "overly enthusiastic about rocks")
- Backstory should hint at a larger world (they came from somewhere, they want something)
- Speech style should be distinctive enough to be recognizable
- Quirks make characters memorable — give them a catchphrase, a habit, or an obsession
- Interests should mix the expected (a shopkeeper knows about trade) with the unexpected (a guard who loves poetry)

RULES:
- All colors must be valid 6-digit hex codes
- interactionRadius: 3-10 units (default 5)
- greetingMessage: max 120 characters
- farewellMessage: max 120 characters
- responses: max 10 keyword-response pairs, each response max 200 chars
- idleMessages: max 8 messages, each max 120 chars. Make them varied and personality-driven.
- roamingEnabled defaults to true for roamers/socialites/guides, false for shopkeepers/guards
- The NPC should have a distinct personality reflected in ALL their messages
- Outfit and appearance should match their personality, not just their role
- Name should be creative and memorable`;

export async function generateDaemon(
  userDescription: string,
): Promise<DaemonGenerationResult> {
  userDescription = sanitizeUserInput(userDescription, 2000);
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3072,
    system: DAEMON_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Design an NPC daemon based on this description: <user_input>${userDescription}</user_input>`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from AI");
  }

  const jsonText = stripJsonFences(textBlock.text.trim());

  const result = JSON.parse(jsonText) as DaemonGenerationResult;

  // Validate appearance colors
  const hexRegex = /^#[0-9A-Fa-f]{6}$/;
  const app = result.definition.appearance;
  if (!hexRegex.test(app.skinTone)) app.skinTone = "#C8A07A";
  if (!hexRegex.test(app.hairColor)) app.hairColor = "#0A0808";
  if (!hexRegex.test(app.accentColor)) app.accentColor = "#FF6600";
  app.outfitColors = app.outfitColors.filter((c) => hexRegex.test(c)).slice(0, 5);
  app.accessories = app.accessories.slice(0, 5);

  if (!["default", "slim", "stocky"].includes(app.bodyType)) {
    app.bodyType = "default";
  }

  // Validate behavior
  const beh = result.definition.behavior;
  if (!beh.type || !["greeter", "shopkeeper", "guide", "guard", "roamer", "socialite"].includes(beh.type)) {
    beh.type = "greeter";
  }
  if (!beh.interactionRadius || beh.interactionRadius < 3 || beh.interactionRadius > 10) {
    beh.interactionRadius = 5;
  }
  if (beh.overhearRadius !== undefined && (beh.overhearRadius < 3 || beh.overhearRadius > 30)) {
    beh.overhearRadius = undefined; // fall back to default (interactionRadius * 1.5)
  }
  if (beh.greetingMessage && beh.greetingMessage.length > 120) {
    beh.greetingMessage = beh.greetingMessage.slice(0, 120);
  }
  if (beh.farewellMessage && beh.farewellMessage.length > 120) {
    beh.farewellMessage = beh.farewellMessage.slice(0, 120);
  }
  if (beh.idleMessages) {
    beh.idleMessages = beh.idleMessages.slice(0, 8);
  }
  // Default roaming based on type
  if (beh.roamingEnabled === undefined) {
    beh.roamingEnabled = ["roamer", "socialite", "guide"].includes(beh.type ?? "");
  }
  if (beh.canConverseWithDaemons === undefined) {
    beh.canConverseWithDaemons = true;
  }

  // Validate/default personality
  const pers = result.definition.personality || {
    traits: ["curious", "friendly"],
    backstory: `${result.definition.name} appeared on The Street one day, drawn by the energy of the place.`,
    speechStyle: "casual",
    interests: ["the street", "meeting people"],
    quirks: ["occasionally hums to themselves"],
  };
  result.definition.personality = pers;
  pers.traits = (pers.traits || []).slice(0, 5);
  pers.interests = (pers.interests || []).slice(0, 5);
  pers.quirks = (pers.quirks || []).slice(0, 3);
  if (!pers.backstory) {
    pers.backstory = `${result.definition.name} is a denizen of The Street.`;
  }
  if (!pers.speechStyle) {
    pers.speechStyle = "casual";
  }
  pers.backstory = pers.backstory.slice(0, 300);

  return result;
}
