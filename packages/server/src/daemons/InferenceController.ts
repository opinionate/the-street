import type {
  PersonalityManifest,
  InferenceContext,
  DaemonThought,
  DaemonEvent,
  ConversationTurn,
  ConversationSession,
  BudgetStatus,
  EmoteAssignment,
  VisitorImpression,
  DaemonRelationship,
  WorldStateContext,
  MovementIntent,
  LogEntry,
  Actor,
  ConversationTurnPayload,
  BehaviorEventPayload,
  InferenceFailurePayload,
  BudgetWarningPayload,
  InferenceValidationResult,
} from "@the-street/shared";
import { getClient, stripJsonFences } from "@the-street/ai-service";
import { getRedis } from "../database/redis.js";
import { appendLogEntry } from "../services/ActivityLogService.js";

// Haiku for conversation turns, sonnet for compilation
const CONVERSATION_MODEL = "claude-haiku-4-5-20251001";
const COMPILATION_MODEL = "claude-sonnet-4-6";

const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_CALLS = 5;
const MAX_SPEECH_LENGTH = 500;

// ~4 chars per token approximation (matches manifest-compiler)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const VALID_MOVEMENTS: MovementIntent[] = ["approach", "retreat", "idle", "face", "patrol"];

export interface InferenceResult {
  thought: DaemonThought;
  logEntry: LogEntry;
  sessionUpdate?: Partial<ConversationSession>;
}

export interface InferenceCallOptions {
  manifest: PersonalityManifest;
  event: DaemonEvent;
  session: ConversationSession;
  conversationHistory: ConversationTurn[];
  worldState: WorldStateContext;
  visitorImpression?: VisitorImpression;
  daemonRelationship?: DaemonRelationship;
  contextBudget?: number;
}

// --- Budget tracking ---

function getBudgetDateKey(daemonId: string, resetTime: string): string {
  // Determine the current "budget day" based on resetTime (HH:MM UTC)
  const now = new Date();
  const [resetH, resetM] = resetTime.split(":").map(Number);
  const resetToday = new Date(now);
  resetToday.setUTCHours(resetH, resetM, 0, 0);

  // If we haven't reached today's reset time, we're still in "yesterday's" budget day
  const budgetDate = now < resetToday
    ? new Date(now.getTime() - 86_400_000)
    : now;

  const dateStr = budgetDate.toISOString().slice(0, 10);
  return `daemon:budget:${daemonId}:${dateStr}`;
}

async function getDailyCallCount(daemonId: string, resetTime: string): Promise<number> {
  const redis = getRedis();
  const key = getBudgetDateKey(daemonId, resetTime);
  const val = await redis.get(key);
  return val ? parseInt(val, 10) : 0;
}

async function incrementDailyCallCount(daemonId: string, resetTime: string): Promise<number> {
  const redis = getRedis();
  const key = getBudgetDateKey(daemonId, resetTime);
  const count = await redis.incr(key);
  // Set TTL of 48h to auto-cleanup old keys
  if (count === 1) {
    await redis.expire(key, 48 * 3600);
  }
  return count;
}

// --- Rate limiting (sliding window) ---

async function getRateLimitCount(daemonId: string): Promise<number> {
  const redis = getRedis();
  const key = `daemon:ratelimit:${daemonId}`;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(key, 0, windowStart);
  pipeline.zcard(key);
  const results = await pipeline.exec();

  return (results?.[1]?.[1] as number) ?? 0;
}

async function consumeRateLimit(daemonId: string): Promise<{ allowed: boolean; remaining: number }> {
  const count = await getRateLimitCount(daemonId);
  if (count >= RATE_LIMIT_MAX_CALLS) {
    return { allowed: false, remaining: 0 };
  }

  const redis = getRedis();
  const key = `daemon:ratelimit:${daemonId}`;
  const now = Date.now();
  await redis.zadd(key, now.toString(), `${now}-${Math.random()}`);
  await redis.expire(key, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) + 1);

  return { allowed: true, remaining: RATE_LIMIT_MAX_CALLS - count - 1 };
}

