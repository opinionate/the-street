# The Street — V1 Build Specification

## Scope

V1 ships: one neighborhood, one ring, AI creation pipeline, staging environment, default avatars, avatar movement and presence, proximity text chat, persistence, and the attribution registry.

V1 does not ship: multiple rings, promotion/relegation, combat, teleport-out, ignore system, advanced daemons, monorail, crowd pressure system, jury moderation, event hosting, cross-plot interactions, governance framework, voice audio, the overflow layer, or CSG mesh generation.

The V1 test: a non-technical person describes a building, sees it appear, walks down The Street, encounters another person's build, and initiates unprompted interaction with that person.

---

## Infrastructure

### Hosting

| Component | Service | Region |
|---|---|---|
| Game server | AWS EC2 (single instance) or ECS Fargate | us-east-1 |
| Database | Railway Postgres | US East |
| Cache | Railway Redis | US East |
| Asset storage | AWS S3 (content-addressed) | us-east-1 |
| CDN | Cloudflare (in front of S3) | Edge |
| Static client | Cloudflare Pages | Edge |
| Auth | Clerk | Managed |
| AI generation | Anthropic API (Claude) | Managed |
| 3D mesh generation | Meshy API (Meshy-6, text-to-3D + image-to-3D) | Managed |

### Repository Structure

Monorepo using Turborepo.

```
the-street/
├── packages/
│   ├── client/          # Three.js + TypeScript + Vite
│   ├── server/          # Colyseus game server (Node.js)
│   ├── shared/          # Types, schemas, protocols, building codes
│   ├── ai-service/      # AI generation pipeline (stateless)
│   └── asset-pipeline/  # Upload, validate, store, attribute
├── turbo.json
├── package.json
└── tsconfig.base.json
```

---

## Data Model

### Database Schema (Railway Postgres)

#### users

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  private_key_encrypted TEXT NOT NULL,
  avatar_definition JSONB NOT NULL,
  last_position JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ
);
```

The keypair is generated server-side at registration. The private key is encrypted at rest using a single master encryption key (see Security section). The public key signs creation records. This preserves decentralization optionality per the PRD.

`last_position` is a JSONB column storing `{x, y, z, rotation}`. Nullable — null means "place at default spawn point." The game server writes player positions here every 30 seconds and on disconnect.

#### plots

```sql
CREATE TABLE plots (
  uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id),
  neighborhood TEXT NOT NULL DEFAULT 'origin',
  ring INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (neighborhood, ring, position)
);
```

V1 has one neighborhood (`origin`) and one ring (`0`). The schema supports the full addressing system from day one. `position` is an integer index within the ring for that neighborhood.

#### world_objects

```sql
CREATE TABLE world_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plot_uuid UUID NOT NULL REFERENCES plots(uuid),
  name TEXT NOT NULL,
  description TEXT,
  tags TEXT[],
  object_definition JSONB NOT NULL,
  state_data JSONB NOT NULL DEFAULT '{}',
  render_cost NUMERIC NOT NULL,
  origin_x FLOAT NOT NULL,
  origin_y FLOAT NOT NULL,
  origin_z FLOAT NOT NULL,
  scale_x FLOAT NOT NULL DEFAULT 1,
  scale_y FLOAT NOT NULL DEFAULT 1,
  scale_z FLOAT NOT NULL DEFAULT 1,
  rotation_x FLOAT NOT NULL DEFAULT 0,
  rotation_y FLOAT NOT NULL DEFAULT 0,
  rotation_z FLOAT NOT NULL DEFAULT 0,
  rotation_w FLOAT NOT NULL DEFAULT 1,
  asset_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_by UUID NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_world_objects_plot ON world_objects(plot_uuid);
CREATE INDEX idx_world_objects_asset ON world_objects(asset_hash);
```

`object_definition` stores the full `WorldObject` interface as JSON, including mesh definition, materials, interactions, animations, physics profile, LOD levels, and behavioral primitives. This is the canonical representation the client deserializes to render and execute the object.

`state_data` stores the runtime persistent state for interactive objects (door open/closed, display content, container contents). Separate from the definition so state changes don't rewrite the full object.

#### assets

```sql
CREATE TABLE assets (
  content_hash TEXT PRIMARY KEY,
  creator_id UUID NOT NULL REFERENCES users(id),
  creator_public_key TEXT NOT NULL,
  signature TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  dependencies TEXT[],
  adoption_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assets_creator ON assets(creator_id);
```

This is the attribution registry. `content_hash` is the SHA-256 of the asset binary (glTF .glb). `signature` is the hash signed by the creator's private key. `dependencies` is an array of other `content_hash` values this asset references. `adoption_count` tracks how many times this asset has been placed by other users.

#### plot_metrics

```sql
CREATE TABLE plot_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plot_uuid UUID NOT NULL REFERENCES plots(uuid),
  visitor_id UUID NOT NULL REFERENCES users(id),
  entered_at TIMESTAMPTZ NOT NULL,
  exited_at TIMESTAMPTZ,
  dwell_seconds INTEGER,
  visit_type TEXT NOT NULL DEFAULT 'normal'
);

