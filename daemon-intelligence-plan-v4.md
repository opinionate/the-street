# Daemon Intelligence Subsystem — Implementation Plan

## Overview

This plan covers the design and implementation of LLM-driven daemon intelligence for The Street, including personality manifests, event-driven inference, inter-daemon interaction, behavioral evolution, and the admin-facing activity log with token accounting.

Daemons are platform-level entities. Only super admins can create, configure, and manage enhanced AI daemons. Inference costs are absorbed by the platform. The admin-facing log and token dashboard exist for operational visibility, not billing.

The system is built around a single constraint: inference only fires on discrete events. Idle behavior costs nothing. The super admin sees everything.

Combat mechanics for daemons are out of scope. Daemons are plot-bound and do not operate in public space.

---

## Architecture Overview

```
+---------------------------------------------------------+
|                     World Event Bus                      |
|  (visitor proximity, speech, daemon-to-daemon)           |
+----------------------------+----------------------------+
                             |
                +------------v--------------+
                |     Behavior Tree          |
                |  (scripted, zero cost)     |
                +------------+--------------+
                             | attention trigger
                +------------v--------------+
                |    Inference Controller    |
                |  (rate limits, budgets,    |
                |   output validation)       |
                +------------+--------------+
                             |
                +------------v--------------+
                |      LLM Brain             |
                |  (manifest + context)      |
                +------------+--------------+
                             | DaemonThought (validated)
           +-----------------+-------------------+
           v                 v                   v
      Speech/Emote     Movement            Activity Log
      (world output)   (world output)      (persistence)
```

---

## Data Models

### Shared Types

```typescript
type UserId = string;
type DaemonId = string;
type EmoteId = string;
type timestamp = number;        // Unix epoch milliseconds

interface Actor {
  actorType: "visitor" | "daemon" | "system";
  actorId: string;
  actorName?: string;
}

interface DaemonEvent {
  eventType: "visitor_speech" | "daemon_speech" | "visitor_proximity"
           | "daemon_proximity" | "visitor_departure" | "daemon_departure"
           | "ambient_crowd" | "ambient_time";
  sourceId: string;
  sourceName?: string;
  speech?: string;
  position?: { x: number; y: number; z: number };
  metadata?: Record<string, unknown>;
  receivedAt: timestamp;
}

interface BudgetStatus {
  dailyCallsUsed: number;
  dailyCallsRemaining: number;
  dailyCapReached: boolean;
  currentSessionTurns: number;
  sessionTurnCapReached: boolean;
  rateLimitWindowCallsRemaining: number;
}

interface ConversationTurn {
  speaker: Actor;
  speech: string;
  emote?: EmoteId;
  movement?: MovementIntent;
  timestamp: timestamp;
}

interface TokenCost {
  callCount: number;
  tokensIn: number;
  tokensOut: number;
  estimatedCostUSD: number;
}
```

### Personality Manifest

Authored by the super admin in natural language, compiled into a structured prompt fragment by the AI Service. Recompiled on admin edits and on accepted manifest amendments.

Daemon behavior — role, personality, social style — is expressed entirely through natural language in the identity fields. There is no role enum. A daemon that should behave as a greeter, bouncer, shopkeeper, or anything else has that behavior described in its voice description and backstory.

```typescript
interface PersonalityManifest {
  daemonId: string;
  version: number;

  identity: {
    name: string;
    voiceDescription: string;
    backstory: string;
  };

  // Compiled by AI Service from admin input.
  // Recompiled on: admin edit, accepted manifest amendment.
  compiledSystemPrompt: string;
  compiledTokenCount: number;   // token length of compiledSystemPrompt
  compiledAt: timestamp;

  interests: string[];
  dislikes: string[];
  mutableTraits: MutableTrait[];
  availableEmotes: EmoteAssignment[];

  behaviorPreferences: {
    crowdAffinity: number;        // -1.0 to 1.0
    territoriality: number;       // 0.0 to 1.0
    conversationLength: "brief" | "moderate" | "extended";
    initiatesConversation: boolean;
  };

  maxConversationTurns: number;
  maxDailyCalls: number;
  dailyBudgetResetsAt: string;    // "00:00" UTC
  rememberVisitors: boolean;
}

interface MutableTrait {
  traitId: string;
  name: string;
  currentValue: string;
  range: string;
  triggerConditions: string;      // natural language; evaluated by lightweight classifier
}

interface EmoteAssignment {
  emoteId: string;
  label: string;
  promptDescription: string;
}
```

