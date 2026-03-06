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

export type DaemonBehaviorType = "greeter" | "shopkeeper" | "guide" | "guard" | "roamer" | "socialite";

export type DaemonMood = "happy" | "neutral" | "bored" | "excited" | "annoyed" | "curious";

export interface DaemonPersonality {
  traits: string[];           // ["friendly", "curious", "witty"]
  backstory: string;          // Brief background story
  speechStyle: string;        // "formal", "casual", "poetic", "gruff", etc.
  interests: string[];        // Topics they enjoy discussing
  quirks: string[];           // Catchphrases, unusual behaviors
}

export interface DaemonBehavior {
  type: DaemonBehaviorType;
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
