import Anthropic from "@anthropic-ai/sdk";
import {
  validateWorldObject,
  UNIVERSAL_CODE,
  ORIGIN_NEIGHBORHOOD_CODE,
} from "@the-street/shared";
import type {
  GenerationRequest,
  GenerationResult,
  WorldObject,
} from "@the-street/shared";
import { buildSystemPrompt } from "./system-prompt.js";

const MAX_RETRIES = 3;
const MODEL = "claude-sonnet-4-20250514";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

export async function generate(
  request: GenerationRequest
): Promise<GenerationResult> {
  const anthropic = getClient();
  const systemPrompt = buildSystemPrompt(
    request.plotContext,
    request.buildingCode,
    request.neighborhoodCode
  );

  let lastErrors: string[] = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let userMessage = `Create a world object based on this description: "${request.userDescription}"`;

    if (attempt > 0 && lastErrors.length > 0) {
      userMessage += `\n\nYour previous attempt had these validation errors. Please fix them:\n${lastErrors.map((e) => `- ${e}`).join("\n")}`;
    }

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    // Extract text content
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      lastErrors = ["No text response from AI"];
      continue;
    }

    // Parse JSON
    let result: GenerationResult;
    try {
      // Strip markdown fences if present
      let jsonText = textBlock.text.trim();
      if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      result = JSON.parse(jsonText) as GenerationResult;
    } catch {
      lastErrors = [
        `Failed to parse JSON response: ${textBlock.text.substring(0, 200)}`,
      ];
      continue;
    }

    // Validate
    const validation = validateWorldObject(
      result.objectDefinition as WorldObject,
      request.plotContext.plotBounds,
      request.plotContext.remainingRenderBudget,
      UNIVERSAL_CODE,
      ORIGIN_NEIGHBORHOOD_CODE
    );

    if (validation.valid) {
      result.validationErrors = [];
      return result;
    }

    // Collect errors for retry
    lastErrors = validation.errors
      .filter((e) => e.severity === "error")
      .map((e) => `${e.code}: ${e.message} (field: ${e.field})`);

    result.validationErrors = lastErrors;

    // If only warnings, accept it
    if (lastErrors.length === 0) {
      result.validationErrors = validation.errors.map(
        (e) => `${e.code}: ${e.message}`
      );
      return result;
    }
  }

  // All retries exhausted — return last attempt with errors
  throw new Error(
    `Generation failed after ${MAX_RETRIES} retries. Last errors: ${lastErrors.join("; ")}`
  );
}