### Memory Store

```typescript
interface DaemonMemoryStore {
  daemonId: string;

  // Capped at maxVisitorImpressions; LRU eviction on lastSeen. Evictions logged.
  visitorImpressions: Map<UserId, VisitorImpression>;
  maxVisitorImpressions: number;  // default 200

  daemonRelationships: Map<DaemonId, DaemonRelationship>;

  worldStateContext: WorldStateContext;
}

interface VisitorImpression {
  userId: UserId;
  visitCount: number;
  lastSeen: timestamp;
  impression: string;
  relationshipValence: "hostile" | "neutral" | "warm" | "trusted";
}

interface DaemonRelationship {
  targetDaemonId: DaemonId;
  targetDaemonName: string;
  interactionCount: number;
  lastInteraction: timestamp;
  relationship: string;
  relationalValence: "rival" | "neutral" | "allied" | "subordinate" | "dominant";
}

interface WorldStateContext {
  currentVisitorCount: number;
  nearbyDaemons: { daemonId: DaemonId; name: string }[];
  timeOfDay: string;
  trafficTrend: "rising" | "stable" | "falling";  // relative to same hour yesterday
  assembledAt: timestamp;
}
```

### Inference Response

```typescript
interface DaemonThought {
  speech?: string;
  emote?: EmoteId;
  movement?: MovementIntent;
  addressedTo: "ambient" | UserId | DaemonId;
  internalState: string;          // daemon's subjective reasoning, never spoken aloud
  suppressSpeech?: boolean;
  endConversation?: boolean;      // used for natural endings and context overflow
}

type MovementIntent = "approach" | "retreat" | "idle" | "face" | "patrol";
```

### Conversation Session

Single-visitor in Phase 1. While a session is active, other visitors who speak to the daemon receive a scripted "busy" response and are not added to the session.

```typescript
interface ConversationSession {
  sessionId: string;
  daemonId: string;
  participantId: string;
  participantType: "visitor" | "daemon";
  startedAt: timestamp;
  endedAt?: timestamp;
  turnCount: number;
  status: "active" | "ended_natural" | "ended_timeout" | "ended_budget"
        | "ended_departed" | "ended_context_limit";
}
```

**Session start conditions:**
- Visitor: first direct speech event from a visitor when no session is active.
- Daemon: first routed speech event from another daemon when no session is active.
- Daemon-initiated: if `initiatesConversation` is true and a visitor enters proximity, the greeting inference call opens a new session.

**Session end conditions:**
- Natural: `DaemonThought.suppressSpeech` is true or `endConversation` is true with no pending input.
- Timeout: no speech from participant within 60 seconds (visitor) or 30 seconds (daemon). Measured from last message received.
- Budget: turn count hits `maxConversationTurns` or daily call budget exhausted.
- Departed: participant left proximity radius.
- Context limit: conversation history would exceed the model's context window (see Context Overflow).

**Summarization threshold:** A summarization call fires at session end if turn count is 4 or more. Sessions under 4 turns are too likely to contain only surface-level exchanges to produce a useful impression.

### Activity Log Entry

