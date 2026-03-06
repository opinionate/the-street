import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-sonnet-4-6";
export const FALLBACK_MODEL = "claude-haiku-4-5-20251001";

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

export function stripJsonFences(text: string): string {
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json[c]?|JSON)?\n?/, "").replace(/\n?```$/, "");
  }
  return text;
}

export function sanitizeUserInput(input: string, maxLength: number = 2000): string {
  // Strip control characters except newlines
  let sanitized = input.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, "");
  // Truncate to max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }
  return sanitized;
}
