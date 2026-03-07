# The Street - Architecture Document

Generated from full codebase review. Describes the system as-built.

---

## 1. Overview

**The Street** is a multiplayer 3D virtual world where players can build AI-generated objects, create AI-powered NPC "daemons", and interact in real time. It's a turbo monorepo with 5 TypeScript packages managed by pnpm.

**Tech stack:** TypeScript, Three.js (client 3D), Colyseus (WebSocket game server), Express (REST API), PostgreSQL (30 migrations), Redis (rate limiting/budgets), Anthropic Claude API (AI inference), AWS S3 (asset storage), Clerk (authentication).

---

## 2. Package Map

```
packages/
  shared/        # Types, protocol, validator, building codes, world geometry
  client/        # Three.js browser app (Vite)
  server/        # Colyseus rooms + Express REST API
  ai-service/    # Claude API wrappers for generation/conversation/compilation
  asset-pipeline/ # S3 upload with content-addressed hashing + Ed25519 signing
```

### Dependency graph
```
client ──> shared
server ──> shared, ai-service, asset-pipeline
ai-service ──> shared
asset-pipeline ──> (standalone, uses shared types indirectly)
```

---

## 3. Shared Package

**`packages/shared/src/`**

| File | Purpose |
|------|---------|
| `types.ts` | ~600 lines of shared type definitions: WorldObject, DaemonDefinition, PersonalityManifest, AvatarDefinition, PlotDefinition, BuildingCode, conversation types, activity log types, inference types |
| `protocol.ts` | Colyseus message protocol — 40+ message type constants and payload interfaces for client-server communication |
| `validator.ts` | WorldObject validation engine — checks object bounds, material limits, render cost, building code compliance |
| `building-codes.ts` | Per-neighborhood building rules (heights, materials, density) with universal + neighborhood-specific codes |
| `world-geometry.ts` | Polar coordinate → Cartesian conversion, plot layout generation for the circular street ring |
| `index.ts` | Re-exports all public API |

### Key architectural patterns
- **DaemonDefinition** contains personality, behavior, appearance, position — the full spec for an NPC
- **PersonalityManifest** is the compiled system prompt with token count tracking and version history
- **WorldObject** has archetype (parametric) or novel (AI-generated GLB) mesh definitions
- **BuildingCode** system validates objects against neighborhood-specific rules before placement

---

## 4. Client Package

**`packages/client/src/`** — Single-page Three.js application, no framework.

### Entry point: `main.ts` (~1400 lines)
Orchestrates all subsystems. Initializes auth → login → connect to Colyseus → render loop. Wires all UI panels to network callbacks.

### Subsystems

| Directory | Files | Purpose |
|-----------|-------|---------|
| `auth/` | AuthManager | Clerk SDK wrapper — init, sign-in mount, token retrieval |
| `network/` | NetworkManager | Colyseus client — room join, all message handlers (40+ types) |
| `camera/` | CameraController | Third-person camera with lerped follow, collision avoidance |
| `input/` | InputManager | WASD + mouse input, pointer lock, jump, sprint |
| `scene/` | StreetScene | Three.js scene setup — lights, fog, sky |
| `scene/` | StreetGeometry | Procedural ring road + sidewalks from polar geometry |
| `scene/` | PlotRenderer | Plot boundary visualization (borders, owner labels) |
| `scene/` | ObjectRenderer | WorldObject → Three.js mesh — archetype procedural or novel GLB loading |
| `avatar/` | AvatarManager (~1600 lines) | Player avatar system — procedural mannequin fallback, custom GLB model loading, Mixamo bone retargeting, locomotion state machine (idle/walk/run/strafe/turn/jump), emotes, chat bubbles, nameplates |
| `avatar/` | DaemonRenderer (~1800 lines) | Daemon NPC rendering — same features as AvatarManager plus mood indicators, thought bubbles, emote particles |
| `avatar/` | animation-converter | Client-side FBX/GLB → GLB conversion with bone normalization |

### UI Panels (16 files in `ui/`)