```typescript
type LogEntryType =
  | "conversation_turn"
  | "conversation_summary"
  | "manifest_amendment"
  | "manifest_recompile"
  | "behavior_event"
  | "inter_daemon_event"
  | "budget_warning"
  | "inference_failure";

interface LogEntry {
  entryId: string;
  daemonId: string;
  type: LogEntryType;
  timestamp: timestamp;
  actors: Actor[];

  tokensIn?: number;
  tokensOut?: number;
  modelUsed?: string;
  inferenceLatencyMs?: number;

  payload: ConversationTurnPayload
         | ConversationSummaryPayload
         | ManifestAmendmentPayload
         | ManifestRecompilePayload
         | BehaviorEventPayload
         | InterDaemonEventPayload
         | BudgetWarningPayload
         | InferenceFailurePayload;
}

interface ConversationTurnPayload {
  sessionId: string;
  speakerType: "visitor" | "daemon" | "self";
  speakerId: string;
  speech: string;
  emoteFired?: EmoteId;
  movement?: MovementIntent;
  internalState: string;          // present only when speakerType is "self"
  addressedTo: "ambient" | UserId | DaemonId;
}

interface ConversationSummaryPayload {
  sessionId: string;
  participantId: string;
  participantType: "visitor" | "daemon";
  duration: number;               // seconds
  turnCount: number;
  impressionGenerated: string;
}

interface ManifestAmendmentPayload {
  triggeringEvent: string;
  triggeringEventType: string;
  traitId: string;
  traitName: string;
  previousValue: string;
  proposedValue: string;
  validatorDecision: "accepted" | "rejected";
  rejectionReason?: string;
}

interface ManifestRecompilePayload {
  reason: "admin_edit" | "amendment_accepted";
  previousVersion: number;
  newVersion: number;
  previousTokenCount: number;
  newTokenCount: number;
}

interface BehaviorEventPayload {
  eventType: string;
  fallbackReason?: string;
  details: Record<string, unknown>;
}

interface InterDaemonEventPayload {
  sessionId: string;
  otherDaemonId: DaemonId;
  otherDaemonName: string;
  speakerDaemonId: DaemonId;
  speech: string;
  emoteFired?: EmoteId;
  internalState: string;          // present only when speakerDaemonId matches the log-owning daemon
}

interface BudgetWarningPayload {
  warningType: "daily_cap_approaching" | "daily_cap_reached" | "turn_limit_reached";
  currentUsage: number;
  limit: number;
}

interface InferenceFailurePayload {
  failureType: "timeout" | "malformed_output" | "service_unavailable" | "rate_limited";
  retryAttempted: boolean;
  fallbackUsed: "scripted" | "silence" | "none";
  rawError?: string;
}
```

---

## Context Overflow

Every inference call has a context budget: the model's context window minus a reserved output allocation. The inference controller tracks the token count of the assembled context before each call.

When the next call's context would exceed the budget, the daemon ends the conversation in character. The inference controller sends one final call with a truncated history (most recent turns only, fitting within budget) and an appended system instruction: "This conversation has gone on a long time. Find a natural, in-character reason to end the conversation now. Set endConversation to true." The daemon produces its farewell, the session ends with status `ended_context_limit`, and summarization fires normally.

The token count of the assembled context is logged on every inference call. The admin can see conversations approaching the limit in the activity log.

---

## Services

### Inference Controller

```typescript
interface InferenceController {
  handleEvent(daemonId: string, event: DaemonEvent): Promise<DaemonThought | null>;
  checkBudget(daemonId: string): BudgetStatus;
  buildContext(daemonId: string, event: DaemonEvent): InferenceContext;
  checkContextOverflow(context: InferenceContext): boolean;
  buildOverflowContext(daemonId: string, event: DaemonEvent): InferenceContext;
  validateOutput(raw: unknown): ValidationResult<DaemonThought>;
  processResponse(daemonId: string, thought: DaemonThought, context: InferenceContext): void;
  getFallbackResponse(daemonId: string, event: DaemonEvent): DaemonThought;
}

interface InferenceContext {
  systemPrompt: string;
  worldStateContext: WorldStateContext;
  visitorImpression?: VisitorImpression;    // present if visitor is known
  daemonRelationship?: DaemonRelationship;  // present if session is daemon-to-daemon
  conversationHistory: ConversationTurn[];
  availableEmotes: EmoteAssignment[];
  budgetRemaining: number;
  event: DaemonEvent;
  assembledTokenCount: number;
  contextBudget: number;
}

interface ValidationResult<T> {
  valid: boolean;
  parsed?: T;
  errors?: string[];
}
```

**Responsibilities:**
- Enforce per-daemon daily call budgets, resetting at `dailyBudgetResetsAt` UTC
- Enforce per-conversation turn limits
- Rate limit: max 5 calls per daemon per 10-second window
- Assemble full context payload with token counting
- Trigger context-overflow conversation ending when approaching the limit
- Validate structured output against `DaemonThought` schema
- Retry on malformed output once, with repair prompt appended. On second failure, scripted fallback and log the failure.
- Fall back to scripted responses on budget exhaustion, rate limiting, or inference failure. Never silence, never an "unavailable" state.

**Output validation checks:**
- Parses as valid JSON
- Required fields present: `addressedTo`, `internalState`
- `addressedTo` is `"ambient"` or a valid participant ID from the current session
- `emote`, if present, exists in `availableEmotes`
- `movement`, if present, is a valid `MovementIntent`
- `speech` does not exceed 500 characters