CREATE INDEX idx_plot_metrics_plot ON plot_metrics(plot_uuid);
CREATE INDEX idx_plot_metrics_visitor ON plot_metrics(visitor_id);
CREATE INDEX idx_plot_metrics_entered ON plot_metrics(entered_at);
```

V1 collects this data from day one even though promotion/relegation doesn't ship until V1.2. `visit_type` captures signal quality: `normal`, `rapid_exit` (sub-5-second visit), `repeat` (visitor has been before). This data feeds the composite score calculations when they activate.

#### chat_messages

```sql
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  position_x FLOAT NOT NULL,
  position_y FLOAT NOT NULL,
  position_z FLOAT NOT NULL,
  neighborhood TEXT NOT NULL,
  ring INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_location ON chat_messages(neighborhood, ring, created_at);
```

Proximity text chat. Messages are spatially tagged. The client filters to show only messages within a configurable radius of the viewer.

#### staging_objects

```sql
CREATE TABLE staging_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  tags TEXT[],
  object_definition JSONB NOT NULL,
  state_data JSONB NOT NULL DEFAULT '{}',
  render_cost NUMERIC NOT NULL,
  origin_x FLOAT NOT NULL,
  origin_y FLOAT NOT NULL,
  origin_z FLOAT NOT NULL,
  scale_x FLOAT NOT NULL DEFAULT 1,
  scale_y FLOAT NOT NULL DEFAULT 1,
  scale_z FLOAT NOT NULL DEFAULT 1,
  rotation_x FLOAT NOT NULL DEFAULT 0,
  rotation_y FLOAT NOT NULL DEFAULT 0,
  rotation_z FLOAT NOT NULL DEFAULT 0,
  rotation_w FLOAT NOT NULL DEFAULT 1,
  asset_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_staging_objects_creator ON staging_objects(creator_id);
```

Separate table from `world_objects`. Staging objects are ephemeral drafts — they are never visible in the live world. The publish flow copies validated staging objects to `world_objects` and deletes the staging records atomically. This prevents staged objects from leaking into the live world.

#### moderation_log

```sql
CREATE TABLE moderation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  moderator_id UUID NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  action TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Platform-operator moderation with documented reasoning, establishing precedent per the PRD's bootstrap sequence. `target_type` is `user`, `plot`, or `object`. `action` is `warn`, `remove_object`, `suspend_user`, or `remove_plot`.

---

## Authentication

Clerk handles auth. Flow:

1. User signs up or signs in via Clerk (passkeys or magic link).
2. On first registration, the server generates an Ed25519 keypair.
3. Public key stored in `users.public_key`. Private key encrypted with a server-side master key, stored in `users.private_key_encrypted`.
4. Clerk webhook fires on user creation, triggering keypair generation.
5. Clerk session token is passed with every WebSocket connection and API request.
6. Server validates the Clerk token and resolves to a `user_id` on every request.

No passwords. No OAuth with third parties. Clerk manages all session handling.

### Launch Cohort Gating

V1 is invite-only. Clerk is configured with an email allowlist. The 56 launch cohort members are pre-registered by email address. Users not on the allowlist see a "The Street is invite-only during launch" page. A public waitlist form (Clerk signup without access grant) captures interest for future cohorts.

---

## World Geometry (V1)

V1 is one ring, one neighborhood. The ring is a circle. Plots are evenly spaced along the circle. The geometry is defined as:

