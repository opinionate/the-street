import { describe, it, expect } from "vitest";

/**
 * Tests for daemon conversation prompt construction.
 * We import buildDaemonSystemPrompt indirectly by checking compile output
 * and verifying prompt content rules.
 */

// We can't easily import the private buildDaemonSystemPrompt, so we test
// the compiled manifest prompt (manifest-compiler) for the key rules,
// and test the daemon-converse prompt structure by importing directly.

// Since buildDaemonSystemPrompt is not exported, we test via the module's
// exported generateDaemonResponse by checking the prompt rules are present
// in the manifest compiler output (which uses the same pattern).

import { compile } from "../manifest-compiler.js";
import type { PersonalityManifest } from "@the-street/shared";

function makeManifest(overrides: Partial<PersonalityManifest> = {}): PersonalityManifest {
  return {
    daemonId: "daemon-test",
    version: 1,
    identity: {
      name: "Crash",
      voiceDescription: "A loud, boisterous voice full of energy.",
      backstory: "Crash used to be a Hollywood stunt double. He references movies and stunts constantly.",
    },
    compiledSystemPrompt: "",
    compiledTokenCount: 0,
    compiledAt: 0,
    interests: ["stunts", "movies", "explosions"],
    dislikes: ["boring conversations"],
    mutableTraits: [],
    availableEmotes: [],
    behaviorPreferences: {
      crowdAffinity: 0.5,
      territoriality: 0.3,
      conversationLength: "moderate",
      initiatesConversation: true,
    },
    maxConversationTurns: 20,
    maxDailyCalls: 100,
    dailyBudgetResetsAt: "00:00",
    rememberVisitors: true,
    ...overrides,
  };
}

describe("daemon prompt personality restraint", () => {
  it("compiled prompt instructs daemons not to shoehorn backstory into every reply", () => {
    const result = compile(makeManifest(), "daemon_creation");
    const prompt = result.manifest.compiledSystemPrompt;

    expect(prompt).toContain("background context");
    expect(prompt).toContain("NOT things to shoehorn into every reply");
  });

  it("compiled prompt tells daemons to bring up background only when relevant", () => {
    const result = compile(makeManifest(), "daemon_creation");
    const prompt = result.manifest.compiledSystemPrompt;

    expect(prompt).toContain("genuinely calls for it");
  });

  it("compiled prompt still contains the backstory itself", () => {
    const result = compile(makeManifest(), "daemon_creation");
    const prompt = result.manifest.compiledSystemPrompt;

    // Backstory should be present as context, just not forced into every reply
    expect(prompt).toContain("Hollywood stunt double");
  });

  it("compiled prompt forbids parroting", () => {
    const result = compile(makeManifest(), "daemon_creation");
    const prompt = result.manifest.compiledSystemPrompt;

    expect(prompt).toContain("NEVER parrot");
  });
});
