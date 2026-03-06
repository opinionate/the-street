import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Anthropic client before importing
vi.mock("@anthropic-ai/sdk", () => {
  const mockCreate = vi.fn();
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
    __mockCreate: mockCreate,
  };
});

import { expandPrompt } from "../prompt-expand.js";

// Get reference to the mock
const { __mockCreate: mockCreate } = await import("@anthropic-ai/sdk") as unknown as { __mockCreate: ReturnType<typeof vi.fn> };

function mockAIResponse(json: Record<string, unknown>) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: "text", text: JSON.stringify(json) }],
  });
}

const VALID_EXPANSION = {
  name: "Professor Whiskers",
  voiceDescription: "Warm tenor with a slight academic cadence, punctuated by thoughtful pauses",
  backstory: "Professor Whiskers arrived on The Street after his university closed. He now shares knowledge freely with anyone who stops to listen. His passion for teaching never faded.",
  interests: ["ancient history", "tea brewing", "stargazing", "crossword puzzles"],
  dislikes: ["loud noises", "rudeness", "being rushed"],
  behaviorPreferences: {
    crowdAffinity: -0.3,
    territoriality: 0.6,
    conversationLength: "extended",
    initiatesConversation: true,
  },
  expansionNotes: "Chose negative crowdAffinity (-0.3) because academics tend to prefer smaller groups. Moderate territoriality (0.6) since he has a 'teaching spot'. Extended conversations fit his professorial nature.",
};