```typescript
// shared/src/world-geometry.ts

interface WorldConfig {
  ringRadius: number;           // radius of the single ring in world units
  plotWidth: number;            // frontage width of each plot
  plotDepth: number;            // depth of each plot (away from the street)
  plotHeight: number;           // max build height
  streetWidth: number;          // width of the walkable street in front of plots
  plotCount: number;            // total plots on the ring
  plotRenderBudget: number;     // total render cost units per plot
}

// V1 defaults — these are the open decisions from the PRD.
// Starting values, tuned based on what looks right in-engine.
const V1_CONFIG: WorldConfig = {
  ringRadius: 200,              // 200 unit radius circle
  plotWidth: 20,                // 20 unit frontage
  plotDepth: 30,                // 30 units deep
  plotHeight: 40,               // 40 units tall
  streetWidth: 15,              // 15 unit wide street
  plotCount: 56,                // 56 plots for launch cohort
  plotRenderBudget: 500_000,    // total render cost units per plot (tune based on perf testing)
};
```

Plot placement is computed from angular position:

```typescript
function getPlotPosition(index: number, config: WorldConfig): PlotPlacement {
  const angleStep = (2 * Math.PI) / config.plotCount;
  const angle = index * angleStep;
  const centerX = Math.cos(angle) * config.ringRadius;
  const centerZ = Math.sin(angle) * config.ringRadius;
  const facingAngle = angle + Math.PI; // face inward toward street center

  return {
    position: { x: centerX, y: 0, z: centerZ },
    rotation: facingAngle,
    bounds: {
      width: config.plotWidth,
      depth: config.plotDepth,
      height: config.plotHeight,
    },
  };
}
```

The street is the walkable ring between the plot frontages and the center. Users walk clockwise or counterclockwise. The camera faces inward or along the tangent. The street is a continuous loop — walking in one direction returns you to where you started.

---

## Game Server (Colyseus)

### Room Structure

V1 uses a single Colyseus room since there is one ring and one neighborhood. The room manages all connected players, their positions, object state changes, and proximity chat. The room is configured with `maxClients: 100`. If the room is full, new connections receive a "The Street is at capacity, please try again shortly" message. This is consistent with the PRD principle of transparent capacity communication.

```typescript
// server/src/rooms/StreetRoom.ts

import { Room, Client } from "colyseus";

interface PlayerState {
  userId: string;
  displayName: string;
  avatarDefinition: AvatarDefinition;
  position: { x: number; y: number; z: number };
  rotation: number;
  velocity: { x: number; y: number; z: number };
}

interface StreetRoomState {
  players: Map<string, PlayerState>;
  objects: Map<string, WorldObjectState>;
}
```

### Server Responsibilities

The game server is authoritative for:

- Player position validation (anti-cheat: reject impossible movement speeds or positions outside world bounds)
- Object state changes (door toggle, container interactions) — client sends intent, server validates and broadcasts
- Proximity chat relay — server receives message with sender position, broadcasts to all clients within chat radius
- Plot boundary enforcement — the server knows which plot a player is standing on and tracks entry/exit for metrics
- Visit tracking — on plot entry, the server writes to `plot_metrics`. On exit, it updates `dwell_seconds`

The game server is NOT authoritative for:

- Rendering (client-only)
- Physics for local-only effects (client-predicted)
- AI generation (handled by the AI service)

### WebSocket Protocol

Messages between client and server:

```typescript
// shared/src/protocol.ts

// Client -> Server
type ClientMessage =
  | { type: "move"; position: Vector3; rotation: number }
  | { type: "interact"; objectId: string; interaction: InteractionType }
  | { type: "chat"; content: string }
  | { type: "object_place"; plotUUID: string; objectDefinition: WorldObject }
  | { type: "object_remove"; objectId: string }
  | { type: "object_update_state"; objectId: string; stateKey: string; stateValue: unknown };

// Server -> Client
type ServerMessage =
  | { type: "player_join"; player: PlayerState }
  | { type: "player_leave"; userId: string }
  | { type: "player_move"; userId: string; position: Vector3; rotation: number }
  | { type: "object_state_change"; objectId: string; stateData: Record<string, unknown> }
  | { type: "object_placed"; objectId: string; plotUUID: string; objectDefinition: WorldObject }
  | { type: "object_removed"; objectId: string }
  | { type: "chat"; senderId: string; senderName: string; content: string; position: Vector3 }
  | { type: "world_snapshot"; players: PlayerState[]; plots: PlotSnapshot[] };
```

On connect, the server sends a `world_snapshot` with all current players and all plot data for the visible area. The client uses this to hydrate the scene. After that, incremental updates only.

### Tick Rate

Server tick rate: 20Hz (50ms). Player position updates are batched and broadcast every tick. Object state changes are broadcast immediately. Chat messages are broadcast immediately.