| Panel | Toggle | Purpose |
|-------|--------|---------|
| LoginUI | Auto | Clerk sign-in overlay |
| ChatUI | Enter | Proximity chat with /emote autocomplete |
| DaemonChatUI | Click NPC | Floating daemon conversation input |
| CreationPanel | B | AI object generation |
| GalleryPanel | G | Generated object gallery |
| AvatarPanel | F3 | Avatar customization + history |
| DaemonPanel | F7 | Daemon generation + management |
| AdminPanel | F9 | User management (super_admin) |
| DaemonDirectoryPanel | F10 | Global daemon list + edit |
| DaemonCreationPanel | — | 6-step daemon creation wizard |
| DaemonPlacementPanel | — | Admin daemon world placement |
| AnimationPanel | — | Reusable animation slot manager |
| AnimationConverterTool | — | Admin shared animation uploader |
| DefaultModelUploader | — | Admin default avatar uploader |
| TargetingSystem | Tab | Tab-targeting for players/daemons |
| ActivityLogViewer | — | Admin daemon activity log |

### Rendering pipeline
1. `requestAnimationFrame` loop in main.ts
2. Input → player state update → send to server
3. Receive server state → update avatar positions (lerped)
4. AvatarManager/DaemonRenderer animate bones
5. Three.js render pass

---

## 5. Server Package

**`packages/server/src/`**

### Entry point: `index.ts`
Manual `.env` loading, Express app + Colyseus game server on same HTTP server. Registers two room types and mounts REST API routes. Runs migrations on startup. Seeds dev data.

### Colyseus Rooms

| Room | File | Purpose |
|------|------|---------|
| StreetRoom (~900 lines) | `rooms/StreetRoom.ts` | Main multiplayer room — PlayerSchema with position/rotation/animation state, 40+ message handlers, 200ms tick loop, plot proximity tracking, daemon message routing |
| StagingRoom | `rooms/StagingRoom.ts` | Single-player sandbox for editing objects before publishing to main world |

### REST API Routes (`api/`)

