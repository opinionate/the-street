// Core types for The Street

export interface Vector3 {
  x: number;
  y: number;
  z: number;
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

export interface AvatarDefinition {
  avatarIndex: number; // index into default avatar set (0-5 for V1)
}

export interface PlayerState {
  userId: string;
  displayName: string;
  avatarDefinition: AvatarDefinition;
  position: Vector3;
  rotation: number;
  velocity: Vector3;
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