---

## Client (Three.js)

### Stack

- Three.js for rendering
- Vite for build tooling
- TypeScript throughout
- Colyseus client SDK for WebSocket connection

### Scene Graph Structure

```
Scene
├── StreetGeometry (the walkable ring surface)
├── PlotGroup[0..N]
│   ├── PlotBoundary (wireframe in edit mode, invisible in play mode)
│   └── WorldObjects (meshes loaded from glTF or generated)
├── AvatarGroup
│   ├── LocalPlayer
│   └── RemotePlayers[0..N]
├── Lighting
│   ├── AmbientLight
│   ├── DirectionalLight (sun)
│   └── PlotLights (per-plot emissive sources)
└── Sky
```

### Rendering Pipeline

1. On load: connect to Colyseus room, receive world snapshot.
2. Generate street ring geometry procedurally from `WorldConfig`.
3. For each plot in snapshot: load its objects. Objects with an `asset_hash` fetch glTF from CDN (archetype primitives or Meshy-generated novel meshes). Objects currently generating display as translucent placeholder bounding boxes (see Generation Placeholder UX).
4. Place default avatars for each connected player at their reported position.
5. Enter game loop: process input, send movement to server, interpolate remote players, render frame.

### Camera

Third-person camera following the local player. Camera stays on the street side of plots, looking along the tangent of the ring with the ability to rotate and look at plot frontages. Camera collision prevents clipping through builds.

### Input Mapping (V1 — Mouse/Keyboard)

```typescript
const V1_INPUT_MAP = {
  move: { keys: ["W", "A", "S", "D"], type: "move" },
  select: { keys: ["E"], mouse: "left_click", type: "select" },
  inspect: { keys: ["Q"], type: "inspect" },
  chat: { keys: ["Enter"], type: "speak" },
  menu: { keys: ["Escape", "Tab"], type: "menu" },
};
```

This maps to the `InputIntent` abstraction from the PRD. Future clients remap these without touching world logic.

### Asset Loading

All assets are glTF (.glb). Loaded via Three.js `GLTFLoader`. Content-addressed URLs resolve as:

```
https://cdn.thestreet.world/assets/{content_hash}.glb
```

The CDN serves from the S3 bucket. Cache headers set to immutable (content-addressed = the hash IS the cache key).

### Proximity Chat UI

A text input anchored to the bottom of the viewport. Messages from other players appear as floating text above their avatar, fading with distance. Messages beyond chat radius are not shown. Chat radius is a constant (e.g., 30 world units). Messages persist for a configurable duration (e.g., 8 seconds) then fade.

---

## AI Creation Pipeline

This is the core of V1. The quality of this system determines whether the launch cohort produces work worth showing.

### Flow

```
User types natural language description
        │
        ▼
Client sends description + plot context to AI Service
        │
        ▼
AI Service constructs prompt:
  - System prompt (role, constraints, output format)
  - Full WorldObject schema
  - Universal building code rules
  - Launch neighborhood building code rules
  - Current plot state (existing objects, remaining render budget)
  - Few-shot examples of well-formed objects
  - Validation rules (max vertex count, max texture size, required fields)
        │
        ▼
Anthropic API (Claude) generates:
  - TypeScript WorldObject definition
  - Mesh description (archetype reference OR novel description)
        │
        ▼
Validator checks:
  - Schema conformance (all required fields present, types correct)
  - Building code compliance (PBR materials, grounded, no boundary violations,
    emissive within limits, collider matches visual geometry)
  - Render budget (renderCost fits within plot's remaining budget)
  - Physics sanity (mass > 0 for non-static, friction/restitution in range)
        │
        ▼
If invalid: feed errors back to Claude, regenerate (max 3 retries)
        │
        ▼
If valid, route mesh:
  A) Archetype match → select base mesh from platform primitives library,
     apply material/scale/parameter overrides from the generated definition
  B) Novel object → send description to Meshy API (text-to-3D, Meshy-6 model,
     enable_pbr=true, target_polycount=30000), receive glTF,
     validate polygon count and materials
        │
        ▼
Compute content hash of final glTF binary
Sign creation record with user's private key
Store in S3 (content-addressed)
Write to assets table (attribution registry)
        │
        ▼
Send WorldObject definition + asset_hash back to client
Client places object, server broadcasts to all connected clients
Write to world_objects table
```

### Generation Placeholder UX

