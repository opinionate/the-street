import { describe, it, expect, beforeEach } from "vitest";
import { compile, getManifest, setManifest } from "../manifest-compiler.js";
import type { PersonalityManifest } from "@the-street/shared";

function makeManifest(overrides: Partial<PersonalityManifest> = {}): PersonalityManifest {
  return {
    daemonId: "daemon-001",
    version: 1,
    identity: {
      name: "Patches",
      voiceDescription: "A raspy, playful voice with a mischievous edge.",
      backstory: "Patches grew up on the outskirts of The Street, always watching from a distance. One day, a stranger tossed them a coin, and they decided this was home.",
    },
    compiledSystemPrompt: "",
    compiledTokenCount: 0,
    compiledAt: 0,
    interests: ["gossip", "street art", "old coins", "cloud shapes"],
    dislikes: ["loud music", "being ignored"],
    mutableTraits: [
      {
        traitId: "trust",
        name: "Trust Level",
        currentValue: "wary",
        range: "suspicious → wary → open → trusting",
        triggerConditions: "Shifts toward trusting after repeated friendly interactions",
      },
      {
        traitId: "energy",
        name: "Energy",
        currentValue: "moderate",
        range: "lethargic → moderate → hyperactive",
        triggerConditions: "Rises when crowd is large, falls at night",
      },
    ],
    availableEmotes: [
      { emoteId: "wave", label: "Wave", promptDescription: "A friendly wave" },
      { emoteId: "dance", label: "Dance", promptDescription: "A playful jig" },
      { emoteId: "laugh", label: "Laugh", promptDescription: "A hearty laugh" },
    ],
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

describe("manifest-compiler", () => {
  beforeEach(() => {
    // Clear store between tests by setting then getting
  });

  describe("compile", () => {
    it("produces a compiled system prompt", () => {
      const manifest = makeManifest();
      const result = compile(manifest, "daemon_creation");

      expect(result.manifest.compiledSystemPrompt).toBeTruthy();
      expect(result.manifest.compiledSystemPrompt).toContain("Patches");
      expect(result.manifest.compiledTokenCount).toBeGreaterThan(0);
      expect(result.manifest.compiledAt).toBeGreaterThan(0);
      expect(result.manifest.version).toBe(2);
    });

    it("includes identity and voice in the prompt", () => {
      const result = compile(makeManifest(), "daemon_creation");
      const prompt = result.manifest.compiledSystemPrompt;

      expect(prompt).toContain("You are Patches");
      expect(prompt).toContain("raspy, playful voice");
    });

    it("includes emotes with usage guidance", () => {
      const result = compile(makeManifest(), "daemon_creation");
      const prompt = result.manifest.compiledSystemPrompt;

      expect(prompt).toContain("wave");
      expect(prompt).toContain("dance");
      expect(prompt).toContain("A friendly wave");
    });

    it("includes interests and dislikes", () => {
      const result = compile(makeManifest(), "daemon_creation");
      const prompt = result.manifest.compiledSystemPrompt;

      expect(prompt).toContain("gossip");
      expect(prompt).toContain("loud music");
    });

    it("includes DaemonThought JSON structure instructions", () => {
      const result = compile(makeManifest(), "daemon_creation");
      const prompt = result.manifest.compiledSystemPrompt;

      expect(prompt).toContain('"speech"');
      expect(prompt).toContain('"emote"');
      expect(prompt).toContain('"movement"');
      expect(prompt).toContain('"addressedTo"');
      expect(prompt).toContain('"internalState"');
      expect(prompt).toContain('"suppressSpeech"');
      expect(prompt).toContain('"endConversation"');
    });

    it("instructs internalState to be written in daemon's voice", () => {
      const result = compile(makeManifest(), "daemon_creation");
      const prompt = result.manifest.compiledSystemPrompt;

      expect(prompt).toContain("write this in your own voice");
      expect(prompt).toContain("as Patches would think");
    });

    it("stays under 1500-token budget for a typical manifest", () => {
      const result = compile(makeManifest(), "daemon_creation");
      expect(result.manifest.compiledTokenCount).toBeLessThanOrEqual(1500);
    });

    it("truncates mutable trait ranges first when over budget", () => {
      const bigTraits: PersonalityManifest["mutableTraits"] = [];
      for (let i = 0; i < 20; i++) {
        bigTraits.push({
          traitId: `trait-${i}`,
          name: `Trait ${i} with a very long descriptive name`,
          currentValue: "moderate level of this particular trait",
          range: "very low → low → below average → average → above average → high → very high → extreme",
          triggerConditions: "This trait changes when the daemon experiences prolonged exposure to various environmental stimuli and social interactions over time",
        });
      }
      const manifest = makeManifest({ mutableTraits: bigTraits });
      const result = compile(manifest, "admin_edit");

      // Should still be under budget after truncation
      expect(result.manifest.compiledTokenCount).toBeLessThanOrEqual(1500);
      // Should NOT contain range descriptions (they were truncated)
      expect(result.manifest.compiledSystemPrompt).not.toContain("very low → low");
    });

    it("returns a valid ManifestRecompilePayload log entry", () => {
      const manifest = makeManifest({ version: 3, compiledTokenCount: 800 });
      const result = compile(manifest, "amendment_accepted");

      expect(result.logEntry).toEqual({
        reason: "amendment_accepted",
        previousVersion: 3,
        newVersion: 4,
        previousTokenCount: 800,
        newTokenCount: expect.any(Number),
      });
    });

    it("maps daemon_creation reason to admin_edit in log", () => {
      const result = compile(makeManifest(), "daemon_creation");
      expect(result.logEntry.reason).toBe("admin_edit");
    });
  });

  describe("getManifest / setManifest", () => {
    it("returns undefined for unknown daemon", () => {
      expect(getManifest("nonexistent")).toBeUndefined();
    });

    it("retrieves a compiled manifest", () => {
      const manifest = makeManifest();
      compile(manifest, "daemon_creation");

      const retrieved = getManifest("daemon-001");
      expect(retrieved).toBeDefined();
      expect(retrieved!.compiledSystemPrompt).toBeTruthy();
      expect(retrieved!.daemonId).toBe("daemon-001");
    });

    it("setManifest stores a manifest for later retrieval", () => {
      const manifest = makeManifest({ daemonId: "daemon-set-test" });
      setManifest(manifest);

      const retrieved = getManifest("daemon-set-test");
      expect(retrieved).toBeDefined();
      expect(retrieved!.daemonId).toBe("daemon-set-test");
    });
  });

  describe("truncation cascade", () => {
    it("handles a manifest with empty optional fields", () => {
      const manifest = makeManifest({
        interests: [],
        dislikes: [],
        mutableTraits: [],
        availableEmotes: [],
      });
      const result = compile(manifest, "daemon_creation");

      expect(result.manifest.compiledSystemPrompt).toContain("Patches");
      expect(result.manifest.compiledTokenCount).toBeLessThanOrEqual(1500);
    });

    it("handles extremely long backstory by truncating it", () => {
      // 8000 chars ≈ 2000 tokens — exceeds budget even alone, forcing short_backstory level
      const longBackstory = "A".repeat(8000) + ". And then more happened.";
      const manifest = makeManifest({
        identity: {
          name: "Verbose",
          voiceDescription: "Talks a lot.",
          backstory: longBackstory,
        },
        interests: Array.from({ length: 20 }, (_, i) => `Interest number ${i} which is very detailed and long`),
        dislikes: Array.from({ length: 20 }, (_, i) => `Dislike number ${i} which is very detailed and long`),
      });
      const result = compile(manifest, "admin_edit");

      // Backstory should be truncated to first sentence
      expect(result.manifest.compiledSystemPrompt).not.toContain("And then more happened");
    });
  });
});