// --- Budget status ---

export async function getBudgetStatus(
  manifest: PersonalityManifest,
  session: ConversationSession,
): Promise<BudgetStatus> {
  const dailyUsed = await getDailyCallCount(manifest.daemonId, manifest.dailyBudgetResetsAt);
  const rateLimitCount = await getRateLimitCount(manifest.daemonId);

  return {
    dailyCallsUsed: dailyUsed,
    dailyCallsRemaining: Math.max(0, manifest.maxDailyCalls - dailyUsed),
    dailyCapReached: dailyUsed >= manifest.maxDailyCalls,
    currentSessionTurns: session.turnCount,
    sessionTurnCapReached: session.turnCount >= manifest.maxConversationTurns,
    rateLimitWindowCallsRemaining: Math.max(0, RATE_LIMIT_MAX_CALLS - rateLimitCount),
  };
}

// --- Context assembly ---

function assembleContext(options: InferenceCallOptions): InferenceContext {
  const {
    manifest,
    event,
    conversationHistory,
    worldState,
    visitorImpression,
    daemonRelationship,
    contextBudget = 4096,
  } = options;

  const systemPrompt = manifest.compiledSystemPrompt;

  const parts: string[] = [
    systemPrompt,
    `\nWORLD STATE:\n- Visitors nearby: ${worldState.currentVisitorCount}\n- Time: ${worldState.timeOfDay}\n- Traffic: ${worldState.trafficTrend}`,
  ];

  if (worldState.nearbyDaemons.length > 0) {
    parts.push(`- Nearby daemons: ${worldState.nearbyDaemons.map(d => d.name).join(", ")}`);
  }

  if (visitorImpression) {
    parts.push(`\nVISITOR IMPRESSION:\n- Visits: ${visitorImpression.visitCount}\n- Feeling: ${visitorImpression.relationshipValence}\n- Notes: ${visitorImpression.impression}`);
  }

  if (daemonRelationship) {
    parts.push(`\nDAEMON RELATIONSHIP:\n- With: ${daemonRelationship.targetDaemonName}\n- Interactions: ${daemonRelationship.interactionCount}\n- Feeling: ${daemonRelationship.relationalValence}\n- Notes: ${daemonRelationship.relationship}`);
  }

  if (manifest.availableEmotes.length > 0) {
    parts.push(`\nAVAILABLE EMOTES:\n${manifest.availableEmotes.map(e => `- ${e.emoteId}: ${e.label}`).join("\n")}`);
  }

  const dailyBudgetNote = `\nBUDGET: You have approximately ${options.contextBudget ?? "unknown"} calls remaining today. Be mindful of this.`;
  parts.push(dailyBudgetNote);

  const assembledSystemPrompt = parts.join("\n");
  const assembledTokenCount = estimateTokens(assembledSystemPrompt)
    + conversationHistory.reduce((sum, t) => sum + estimateTokens(t.speech), 0)
    + estimateTokens(JSON.stringify(event));

  return {
    systemPrompt: assembledSystemPrompt,
    worldStateContext: worldState,
    visitorImpression,
    daemonRelationship,
    conversationHistory,
    availableEmotes: manifest.availableEmotes,
    budgetRemaining: options.contextBudget ?? 0,
    event,
    assembledTokenCount,
    contextBudget,
  };
}

// --- Output validation ---