Novel mesh generation via Meshy takes 30-90 seconds. During this time, the client displays a placeholder:

- A translucent bounding box matching the object's declared dimensions
- Shimmer/pulse effect to indicate generation in progress
- Object name floating above the placeholder (e.g., "Building... Steve's Bookshop")
- Visible to all connected players — creation is a social spectacle

When the glTF is ready, the placeholder swaps to the final mesh with a brief fade transition. If generation fails after retries, the placeholder is removed and the user receives an error with the option to retry or revise their description.

### AI Service Implementation

```typescript
// ai-service/src/generate.ts

interface GenerationRequest {
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

interface GenerationResult {
  objectDefinition: WorldObject;
  meshRoute: "archetype" | "novel";
  archetypeId?: string;        // if meshRoute === "archetype"
  novelDescription?: string;   // if meshRoute === "novel"
  validationErrors: string[];
}
```

The AI service is stateless. Every request includes the full context needed to generate. No conversation history, no session state.

### System Prompt Structure

The system prompt sent to Claude for each generation request:

```
You are the build engine for The Street, a persistent shared virtual world.

You generate WorldObject definitions in TypeScript that conform exactly to the
provided schema. Every object must comply with the universal building code and
the neighborhood building code provided below.

OUTPUT FORMAT:
Return a single JSON object matching the GenerationResult interface.
Do not include markdown fences or explanation text.

SCHEMA:
{full WorldObject interface}

UNIVERSAL BUILDING CODE:
- All materials must use PBR (baseColor, metallic, roughness, opacity required)
- No custom shaders, no unlit surfaces
- Collider shape must approximate visual geometry
- Object must connect to ground plane (origin.y >= 0, geometry touches y=0)
- Minimum opacity: 0.1 (no fully invisible objects)
- Maximum emissive brightness: 2.0
- No geometry extending past plot boundaries: {plotBounds}
- Signage: max 2 signs per object, max 128 characters per sign

NEIGHBORHOOD CODE (origin):
- No additional constraints beyond universal code for launch neighborhood

CURRENT PLOT STATE:
- Existing objects: {summary}
- Remaining render budget: {number}
- Plot bounds: {width} x {depth} x {height}

EXAMPLES:
{3-5 few-shot examples of well-formed WorldObject JSON}

VALIDATION RULES:
- Max vertex count per object: 50,000
- Max texture resolution: 2048x2048
- renderCost must be declared and must not exceed remaining budget
- physics.mass must be > 0 for non-static objects
- physics.friction must be 0.0-1.0
- physics.restitution must be 0.0-1.0
```

### Platform Primitives Library (std: namespace)

V1 ships with a curated set of platform primitives. Each is a pre-built glTF asset with a TypeScript class defining its parameters and interaction hooks.

Categories for V1:

- **Structural**: walls, floors, ceilings, columns, beams, stairs, ramps, roofs (flat, pitched, domed)
- **Doors and windows**: standard door, double door, sliding door, window (various sizes), garage door
- **Furniture**: table, chair, desk, shelf, bench, bed, couch, counter
- **Lighting**: ceiling light, floor lamp, wall sconce, spotlight, lantern
- **Vegetation**: tree (3 variants), bush, grass patch, flower bed, potted plant
- **Props**: sign, screen/display, crate, barrel, trash can, mailbox, fire hydrant, lamp post
- **Terrain**: ground tile, path tile, curb, planter box

Each primitive has:

```typescript
interface PlatformPrimitive {
  id: string;                  // "std:door", "std:tree_oak", etc.
  category: string;
  defaultMesh: string;         // content_hash of the default glTF
  variants: string[];          // e.g., ["colonial", "modern", "industrial"]
  parameters: ParameterDef[];  // width, height, material, color, etc.
  interactions: InteractionType[];
  defaultRenderCost: number;
}
```

When the AI identifies that a user's description matches a known archetype, it references the `std:` primitive and specifies parameter overrides rather than generating a novel mesh. This is faster, cheaper, and produces more consistent results.

### Building Code Validator

```typescript
// shared/src/validator.ts

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

interface ValidationError {
  code: string;
  field: string;
  message: string;
  severity: "error" | "warning";
}

function validateWorldObject(
  obj: WorldObject,
  plotBounds: BoundingBox,
  remainingBudget: number,
  universalCode: BuildingCodeRules,
  neighborhoodCode: NeighborhoodCodeRules
): ValidationResult;
```

