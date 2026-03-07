# The Street - Claude Code Guide

## Project Overview
Multiplayer 3D virtual world with AI-powered avatars and NPC daemons. Monorepo using pnpm workspaces + Turbo.

## Packages
- `packages/client` — Vite + Three.js browser client (port 5173)
- `packages/server` — Express + Colyseus multiplayer server (port 3000 API, 2567 WS)
- `packages/ai-service` — Anthropic Claude API (daemon generation, world object generation)
- `packages/shared` — Protocol types, constants, shared between client/server
- `packages/asset-pipeline` — Asset processing utilities

## Key Commands
```bash
pnpm dev                                         # Start all packages
pnpm --filter @the-street/client dev             # Client only (Vite, port 5173)
pnpm --filter @the-street/server dev             # Server only (tsx watch)
pnpm --filter @the-street/client exec tsc --noEmit  # Type-check client
pnpm --filter @the-street/server exec tsc --noEmit  # Type-check server
```

## Visual Design System

**IMPORTANT**: When building or modifying anything with a visual component (UI panels, 3D labels, HUD elements, scene materials, chat styling, canvas rendering), you MUST reference `DESIGN_SYSTEM.md` in the project root and follow its color palette, typography, component patterns, and anti-patterns. Do not introduce colors, fonts, or styling that contradict the design system.

## Architecture Notes

### Avatar Pipeline
1. **User uploads pre-rigged FBX** — Mixamo-rigged character model
2. **Browser converts FBX → GLB** — Using THREE.FBXLoader + GLTFExporter client-side
3. **GLB uploaded to server** — Stored on disk, UUID returned
4. **Shared animations applied** — Mixamo-native idle/walk/run/emote animations loaded from server

### Animation System
- Shared animations served from `server/data/animations/` (idle.glb, walk.glb, run.glb)
- Emote animations served from `server/data/emotes/` (hip-hop-dance.glb, etc.)
- All animations use Mixamo bone space (no retargeting needed for uploaded Mixamo FBX models)
- Procedural capsule avatars have their own procedural idle breathing + walk animation
- AnimationMixer with crossfade state machine: idle ↔ walk ↔ run, plus emote overlay

### Slash Command System
- Type "/" anywhere to open autocomplete popup
- Animated emotes: `/dance`, `/wave`, `/shrug`, `/nod`, `/cry`, `/bow`, `/cheer`, `/laugh`
- Text-only emotes: `/clap`, `/sit`, `/stretch`, `/yawn`, `/salute`, `/flex`, `/think`, `/facepalm`, `/point`
- Emotes broadcast to nearby players via Colyseus room
- Procedural avatars show text-only emotes in chat

### Daemon (NPC) System
- 8-phase lifecycle: spawn → idle → wander → observe → approach → chat → disengage → despawn
- AI-driven conversations via Claude
- Each daemon has personality, appearance, behavioral traits
- Rendered with Three.js procedural capsule bodies

## File Locations
- Avatar management: `packages/client/src/avatar/AvatarManager.ts`
- Animation converter: `packages/client/src/avatar/animation-converter.ts`
- Avatar API routes: `packages/server/src/api/avatar.ts`
- Protocol types: `packages/shared/src/protocol.ts`
- Game loop + wiring: `packages/client/src/main.ts`
- Chat UI + slash commands: `packages/client/src/ui/ChatUI.ts`
- Multiplayer room: `packages/server/src/rooms/StreetRoom.ts`
- Network client: `packages/client/src/network/NetworkManager.ts`

## Local Development Setup

### Prerequisites
- **Node.js** (v18+)
- **pnpm** (package manager)
- **PostgreSQL 16** — port 5432
- **Redis 7** — port 6379

### Starting Local Services
A `docker-compose.yml` at project root provides Postgres and Redis:
```bash
docker compose up -d          # Start Postgres + Redis in background
docker compose down           # Stop services
```
Docker Compose creates:
- **Postgres**: `localhost:5432`, user `thestreet`, password `thestreet`, database `thestreet`
- **Redis**: `localhost:6379`, no auth

### Environment Variables
Create a `.env` file in the project root. The server loads it manually at startup.

**Required:**
| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string (e.g. `postgresql://thestreet:thestreet@localhost:5432/thestreet`) |
| `REDIS_URL` | Redis connection string (e.g. `redis://localhost:6379`) |
| `CLERK_SECRET_KEY` | Clerk auth secret (any value in dev mode) |
| `CLERK_PUBLISHABLE_KEY` | Clerk public key (any value in dev mode) |
| `ANTHROPIC_API_KEY` | Claude API key for AI features |
| `MASTER_ENCRYPTION_KEY` | Encryption key for sensitive data |
| `AWS_ACCESS_KEY_ID` | AWS credentials (needed for S3 asset storage) |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials |

**Optional (have defaults):**
| Variable | Default | Description |
|---|---|---|
| `API_PORT` | `3000` | REST API port |
| `COLYSEUS_PORT` | `2567` | WebSocket multiplayer port |
| `NODE_ENV` | — | Set to `development` for dev mode |
| `DEV_USER_ROLE` | `super_admin` | Role assigned to dev user |
| `AWS_S3_BUCKET` | `the-street-assets` | S3 bucket name |
| `AWS_REGION` | `us-east-1` | AWS region |
| `CDN_BASE_URL` | `https://cdn.thestreet.world` | CDN base URL |

### Dev Mode (`NODE_ENV=development`)
- **Auth bypass**: Skips Clerk authentication. All requests use a fixed dev user:
  - User ID: `00000000-0000-0000-0000-000000000000`
  - Role: `super_admin` (configurable via `DEV_USER_ROLE`)
- **Auto-seeding**: Creates dev user, 8 test plots (ring 0), and 2 test daemons (Professor Cogsworth, Zer0_Day)
- **Migrations**: Run automatically on server startup

### Starting the App
```bash
pnpm install                  # Install all dependencies
docker compose up -d          # Start Postgres + Redis
pnpm dev                      # Start all packages (client + server + ai-service)
```

### Ports
| Service | Port |
|---|---|
| Vite client (HMR) | 5173 |
| Express REST API | 3000 |
| Colyseus WebSocket | 2567 |
| PostgreSQL | 5432 |
| Redis | 6379 |

### Server Startup Sequence
1. Load `.env` from project root
2. Connect to Postgres, run migrations
3. Connect to Redis
4. Seed dev data (if `NODE_ENV=development`)
5. Start Express API server (port 3000)
6. Start Colyseus WebSocket server (port 2567)

### Type Checking
```bash
pnpm --filter @the-street/client exec tsc --noEmit  # Type-check client
pnpm --filter @the-street/server exec tsc --noEmit  # Type-check server
```

### Common Issues
- **`ECONNREFUSED :5432`** — PostgreSQL not running. Start it with `docker compose up -d` or check your local Postgres service.
- **`ECONNREFUSED :6379`** — Redis not running. Start it with `docker compose up -d`.
- **Animations not updating after upload** — Browser HTTP cache (7-day max-age). The client uses cache-busting on reload, but hard-refresh (Ctrl+Shift+R) helps during dev.
- **FBX conversion fails in Node.js** — Expected. FBX→GLB conversion must happen in the browser (Three.js APIs require DOM). See "FBX → GLB Conversion" below.

## FBX → GLB Conversion
Node.js conversion fails (browser API polyfill issues). Use browser-based approach:
1. User selects FBX file in avatar panel
2. THREE.FBXLoader loads it in browser
3. THREE.GLTFExporter exports to GLB
4. GLB uploaded to server via POST /api/avatar/upload-character