**Fallback responses** are role-context scripted acknowledgments drawn from the manifest's backstory framing. Logged as behavior events with `eventType: "fallback_used"` and `fallbackReason` populated.

### Manifest Compiler

Called on daemon creation, admin edits, and accepted amendments. Produces a compiled system prompt that:
- Establishes the daemon's voice and personality
- Lists available emotes with usage guidance
- Describes interests and aversions
- Instructs the model to return structured JSON matching `DaemonThought`
- Instructs the model to write `internalState` in the daemon's own voice

Target: under 1,500 tokens for the compiled system prompt. If exceeded, the compiler truncates in this order: mutable trait range descriptions, interest and dislike elaborations, backstory detail. The admin sees `compiledTokenCount` and any truncation warnings in the manifest editor.

Active conversations at recompile time continue with the old prompt until their session ends.

A recompile logs a `manifest_recompile` entry with reason, version transition, previous and new token counts.

### Manifest Service

Owns all mutations to the personality manifest. The admin edits the manifest directly through the management UI. Amendment history is visible in the activity log; reverting an amendment means editing the trait value in the manifest editor and saving, which triggers a recompile logged with reason `admin_edit`.

```typescript
interface ManifestService {
  compile(daemonId: string, reason: ManifestRecompilePayload["reason"]): Promise<void>;
  applyAmendment(daemonId: string, amendment: ManifestAmendmentPayload): Promise<void>;
  getManifest(daemonId: string): PersonalityManifest;
  getVersionHistory(daemonId: string): ManifestVersion[];
}

interface ManifestVersion {
  version: number;
  compiledAt: timestamp;
  reason: ManifestRecompilePayload["reason"];
  compiledTokenCount: number;
}
```

### Memory Service

**Visitor impression compression** — fires at session end if turn count >= 4. One summarization call per qualifying session. Output: 1–2 sentence impression plus relationship valence.

**Daemon relationship update** — fires at inter-daemon session end. Updates relationship records for both daemons.

**Manifest amendment proposal** — fires when the evolution engine determines a trigger condition is met. Output: proposed trait value plus reasoning. Validator checks against manifest constraints before writing. On acceptance, the manifest is updated and a recompile fires.

Impression store is capped at `maxVisitorImpressions`. Eviction is LRU on `lastSeen`. Evictions logged as behavior events.

### Evolution Engine

Monitors event history for trigger conditions. Evaluated at session end and on significant world events.

**Significant world events:**
- Traffic milestone crossed (100, 500, 1,000 unique visitors, etc.)
- Promotion/relegation cycle affecting this daemon's plot

**Built-in trigger condition:**
- Same visitor reaches 5 interactions → impression upgrades to `warm`, optional trait amendment proposed

**Admin-defined trigger conditions:** `MutableTrait.triggerConditions` is evaluated by a lightweight classifier call per trigger event. If the classifier matches, the amendment proposal pipeline fires. The false-positive path (classifier matches, proposal fires, validator rejects) costs two inference calls. This is acceptable given the 30-day cooldown. Both calls are logged so the admin can see when it happens.

Each trigger fires at most once per 30-day window per `traitId`. The cooldown is keyed on `traitId` so editing the trigger condition text does not reset it.

### Activity Log Service

Append-only write path.

```typescript
interface ActivityLogService {
  append(entry: LogEntry): void;
  query(daemonId: string, filters: LogQueryFilters): PaginatedResult<LogEntry>;
  getTokenSummary(daemonId: string, window: "30d" | "90d" | "all"): TokenSummary;
}

interface LogQueryFilters {
  types?: LogEntryType[];
  visitorId?: UserId;
  otherDaemonId?: DaemonId;
  after?: timestamp;
  before?: timestamp;
  sessionId?: string;
  limit?: number;               // default 50
  cursor?: string;
}

interface PaginatedResult<T> {
  entries: T[];
  nextCursor?: string;
  hasMore: boolean;
}

interface TokenSummary {
  window: string;
  conversationTurns: number;
  summarizationCalls: number;
  manifestAmendments: number;
  manifestRecompiles: number;
  inferenceFailures: number;
  tokensIn: number;
  tokensOut: number;
  estimatedCostUSD: number;
  breakdown: {
    conversationTurns: TokenCost;
    summarizationCalls: TokenCost;
    manifestAmendments: TokenCost;
    manifestRecompiles: TokenCost;
  };
}
```