Validation checks, in order:

1. **Schema conformance** — all required fields present, correct types.
2. **PBR compliance** — every material has baseColor, metallic, roughness, opacity. No unlit surfaces.
3. **Ground plane connection** — bounding box minimum y <= 0.01 (tolerance for floating point).
4. **Boundary containment** — bounding box fits within plot bounds at the specified origin/scale/rotation.
5. **Collider match** — collider shape approximates mesh bounding box (within 20% volume tolerance).
6. **Emissive limits** — emissive brightness <= 2.0.
7. **Opacity minimum** — no material with opacity < 0.1.
8. **Render budget** — renderCost <= remainingBudget.
9. **Vertex count** — mesh vertex count <= 50,000.
10. **Texture size** — no texture exceeds 2048x2048.
11. **Physics sanity** — mass > 0 if not static, friction and restitution in [0, 1].
12. **Signage** — max 2 display-type interactions, text content <= 128 chars each.
13. **Neighborhood code** — additional material, color, height, or style constraints if any exist.

---

## Staging Environment

Every creator gets a private staging environment where they can build and iterate before publishing to the live world.

The staging environment provides the full AI creation pipeline and the same render/compute budget as the live plot. Staging exists as a separate Colyseus room per user, not connected to the shared world. Only the creator can see their staging environment.

```typescript
// server/src/rooms/StagingRoom.ts

// One room per creator. No other players. Full toolset.
// Objects placed here are not persisted to the live world_objects table.
// They are stored in a staging_objects table with the same schema.
// When the creator publishes, staging objects are validated against
// building codes and copied to the live plot.
```

### Publish Flow

1. Creator finishes building in staging.
2. Creator triggers "publish to plot."
3. Server validates all staged objects against building codes and budget.
4. If valid: atomically replaces all objects on the live plot with the staged set. Old objects are archived (soft delete). New objects are broadcast to all connected clients.
5. If invalid: returns validation errors. Creator fixes in staging.

This means creators never break the live world while iterating. They can experiment freely in staging and publish only when ready.

---

## Avatar System (V1)