| File | Endpoints | Purpose |
|------|-----------|---------|
| auth | POST /register-keypair | Ed25519 keypair generation for asset signing |
| admin | /me, /users, /users/:id/role, /cache-assets | User info and role management |
| assets | GET/POST /assets, /assets/:hash/glb | Asset metadata, CDN redirect, S3 upload |
| gallery | /gallery CRUD | Generated object gallery with local cache |
| generation | POST /generate | AI object generation |
| metrics | /plots/:uuid/metrics | Plot visit analytics |
| moderation | POST /moderation/:action | Moderation action logging |
| plots | /plots, /plots/:uuid, /plots/:uuid/publish | Plot listing, detail, atomic staging→live publish |
| avatar | /avatar/* | Animations, emotes, character upload, history, save, default model |
| animations | /animations/* | Custom animation upload/serve/delete, shared animations |
| daemons | /daemons/* | Daemon CRUD, generation, prompt expansion, manifest compile, activity log, placement |
| asset-cache | /cached-assets/* | SSRF-protected asset downloading with local file cache |

### Daemon System (`daemons/`)

The daemon system is the most complex subsystem in the codebase.

```
DaemonManager (1300+ lines)
  ├── DaemonBehaviorTree (per-daemon FSM)
  │     └── PriorityEventQueue (bounded, sorted)
  ├── ConversationSessionManager (session lifecycle)
  │     └── InferenceController (AI pipeline)
  ├── WorldEventBus (pub/sub)
  └── Services
        ├── VisitorImpressionStore (AI-summarized visitor memory, LRU-200)
        ├── DaemonRelationshipStore (bidirectional daemon relationships)
        ├── DaemonEvolutionEngine (mutable trait triggers)
        └── ActivityLogService (structured event logging)
```

**DaemonManager** is the central orchestrator:
- Loads daemons from DB on room creation
- Runs 2-second tick loop for all daemon behaviors
- Routes player interactions to ConversationSessionManager
- Manages daemon-to-daemon conversations
- Handles roaming, emotions, mood transitions

**DaemonBehaviorTree** implements a 4-state FSM per daemon:
`idle → attention → in_conversation → post_interaction`
Each state has entry/exit actions. Events are processed from a PriorityEventQueue.

**ConversationSessionManager** manages conversation lifecycle:
- Session creation with timeout monitoring (60s idle, 300s absolute)
- Routes each turn through InferenceController
- Triggers summarization on session end
- Persists visitor impressions and daemon relationships

**InferenceController** is the full AI inference pipeline:
1. Budget check (Redis daily token tracking)
2. Rate limit check (Redis sliding window)
3. Context assembly (system prompt + world state + memories + history)
4. Claude API call (Haiku for conversation, Sonnet for compilation)
5. Response validation (JSON schema)
6. Retry with repair on parse failure
7. Fallback response on total failure
8. Activity logging

**DaemonEvolutionEngine** enables daemon personality drift:
- Cooldown tracking per daemon (1 hour between triggers)
- AI classifier evaluates if events warrant trait changes
- AI proposer suggests specific trait mutations
- AI validator accepts/rejects changes
- All decisions logged to activity log

### Services (`services/`)

| Service | Purpose |
|---------|---------|
| ActivityLogService | Structured append-only log — conversation turns, summaries, amendments, failures |
| VisitorImpressionStore | Per-visitor memory with AI summarization. LRU eviction at 200 impressions per daemon |
| DaemonRelationshipStore | Bidirectional daemon relationships with AI-summarized descriptions and valence mirroring |
| DaemonEvolutionEngine | Trait mutation pipeline with classifier → proposer → validator chain |

### Middleware

| File | Purpose |
|------|---------|
| auth | Clerk JWT verification, dev bypass mode, role checking |
| rate-limit | Redis-backed rate limiting for REST + WebSocket chat |

### Database
- PostgreSQL with 30 sequential SQL migrations
- Singleton `pg.Pool` connection
- Redis via `ioredis` for rate limiting and budget tracking

---

## 6. AI Service Package

**`packages/ai-service/src/`**

| File | Purpose |
|------|---------|
| utils | Shared: model constants (Haiku/Sonnet), Anthropic client singleton, JSON fence stripping, input sanitization |
| generate | Object generation — Claude produces WorldObject JSON from text description |
| daemon-generate | Daemon generation — Claude creates DaemonDefinition from description |
| daemon-converse | Daemon conversation — structured JSON responses with speech, emotes, movement, internal state |
| manifest-compiler | PersonalityManifest compilation — system prompt assembly with truncation cascade (backstory → interests → quirks) when exceeding token budget |
| prompt-expand | Prompt expansion — Claude expands brief admin prompts into full ExpandedManifestFields |
| system-prompt | System prompt builder — assembles daemon system prompt from manifest + context |

### Model usage
- **claude-haiku-4-5-20251001**: Conversations, impression summaries, relationship summaries
- **claude-sonnet-4-5-20241022**: Manifest compilation, daemon generation, trait evolution

---

## 7. Asset Pipeline Package

**`packages/asset-pipeline/src/`**

| File | Purpose |
|------|---------|
| hash | SHA-256 content-addressed hashing |
| signing | Ed25519 signing of content hashes |
| upload | S3 upload with deduplication (HeadObject check before PutObject) |

### Content-addressed storage
Assets are stored at `assets/{sha256}.glb` in S3. The hash serves as both the key and integrity check. Duplicate uploads are detected and short-circuited.

---

## 8. Data Flow Diagrams

### Player joins world
```
Client                    Server                     DB
  │                         │                         │
  ├─ Clerk auth ───────────>│                         │
  ├─ Join StreetRoom ──────>│                         │
  │                         ├─ Load plots ───────────>│
  │                         ├─ Load daemons ─────────>│
  │                         ├─ DaemonManager.init() ──┤
  │<── room state sync ────┤                         │
  ├─ Build scene ──────────>│                         │
  └─ Start render loop      │                         │
```

### AI object creation
```
Client                    Server                  AI Service        S3
  │                         │                         │              │
  ├─ POST /generate ──────>│                         │              │
  │                         ├─ generate() ──────────>│              │
  │                         │<── WorldObject JSON ───┤              │
  │                         ├─ uploadAsset() ────────┼────────────>│
  │                         ├─ Save to DB ───────────┤              │
  │<── object + CDN URL ───┤                         │              │
  ├─ Load GLB from CDN ────┼─────────────────────────┼──────┐      │
  │<── GLB binary ─────────┼─────────────────────────┼──────┘      │
  └─ ObjectRenderer.add()  │                         │              │
```

### Daemon conversation
```
Player                  Server/DaemonManager      ConvSessionMgr     InferenceCtrl      Claude API
  │                         │                         │                   │                 │
  ├─ talk_to_daemon ──────>│                         │                   │                 │
  │                         ├─ startConversation() ──>│                   │                 │
  │                         │                         ├─ processInput() ──>│                 │
  │                         │                         │                   ├─ budget check    │
  │                         │                         │                   ├─ rate limit      │
  │                         │                         │                   ├─ assemble ctx    │
  │                         │                         │                   ├─ API call ──────>│
  │                         │                         │                   │<── response ─────┤
  │                         │                         │                   ├─ validate JSON   │
  │                         │                         │<── DaemonResponse ┤                 │
  │                         │<── broadcast speech ────┤                   │                 │
  │<── daemon_response ────┤                         │                   │                 │
  └─ Show chat bubble      │                         │                   │                 │
```

---

## 9. Authentication & Authorization

- **Clerk** handles identity — JWT tokens verified server-side
- **Dev bypass**: When `FLASK_ENV=development` or no `CLERK_SECRET_KEY`, auth is skipped with a synthetic dev user
- **Roles**: `user` and `super_admin` stored in PostgreSQL
- **Admin gates**: Several API routes and client panels require `super_admin` role
- **WebSocket auth**: Token passed on room join, verified in `onAuth()`

---

## 10. Security Boundaries

| Boundary | Protection |
|----------|-----------|
| Asset downloads | `isAllowedAssetUrl()` validates amazonaws.com domain (SSRF protection) |
| User input | `sanitizeUserInput()` in ai-service strips control chars, limits length |
| Rate limiting | Redis sliding window — per-user REST and WebSocket chat limits |
| Budget tracking | Redis daily token budget per daemon — hard cap on AI spend |
| Building codes | Server-side validation of objects against neighborhood rules |
| Auth middleware | Clerk JWT verification on all authenticated routes |

---

## 11. File Size Distribution

The codebase has several very large files that contain significant complexity:

| File | Lines | Notes |
|------|-------|-------|
| DaemonRenderer.ts | ~1800 | Daemon 3D rendering + animations |
| AvatarManager.ts | ~1600 | Player avatar rendering + animations |
| main.ts | ~1400 | Client orchestrator |
| DaemonManager.ts | ~1300 | Server daemon lifecycle |
| types.ts | ~600 | Shared type definitions |
| DaemonCreationPanel.ts | ~910 | UI wizard |
| StreetRoom.ts | ~900 | Game room |
| ActivityLogViewer.ts | ~830 | Activity log UI |
| DaemonDirectoryPanel.ts | ~768 | Daemon list/edit UI |
| AvatarPanel.ts | ~741 | Avatar customization UI |

---

## 12. Build & Development

- **Package manager**: pnpm with workspace protocol
- **Build orchestration**: Turborepo (`turbo.json`)
- **Client bundler**: Vite
- **Server runtime**: tsx (TypeScript execution)
- **Development**: `pnpm dev` runs all 5 packages concurrently via turbo
  - Client: Vite dev server (port 5173)
  - Server: Colyseus (port 2567) + REST API (port 3000)
  - AI Service: tsx watch
  - Asset Pipeline: tsx watch
  - Shared: tsc --watch

---

## 13. Testing

Tests exist in `__tests__/` directories:
- `shared`: validator, protocol, types tests
- `ai-service`: utils, manifest-compiler, prompt-expand tests
- `server`: auth middleware, inference-controller tests

Test runner: Vitest (inferred from tsconfig and package structure).