Log retention: entries older than 180 days are archived to cold storage. The query API searches the active window only. Archived entries are retrievable on request.

---

## Behavior Tree

Event-driven, not tick-based. Subscribes to the world event bus and evaluates state transitions per incoming event. A low-frequency ambient timer (one tick per 10 seconds) handles idle behaviors. Zero CPU cost when nothing is happening.

### States

**Idle** — no visitors present, no events pending. Ambient behaviors: patrol within `roamRadius`, examine objects, ambient emotes. Governed by `crowdAffinity` and `territoriality`.

**Attention** — visitor or daemon enters proximity radius. Evaluates whether to hand off to the inference controller. If `initiatesConversation` is true, hands off. Otherwise waits for direct speech.

**In Conversation** — active session with one participant. Routes each incoming speech event from the active participant to the inference controller. Tracks turn count against `maxConversationTurns`. Other visitors who speak during an active session receive a scripted "busy" response. These are logged as behavior events.

**Post-Interaction** — 5-second cooldown after session ends. Fires conversation-end hooks: summarization if turn count >= 4, relationship update if inter-daemon. New conversation requests queue (max 5) during cooldown. Excess queued events are discarded and logged.

### State Transitions

- Idle → Attention: visitor or daemon enters proximity.
- Attention → In Conversation: inference controller returns a greeting, or visitor speaks directly.
- Attention → Idle: visitor or daemon leaves proximity without interaction, after a 10-second hold.
- In Conversation → Post-Interaction: session ends (any end condition).
- Post-Interaction → Idle: cooldown expires, no queued events.
- Post-Interaction → Attention: cooldown expires with a queued proximity event.
- Post-Interaction → In Conversation: cooldown expires with a queued speech event.

Non-participant speech during In Conversation is handled inline without a state transition.

### Event Priority

1. Direct speech from participant already in active session
2. Direct speech from new visitor or daemon
3. Known visitor returning (has existing impression)
4. Unknown visitor entering radius
5. Ambient triggers

---

## Inter-Daemon Interaction

Daemons on the same plot perceive each other through the same event bus as visitors. The inference controller handles inter-daemon exchanges with the same pipeline as visitor exchanges. The context's `daemonRelationship` field is populated with the relationship record for the other daemon instead of a `visitorImpression`.

`DaemonThought.addressedTo` carries the target daemon's ID, routing speech to that daemon's event bus as an incoming speech event. Multi-party scenes emerge naturally: daemon A speaks to daemon B, B receives it as a speech event and responds. Nearby visitors receive all speech via the NPC speech stream.

**Loop prevention:**
- Per-session inter-daemon turn cap: 6 turns per daemon per session
- Session inactivity timeout: 30 seconds from last message
- Global cap: 3 inter-daemon sessions per daemon per hour

Inter-daemon perception is governed by each daemon's `interactionRange`. Two daemons whose ranges overlap will perceive each other regardless of plot boundaries.

---

## Admin-Facing Log UI

A basic log viewer ships with Phase 1. The full UI ships with Phase 4.

### Layout (Full UI — Phase 4)

**Header** — daemon name, manifest version, `compiledTokenCount`, last active timestamp, and token summary dashboard:

```
Last 30 days
------------------------------------
Conversation turns       124
Summarization calls        8
Manifest amendments        2
Inference failures         1

Tokens in             18,400
Tokens out             5,200

Estimated cost           $0.01
------------------------------------
[ 30d ]  [ 90d ]  [ All time ]
```

**Filter bar** — type selector, visitor ID search, date range.

**Event stream** — reverse chronological.

*Conversation turn* — speaker label, speech, emote badge if fired, movement if non-idle, `internalState` in muted style below. Token count right-aligned.

*Conversation summary* — collapsed by default. Participant, duration, turn count, compressed impression, summarization token cost.

*Manifest amendment* — highlighted. Triggering event, trait name, old → new diff, validator decision. Token cost for the proposal call.

*Manifest recompile* — reason, version transition, token count before and after.

*Behavior event* — collapsed disclosure group. Expandable. Fallback-used events tagged with fallback reason.

*Inter-daemon event* — same structure as conversation turn, both daemon names labeled.

