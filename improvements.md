# Improvements Report

Generated from full codebase review. Suggestions grouped by module, sorted by severity within each category.

---

## Categories

| Tag | Meaning |
|-----|---------|
| STRUCTURE | File organization, module boundaries, separation of concerns |
| TYPES | Type safety, missing types, `any` usage |
| ERROR_HANDLING | Missing error handling, silent failures, unhandled rejections |
| DUPLICATION | Repeated code that could be shared |
| NAMING | Unclear names, inconsistent conventions |
| TESTING | Missing test coverage, untestable code |
| PERFORMANCE | Unnecessary work, memory leaks, render overhead |
| SECURITY | Potential vulnerabilities, input validation gaps |
| SCAFFOLD | Placeholder/stub code that should be completed or removed |
| CONSISTENCY | Inconsistent patterns across similar code |

Severity: **HIGH** (likely to cause bugs or block features), **MEDIUM** (code quality / maintainability), **LOW** (polish / style).

---

## packages/server

### STRUCTURE

**HIGH — DaemonManager.ts is 1300+ lines with too many responsibilities**
`packages/server/src/daemons/DaemonManager.ts`
This file handles daemon loading, ticking, conversations, roaming, emotions, relationships, inter-daemon chat, and world events. Extract at minimum:
- Roaming logic → `DaemonMovement.ts`
- Emotion/mood transitions → `DaemonEmotionEngine.ts`
- Inter-daemon conversation orchestration → `InterDaemonConversation.ts`

**HIGH — StreetRoom.ts is 900+ lines with 40+ message handlers inline**
`packages/server/src/rooms/StreetRoom.ts`
Each `this.onMessage()` handler is defined inline in `onCreate()`. Extract handlers into a separate module or use a handler map pattern.

**MEDIUM — REST routes are split across 12 files with no shared error handling**
`packages/server/src/api/*.ts`
Each route file has its own try/catch patterns. Consider a shared `asyncHandler` wrapper that catches errors and returns consistent error responses.

### TYPES

**HIGH — Pre-existing type errors in DaemonManager.ts**
`packages/server/src/daemons/DaemonManager.ts` lines 481, 614, 2389, 2402, 2406, 2482
Multiple type errors: accessing `.role`/`.content` on `ConversationTurn`, `.idleAnimationLabel` on `DaemonBehavior`, and `string | undefined` passed where `string` required. These indicate the shared types have diverged from the server's usage.

**MEDIUM — `any` in StreetRoom.ts PlayerSchema**
The Colyseus schema likely uses runtime reflection which bypasses strict typing. Review whether the PlayerSchema fields match the shared `PlayerState` type.

### ERROR_HANDLING

**HIGH — Silent catch blocks throughout API routes**
Multiple API route handlers have `catch {}` or `catch { /* silently fail */ }` blocks that swallow errors without logging. Examples:
- `api/gallery.ts` — gallery load failures silently return empty
- `api/assets.ts` — asset metadata fetch failures
- `api/daemons.ts` — daemon detail fetch failures

**MEDIUM — Redis connection failures could crash the server**
`packages/server/src/database/redis.ts`
The Redis client singleton doesn't have error event handling or reconnection logic visible. If Redis goes down, rate limiting and budget tracking will throw unhandled errors.

### DUPLICATION

**MEDIUM — Activity log rendering duplicated between DaemonPanel and DaemonDirectoryPanel**
Both `DaemonPanel.ts` (lines 441-477) and `DaemonDirectoryPanel.ts` (lines 718-751) have nearly identical activity log rendering with the same type colors and formatting. Extract to a shared helper.

**MEDIUM — `escapeHtml` function duplicated 6 times across UI files**
`ChatUI.ts`, `ActivityLogViewer.ts`, `DaemonPanel.ts`, `DaemonDirectoryPanel.ts`, `DaemonCreationPanel.ts`, `TargetingSystem.ts` all have identical `escapeHtml` implementations using `document.createElement("div")`. Extract to a shared `ui/utils.ts`.

