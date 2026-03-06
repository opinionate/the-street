import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  PersonalityManifest,
  DaemonEvent,
  ConversationSession,
  ConversationTurn,
  WorldStateContext,
  DaemonThought,
} from "@the-street/shared";

// Mock Redis
const mockRedisGet = vi.fn().mockResolvedValue(null);
const mockRedisIncr = vi.fn().mockResolvedValue(1);
const mockRedisExpire = vi.fn().mockResolvedValue(1);
const mockRedisZremrangebyscore = vi.fn().mockResolvedValue(0);
const mockRedisZcard = vi.fn().mockResolvedValue(0);
const mockRedisZadd = vi.fn().mockResolvedValue(1);
const mockPipelineExec = vi.fn().mockResolvedValue([[null, 0], [null, 0]]);
const mockPipeline = vi.fn(() => ({
  zremrangebyscore: mockRedisZremrangebyscore,
  zcard: mockRedisZcard,
  exec: mockPipelineExec,
}));

vi.mock("../database/redis.js", () => ({
  getRedis: () => ({
    get: mockRedisGet,
    incr: mockRedisIncr,
    expire: mockRedisExpire,
    zadd: mockRedisZadd,
    pipeline: mockPipeline,
  }),
}));

// Mock AI service
const mockCreate = vi.fn();
vi.mock("@the-street/ai-service", () => ({
  getClient: () => ({ messages: { create: mockCreate } }),
  stripJsonFences: (text: string) => {
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json[c]?|JSON)?\n?/, "").replace(/\n?```$/, "");
    }
    return text;
  },
}));

import { runInference, getBudgetStatus } from "../daemons/InferenceController.js";

function makeManifest(overrides: Partial<PersonalityManifest> = {}): PersonalityManifest {
  return {
    daemonId: "daemon-1",
    version: 1,
    identity: {
      name: "TestBot",
      voiceDescription: "Friendly and warm",
      backstory: "A test daemon who loves testing.",
    },
    compiledSystemPrompt: "You are TestBot. Be friendly.",
    compiledTokenCount: 20,
    compiledAt: Date.now(),
    interests: ["testing"],
    dislikes: ["bugs"],
    mutableTraits: [],
    availableEmotes: [
      { emoteId: "wave", label: "Wave", promptDescription: "A friendly wave" },
      { emoteId: "nod", label: "Nod", promptDescription: "A thoughtful nod" },
    ],
    behaviorPreferences: {
      crowdAffinity: 0.5,
      territoriality: 0.2,
      conversationLength: "moderate",
      initiatesConversation: true,
    },
    maxConversationTurns: 10,
    maxDailyCalls: 200,
    dailyBudgetResetsAt: "00:00",
    rememberVisitors: true,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<DaemonEvent> = {}): DaemonEvent {
  return {
    eventType: "visitor_speech",
    sourceId: "visitor-1",
    sourceName: "Alice",
    speech: "Hello there!",
    receivedAt: Date.now(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<ConversationSession> = {}): ConversationSession {
  return {
    sessionId: "session-1",
    daemonId: "daemon-1",
    participantId: "visitor-1",
    participantType: "visitor",
    startedAt: Date.now(),
    turnCount: 0,
    status: "active",
    ...overrides,
  };
}

function makeWorldState(): WorldStateContext {
  return {
    currentVisitorCount: 5,
    nearbyDaemons: [],
    timeOfDay: "afternoon",
    trafficTrend: "stable",
    assembledAt: Date.now(),
  };
}

function mockValidResponse(thought: Partial<DaemonThought> = {}) {
  const body: DaemonThought = {
    addressedTo: "visitor-1",
    internalState: "I should greet them warmly.",
    speech: "Hello! Welcome to the street!",
    ...thought,
  };
  mockCreate.mockResolvedValueOnce({
    content: [{ type: "text", text: JSON.stringify(body) }],
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}

describe("InferenceController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisIncr.mockResolvedValue(1);
    mockPipelineExec.mockResolvedValue([[null, 0], [null, 0]]);
  });

  describe("runInference", () => {
    it("should make a successful inference call and return a thought", async () => {
      mockValidResponse();

      const result = await runInference({
        manifest: makeManifest(),
        event: makeEvent(),
        session: makeSession(),
        conversationHistory: [],
        worldState: makeWorldState(),
      });

      expect(result.thought.speech).toBe("Hello! Welcome to the street!");
      expect(result.thought.addressedTo).toBe("visitor-1");
      expect(result.thought.internalState).toBe("I should greet them warmly.");
      expect(result.logEntry.type).toBe("conversation_turn");
      expect(result.logEntry.modelUsed).toBe("claude-haiku-4-5-20251001");
      expect(result.logEntry.tokensIn).toBe(100);
      expect(result.logEntry.tokensOut).toBe(50);
      expect(result.sessionUpdate?.turnCount).toBe(1);
    });

    it("should include conversation history in messages", async () => {
      mockValidResponse();

      const history: ConversationTurn[] = [
        {
          speaker: { actorType: "visitor", actorId: "visitor-1", actorName: "Alice" },
          speech: "Hi!",
          timestamp: Date.now() - 1000,
        },
        {
          speaker: { actorType: "daemon", actorId: "daemon-1", actorName: "TestBot" },
          speech: "Hello there!",
          timestamp: Date.now() - 500,
        },
      ];

      await runInference({
        manifest: makeManifest(),
        event: makeEvent(),
        session: makeSession({ turnCount: 1 }),
        conversationHistory: history,
        worldState: makeWorldState(),
      });

      const callArgs = mockCreate.mock.calls[0][0];
      // First message should be the visitor's history
      expect(callArgs.messages[0].role).toBe("user");
      expect(callArgs.messages[0].content).toBe("Hi!");
      // Second message should be daemon's history
      expect(callArgs.messages[1].role).toBe("assistant");
      expect(callArgs.messages[1].content).toBe("Hello there!");
    });

    it("should reject when daily budget is exhausted", async () => {
      mockRedisGet.mockResolvedValue("200");

      const result = await runInference({
        manifest: makeManifest({ maxDailyCalls: 200 }),
        event: makeEvent(),
        session: makeSession(),
        conversationHistory: [],
        worldState: makeWorldState(),
      });

      expect(result.thought.endConversation).toBe(true);
      expect(result.logEntry.type).toBe("budget_warning");
      expect(result.sessionUpdate?.status).toBe("ended_budget");
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("should reject when turn limit is reached", async () => {
      const result = await runInference({
        manifest: makeManifest({ maxConversationTurns: 5 }),
        event: makeEvent(),
        session: makeSession({ turnCount: 5 }),
        conversationHistory: [],
        worldState: makeWorldState(),
      });

      expect(result.thought.endConversation).toBe(true);
      expect(result.logEntry.type).toBe("budget_warning");
      expect(result.sessionUpdate?.status).toBe("ended_budget");
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("should reject when rate limited", async () => {
      mockPipelineExec.mockResolvedValue([[null, 0], [null, 5]]);

      const result = await runInference({
        manifest: makeManifest(),
        event: makeEvent(),
        session: makeSession(),
        conversationHistory: [],
        worldState: makeWorldState(),
      });

      expect(result.logEntry.type).toBe("inference_failure");
      expect((result.logEntry.payload as any).failureType).toBe("rate_limited");
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("should validate emotes against availableEmotes", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify({
          addressedTo: "visitor-1",
          internalState: "Thinking...",
          speech: "Hey!",
          emote: "invalid_emote",
        })}],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // Retry with repair prompt - return valid response
      mockValidResponse({ emote: "wave" });

      const result = await runInference({
        manifest: makeManifest(),
        event: makeEvent(),
        session: makeSession(),
        conversationHistory: [],
        worldState: makeWorldState(),
      });

      // Should have retried and got valid result
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.thought.emote).toBe("wave");
    });

    it("should validate movement as MovementIntent", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify({
          addressedTo: "visitor-1",
          internalState: "Thinking...",
          speech: "Hey!",
          movement: "invalid_movement",
        })}],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // Repair response
      mockValidResponse({ movement: "approach" });

      const result = await runInference({
        manifest: makeManifest(),
        event: makeEvent(),
        session: makeSession(),
        conversationHistory: [],
        worldState: makeWorldState(),
      });

      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("should reject speech over 500 chars", async () => {
      const longSpeech = "a".repeat(501);
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify({
          addressedTo: "visitor-1",
          internalState: "State",
          speech: longSpeech,
        })}],
        usage: { input_tokens: 100, output_tokens: 200 },
      });

      // Repair: valid response
      mockValidResponse();

      const result = await runInference({
        manifest: makeManifest(),
        event: makeEvent(),
        session: makeSession(),
        conversationHistory: [],
        worldState: makeWorldState(),
      });

      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("should use scripted fallback after two failures", async () => {
      // First call: invalid JSON
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "not json at all" }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // Repair call: also invalid
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "still not json" }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const result = await runInference({
        manifest: makeManifest(),
        event: makeEvent(),
        session: makeSession(),
        conversationHistory: [],
        worldState: makeWorldState(),
      });

      expect(result.logEntry.type).toBe("behavior_event");
      expect((result.logEntry.payload as any).eventType).toBe("fallback_used");
      expect(result.thought.speech).toBeTruthy();
      expect(result.thought.addressedTo).toBe("visitor-1");
    });

    it("should use scripted fallback on API error after retry fails", async () => {
      mockCreate.mockRejectedValueOnce(new Error("service_unavailable"));
      mockCreate.mockRejectedValueOnce(new Error("service_unavailable"));

      const result = await runInference({
        manifest: makeManifest(),
        event: makeEvent(),
        session: makeSession(),
        conversationHistory: [],
        worldState: makeWorldState(),
      });

      expect(result.logEntry.type).toBe("behavior_event");
      expect((result.logEntry.payload as any).fallbackReason).toBe("service_unavailable");
    });

    it("should set ended_context_limit when context overflows budget", async () => {
      mockValidResponse({ endConversation: false });

      // Create a manifest with very low compiled token count but we'll have tons of history
      const longHistory: ConversationTurn[] = Array.from({ length: 50 }, (_, i) => ({
        speaker: { actorType: i % 2 === 0 ? "visitor" as const : "daemon" as const, actorId: `id-${i}` },
        speech: "A".repeat(200),
        timestamp: Date.now() - (50 - i) * 1000,
      }));

      const result = await runInference({
        manifest: makeManifest(),
        event: makeEvent(),
        session: makeSession(),
        conversationHistory: longHistory,
        worldState: makeWorldState(),
        contextBudget: 10, // Very small budget to trigger overflow
      });

      expect(result.sessionUpdate?.status).toBe("ended_context_limit");
    });

    it("should record modelUsed on log entries", async () => {
      mockValidResponse();

      const result = await runInference({
        manifest: makeManifest(),
        event: makeEvent(),
        session: makeSession(),
        conversationHistory: [],
        worldState: makeWorldState(),
      });

      expect(result.logEntry.modelUsed).toBe("claude-haiku-4-5-20251001");
    });

    it("should handle different event types correctly", async () => {
      mockValidResponse();

      await runInference({
        manifest: makeManifest(),
        event: makeEvent({ eventType: "visitor_proximity", speech: undefined }),
        session: makeSession(),
        conversationHistory: [],
        worldState: makeWorldState(),
      });

      const callArgs = mockCreate.mock.calls[0][0];
      const lastMessage = callArgs.messages[callArgs.messages.length - 1];
      expect(lastMessage.content).toContain("has come nearby");
    });
  });

  describe("getBudgetStatus", () => {
    it("should return correct budget status", async () => {
      mockRedisGet.mockResolvedValue("50");
      mockPipelineExec.mockResolvedValue([[null, 0], [null, 2]]);

      const status = await getBudgetStatus(
        makeManifest({ maxDailyCalls: 200, maxConversationTurns: 10 }),
        makeSession({ turnCount: 3 }),
      );

      expect(status.dailyCallsUsed).toBe(50);
      expect(status.dailyCallsRemaining).toBe(150);
      expect(status.dailyCapReached).toBe(false);
      expect(status.currentSessionTurns).toBe(3);
      expect(status.sessionTurnCapReached).toBe(false);
    });

    it("should report cap reached when at limit", async () => {
      mockRedisGet.mockResolvedValue("200");

      const status = await getBudgetStatus(
        makeManifest({ maxDailyCalls: 200, maxConversationTurns: 10 }),
        makeSession({ turnCount: 10 }),
      );

      expect(status.dailyCapReached).toBe(true);
      expect(status.sessionTurnCapReached).toBe(true);
      expect(status.dailyCallsRemaining).toBe(0);
    });
  });
});