function validateThought(
  raw: unknown,
  availableEmotes: EmoteAssignment[],
): InferenceValidationResult<DaemonThought> {
  if (!raw || typeof raw !== "object") {
    return { valid: false, errors: ["Output is not a JSON object"] };
  }

  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];

  // Required fields
  if (typeof obj.addressedTo !== "string" || !obj.addressedTo) {
    errors.push("Missing or invalid 'addressedTo'");
  }
  if (typeof obj.internalState !== "string" || !obj.internalState) {
    errors.push("Missing or invalid 'internalState'");
  }

  // Validate speech length
  if (obj.speech !== undefined && obj.speech !== null) {
    if (typeof obj.speech !== "string") {
      errors.push("'speech' must be a string");
    } else if (obj.speech.length > MAX_SPEECH_LENGTH) {
      errors.push(`'speech' exceeds ${MAX_SPEECH_LENGTH} characters`);
    }
  }

  // Validate emote against availableEmotes
  if (obj.emote !== undefined && obj.emote !== null) {
    if (typeof obj.emote !== "string") {
      errors.push("'emote' must be a string");
    } else {
      const validEmoteIds = availableEmotes.map(e => e.emoteId);
      if (validEmoteIds.length > 0 && !validEmoteIds.includes(obj.emote)) {
        errors.push(`'emote' "${obj.emote}" not in available emotes`);
      }
    }
  }

  // Validate movement
  if (obj.movement !== undefined && obj.movement !== null) {
    if (!VALID_MOVEMENTS.includes(obj.movement as MovementIntent)) {
      errors.push(`'movement' "${obj.movement}" is not a valid MovementIntent`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const thought: DaemonThought = {
    addressedTo: obj.addressedTo as string,
    internalState: obj.internalState as string,
    speech: typeof obj.speech === "string" ? obj.speech.slice(0, MAX_SPEECH_LENGTH) : undefined,
    emote: typeof obj.emote === "string" ? obj.emote : undefined,
    movement: VALID_MOVEMENTS.includes(obj.movement as MovementIntent)
      ? (obj.movement as MovementIntent)
      : undefined,
    suppressSpeech: obj.suppressSpeech === true,
    endConversation: obj.endConversation === true,
  };

  return { valid: true, parsed: thought };
}

// --- Scripted fallback ---

function generateFallback(manifest: PersonalityManifest, event: DaemonEvent): DaemonThought {
  // Role-context scripted response from backstory
  const name = manifest.identity.name;
  const fallbackSpeeches = [
    `*${name} seems lost in thought for a moment*`,
    `*${name} glances around uncertainly*`,
    `*${name} pauses, collecting their thoughts*`,
  ];

  const speech = fallbackSpeeches[Math.floor(Math.random() * fallbackSpeeches.length)];

  return {
    speech,
    addressedTo: event.sourceId || "ambient",
    internalState: "Something distracted me... I lost my train of thought.",
    suppressSpeech: false,
    endConversation: false,
  };
}

// --- Build messages for the API call ---

function buildMessages(
  context: InferenceContext,
  isContextOverflow: boolean,
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Add conversation history
  for (const turn of context.conversationHistory) {
    const role = turn.speaker.actorType === "daemon" ? "assistant" as const : "user" as const;
    messages.push({ role, content: turn.speech });
  }

  // Add the current event
  let eventContent = formatEvent(context.event);

  if (isContextOverflow) {
    eventContent += "\n\n[SYSTEM NOTE: This is your final message in this conversation due to context limits. Wrap up gracefully — say a brief goodbye or closing remark. Set endConversation to true.]";
  }

  messages.push({ role: "user", content: eventContent });

  return messages;
}

function formatEvent(event: DaemonEvent): string {
  switch (event.eventType) {
    case "visitor_speech":
      return `[${event.sourceName || event.sourceId} says]: "${event.speech || ""}"`;
    case "daemon_speech":
      return `[Daemon ${event.sourceName || event.sourceId} says]: "${event.speech || ""}"`;
    case "visitor_proximity":
      return `[${event.sourceName || event.sourceId} has come nearby]`;
    case "daemon_proximity":
      return `[Daemon ${event.sourceName || event.sourceId} has come nearby]`;
    case "visitor_departure":
      return `[${event.sourceName || event.sourceId} has walked away]`;
    case "daemon_departure":
      return `[Daemon ${event.sourceName || event.sourceId} has left]`;
    case "ambient_crowd":
      return `[The crowd around you has shifted]`;
    case "ambient_time":
      return `[Time has passed. The atmosphere has changed.]`;
    default:
      return `[An event occurred: ${event.eventType}]`;
  }
}

// --- Main inference call ---

export async function runInference(options: InferenceCallOptions): Promise<InferenceResult> {
  const result = await runInferenceInternal(options);

  // Persist log entry to database (fire-and-forget to avoid blocking inference)
  appendLogEntry(result.logEntry).catch((err) => {
    console.error("[ActivityLog] Failed to persist log entry:", err);
  });

  return result;
}

async function runInferenceInternal(options: InferenceCallOptions): Promise<InferenceResult> {
  const { manifest, event, session } = options;
  const startTime = Date.now();

  // 1. Check daily budget
  const dailyUsed = await getDailyCallCount(manifest.daemonId, manifest.dailyBudgetResetsAt);
  if (dailyUsed >= manifest.maxDailyCalls) {
    return budgetExhaustedResult(manifest, event, session, "daily_cap_reached", dailyUsed);
  }

  // 2. Check turn limit
  if (session.turnCount >= manifest.maxConversationTurns) {
    return budgetExhaustedResult(manifest, event, session, "turn_limit_reached", session.turnCount);
  }

  // 3. Check rate limit
  const rateCheck = await consumeRateLimit(manifest.daemonId);
  if (!rateCheck.allowed) {
    return rateLimitedResult(manifest, event, session);
  }

  // 4. Assemble context
  const budgetRemaining = manifest.maxDailyCalls - dailyUsed;
  const context = assembleContext({ ...options, contextBudget: budgetRemaining });

  // 5. Check context overflow
  const isContextOverflow = context.assembledTokenCount >= context.contextBudget;

  // 6. Make the AI call
  const messages = buildMessages(context, isContextOverflow);
  let thought: DaemonThought;
  let modelUsed = CONVERSATION_MODEL;
  let tokensIn = 0;
  let tokensOut = 0;

  try {
    const result = await callModel(
      context.systemPrompt,
      messages,
      CONVERSATION_MODEL,
    );

    tokensIn = result.tokensIn;
    tokensOut = result.tokensOut;
    modelUsed = result.modelUsed;

    // 7. Validate output
    const validation = validateThought(result.parsed, manifest.availableEmotes);

    if (validation.valid && validation.parsed) {
      thought = validation.parsed;
    } else {
      // 8. Retry once with repair prompt
      const repairResult = await retryWithRepair(
        context,
        result.rawText,
        validation.errors ?? [],
        manifest.availableEmotes,
      );

      if (repairResult.thought) {
        thought = repairResult.thought;
        tokensIn += repairResult.tokensIn;
        tokensOut += repairResult.tokensOut;
        modelUsed = repairResult.modelUsed;
      } else {
        // 9. Use scripted fallback on second failure
        thought = generateFallback(manifest, event);
        return fallbackResult(manifest, event, session, thought, startTime, tokensIn, tokensOut, modelUsed, "malformed_output");
      }
    }
  } catch (err) {
    // API call failed entirely
    const failureType = isTimeoutError(err) ? "timeout" as const : "service_unavailable" as const;

    // Try one retry
    try {
      const retryResult = await callModel(context.systemPrompt, messages, CONVERSATION_MODEL);
      const retryValidation = validateThought(retryResult.parsed, manifest.availableEmotes);

      if (retryValidation.valid && retryValidation.parsed) {
        thought = retryValidation.parsed;
        tokensIn = retryResult.tokensIn;
        tokensOut = retryResult.tokensOut;
        modelUsed = retryResult.modelUsed;
      } else {
        thought = generateFallback(manifest, event);
        return fallbackResult(manifest, event, session, thought, startTime, 0, 0, modelUsed, failureType);
      }
    } catch {
      thought = generateFallback(manifest, event);
      return fallbackResult(manifest, event, session, thought, startTime, 0, 0, CONVERSATION_MODEL, failureType);
    }
  }

  // Increment daily call count
  await incrementDailyCallCount(manifest.daemonId, manifest.dailyBudgetResetsAt);

  const latencyMs = Date.now() - startTime;

  // Build log entry
  const actors: Actor[] = [
    { actorType: "daemon", actorId: manifest.daemonId, actorName: manifest.identity.name },
  ];
  if (event.sourceId) {
    actors.push({
      actorType: event.eventType.startsWith("daemon") ? "daemon" : "visitor",
      actorId: event.sourceId,
      actorName: event.sourceName,
    });
  }

  const payload: ConversationTurnPayload = {
    sessionId: session.sessionId,
    speakerType: "self",
    speakerId: manifest.daemonId,
    speech: thought.speech || "",
    emoteFired: thought.emote,
    movement: thought.movement,
    internalState: thought.internalState,
    addressedTo: thought.addressedTo,
  };

  const logEntry: LogEntry = {
    entryId: crypto.randomUUID(),
    daemonId: manifest.daemonId,
    type: "conversation_turn",
    timestamp: Date.now(),
    actors,
    tokensIn,
    tokensOut,
    modelUsed,
    inferenceLatencyMs: latencyMs,
    payload,
  };

  // Log assembled token count
  console.log(`[InferenceController] daemon=${manifest.daemonId} assembledTokenCount=${context.assembledTokenCount} tokensIn=${tokensIn} tokensOut=${tokensOut} latency=${latencyMs}ms model=${modelUsed}`);

  const sessionUpdate: Partial<ConversationSession> = {
    turnCount: session.turnCount + 1,
  };

  if (isContextOverflow || thought.endConversation) {
    sessionUpdate.status = isContextOverflow ? "ended_context_limit" : "ended_natural";
    sessionUpdate.endedAt = Date.now();
  }

  return { thought, logEntry, sessionUpdate };
}

// --- AI call ---

async function callModel(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  model: string,
): Promise<{ parsed: unknown; rawText: string; tokensIn: number; tokensOut: number; modelUsed: string }> {
  const client = getClient();

  const response = await client.messages.create({
    model,
    max_tokens: 512,
    system: systemPrompt,
    messages,
  });

  const textBlock = response.content.find(b => b.type === "text");
  const rawText = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(stripJsonFences(rawText));
  } catch {
    // Will be handled by validation
  }

  return {
    parsed,
    rawText,
    tokensIn: response.usage.input_tokens,
    tokensOut: response.usage.output_tokens,
    modelUsed: model,
  };
}

// --- Retry with repair prompt ---

async function retryWithRepair(
  context: InferenceContext,
  rawOutput: string,
  errors: string[],
  availableEmotes: EmoteAssignment[],
): Promise<{ thought: DaemonThought | null; tokensIn: number; tokensOut: number; modelUsed: string }> {
  const repairPrompt = `Your previous response was invalid. Errors: ${errors.join("; ")}

Your raw output was:
${rawOutput.slice(0, 500)}

Please respond with ONLY a valid JSON object with these required fields:
- "addressedTo": "ambient" or a specific participant ID (string)
- "internalState": your private inner monologue (string)
Optional fields:
- "speech": what you say (string, max ${MAX_SPEECH_LENGTH} chars)
- "emote": emote ID from [${availableEmotes.map(e => e.emoteId).join(", ")}]
- "movement": one of "approach", "retreat", "idle", "face", "patrol"
- "suppressSpeech": boolean
- "endConversation": boolean`;

  try {
    const messages = [
      ...context.conversationHistory.map(t => ({
        role: (t.speaker.actorType === "daemon" ? "assistant" : "user") as "user" | "assistant",
        content: t.speech,
      })),
      { role: "user" as const, content: formatEvent(context.event) },
      { role: "assistant" as const, content: rawOutput.slice(0, 500) },
      { role: "user" as const, content: repairPrompt },
    ];

    const result = await callModel(context.systemPrompt, messages, CONVERSATION_MODEL);

    const validation = validateThought(result.parsed, availableEmotes);
    if (validation.valid && validation.parsed) {
      return {
        thought: validation.parsed,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        modelUsed: result.modelUsed,
      };
    }

    return { thought: null, tokensIn: result.tokensIn, tokensOut: result.tokensOut, modelUsed: result.modelUsed };
  } catch {
    return { thought: null, tokensIn: 0, tokensOut: 0, modelUsed: CONVERSATION_MODEL };
  }
}

// --- Result builders for edge cases ---

function budgetExhaustedResult(
  manifest: PersonalityManifest,
  event: DaemonEvent,
  session: ConversationSession,
  warningType: "daily_cap_reached" | "turn_limit_reached",
  usage: number,
): InferenceResult {
  const thought = generateFallback(manifest, event);
  thought.endConversation = true;

  const limit = warningType === "daily_cap_reached" ? manifest.maxDailyCalls : manifest.maxConversationTurns;

  const payload: BudgetWarningPayload = {
    warningType,
    currentUsage: usage,
    limit,
  };

  const logEntry: LogEntry = {
    entryId: crypto.randomUUID(),
    daemonId: manifest.daemonId,
    type: "budget_warning",
    timestamp: Date.now(),
    actors: [{ actorType: "daemon", actorId: manifest.daemonId, actorName: manifest.identity.name }],
    modelUsed: CONVERSATION_MODEL,
    payload,
  };

  const sessionUpdate: Partial<ConversationSession> = {
    status: "ended_budget",
    endedAt: Date.now(),
  };

  return { thought, logEntry, sessionUpdate };
}

function rateLimitedResult(
  manifest: PersonalityManifest,
  event: DaemonEvent,
  session: ConversationSession,
): InferenceResult {
  const thought = generateFallback(manifest, event);

  const payload: InferenceFailurePayload = {
    failureType: "rate_limited",
    retryAttempted: false,
    fallbackUsed: "scripted",
  };

  const logEntry: LogEntry = {
    entryId: crypto.randomUUID(),
    daemonId: manifest.daemonId,
    type: "inference_failure",
    timestamp: Date.now(),
    actors: [{ actorType: "daemon", actorId: manifest.daemonId, actorName: manifest.identity.name }],
    modelUsed: CONVERSATION_MODEL,
    payload,
  };

  return { thought, logEntry };
}

function fallbackResult(
  manifest: PersonalityManifest,
  event: DaemonEvent,
  session: ConversationSession,
  thought: DaemonThought,
  startTime: number,
  tokensIn: number,
  tokensOut: number,
  modelUsed: string,
  failureType: "malformed_output" | "timeout" | "service_unavailable",
): InferenceResult {
  const latencyMs = Date.now() - startTime;

  // Log the fallback as a behavior_event
  const behaviorPayload: BehaviorEventPayload = {
    eventType: "fallback_used",
    fallbackReason: failureType,
    details: { originalEvent: event.eventType, sourceId: event.sourceId },
  };

  const logEntry: LogEntry = {
    entryId: crypto.randomUUID(),
    daemonId: manifest.daemonId,
    type: "behavior_event",
    timestamp: Date.now(),
    actors: [{ actorType: "daemon", actorId: manifest.daemonId, actorName: manifest.identity.name }],
    tokensIn,
    tokensOut,
    modelUsed,
    inferenceLatencyMs: latencyMs,
    payload: behaviorPayload,
  };

  console.log(`[InferenceController] FALLBACK daemon=${manifest.daemonId} reason=${failureType} latency=${latencyMs}ms`);

  return { thought, logEntry };
}

function isTimeoutError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes("timeout") || err.message.includes("ETIMEDOUT");
  }
  return false;
}

// Re-export model constants for external use
export { CONVERSATION_MODEL, COMPILATION_MODEL };
