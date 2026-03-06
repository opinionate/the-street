// Core types for The Street

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface SavedPosition extends Vector3 {
  rotation: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface BoundingBox {
  width: number;
  depth: number;
  height: number;
}

// --- World Objects ---

export interface PBRMaterial {
  baseColor: string; // hex color
  metallic: number; // 0-1
  roughness: number; // 0-1
  opacity: number; // 0.1-1
  emissive?: string; // hex color
  emissiveBrightness?: number; // 0-2
}

export type InteractionType =
  | "toggle" // door open/close, light on/off
  | "trigger" // button press, lever pull
  | "container" // open/close with contents
  | "display" // sign, screen — shows text
  | "sit"; // avatar sits on this object

export interface Interaction {
  type: InteractionType;
  label: string; // "Open", "Sit", etc.
  stateKey: string; // key in state_data
  displayText?: string; // for "display" type, max 128 chars
}

export type PhysicsType = "static" | "dynamic" | "kinematic";

export interface PhysicsProfile {
  type: PhysicsType;
  mass: number; // > 0 for non-static
  friction: number; // 0-1
  restitution: number; // 0-1
  colliderShape: "box" | "sphere" | "capsule" | "mesh";
  colliderSize: Vector3; // approximate dimensions
}

export interface LODLevel {
  distance: number; // camera distance threshold
  vertexReduction: number; // 0-1, fraction of original vertices
}

export interface WorldObject {
  name: string;
  description: string;
  tags: string[];
  materials: PBRMaterial[];
  interactions: Interaction[];
  physics: PhysicsProfile;
  lodLevels: LODLevel[];
  renderCost: number;
  origin: Vector3;
  scale: Vector3;
  rotation: Quaternion;
  meshDefinition: MeshDefinition;
}

export type MeshDefinition =
  | { type: "archetype"; archetypeId: string; parameters: Record<string, unknown> }
  | { type: "novel"; description: string; assetHash?: string };

export interface WorldObjectSummary {
  id: string;
  name: string;
  renderCost: number;
  origin: Vector3;
  bounds: BoundingBox;
}

// --- Plots ---

export interface PlotPlacement {
  position: Vector3;
  rotation: number; // radians, facing angle
  bounds: BoundingBox;
}

export interface PlotSnapshot {
  uuid: string;
  ownerId: string;
  ownerName: string;
  neighborhood: string;
  ring: number;
  position: number;
  placement: PlotPlacement;
  objects: WorldObject[];
}

// --- Avatars ---

export type AvatarAnimState = "idle" | "walk" | "run" | "turn_left" | "turn_right";

export interface AvatarAppearance {
  bodyType: "default" | "slim" | "stocky";
  skinTone: string;       // hex color
  hairStyle: string;      // description
  hairColor: string;      // hex color
  outfit: string;         // description
  outfitColors: string[]; // hex colors
  accessories: string[];  // descriptions
  accentColor: string;    // hex color for glasses glow, etc.
}

export interface AvatarDefinition {
  avatarIndex: number;                  // fallback default avatar
  customAppearance?: AvatarAppearance;  // AI-generated description
  customMeshHash?: string;              // content hash of custom GLB
  uploadedModelId?: string;             // UUID for directly uploaded character models
}

export interface PlayerState {
  userId: string;
  displayName: string;
  avatarDefinition: AvatarDefinition;
  position: Vector3;
  rotation: number;
  velocity: Vector3;
}

// --- Daemons ---

// DaemonBehaviorType removed — roles are now expressed in natural language
// via PersonalityManifest identity fields.

export type DaemonMood = "happy" | "neutral" | "bored" | "excited" | "annoyed" | "curious";

export interface DaemonPersonality {
  traits: string[];           // ["friendly", "curious", "witty"]
  backstory: string;          // Brief background story
  speechStyle: string;        // "formal", "casual", "poetic", "gruff", etc.
  interests: string[];        // Topics they enjoy discussing
  quirks: string[];           // Catchphrases, unusual behaviors
}

export interface DaemonBehavior {
  type?: string;  // Was DaemonBehaviorType enum; now free-form (roles in natural language via manifest)
  greetingMessage?: string;
  farewellMessage?: string;
  interactionRadius: number;
  responses?: Record<string, string>;
  patrolPath?: Vector3[];
  idleMessages?: string[];
  roamingEnabled?: boolean;   // Can leave home plot to wander the street
  roamRadius?: number;        // Max distance from home (default: full ring)
  homePosition?: Vector3;     // Where to return to when recalled
  canConverseWithDaemons?: boolean; // Can talk to other daemons (default true)
}

export interface DaemonDefinition {
  name: string;
  description: string;
  appearance: AvatarAppearance;
  behavior: DaemonBehavior;
  personality: DaemonPersonality;
  plotUuid?: string;
  position: Vector3;
  rotation: number;
  meshDescription?: string;
}

export type DaemonAction = "idle" | "walking" | "talking" | "waving" | "thinking" | "laughing" | "emoting";

export interface DaemonState {
  daemonId: string;
  definition: DaemonDefinition;
  currentPosition: Vector3;
  currentRotation: number;
  currentAction: DaemonAction;
  targetPlayerId?: string;
  targetDaemonId?: string;    // For daemon-daemon interaction
  mood: DaemonMood;
  characterUploadId?: string;  // UUID of uploaded character FBX
  idleAnimationLabel?: string; // Label of emote FBX to use as idle animation
}

// --- Building Codes ---

export interface MaterialRules {
  requirePBR: boolean;
  minOpacity: number;
  maxEmissiveBrightness: number;
  noCustomShaders: boolean;
  noUnlitSurfaces: boolean;
}

export interface GeometryRules {
  requireGroundConnection: boolean;
  requireColliderMatch: boolean;
  colliderVolumeTolerance: number;
  maxVerticesPerObject: number;
  maxTextureResolution: number;
}

export interface PlacementRules {
  mustFitWithinPlotBounds: boolean;
  noEffectsPastBoundary: boolean;
}

export interface SignageRules {
  maxSignsPerObject: number;
  maxCharsPerSign: number;
}

export interface StructuralRules {
  requireCoherence: boolean;
}

export interface BuildingCodeRules {
  materials: MaterialRules;
  geometry: GeometryRules;
  placement: PlacementRules;
  signage: SignageRules;
  structural: StructuralRules;
}

export interface NeighborhoodCodeRules {
  name: string;
  extendsUniversal: boolean;
  additionalConstraints: {
    maxHeightToWidthRatio?: number;
  };
}

// --- Generation ---

export interface GenerationRequest {
  userDescription: string;
  plotUUID: string;
  plotContext: {
    existingObjects: WorldObjectSummary[];
    remainingRenderBudget: number;
    plotBounds: BoundingBox;
  };
  buildingCode: BuildingCodeRules;
  neighborhoodCode: NeighborhoodCodeRules;
}

export interface GenerationResult {
  objectDefinition: WorldObject;
  meshRoute: "archetype" | "novel";
  archetypeId?: string;
  novelDescription?: string;
  validationErrors: string[];
}

// --- Validation ---

export type ValidationSeverity = "error" | "warning";

export interface ValidationError {
  code: string;
  field: string;
  message: string;
  severity: ValidationSeverity;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// --- Platform Primitives ---

export interface ParameterDef {
  name: string;
  type: "number" | "string" | "boolean" | "color";
  default: unknown;
  min?: number;
  max?: number;
  options?: string[];
}

export interface PlatformPrimitive {
  id: string; // "std:door", "std:tree_oak", etc.
  category: string;
  defaultMesh: string; // content_hash of the default glTF
  variants: string[];
  parameters: ParameterDef[];
  interactions: InteractionType[];
  defaultRenderCost: number;
}

// --- User Roles ---

export type UserRole = "user" | "super_admin";

export interface UserProfile {
  userId: string;
  clerkId: string;
  displayName: string;
  role: UserRole;
  avatarDefinition: AvatarDefinition;
}

// --- Assets ---

export interface AssetRecord {
  contentHash: string;
  creatorId: string;
  creatorPublicKey: string;
  signature: string;
  assetType: string;
  s3Key: string;
  fileSizeBytes: number;
  metadata: Record<string, unknown>;
  dependencies: string[];
  adoptionCount: number;
  createdAt: string;
}

// --- Daemon Intelligence ---

export type UserId = string;
export type DaemonId = string;
export type timestamp = number; // Unix epoch milliseconds

export interface Actor {
  actorType: "visitor" | "daemon" | "system";
  actorId: string;
  actorName?: string;
}

export interface PersonalityManifest {
  daemonId: string;
  version: number;

  identity: {
    name: string;
    voiceDescription: string;
    backstory: string;
  };

  compiledSystemPrompt: string;
  compiledTokenCount: number;
  compiledAt: timestamp;

  interests: string[];
  dislikes: string[];
  mutableTraits: MutableTrait[];
  availableEmotes: EmoteAssignment[];

  behaviorPreferences: {
    crowdAffinity: number;       // -1.0 to 1.0
    territoriality: number;      // 0.0 to 1.0
    conversationLength: "brief" | "moderate" | "extended";
    initiatesConversation: boolean;
  };

  maxConversationTurns: number;
  maxDailyCalls: number;
  dailyBudgetResetsAt: string;   // "00:00" UTC
  rememberVisitors: boolean;
}

export interface MutableTrait {
  traitId: string;
  name: string;
  currentValue: string;
  range: string;
  triggerConditions: string;
}

export interface EmoteAssignment {
  emoteId: string;
  label: string;
  promptDescription: string;
}

export interface DaemonEvent {
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

export type MovementIntent = "approach" | "retreat" | "idle" | "face" | "patrol";

export interface DaemonThought {
  speech?: string;
  emote?: string;
  movement?: MovementIntent;
  addressedTo: "ambient" | string; // "ambient", UserId, or DaemonId
  internalState: string;
  suppressSpeech?: boolean;
  endConversation?: boolean;
}

export interface ConversationSession {
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

export interface ConversationTurn {
  speaker: Actor;
  speech: string;
  emote?: string;
  movement?: MovementIntent;
  timestamp: timestamp;
}

export interface BudgetStatus {
  dailyCallsUsed: number;
  dailyCallsRemaining: number;
  dailyCapReached: boolean;
  currentSessionTurns: number;
  sessionTurnCapReached: boolean;
  rateLimitWindowCallsRemaining: number;
}

export interface TokenCost {
  callCount: number;
  tokensIn: number;
  tokensOut: number;
  estimatedCostUSD: number;
}

export interface InferenceContext {
  systemPrompt: string;
  worldStateContext: WorldStateContext;
  visitorImpression?: VisitorImpression;
  daemonRelationship?: DaemonRelationship;
  conversationHistory: ConversationTurn[];
  availableEmotes: EmoteAssignment[];
  budgetRemaining: number;
  event: DaemonEvent;
  assembledTokenCount: number;
  contextBudget: number;
}

export interface InferenceValidationResult<T> {
  valid: boolean;
  parsed?: T;
  errors?: string[];
}

// --- Daemon Memory ---

export interface DaemonMemoryStore {
  daemonId: string;
  visitorImpressions: Map<UserId, VisitorImpression>;
  maxVisitorImpressions: number;
  daemonRelationships: Map<DaemonId, DaemonRelationship>;
  worldStateContext: WorldStateContext;
}

export interface VisitorImpression {
  userId: UserId;
  visitCount: number;
  lastSeen: timestamp;
  impression: string;
  relationshipValence: "hostile" | "neutral" | "warm" | "trusted";
}

export interface DaemonRelationship {
  targetDaemonId: DaemonId;
  targetDaemonName: string;
  interactionCount: number;
  lastInteraction: timestamp;
  relationship: string;
  relationalValence: "rival" | "neutral" | "allied" | "subordinate" | "dominant";
}

export interface WorldStateContext {
  currentVisitorCount: number;
  nearbyDaemons: { daemonId: DaemonId; name: string }[];
  timeOfDay: string;
  trafficTrend: "rising" | "stable" | "falling";
  assembledAt: timestamp;
}

// --- Activity Log ---

export type LogEntryType =
  | "conversation_turn"
  | "conversation_summary"
  | "manifest_amendment"
  | "manifest_recompile"
  | "behavior_event"
  | "inter_daemon_event"
  | "budget_warning"
  | "inference_failure";

export interface LogEntry {
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

export interface ConversationTurnPayload {
  sessionId: string;
  speakerType: "visitor" | "daemon" | "self";
  speakerId: string;
  speech: string;
  emoteFired?: string;
  movement?: MovementIntent;
  internalState: string;
  addressedTo: "ambient" | string;
}

export interface ConversationSummaryPayload {
  sessionId: string;
  participantId: string;
  participantType: "visitor" | "daemon";
  duration: number;
  turnCount: number;
  impressionGenerated: string;
}

export interface ManifestAmendmentPayload {
  triggeringEvent: string;
  triggeringEventType: string;
  traitId: string;
  traitName: string;
  previousValue: string;
  proposedValue: string;
  validatorDecision: "accepted" | "rejected";
  rejectionReason?: string;
}

export interface ManifestRecompilePayload {
  reason: "admin_edit" | "amendment_accepted";
  previousVersion: number;
  newVersion: number;
  previousTokenCount: number;
  newTokenCount: number;
}

export interface BehaviorEventPayload {
  eventType: string;
  fallbackReason?: string;
  details: Record<string, unknown>;
}

export interface InterDaemonEventPayload {
  sessionId: string;
  otherDaemonId: DaemonId;
  otherDaemonName: string;
  speakerDaemonId: DaemonId;
  speech: string;
  emoteFired?: string;
  internalState: string;
}

export interface BudgetWarningPayload {
  warningType: "daily_cap_approaching" | "daily_cap_reached" | "turn_limit_reached";
  currentUsage: number;
  limit: number;
}

export interface InferenceFailurePayload {
  failureType: "timeout" | "malformed_output" | "service_unavailable" | "rate_limited";
  retryAttempted: boolean;
  fallbackUsed: "scripted" | "silence" | "none";
  rawError?: string;
}

// --- Daemon Creation ---

export interface DaemonCreationDraft {
  draftId: string;
  adminId: string;
  createdAt: timestamp;
  updatedAt: timestamp;

  characterUploadId?: string;
  emoteUploadIds: string[];

  adminPrompt?: string;
  expandedFields?: ExpandedManifestFields;
  expansionStatus: "none" | "processing" | "ready" | "failed";

  maxConversationTurns: number;
  maxDailyCalls: number;
  dailyBudgetResetsAt: string;
  rememberVisitors: boolean;

  status: "draft" | "finalized" | "abandoned";
}

export interface ExpandedManifestFields {
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
  expansionNotes: string;
}

export interface DaemonAssetUpload {
  uploadId: string;
  daemonId?: string;
  uploadType: "character" | "emote";
  fbxFilename: string;
  label?: string;
  uploadedAt: timestamp;
  conversionStatus: "pending" | "processing" | "ready" | "failed";
  glTFAssetId?: string;
  validationErrors?: string[];
}

// --- Daemon Placement ---

export interface DaemonPlacement {
  daemonId: DaemonId;
  plotUUID: string;
  spawnPoint: { x: number; y: number; z: number };
  facingDirection: number;
  roamRadius: number;
  interactionRange: number;
  active: boolean;
}
