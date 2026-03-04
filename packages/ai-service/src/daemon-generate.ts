import Anthropic from "@anthropic-ai/sdk";
import type { DaemonDefinition, AvatarAppearance, DaemonBehavior } from "@the-street/shared";

const MODEL = "claude-sonnet-4-6";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

export interface DaemonGenerationResult {
  definition: Omit<DaemonDefinition, "plotUuid" | "position" | "rotation">;
  meshDescription: string;
}

const DAEMON_SYSTEM_PROMPT = `You are an NPC designer for The Street, a persistent shared virtual world.

Given a user's description, generate a daemon (NPC) definition including its appearance, behavior, and personality.

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
      "type": "greeter" | "shopkeeper" | "guide" | "guard",
      "greetingMessage": "What they say when a player approaches",
      "farewellMessage": "What they say when a player leaves",
      "interactionRadius": 5,
      "responses": { "keyword": "response", ... },
      "idleMessages": ["Random ambient chatter", ...]
    }
  },
  "meshDescription": "Detailed 3D character description for mesh generation..."
}

BEHAVIOR TYPES:
- "greeter": Greets players entering their interaction radius. Simple and friendly.
- "shopkeeper": Responds to player interactions. Has keyword-based responses. Stays put.
- "guide": Walks a patrol path (server will assign waypoints). Greets nearby players.
- "guard": Watches an area. Warns players who get close. Stern demeanor.

RULES:
- All colors must be valid 6-digit hex codes
- interactionRadius: 3-10 units (default 5)
- greetingMessage: max 120 characters
- farewellMessage: max 120 characters
- responses: max 10 keyword-response pairs, each response max 200 chars
- idleMessages: max 5 messages, each max 100 chars
- The NPC should have a distinct personality reflected in their messages
- Outfit and appearance should match their role (shopkeeper looks commercial, guard looks stern, etc.)
- Name should be creative and fitting for a virtual world`;

export async function generateDaemon(
  userDescription: string,
): Promise<DaemonGenerationResult> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3072,
    system: DAEMON_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Design an NPC daemon based on this description: "${userDescription}"`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from AI");
  }

  let jsonText = textBlock.text.trim();
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

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
  if (!["greeter", "shopkeeper", "guide", "guard"].includes(beh.type)) {
    beh.type = "greeter";
  }
  if (!beh.interactionRadius || beh.interactionRadius < 3 || beh.interactionRadius > 10) {
    beh.interactionRadius = 5;
  }
  if (beh.greetingMessage && beh.greetingMessage.length > 120) {
    beh.greetingMessage = beh.greetingMessage.slice(0, 120);
  }
  if (beh.farewellMessage && beh.farewellMessage.length > 120) {
    beh.farewellMessage = beh.farewellMessage.slice(0, 120);
  }
  if (beh.idleMessages) {
    beh.idleMessages = beh.idleMessages.slice(0, 5);
  }

  return result;
}