describe("expandPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns well-structured ExpandedManifestFields from a prompt", async () => {
    mockAIResponse(VALID_EXPANSION);

    const result = await expandPrompt({
      adminPrompt: "A retired professor who loves to teach anyone who walks by",
    });

    expect(result.expandedFields.name).toBe("Professor Whiskers");
    expect(result.expandedFields.voiceDescription).toContain("tenor");
    expect(result.expandedFields.backstory).toContain("Street");
    expect(result.expandedFields.interests).toHaveLength(4);
    expect(result.expandedFields.dislikes).toHaveLength(3);
    expect(result.expandedFields.behaviorPreferences.crowdAffinity).toBe(-0.3);
    expect(result.expandedFields.behaviorPreferences.territoriality).toBe(0.6);
    expect(result.expandedFields.behaviorPreferences.conversationLength).toBe("extended");
    expect(result.expandedFields.behaviorPreferences.initiatesConversation).toBe(true);
    expect(result.expandedFields.expansionNotes).toContain("crowdAffinity");
  });

  it("validates and clamps numeric fields", async () => {
    mockAIResponse({
      ...VALID_EXPANSION,
      behaviorPreferences: {
        crowdAffinity: 5.0,  // out of range
        territoriality: -2.0, // out of range
        conversationLength: "invalid",
        initiatesConversation: "yes", // wrong type
      },
    });

    const result = await expandPrompt({ adminPrompt: "test" });

    expect(result.expandedFields.behaviorPreferences.crowdAffinity).toBe(1.0);
    expect(result.expandedFields.behaviorPreferences.territoriality).toBe(0.0);
    expect(result.expandedFields.behaviorPreferences.conversationLength).toBe("moderate");
    expect(result.expandedFields.behaviorPreferences.initiatesConversation).toBe(true); // default
  });

  it("provides defaults for missing fields", async () => {
    mockAIResponse({});

    const result = await expandPrompt({ adminPrompt: "a mysterious figure" });

    expect(result.expandedFields.name).toBe("Unnamed Daemon");
    expect(result.expandedFields.voiceDescription).toContain("neutral");
    expect(result.expandedFields.interests).toEqual(["the street", "meeting people"]);
    expect(result.expandedFields.dislikes).toEqual([]);
    expect(result.expandedFields.behaviorPreferences.crowdAffinity).toBe(0);
    expect(result.expandedFields.behaviorPreferences.territoriality).toBe(0.5);
  });

  it("truncates overly long fields", async () => {
    mockAIResponse({
      ...VALID_EXPANSION,
      name: "A".repeat(100),
      voiceDescription: "B".repeat(500),
      backstory: "C".repeat(1000),
      expansionNotes: "D".repeat(2000),
    });

    const result = await expandPrompt({ adminPrompt: "test" });

    expect(result.expandedFields.name.length).toBeLessThanOrEqual(50);
    expect(result.expandedFields.voiceDescription.length).toBeLessThanOrEqual(300);
    expect(result.expandedFields.backstory.length).toBeLessThanOrEqual(600);
    expect(result.expandedFields.expansionNotes.length).toBeLessThanOrEqual(1000);
  });

  it("caps array lengths", async () => {
    mockAIResponse({
      ...VALID_EXPANSION,
      interests: Array(20).fill("topic"),
      dislikes: Array(20).fill("thing"),
    });

    const result = await expandPrompt({ adminPrompt: "test" });

    expect(result.expandedFields.interests.length).toBeLessThanOrEqual(6);
    expect(result.expandedFields.dislikes.length).toBeLessThanOrEqual(4);
  });

  it("preserves existing fields during re-expansion", async () => {
    mockAIResponse({
      ...VALID_EXPANSION,
      name: "AI Generated Name",
      backstory: "AI generated backstory",
    });

    const result = await expandPrompt({
      adminPrompt: "updated description",
      existingFields: {
        name: "Admin Edited Name",
        backstory: "Admin edited backstory",
      },
    });

    // Existing manually-edited fields should be preserved
    expect(result.expandedFields.name).toBe("Admin Edited Name");
    expect(result.expandedFields.backstory).toBe("Admin edited backstory");
    // AI-generated fields for non-existing keys should come through
    expect(result.expandedFields.voiceDescription).toBe(VALID_EXPANSION.voiceDescription);
  });

  it("re-generates cleared fields even if they exist", async () => {
    mockAIResponse({
      ...VALID_EXPANSION,
      name: "Fresh AI Name",
    });

    const result = await expandPrompt({
      adminPrompt: "updated description",
      existingFields: {
        name: "Old Admin Name",
        backstory: "Keep this backstory",
      },
      clearedFields: ["name"],
    });

    // name was cleared, so AI value should be used
    expect(result.expandedFields.name).toBe("Fresh AI Name");
    // backstory was NOT cleared, so existing value preserved
    expect(result.expandedFields.backstory).toBe("Keep this backstory");
  });

  it("includes suggested emote descriptions when emote labels provided", async () => {
    mockAIResponse({
      ...VALID_EXPANSION,
      suggestedEmoteDescriptions: {
        "wave": "Professor Whiskers gives a dignified wave, adjusting his spectacles",
        "dance": "Shuffles his feet in an awkward but endearing two-step",
        "unknown-emote": "Should be filtered out",
      },
    });

    const result = await expandPrompt({
      adminPrompt: "a professor",
      emoteLabels: ["wave", "dance"],
    });

    expect(result.suggestedEmoteDescriptions).toBeDefined();
    expect(result.suggestedEmoteDescriptions!["wave"]).toContain("wave");
    expect(result.suggestedEmoteDescriptions!["dance"]).toContain("two-step");
    // unknown-emote not in emoteLabels, should be filtered
    expect(result.suggestedEmoteDescriptions!["unknown-emote"]).toBeUndefined();
  });

  it("handles AI returning JSON wrapped in code fences", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: "text",
        text: "```json\n" + JSON.stringify(VALID_EXPANSION) + "\n```",
      }],
    });

    const result = await expandPrompt({ adminPrompt: "test" });
    expect(result.expandedFields.name).toBe("Professor Whiskers");
  });

  it("throws on empty AI response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [],
    });

    await expect(expandPrompt({ adminPrompt: "test" })).rejects.toThrow(
      "No text response from AI during prompt expansion",
    );
  });

  it("passes model and sanitized prompt to AI", async () => {
    mockAIResponse(VALID_EXPANSION);

    await expandPrompt({ adminPrompt: "test\x00prompt" });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.stringMatching(/^claude-/),
        messages: [
          expect.objectContaining({
            content: expect.stringContaining("testprompt"),
          }),
        ],
      }),
    );
    // Control char should be stripped
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content).not.toContain("\x00");
  });
});