**MEDIUM — `formatAge` function duplicated between DaemonPanel and DaemonDirectoryPanel**
Identical time-ago formatting logic in both files.

**MEDIUM — 3D preview setup duplicated between AvatarPanel and DaemonPanel**
Both panels have nearly identical Three.js preview renderer initialization (scene, camera, lights, ground plane, drag-to-rotate, animation loop). Extract to a shared `PreviewRenderer` class.

### TESTING

**HIGH — No tests for DaemonManager, ConversationSessionManager, or DaemonBehaviorTree**
These are the most complex server-side modules. Only `InferenceController` has tests. The behavior tree state machine and conversation lifecycle are untested.

**MEDIUM — No tests for REST API routes**
None of the 12 API route files have test coverage. At minimum, auth, daemons, and plots routes should have integration tests.

**MEDIUM — No client-side tests**
The entire client package has zero tests. The animation-converter and validator logic are good candidates for unit testing.

### PERFORMANCE

**MEDIUM — DaemonRenderer creates new THREE objects every frame for mood indicators**
`packages/client/src/avatar/DaemonRenderer.ts`
Review whether mood indicator sprites and particle systems are being recreated vs. reused across frames.

**MEDIUM — No debouncing on AnimationPanel file input changes**
`packages/client/src/ui/AnimationPanel.ts` line 108
The `handleFileSelect` is called on every file input change event without debouncing. Rapid file selection could trigger multiple simultaneous conversions.

**LOW — StreetGeometry rebuilds entire ring mesh on parameter changes**
`packages/client/src/scene/StreetGeometry.ts`
The geometry is rebuilt from scratch. For a static scene this is fine, but if the ring parameters ever become dynamic, incremental updates would be needed.

### SECURITY

**HIGH — No CSRF protection on state-changing REST endpoints**
POST/PUT/DELETE routes in `api/` rely solely on Bearer token auth. Consider adding CSRF tokens for browser-initiated requests, or verify the `Origin` header.

**MEDIUM — Asset cache serves local files without content-type validation**
`packages/server/src/api/asset-cache.ts`
The local cache serves downloaded files back to clients. Ensure the content-type is validated to prevent serving unexpected file types.

**MEDIUM — `isAllowedAssetUrl` only checks domain, not path traversal**
`packages/server/src/api/asset-cache.ts`
The SSRF check validates `amazonaws.com` domain but doesn't check for path traversal or internal AWS metadata endpoints (169.254.169.254).

**LOW — Chat message content not sanitized before broadcast**
`packages/server/src/rooms/StreetRoom.ts`
Player chat messages are broadcast to all clients without server-side sanitization. While the client escapes HTML, XSS could affect any non-browser consumer of the WebSocket.

### CONSISTENCY

**MEDIUM — Mixed visibility patterns: `isVisible()` method vs `isVisible` getter vs `visible` property**
- `AvatarPanel.isVisible()` — method
- `AdminPanel.isVisible` — getter
- `DaemonDirectoryPanel.isVisible` — getter
- `ChatUI.isVisible()` — method
Pick one pattern and apply consistently.

