import Anthropic from "@anthropic-ai/sdk";
import type { AvatarAppearance } from "@the-street/shared";

const MODEL = "claude-sonnet-4-6";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

export interface AvatarGenerationResult {
  appearance: AvatarAppearance;
  meshDescription: string; // detailed description for Meshy text-to-3D
}

const AVATAR_SYSTEM_PROMPT = `You are an avatar designer for The Street, a persistent shared virtual world.

Given a user's natural language description of their desired avatar appearance, generate:
1. A structured AvatarAppearance JSON object
2. A detailed 3D mesh description for text-to-3D generation

OUTPUT FORMAT:
Return a single JSON object with this structure (no markdown fences, no extra text):
{
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
  "meshDescription": "A detailed 3D description for mesh generation..."
}

RULES:
- All colors must be valid 6-digit hex codes (e.g. "#FF5500")
- bodyType must be exactly one of: "default", "slim", "stocky"
- The avatar must be humanoid-scale (approximately 1.8m tall)
- meshDescription should describe a full humanoid character model suitable for a 3D game
- Include clothing, accessories, and distinguishing features in the mesh description
- Keep the style consistent with a modern virtual world (not hyper-realistic, not too cartoony)
- The mesh description should specify the character is in a T-pose or A-pose for rigging
- Maximum 5 accessories
- Maximum 5 outfit colors`;

export async function generateAvatar(
  userDescription: string,
): Promise<AvatarGenerationResult> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: AVATAR_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Design an avatar based on this description: "${userDescription}"`,
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

  const result = JSON.parse(jsonText) as AvatarGenerationResult;

  // Validate hex colors
  const hexRegex = /^#[0-9A-Fa-f]{6}$/;
  if (!hexRegex.test(result.appearance.skinTone)) {
    result.appearance.skinTone = "#C8A07A";
  }
  if (!hexRegex.test(result.appearance.hairColor)) {
    result.appearance.hairColor = "#0A0808";
  }
  if (!hexRegex.test(result.appearance.accentColor)) {
    result.appearance.accentColor = "#00FFFF";
  }
  result.appearance.outfitColors = result.appearance.outfitColors
    .filter((c) => hexRegex.test(c))
    .slice(0, 5);
  result.appearance.accessories = result.appearance.accessories.slice(0, 5);

  // Validate bodyType
  if (!["default", "slim", "stocky"].includes(result.appearance.bodyType)) {
    result.appearance.bodyType = "default";
  }

  return result;
}