*Inference failure* — warning style. Failure type, retry attempted, fallback used. Partial token cost if call returned malformed output.

*Budget warning* — banner style. Current usage against limit.

### Session Grouping

Turns from the same session are grouped under a collapsible session header: participant name, start time, end reason, total turns, total tokens. Expanded view shows all turns in order.

---

## Implementation Phases

### Phase 0 — Daemon Creation

Phase 0 covers the end-to-end flow for creating a daemon: uploading assets, expanding a natural language prompt into manifest fields, reviewing and finalizing, and placing the daemon in the world. It is a prerequisite for all subsequent phases.

#### Asset Pipeline

Character models and emotes are uploaded as FBX files and converted to glTF before being registered in the asset service. glTF is the canonical runtime format; FBX is the authoring format only. The original FBX files are retained for re-export if needed but are never served to clients.

```typescript
interface DaemonAssetUpload {
  uploadId: string;
  daemonId?: string;            // set once the daemon is finalized
  uploadType: "character" | "emote";
  fbxFilename: string;
  label?: string;               // required for emotes; admin-assigned ("wave", "threaten", etc.)
  uploadedAt: timestamp;
  conversionStatus: "pending" | "processing" | "ready" | "failed";
  glTFAssetId?: string;         // set when conversion completes successfully
  validationErrors?: string[];
}
```

**Conversion pipeline per upload:**
1. FBX received, stored to raw upload bucket
2. Conversion job queued: FBX → glTF via server-side converter
3. Validator runs against the converted glTF:
   - Character: single humanoid skeleton, vertex count within budget, textures within resolution limits, rig compatible with the platform's IK system
   - Emote: single animation clip, compatible skeleton, duration within bounds (0.5–8 seconds), loops correctly if flagged as looping
4. On success: glTF registered in the asset service, `glTFAssetId` written to the upload record
5. On failure: `validationErrors` populated, admin notified, FBX retained for correction and re-upload

The admin can upload character and emote FBXs in any order. The creation flow does not gate on all assets being ready; the admin can proceed to prompt expansion while conversions are processing, but finalization requires all uploaded assets to have `conversionStatus: "ready"`.

#### Creation Draft

The creation flow is non-destructive. The admin works against a draft until they explicitly finalize. Drafts are not live daemons and incur no inference cost.

```typescript
interface DaemonCreationDraft {
  draftId: string;
  adminId: string;
  createdAt: timestamp;
  updatedAt: timestamp;

  characterUploadId?: string;   // the selected character asset upload
  emoteUploadIds: string[];     // ordered list of emote upload IDs

  adminPrompt?: string;         // natural language description of the daemon
  expandedFields?: ExpandedManifestFields;
  expansionStatus: "none" | "processing" | "ready" | "failed";

  // Admin-set budget parameters, populated with defaults after expansion
  maxConversationTurns: number; // default: 10
  maxDailyCalls: number;        // default: 200
  dailyBudgetResetsAt: string;  // default: "00:00" UTC
  rememberVisitors: boolean;    // default: true

  status: "draft" | "finalized" | "abandoned";
}

interface ExpandedManifestFields {
  // AI-generated from adminPrompt; all fields editable by admin before finalizing
  name: string;
  voiceDescription: string;
  backstory: string;
  interests: string[];
  dislikes: string[];
  behaviorPreferences: {
    crowdAffinity: number;
    territoriality: number;
    conversationLength: "brief" | "moderate" | "extended";
    initiatesConversation: boolean;
  };
  expansionNotes: string;       // AI's reasoning, shown to admin for transparency
}
```

#### Prompt Expansion

The admin writes a natural language description of the daemon. Length and detail are unconstrained — a sentence or several paragraphs. The AI expands this into the `ExpandedManifestFields` struct.

The expansion prompt instructs the AI to:
- Infer a name if one is not provided, consistent with the described character
- Derive `voiceDescription` as a concise characterization of speech patterns
- Construct `backstory` as a grounding narrative (2–4 sentences) that explains the daemon's presence and role on The Street without contradicting anything stated in the prompt
- Extract explicit interests and dislikes, and infer plausible ones from the character description
- Map described personality traits to the numeric `behaviorPreferences` fields with brief reasoning in `expansionNotes`

The admin sees all expanded fields inline and can edit any of them before finalizing. The expansion is a starting point, not a binding output. The admin can trigger re-expansion with a revised prompt at any time before finalization; re-expansion does not overwrite fields the admin has manually edited unless the admin explicitly clears the manual edits.