**LOW — Some panels append to `document.body` in constructor, others don't**
`AdminPanel`, `ChatUI`, `DaemonChatUI`, `DaemonCreationPanel`, `DaemonDirectoryPanel`, `DaemonPlacementPanel`, `GalleryPanel`, `LoginUI`, `TargetingSystem` all append themselves to `document.body` in their constructors. `AvatarPanel` and `CreationPanel` also do this. `AnimationPanel`, `AnimationConverterTool`, `DefaultModelUploader`, and `ActivityLogViewer` do not (they're embedded by their parent). This is actually correct per their usage, but worth documenting.

---

## packages/shared

### TYPES

**MEDIUM — `DaemonBehavior` interface missing `idleAnimationLabel` field**
`packages/shared/src/types.ts`
The server accesses `behavior.idleAnimationLabel` in DaemonManager but this field doesn't exist on the `DaemonBehavior` type. Add it to fix the pre-existing type error.

**MEDIUM — `ConversationTurn` missing `role` and `content` fields**
`packages/shared/src/types.ts`
DaemonManager accesses `.role` and `.content` on `ConversationTurn` but the type doesn't have these fields. Align the type with actual usage.

### STRUCTURE

**LOW — `types.ts` is ~560 lines with all types in one file**
Consider splitting into domain-specific files: `world.ts`, `daemon.ts`, `avatar.ts`, `inference.ts`, `activity-log.ts`. The barrel `index.ts` already re-exports everything, so this is purely organizational.

---

## packages/client

### STRUCTURE

**HIGH — main.ts is 1400+ lines of orchestration with inline callbacks**
`packages/client/src/main.ts`
All network event handlers, UI wiring, and game loop logic are in one file. Extract:
- Network event handlers → `handlers/` directory
- UI panel wiring → `ui/PanelManager.ts`
- Game loop → `GameLoop.ts`

**MEDIUM — AvatarManager.ts (1600 lines) and DaemonRenderer.ts (1800 lines) share significant code**
Both implement: GLB model loading, Mixamo bone retargeting, animation state machines, chat bubble rendering, nameplate sprites. Extract shared functionality into a base `AnimatedEntity` class.

### ERROR_HANDLING

**MEDIUM — Network disconnection not gracefully handled**
`packages/client/src/network/NetworkManager.ts`
There's no visible reconnection logic or user notification when the WebSocket connection drops.

### NAMING

**LOW — `DaemonPanel` vs `DaemonDirectoryPanel` vs `DaemonCreationPanel` naming is confusing**
- `DaemonPanel` = per-plot daemon creation and listing (F7)
- `DaemonDirectoryPanel` = global daemon listing and editing (F10)
- `DaemonCreationPanel` = full wizard for creating with FBX uploads
Consider renaming to `PlotDaemonPanel`, `DaemonDirectoryPanel`, `DaemonWizardPanel`.

---

## packages/ai-service

### ERROR_HANDLING

**MEDIUM — `getClient()` returns a new client on every call**
`packages/ai-service/src/utils.ts`
Check if this creates a new HTTP connection pool each time, or if the Anthropic SDK handles connection reuse internally. If not, cache the client instance.

### TESTING

**MEDIUM — No tests for daemon-converse.ts or daemon-generate.ts**
These contain complex prompt construction and response parsing logic that could be tested with mock responses.

---

## packages/asset-pipeline

### TESTING

**LOW — No tests for upload.ts or signing.ts**
The content-addressed upload logic with S3 deduplication should have tests with mocked S3 client.

---

## Summary

| Category | HIGH | MEDIUM | LOW |
|----------|------|--------|-----|
| STRUCTURE | 3 | 1 | 1 |
| TYPES | 1 | 3 | 0 |
| ERROR_HANDLING | 2 | 3 | 0 |
| DUPLICATION | 0 | 4 | 0 |
| TESTING | 1 | 3 | 1 |
| PERFORMANCE | 0 | 2 | 1 |
| SECURITY | 1 | 2 | 1 |
| NAMING | 0 | 0 | 1 |
| CONSISTENCY | 0 | 1 | 1 |
| **Total** | **8** | **19** | **6** |

### Top 5 highest-impact improvements

1. **Fix pre-existing type errors** in shared types (DaemonBehavior, ConversationTurn) — blocks strict type-checking
2. **Split DaemonManager.ts** into focused modules — currently hardest file to modify safely
3. **Add tests for DaemonManager and ConversationSessionManager** — most complex untested code
4. **Extract shared UI utilities** (escapeHtml, formatAge, 3D preview) — reduces duplication across 10+ files
5. **Add CSRF protection** to state-changing REST endpoints — security hardening