V1 ships default avatars only. No AI customization (that's V1.1).

### Default Avatar Set

4–6 pre-built humanoid avatars. Each is a glTF file with a standardized skeleton. Variations in body type, skin tone, and clothing to provide minimal choice without implying a customization system that doesn't exist yet.

The skeleton:

```typescript
interface AvatarSkeleton {
  // Standard humanoid rig
  bones: [
    "root", "hips", "spine", "chest", "neck", "head",
    "shoulder_l", "upper_arm_l", "lower_arm_l", "hand_l",
    "shoulder_r", "upper_arm_r", "lower_arm_r", "hand_r",
    "upper_leg_l", "lower_leg_l", "foot_l",
    "upper_leg_r", "lower_leg_r", "foot_r"
  ];
}
```

### Animation State Machine

```typescript
type AvatarAnimState =
  | "idle"
  | "walk"
  | "run"
  | "turn_left"
  | "turn_right";
```

V1 has five states. Animations are baked into the default avatar glTF files. Transitions are blended client-side (Three.js `AnimationMixer` with crossfade).

Movement speed thresholds determine state: standing still = idle, below threshold = walk, above = run. Turn states trigger when rotation changes while stationary.

### Avatar Rendering

Remote players render as their selected default avatar. The server broadcasts which default avatar each player selected (`avatarDefinition` in `PlayerState` for V1 is just an index into the default set). The client loads the corresponding glTF and places it at the server-reported position.

Interpolation: remote player positions are interpolated between server updates (20Hz) to smooth movement. Linear interpolation on position, spherical interpolation on rotation.

---

## Asset Pipeline

### Upload and Attribution

When any asset (generated or uploaded) is finalized:

1. Compute SHA-256 of the glTF binary. This is the `content_hash`.
2. Check if `content_hash` already exists in `assets` table. If yes, this is a duplicate — link to existing record.
3. If new: sign the `content_hash` with the creator's private key. Upload the .glb to S3 at key `assets/{content_hash}.glb`. Write the `assets` record with hash, creator public key, signature, timestamp, and dependency list.
4. When any user places an asset created by someone else, increment `adoption_count` on the original asset record. The client displays attribution (creator name) on inspect.

### Content-Addressed Storage (S3)

```
Bucket: the-street-assets
Key pattern: assets/{sha256_hash}.glb
Content-Type: model/gltf-binary
Cache-Control: public, max-age=31536000, immutable
```

Cloudflare sits in front. Assets are immutable by definition — same hash, same content, forever. Cache is permanent.

---

## API Endpoints

In addition to the Colyseus WebSocket connection, the server exposes REST endpoints for operations that don't need real-time:

### Auth

```
POST /api/auth/register-keypair
  - Called by Clerk webhook on user creation
  - Generates Ed25519 keypair, stores in users table
  - Returns: { publicKey: string }
```

### Plots

```
GET /api/plots
  - Returns all plots with owner info for the current ring/neighborhood
  - Used by client on initial load to render the world

GET /api/plots/:uuid
  - Returns plot detail including all world objects

POST /api/plots/:uuid/publish
  - Publishes staging objects to live plot
  - Validates all objects against building codes
  - Returns: { success: boolean, errors?: ValidationError[] }
```

### AI Generation

```
POST /api/generate
  - Body: GenerationRequest
  - Calls Anthropic API, validates result, routes mesh
  - Returns: GenerationResult with validated WorldObject

POST /api/generate/mesh
  - Body: { route: "novel", description: string }
  - Calls Meshy API text-to-3D (preview stage, then refine stage)
  - Meshy params: ai_model=meshy-6, enable_pbr=true, target_polycount=30000
  - Returns: { contentHash: string, glbUrl: string }
```

### Assets

```
GET /api/assets/:contentHash
  - Returns asset metadata (creator, timestamp, adoption count, dependencies)

GET /api/assets/:contentHash/glb
  - Redirects to CDN URL for the .glb file

POST /api/assets/upload
  - Multipart upload of a .glb file
  - Computes hash, validates format, stores in S3, creates attribution record
  - Returns: { contentHash: string, attributionRecord: AssetRecord }
```

### Metrics

```
GET /api/plots/:uuid/metrics
  - Returns plot owner's own metrics: visit count, avg dwell time, repeat rate
  - Only accessible to the plot owner
  - V1 collects data, display is informational (no promotion/relegation yet)
```

### Moderation

```
POST /api/moderation/action
  - Body: { targetType, targetId, action, reasoning }
  - Platform operator only (V1)
  - Writes to moderation_log with documented reasoning
```

---

## Building Code Rules (V1 Launch Neighborhood)

### Universal Code (enforced)

```typescript
// shared/src/building-codes/universal.ts

const UNIVERSAL_CODE: BuildingCodeRules = {
  materials: {
    requirePBR: true,
    minOpacity: 0.1,
    maxEmissiveBrightness: 2.0,
    noCustomShaders: true,
    noUnlitSurfaces: true,
  },
  geometry: {
    requireGroundConnection: true,
    requireColliderMatch: true,
    colliderVolumeTolerance: 0.2,  // 20%
    maxVerticesPerObject: 50_000,
    maxTextureResolution: 2048,
  },
  placement: {
    mustFitWithinPlotBounds: true,
    noEffectsPastBoundary: true,  // particles, audio, light bleed
  },
  signage: {
    maxSignsPerObject: 2,
    maxCharsPerSign: 128,
  },
  structural: {
    requireCoherence: true,  // no disconnected floating parts
  },
};
```

### Launch Neighborhood Code

```typescript
// shared/src/building-codes/origin.ts

const ORIGIN_NEIGHBORHOOD_CODE: NeighborhoodCodeRules = {
  name: "origin",
  extendsUniversal: true,
  additionalConstraints: {
    // Minimal constraints for launch. Identity emerges from what creators build.
    maxHeightToWidthRatio: 4.0,  // prevents extreme towers that break streetscape
  },
};
```

---

## Persistence Model

### What Persists

- All `world_objects` on live plots (database)
- All `staging_objects` per creator (database)
- All player positions as of last disconnect (database, `users.last_position`)
- All assets in the content-addressed store (S3)
- All attribution records (database)
- All visit metrics (database)
- All moderation actions (database)
- All chat messages (database, retained for moderation review)

### What Does Not Persist

- Real-time player positions (in-memory on game server, lost on restart — players rejoin at last saved position)
- Transient animation states
- Client-side rendering state

### Reconnection

On server restart or player reconnect, the client receives a fresh `world_snapshot` and rebuilds the scene. Object state is loaded from the database. Player positions are loaded from `users.last_position`. The game server writes player positions to the database every 30 seconds and on disconnect.

---

## Security

### Wasm Sandbox (V1 Scope)

V1 does not ship Wasm execution of user scripts. The TypeScript generated by the AI pipeline defines object properties and behavioral primitives (toggle, trigger, container, etc.) which are interpreted by the client and server directly. There is no user-authored code execution in V1.

Wasm sandboxing activates when daemon behavior trees and more complex interactivity ship (V1.1+). The interfaces are designed now but the sandbox runtime is not V1 scope.

### Master Encryption Key

V1 uses a single master encryption key (environment variable) to encrypt all user private keys at rest. This is appropriate for the launch cohort of 56 users. Key rotation is a post-launch concern — when needed, the standard approach is versioned keys: each encrypted private key stores which key version encrypted it, and re-encryption happens lazily on access.

### Server Authority

The game server validates all state-changing actions. The client is a dumb renderer that sends intents. The server:

- Rejects movement that exceeds max speed
- Rejects object placement that fails building code validation
- Rejects interactions with objects the user can't reach (distance check)
- Rejects chat messages that exceed rate limits
- Rejects object modifications on plots the user doesn't own

### Rate Limiting

- AI generation: 10 requests per minute per user
- Chat messages: 1 per second per user
- Object placement: 5 per minute per user
- Asset upload: 3 per minute per user

---

## Deployment

### CI/CD

GitHub Actions. On push to `main`:

1. Lint and typecheck all packages
2. Run shared validation tests (building code validator, schema checks)
3. Build client bundle (Vite)
4. Build server (tsc)
5. Deploy client to Cloudflare Pages
6. Deploy server to EC2/ECS (Docker image pushed to ECR, ECS service updated)

### Environment Variables

```
# Clerk
CLERK_SECRET_KEY=
CLERK_PUBLISHABLE_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=

# Database
DATABASE_URL=               # Railway Postgres connection string

# Redis
REDIS_URL=                  # Railway Redis connection string

# AWS
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET=
AWS_REGION=

# Anthropic
ANTHROPIC_API_KEY=

# Meshy
MESHY_API_KEY=
MESHY_API_URL=https://api.meshy.ai

# Server
MASTER_ENCRYPTION_KEY=      # for encrypting user private keys at rest
COLYSEUS_PORT=2567
API_PORT=3000

# CDN
CDN_BASE_URL=               # https://cdn.thestreet.world
```

### Monitoring

- Colyseus built-in dashboard for room/player counts
- Prometheus metrics exported from the game server (connections, messages/sec, room count, tick duration)
- Grafana dashboards for server health, player activity, AI generation latency, asset pipeline throughput
- Cloudflare analytics for CDN hit rates and client load times
- Railway dashboard for database metrics

---

## V1 Explicit Non-Goals

These are not forgotten. They are deliberately excluded from V1 and accounted for in the architecture so they can be added without rework.

- **Multiple rings** — schema supports it, world geometry supports it, not activated
- **Promotion/relegation** — metrics collection is active from day one, the engine is not
- **Combat** — no PVP, all space is safe in V1
- **Teleport-out** — no adversarial plots to escape from in V1
- **Ignore system** — not needed without combat or adversarial dynamics
- **Daemons** — V1.1
- **AI avatar customization** — V1.1
- **Monorail** — one ring, nowhere to travel
- **Crowd pressure / overflow** — launch cohort won't hit capacity
- **Jury moderation** — platform operator only
- **Event hosting** — no calendar, no promotion system
- **Cross-plot interactions** — no shared doorways or connected interiors
- **Governance** — platform operator makes all decisions with documented reasoning
- **Voice audio** — text chat only
- **Community asset marketplace** — assets exist and are attributed, no browse/search/rating UI
- **CSG mesh generation** — two routes suffice for V1 (archetype + Meshy novel). CSG adds complexity without clear user benefit. Revisit when there's data on what the AI generates and where routes fall short

---

## Resolved Decisions

| Decision | Resolution |
|---|---|
| Renderer | Three.js |
| 3D generation service | Meshy API (Meshy-6 model). Text-to-3D with two-stage pipeline (preview → refine). Native PBR map generation, GLB output, configurable target polycount. ~$0.70-0.80 per model |
| Plot dimensions | 20 x 30 x 40 (W x D x H) in world units |
| Plot count | 56 plots on the single launch ring |

Everything else that's open in the PRD (promotion/relegation counts, ring count at maturity, combat tuning, jury pool size, composite score weights, recency decay rate) is post-V1 and does not block the build.