`expansionNotes` is shown to the admin as a read-only field explaining the AI's interpretation. It is not stored to the personality manifest.

**Emote labels** from `DaemonAssetUpload.label` are carried through as `EmoteAssignment.label` values. The admin assigns `promptDescription` for each emote during review — a short instruction to the LLM about when to use the emote. The UI pre-populates a suggested `promptDescription` based on the label, which the admin can accept or override.

#### Finalization

When the admin finalizes the draft:
1. All asset uploads must be `conversionStatus: "ready"`. Finalization is blocked otherwise.
2. `ExpandedManifestFields` plus budget parameters are written to a `PersonalityManifest` record.
3. Emote assignments are constructed from upload records and admin-entered `promptDescription` values.
4. The manifest compiler runs, producing `compiledSystemPrompt` and `compiledTokenCount`. Truncation warnings are shown if the compiled prompt exceeds the token target.
5. A `DaemonId` is assigned and the daemon entity is created in the world service as inactive.
6. The draft status is set to `finalized`. The draft is retained as a creation record.

#### World Placement

After finalization, the daemon exists as an entity but is not yet active in the world. The admin places it via the plot management UI by configuring a `DaemonPlacement` record:

```typescript
interface DaemonPlacement {
  daemonId: DaemonId;
  plotUUID: string;
  spawnPoint: { x: number; y: number; z: number }; // position within the plot at activation and on respawn
  facingDirection: number;                          // yaw in degrees
  roamRadius: number;                               // meters from spawn point; bounds idle patrol
  interactionRange: number;                         // meters from spawn point; proximity events fire within this range
  active: boolean;
}
```

- **Spawn point** is where the daemon appears on activation and returns to after deactivation/reactivation. It is the anchor for all range calculations.
- **Roam radius** bounds idle patrol. The daemon will not move beyond this distance from the spawn point during Idle state. Must be less than or equal to `interactionRange`.
- **Interaction range** determines how far the daemon can perceive visitors and other daemons. Proximity events fire when an entity enters this range. If `interactionRange` extends past the plot boundary, the daemon will perceive visitors in adjacent space naturally — no additional routing is required.

The admin activates the daemon after confirming placement. Activation is reversible; deactivating suspends inference, stops the behavior tree, and removes the daemon's visible presence without deleting the entity or its memory store.

Activation is reversible. The admin can deactivate a daemon at any time, which suspends inference and removes the daemon from the world without deleting the entity or its memory store.

#### Phase 0 Exit Criteria

An admin can upload a character FBX and one or more emote FBXs, write a prompt, receive an expanded manifest, review and edit all fields, finalize the daemon, and place it on a plot. An invalid FBX produces specific validation errors and does not block the rest of the creation flow. A finalized daemon that has not yet been placed is inactive and costs nothing.

---

### Phase 1 — Foundation

- Personality manifest schema and storage (super admin only)
- Manifest compiler: fires on create and edit, `compiledTokenCount` written to manifest, truncation warnings in editor
- World state context assembly, injected into every call
- Behavior tree: all four states, event-driven with ambient timer, event queue with depth cap
- Inference controller: context assembly with token counting, budget enforcement, rate limit enforcement, output validation with one retry, scripted fallback on all failure paths
- Context overflow handling: token tracking per call, truncated final call with conversation-ending instruction, `ended_context_limit` session status
- Single-visitor conversation sessions: all start/end conditions, timeout from last message
- Scripted "busy" response for additional visitors during active session
- `DaemonThought` structured output: speech, emote, movement, internalState, endConversation
- Emote system integration: LLM selects from available set, world executes
- NPC speech stream: distinct from player proximity chat, spatially sourced, daemon name prefix
- Activity log service: write path, paginated read API
- Basic log viewer: reverse-chronological stream, per-entry token counts, no filtering or session grouping

**Exit criteria:** A daemon holds a multi-turn, single-visitor conversation. Emotes fire. Every inference call is logged with token count and assembled context size. Malformed output is caught, retried, falls back gracefully. A second visitor speaking to a busy daemon gets a scripted response. A conversation approaching the context window limit ends in character. The admin can view the basic event log. Rate-limited calls fall back to scripted responses.

### Phase 2 — Memory

- Visitor impression store: summarization call at session end (4+ turns), LRU eviction at cap, eviction logging
- Context injection: known visitors get their impression in inference context
- Log retention: 180-day active window, archival beyond
- Per-visitor log filtering in basic log viewer

**Exit criteria:** A daemon recognizes a returning visitor and behaves differently. Impression store stays bounded. The admin can filter the log by visitor ID.

### Phase 3 — Inter-Daemon

- Daemon-to-daemon event routing (same-plot only)
- Daemon relationship store: summarization call at inter-daemon session end, both daemon records updated
- Inter-daemon session management: per-session turn cap, inactivity timeout, hourly session cap
- Inter-daemon log entries in basic log viewer

**Exit criteria:** Two daemons on the same plot interact visibly. Relationship records update after the session. Both logs reflect the exchange. Loop prevention holds.

### Phase 4 — Evolution and Full UI

- Mutable trait schema on manifest
- Evolution engine: built-in triggers, significant world event routing, 30-day cooldown per `traitId`
- Lightweight classifier call for admin-defined trigger conditions
- Amendment proposal pipeline and validator
- Manifest recompile on accepted amendment
- Manifest amendment log entries with diff view
- Full admin log UI: token summary dashboard, filter bar, session grouping, behavior event collapsing, inference failure entries, budget warning entries, manifest version history, recompile entries

**Exit criteria:** A daemon proposes a manifest amendment after a trigger condition is met. The admin sees the diff in the log. The 30-day cooldown prevents repeated amendments from the same trait. The full log UI is complete and self-explanatory.

---

## Cost Model

Token costs estimated at haiku-class pricing as a lower bound. Compilation and amendment proposals may warrant a more capable model; the range column reflects haiku-class (low) and sonnet-class (high) for calls where reasoning quality matters.

| Call Type | Tokens In | Tokens Out | When | Est. Cost Range |
|---|---|---|---|---|
| Conversation turn | 800–1,200 | 100–200 | Per visitor speech event | $0.0002–0.001 |
| Greeting (proximity) | 600–900 | 50–100 | Per new visitor in range | $0.0001–0.0005 |
| Conversation summary | 400–800 | 50–100 | End of session, 4+ turns | $0.0001–0.0005 |
| Trigger classifier | 200–400 | 20–50 | Per evolution trigger eval | $0.00005–0.0002 |
| Manifest amendment | 500–800 | 100–200 | On trigger (after classifier) | $0.0002–0.001 |
| Prompt expansion | 400–800 | 300–600 | Once per daemon creation draft | $0.0002–0.002 |
| Manifest compilation | 300–500 | 200–400 | Per manifest change | $0.0002–0.001 |
| Validation retry | 900–1,400 | 100–200 | On malformed output | $0.0003–0.001 |
| Context overflow farewell | 800–1,200 | 100–200 | Once per overflow session | $0.0002–0.001 |

A daemon handling 20 conversations/day at 4 turns each plus 5 summarization calls runs approximately 90 inference calls daily. At haiku-class pricing: under $0.05/day. Realistic mixed-tier estimate for a busy daemon: $0.10–0.20/day. Daemons nobody talks to cost effectively nothing.

The platform absorbs all inference costs. The admin dashboard exists for operational visibility and manifest tuning, not billing.

---

## Resolved Decisions

**Model selection per call type.** A tiered model approach is used. Conversation turns and greeting calls use a haiku-class model. Manifest compilation, prompt expansion, and amendment proposals use a sonnet-class model. The rationale: conversation turns are high-volume and require fast, cheap responses; compilation and amendment calls are low-volume, run infrequently, and produce outputs that persist — quality matters more than cost there. The `modelUsed` field on each log entry records which model was used, keeping token cost accounting accurate across tiers.

**Cross-plot daemon awareness.** Controlled by the daemon's proximity range. The `interactionRange` and `roamRadius` fields on `DaemonPlacement` (see World Placement in Phase 0) determine how far a daemon can perceive and roam. If the range extends past the plot boundary, it will naturally reach into adjacent space. No separate cross-plot routing layer is needed. The event bus handles proximity by position; range is a parameter on that query.

**Platform-wide daemon budget ceiling.** Managed directly by the super admin, who is the only party who can create daemons and set `maxDailyCalls` per daemon. No automated platform ceiling is needed beyond the super admin's own controls.
