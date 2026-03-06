# Plan: Remove Meshy and Switch to FBX-Upload-Only Avatars

## Project Overview

Remove ALL Meshy integration from the codebase and replace the AI-driven avatar generation pipeline with a simple FBX-upload-only workflow. Users upload pre-rigged FBX files which get converted to GLB client-side (already implemented). This is a clean break -- no backward compatibility with Meshy data.

### What is being removed:
- Meshy API integration (text-to-3D, refine, remesh, rigging, animation generation)
- AI avatar description generation (Claude prompts for avatar appearance via `generateAvatar`)
- Meshy-specific bone retargeting pipeline (`MIXAMO_TO_MESHY`, `retargetMixamoClip`, `convertMixamoToMeshy`, `computeBoneCorrections`)
- Meshy-specific data fields (`meshyTaskId`, `meshy_task_id`, `boneSpace: "meshy"`)
- Mesh polling, refining, rigging UI and server routes
- Asset caching for Meshy CDN resources
- Environment variables (`MESHY_API_KEY`, `MESHY_API_URL`)

### What is being kept:
- FBX upload pipeline (already works: `convertFbxCharacterToGlb` in animation-converter.ts)
- GLB model loading and display
- Animation system (shared animations, emotes, custom animation upload)
- Procedural capsule avatars (default fallback)
- Daemon system (procedural capsules only -- no more daemon mesh generation)
- Gallery system for world objects (object generation uses AI + archetype primitives, NOT Meshy for V2)
- Upload-based avatar workflow (`/api/avatar/upload-character`, `uploadedModelId`)

---

## Complete Audit Results

### Files with Meshy/AI-Avatar-Generation References

#### `packages/ai-service/src/meshy.ts` -- ENTIRE FILE IS MESHY
- All Meshy API functions: `startMeshPreview`, `pollMeshTask`, `startMeshRefine`, `generateMesh`, `startRemesh`, `pollRemeshTask`, `startRigging`, `pollRiggingTask`, `startAnimation`, `pollAnimationTask`
- Types: `MeshyTaskStatus`, `RiggingTaskStatus`, `AnimationTaskStatus`
- Constants: `MESHY_API_URL`, `MESHY_API_KEY`

#### `packages/ai-service/src/avatar-generate.ts` -- ENTIRE FILE IS AI AVATAR GENERATION
- `AVATAR_SYSTEM_PROMPT` -- Claude prompt for generating avatar appearance + Meshy mesh description
- `generateAvatar()` -- calls Claude to generate `AvatarAppearance` + `meshDescription`
- Type: `AvatarGenerationResult`

#### `packages/ai-service/src/index.ts` -- EXPORTS
- Line 4: exports all Meshy functions from `meshy.js`
- Line 5: exports Meshy types from `meshy.js`
- Line 7: exports `generateAvatar` from `avatar-generate.js`
- Line 8: exports `AvatarGenerationResult` type

#### `packages/shared/src/types.ts` -- TYPE DEFINITIONS
- Line 132: `meshyTaskId?: string` in `AvatarDefinition`
- Line 135: `boneSpace?: "mixamo" | "meshy"` in `AvatarDefinition`
- Line 185: `meshyTaskId?: string` in `DaemonDefinition`
- Line 200: `meshyTaskId?: string` in `DaemonState`

#### `packages/shared/src/__tests__/types.test.ts` -- TEST
- Line 56: `meshyTaskId: "task-123"` in test fixture

#### `packages/server/src/env.ts` -- ENV CONFIG
- Line 13: `MESHY_API_KEY: string` in `Env` interface
- Line 14: `MESHY_API_URL: string` in `Env` interface
- Line 42: `MESHY_API_KEY: requireEnv("MESHY_API_KEY")`
- Line 43: `MESHY_API_URL: optionalEnv("MESHY_API_URL", ...)`

#### `packages/server/src/api/avatar.ts` -- AVATAR API ROUTES
- Line 20: `isAllowedMeshUrl` checks `.meshy.ai` domain
- Lines 58-88: `POST /api/avatar/generate` -- calls `generateAvatar` (AI avatar generation)
- Lines 90-106: `GET /api/avatar/mesh/:taskId` -- polls Meshy task status
- Lines 108-161: `GET /api/avatar/mesh/:taskId/model` -- proxies Meshy GLB download
- Lines 163-190: `POST /api/avatar/rig` -- starts Meshy rigging
- Lines 192-214: `GET /api/avatar/rig/:taskId` -- polls Meshy rigging status
- Lines 216-269: `GET /api/avatar/rig/:taskId/model` -- proxies rigged GLB
- Lines 271-336: `GET /api/avatar/rig/:taskId/anim/:type` -- proxies rig walk/run anims
- Line 354: `boneSpace` defaults to `"meshy"`
- Lines 515, 535, 551, 566, 598: `meshy_task_id` in DB queries / request body
- Lines 29-53: `cacheAnimationsIfNeeded` -- caches walk/run from Meshy rig results

#### `packages/server/src/api/generation.ts` -- GENERATION API ROUTES
- Line 19: `isAllowedMeshUrl` checks `.meshy.ai`
- Lines 93-120: `POST /api/generate/mesh` -- starts Meshy text-to-3D preview
- Lines 122-145: `POST /api/generate/mesh/refine` -- starts Meshy refine
- Lines 147-167: `POST /api/generate/mesh/remesh` -- starts Meshy remesh
- Lines 169-185: `GET /api/generate/mesh/remesh/:taskId` -- polls Meshy remesh
- Lines 187-258: `GET /api/generate/mesh/:taskId` -- polls Meshy task status
- Lines 260-319: `GET /api/generate/mesh/:taskId/model` -- proxies Meshy GLB
- Lines 172, 204, 212, 220: DB columns `preview_task_id`, `refine_task_id`

#### `packages/server/src/api/daemons.ts` -- DAEMON API ROUTES
- Line 21: `isAllowedMeshUrl` checks `.meshy.ai`
- Lines 284-332: `POST /api/daemons/:id/mesh/start` -- starts Meshy preview for daemon
- Lines 335-350: `GET /api/daemons/:id/mesh/:taskId` -- polls Meshy
- Lines 353-400: `POST /api/daemons/:id/mesh/refine` -- starts Meshy refine for daemon
- Lines 403-449: `POST /api/daemons/:id/remesh` -- starts Meshy remesh for daemon
- Lines 452-468: `GET /api/daemons/:id/remesh/:taskId` -- polls Meshy remesh
- Lines 470-521: `POST /api/daemons/:id/rig` -- starts Meshy rigging for daemon
- Lines 523-578: `GET /api/daemons/:id/rig/:taskId` -- polls Meshy rigging
- Lines 580-633: `GET /api/daemons/:id/rig/:taskId/model` -- proxies rigged GLB
- Lines 322, 390, 439: `meshy_task_id` in DB updates

#### `packages/server/src/api/gallery.ts` -- GALLERY API
- Line 9: `isAllowedMeshUrl` checks `.meshy.ai`
- Line 81: comment about "Meshy proxy"
- Lines 48: `preview_task_id`, `refine_task_id` DB columns in queries

#### `packages/server/src/api/asset-cache.ts` -- ASSET CACHING
- Line 16: `isAllowedAssetUrl` checks `.meshy.ai`
- Lines 89-127: `cacheRigAssets` -- downloads from Meshy rigging API
- Lines 135-160: `cacheMeshAssets` -- downloads from Meshy mesh API
- Lines 91, 122-123, 135-142: `meshyTaskId` parameter and usage

#### `packages/server/src/api/admin.ts` -- ADMIN ROUTES
- Line 87: comment "Download all uncached Meshy assets"
- Lines 100-149: `POST /api/admin/cache-assets` -- queries `meshy_task_id` columns, calls `cacheRigAssets`/`cacheMeshAssets`

#### `packages/server/src/database/migrate.ts` -- DATABASE MIGRATIONS
- Line 172-173: `generated_objects` table: `preview_task_id`, `refine_task_id` columns
- Line 251: `avatar_history` table: `meshy_task_id` column
- Lines 267-268: `daemons` table: `meshy_task_id`, `rig_task_id` columns

#### `packages/server/src/daemons/DaemonManager.ts` -- DAEMON MANAGER
- Line 210: selects `rig_task_id` column
- Line 247: `rigTaskId: row.rig_task_id`

#### `packages/client/src/main.ts` -- MAIN CLIENT ENTRY
- Lines 199-204: loading rigged/meshy avatars on join (meshyTaskId checks)
- Lines 238-243: same for player updates
- Lines 438, 490: `avatarPanel.setMeshyTaskId()`
- Lines 442-523: `pollAvatarMesh()` -- entire Meshy avatar pipeline (preview, refine, rig)
- Lines 556-609: `rigOrFallback()` -- Meshy rigging helper
- Lines 612-654: `pollDaemonMesh()` -- entire Meshy daemon pipeline
- Lines 698, 703: `onSave` callback with `meshyTaskId`
- Lines 731-733: loading rigged/meshy avatar on save
- Lines 785: loading rigged avatar from history
- Line 928: `daemonPanel.setMeshyTaskId()`
- Lines 1046-1131: novel object Meshy generation (preview, refine, load)

#### `packages/client/src/avatar/AvatarManager.ts` -- AVATAR MANAGER
- Line 7: imports `MIXAMO_TO_MESHY`
- Line 65: `boneSpace: "mixamo" | "meshy"` in `CustomModelData`
- Line 101: bone corrections comment for Meshy retargeting
- Lines 169-182: Meshy bone space detection in `ensureAnimClips`
- Lines 254: log "Meshy clips loaded"
- Line 323: `boneSpace: "meshy"` in `loadCustomAvatar`
- Lines 330-468: `loadRiggedAvatar()` -- Meshy-specific texture recovery, bone space
- Lines 703-705: fallback to `loadCustomAvatar` for `meshyTaskId`
- Line 1079: `meshyTaskId` check for procedural capsule fallback
- Line 1234: "Meshy character + Mixamo emote source" retarget comment

#### `packages/client/src/avatar/animation-converter.ts` -- ANIMATION CONVERTER
- Lines 1-7: module doc about Mixamo to Meshy conversion
- Lines 20-46: `MIXAMO_TO_MESHY` constant (bone name mapping)
- Lines 81-126: `retargetMixamoClip()` -- retargets Mixamo to Meshy bone names
- Lines 128-161: `computeBoneCorrections()` -- computes Mixamo-to-Meshy corrections
- Lines 167-236: `convertMixamoToMeshy()` -- full conversion pipeline

#### `packages/client/src/ui/AvatarPanel.ts` -- AVATAR PANEL UI
- Line 9: `meshy_task_id` in `AvatarHistoryItem` interface
- Lines 20-21: `meshPromptArea`, `meshPromptInput` (Meshy mesh prompt UI)
- Line 33: `currentMeshyTaskId` state
- Line 36: `currentBoneSpace` defaults to `"meshy"`
- Line 54: `onSave` callback with `meshyTaskId` parameter
- Lines 250-292: mesh prompt UI construction
- Lines 527-528: `getMeshyTaskId()`
- Lines 637, 655-656: `setMeshyTaskId()`
- Line 679: `getBoneSpace()` returns `"meshy"`
- Lines 762, 786, 917, 966, 971: `meshyTaskId` references

#### `packages/client/src/ui/DaemonPanel.ts` -- DAEMON PANEL UI
- Lines 13-14: `meshPromptArea`, `meshPromptInput`
- Line 28: `currentMeshyTaskId`
- Lines 151-161: mesh prompt UI construction
- Lines 407-414: `setMeshyTaskId()`
- Lines 639, 657, 713: mesh prompt area display/description

#### `packages/client/src/ui/GalleryPanel.ts` -- GALLERY PANEL
- Line 182: "refined" status color mapping
- Line 187: "refined" status icon

#### `packages/client/src/ui/AnimationConverterTool.ts` -- ADMIN ANIM CONVERTER
- Line 2: doc about "Mixamo to Meshy bone space"
- Line 62: description mentions "Meshy bone space"
- Line 88: description mentions "Meshy-retargeted"
- Lines 164-167: loads walk.glb as "Meshy reference"
- Lines 269-291: retargets to "Meshy bone space"

#### `packages/client/src/ui/AnimationPanel.ts` -- ANIMATION PANEL
- Line 4: doc mentions "Mixamo to Meshy bone space"
- Line 9: imports `convertMixamoToMeshy`
- Line 31: `getBoneSpace` option with `"meshy"` type
- Lines 307, 315, 322-323: Meshy conversion logic

#### `packages/client/src/scene/ObjectRenderer.ts` -- OBJECT RENDERER
- Line 22: comment "Set applyMaterials=true for Meshy preview models"

#### Documentation files (non-code, for reference only):
- `CLAUDE.md` -- multiple Meshy references in docs
- `the-street-v1-spec.md` -- Meshy references in spec
- `.claude/investigation/*.md` -- investigation notes

---

## Feature List

### Feature 00: Remove Meshy from ai-service package
**Description:** Delete `meshy.ts` entirely. Delete `avatar-generate.ts` entirely. Remove all Meshy and avatar-generation exports from `index.ts`. The ai-service package should retain only: `generate.ts` (world object generation), `daemon-generate.ts`, `daemon-converse.ts`, `system-prompt.ts`, `mesh-router.ts`, and `utils.ts`.

**Files modified:**
- `packages/ai-service/src/meshy.ts` -- DELETE
- `packages/ai-service/src/avatar-generate.ts` -- DELETE
- `packages/ai-service/src/index.ts` -- remove Meshy and avatar-generation exports (lines 4-5, 7-8)

**Estimated effort:** Small

---

### Feature 01: Remove Meshy from shared types
**Description:** Remove `meshyTaskId` from `AvatarDefinition`, `DaemonDefinition`, and `DaemonState`. Remove `"meshy"` from `boneSpace` type (make it just `"mixamo"` or remove the field entirely since all avatars will be Mixamo bone space). Update type test.

**Files modified:**
- `packages/shared/src/types.ts` -- remove `meshyTaskId` (lines 132, 185, 200), simplify `boneSpace` (line 135)
- `packages/shared/src/__tests__/types.test.ts` -- remove `meshyTaskId` from test fixture (line 56)

**Estimated effort:** Small

---

### Feature 02: Remove Meshy server API routes
**Description:** Remove all Meshy-specific routes from the avatar, generation, and daemons API routers. This includes mesh preview/refine/remesh/rig routes and their polling endpoints. Keep the upload-character and upload-model routes. Remove the `POST /api/avatar/generate` route (AI avatar generation). Clean up `isAllowedMeshUrl` to no longer check `.meshy.ai`. Remove `cacheAnimationsIfNeeded` function from avatar.ts (it cached walk/run from Meshy rig results). Simplify the animation serving endpoint to remove `boneSpace` parameter (all animations are now Mixamo-native).

**Files modified:**
- `packages/server/src/api/avatar.ts` -- remove routes: `/generate`, `/mesh/:taskId`, `/mesh/:taskId/model`, `/rig`, `/rig/:taskId`, `/rig/:taskId/model`, `/rig/:taskId/anim/:type`, `/rig/:taskId/thumbnail`; remove `cacheAnimationsIfNeeded`; simplify `/animations/:type` to remove boneSpace; remove `isAllowedMeshUrl` or update it; remove `meshy_task_id` from `/history` and `/save` queries
- `packages/server/src/api/generation.ts` -- remove routes: `/mesh`, `/mesh/refine`, `/mesh/remesh`, `/mesh/remesh/:taskId`, `/mesh/:taskId`, `/mesh/:taskId/model`; remove `isAllowedMeshUrl`; remove `cacheMeshAssets` import; clean up gallery-update logic to remove `preview_task_id`/`refine_task_id` references
- `packages/server/src/api/daemons.ts` -- remove routes: `/:id/mesh/start`, `/:id/mesh/:taskId`, `/:id/mesh/refine`, `/:id/remesh`, `/:id/remesh/:taskId`, `/:id/rig`, `/:id/rig/:taskId`, `/:id/rig/:taskId/model`; remove `isAllowedMeshUrl`; remove `meshy_task_id` from DB updates
- `packages/server/src/api/gallery.ts` -- remove or simplify `isAllowedMeshUrl` (gallery objects may still use AWS URLs); remove `meshy.ai` check
- `packages/server/src/api/admin.ts` -- remove `POST /api/admin/cache-assets` route (or simplify to only cache uploads); remove `cacheMeshAssets` import; remove `meshy_task_id` references
- `packages/server/src/api/asset-cache.ts` -- remove `cacheMeshAssets`, remove `meshyTaskId` param from `cacheRigAssets`, remove `.meshy.ai` from `isAllowedAssetUrl`; simplify or remove functions that call Meshy API imports

**Estimated effort:** Large

---

### Feature 03: Remove Meshy from server environment config
**Description:** Remove `MESHY_API_KEY` and `MESHY_API_URL` from the server environment configuration. Since it's a `requireEnv`, this currently means the server won't start without the key. Making it not required or removing entirely.

**Files modified:**
- `packages/server/src/env.ts` -- remove `MESHY_API_KEY` and `MESHY_API_URL` from `Env` interface and `loadEnv()` function

**Estimated effort:** Small

---

### Feature 04: Remove Meshy from client main.ts pipeline
**Description:** Remove the entire Meshy avatar pipeline (`pollAvatarMesh`, `rigOrFallback`, `pollDaemonMesh`), the novel object Meshy generation code, and all `meshyTaskId` references in player join/update/save handlers. Simplify avatar loading to only check for `uploadedModelId` (no more `rigTaskId` or `meshyTaskId` checks for Meshy models). Remove `avatarPanel.setMeshyTaskId()` calls. Remove `onStartMesh` and mesh polling callbacks. Remove the `daemonPanel.setMeshyTaskId()` calls and daemon mesh pipeline.

**Files modified:**
- `packages/client/src/main.ts` -- remove `pollAvatarMesh` (lines 442-523), `rigOrFallback` (lines 556-609), `pollDaemonMesh` (lines 612-654), novel object Meshy gen (lines 1046-1131); simplify player join/update to only check `uploadedModelId`; remove `meshyTaskId` from save callback; remove `onStartMesh` wiring for avatar and daemon panels

**Estimated effort:** Large

---

### Feature 05: Simplify AvatarManager -- remove Meshy bone space
**Description:** Remove `loadRiggedAvatar()` method (Meshy-specific with texture recovery logic). Remove Meshy bone space references. Change `loadCustomAvatar` to use `boneSpace: "mixamo"`. Simplify `ensureAnimClips` to not check for Meshy bone space. Remove `MIXAMO_TO_MESHY` import. Remove the entire Meshy retargeting path from animation loading. The `loadUploadedAvatar` method stays (already uses Mixamo bone space). Remove `meshyTaskId` checks from `loadForPlayer` and the procedural capsule fallback logic.

**Files modified:**
- `packages/client/src/avatar/AvatarManager.ts` -- remove `loadRiggedAvatar`; remove `MIXAMO_TO_MESHY` import; simplify `ensureAnimClips`; change boneSpace to always `"mixamo"`; simplify `loadForPlayer`; remove `meshyTaskId` checks

**Estimated effort:** Medium

---

### Feature 06: Simplify animation-converter.ts -- remove Meshy retargeting
**Description:** Remove the Meshy-specific functions: `MIXAMO_TO_MESHY`, `retargetMixamoClip`, `computeBoneCorrections`, `convertMixamoToMeshy`. Keep `convertFbxToGlb` (Mixamo-native FBX-to-GLB conversion without retargeting) and `convertFbxCharacterToGlb` (full character conversion). Keep `extractAveragePoses` only if needed elsewhere (it is imported by AnimationConverterTool, but that tool also gets simplified). Keep `normalizeMixamoBoneName` if still needed by `convertFbxToGlb`.

**Files modified:**
- `packages/client/src/avatar/animation-converter.ts` -- remove `MIXAMO_TO_MESHY`, `retargetMixamoClip`, `computeBoneCorrections`, `convertMixamoToMeshy`; update module doc

**Estimated effort:** Medium

---

### Feature 07: Simplify AvatarPanel UI -- remove AI generation and mesh prompt
**Description:** Remove the "Generate" button and AI avatar description flow. Remove the mesh prompt area (`meshPromptArea`, `meshPromptInput`, `startMeshBtn`). Remove `onGenerate` and `onStartMesh` callbacks. Remove `currentMeshyTaskId` and `getMeshyTaskId()`. Remove `setMeshyTaskId()`, `setGenerationResult()`, `setMeshComplete()`, `setMeshProgress()`. The panel becomes a simpler "Upload FBX" + "My Avatars" gallery panel. Keep the 3D preview, save button, upload character button, and gallery strip. Simplify `onSave` callback to not pass `meshDescription` or `meshyTaskId`. Remove `meshy_task_id` from `AvatarHistoryItem`. Remove `getBoneSpace` (always Mixamo). Simplify `handleSave` to not include `meshyTaskId` in the definition.

**Files modified:**
- `packages/client/src/ui/AvatarPanel.ts` -- major simplification; remove AI generation UI, mesh prompt, Meshy state

**Estimated effort:** Medium

---

### Feature 08: Simplify DaemonPanel UI -- remove mesh generation
**Description:** Remove the mesh prompt area, mesh generate button, mesh progress bar, and `currentMeshyTaskId` from DaemonPanel. Remove `onStartMesh` callback. Remove `setMeshyTaskId()`. Remove the "3D Model" button from the daemon list cards. Daemons remain as procedural capsules. Keep the AI daemon personality generation (`onGenerate`), daemon creation, and daemon management (list, delete, recall, roam).

**Files modified:**
- `packages/client/src/ui/DaemonPanel.ts` -- remove mesh-related UI and callbacks

**Estimated effort:** Medium

---

### Feature 09: Simplify AnimationConverterTool and AnimationPanel
**Description:** In AnimationConverterTool: remove the "Convert All Shared Animations" section (Meshy retargeting of shared anims). Simplify or keep the "Upload Movement Animation" section but remove the Meshy retargeting path (only save Mixamo-native versions). In AnimationPanel: remove `convertMixamoToMeshy` import, remove the `boneSpace === "meshy"` path. All animations are now Mixamo-native only.

**Files modified:**
- `packages/client/src/ui/AnimationConverterTool.ts` -- remove Meshy conversion section, simplify upload to Mixamo-only
- `packages/client/src/ui/AnimationPanel.ts` -- remove `convertMixamoToMeshy` import, remove Meshy bone space path

**Estimated effort:** Medium

---

### Feature 10: Clean up GalleryPanel and ObjectRenderer
**Description:** In GalleryPanel: the "refined" status is Meshy-specific (preview -> refined pipeline). For now, keep the status display but it will naturally become unused for new objects. In ObjectRenderer: remove the Meshy comment about preview models. These are minor cosmetic changes.

**Files modified:**
- `packages/client/src/ui/GalleryPanel.ts` -- minor comment cleanup
- `packages/client/src/scene/ObjectRenderer.ts` -- remove Meshy comment (line 22)

**Estimated effort:** Small

---

### Feature 11: Clean up DaemonManager and StreetRoom
**Description:** In DaemonManager: the `rig_task_id` is loaded from the DB for daemon state. Since daemons will no longer have rigged models, this can be cleaned up (daemons stay as procedural capsules). Remove `rigTaskId` from the daemon state construction. In StreetRoom: no direct Meshy references, but daemon state sent to clients includes `rigTaskId` -- ensure it's removed/ignored.

**Files modified:**
- `packages/server/src/daemons/DaemonManager.ts` -- remove `rig_task_id` from SELECT query and state construction
- `packages/server/src/rooms/StreetRoom.ts` -- no changes needed (uses DaemonState type which will be updated in Feature 01)

**Estimated effort:** Small

---

### Feature 12: Update CLAUDE.md documentation
**Description:** Update the project documentation to reflect the new FBX-upload-only avatar pipeline. Remove all references to Meshy, bone retargeting (Mixamo-to-Meshy), texture recovery, auto-rigging, and the old avatar pipeline. Update the "Avatar Pipeline" section, "Bone Retargeting" section, "Animation System" section, and "3D Model Generation Constraints" section. Update file locations list.

**Files modified:**
- `CLAUDE.md` -- comprehensive documentation update

**Estimated effort:** Small

---

### Feature 13: Database migration for cleanup (optional -- add new migration)
**Description:** Add a new migration that does NOT drop existing columns (backwards compatible) but documents the deprecation. The `meshy_task_id` columns in `avatar_history` and `daemons` tables, plus `preview_task_id`/`refine_task_id` in `generated_objects`, are now unused. A migration can add a comment or the columns can simply be left as-is (they're nullable and won't cause issues). **Recommendation: leave columns as-is** to avoid data loss on rollback. The code just stops reading/writing them.

**Files modified:**
- `packages/server/src/database/migrate.ts` -- no changes needed (leave existing migrations as-is; old columns are nullable and harmless)

**Estimated effort:** None (skip)

---

## Dependency Graph

```
Feature 00 (Remove meshy.ts + avatar-generate.ts from ai-service)
  |
  +---> Feature 01 (Remove meshyTaskId from shared types)
  |       |
  |       +---> Feature 02 (Remove Meshy server API routes) -- depends on 00, 01
  |       |       |
  |       |       +---> Feature 03 (Remove MESHY env vars) -- depends on 02
  |       |
  |       +---> Feature 04 (Remove Meshy from client main.ts) -- depends on 01
  |       |       |
  |       |       +---> Feature 05 (Simplify AvatarManager) -- depends on 04, 06
  |       |
  |       +---> Feature 11 (Clean up DaemonManager) -- depends on 01
  |
  +---> Feature 06 (Remove Meshy retargeting from animation-converter) -- depends on 00
          |
          +---> Feature 09 (Simplify AnimationConverterTool + AnimationPanel) -- depends on 06
          |
          +---> Feature 05 (Simplify AvatarManager) -- depends on 04, 06

Feature 07 (Simplify AvatarPanel UI) -- depends on 01, 04
Feature 08 (Simplify DaemonPanel UI) -- depends on 04
Feature 10 (Clean up GalleryPanel + ObjectRenderer) -- independent
Feature 12 (Update CLAUDE.md) -- do last, depends on all others
```

### Recommended execution order:
1. **Feature 00** -- Remove ai-service Meshy code (foundation -- everything else depends on this)
2. **Feature 01** -- Remove shared types (types propagate everywhere)
3. **Feature 06** -- Remove Meshy retargeting from animation-converter
4. **Feature 03** -- Remove MESHY env vars
5. **Feature 02** -- Remove Meshy server API routes (large, can be parallelized with 04)
6. **Feature 04** -- Remove Meshy from client main.ts (large, can be parallelized with 02)
7. **Feature 05** -- Simplify AvatarManager (depends on 04 + 06)
8. **Feature 07** -- Simplify AvatarPanel UI
9. **Feature 08** -- Simplify DaemonPanel UI
10. **Feature 09** -- Simplify AnimationConverterTool + AnimationPanel
11. **Feature 10** -- Clean up GalleryPanel + ObjectRenderer
12. **Feature 11** -- Clean up DaemonManager
13. **Feature 12** -- Update CLAUDE.md

### Parallelization opportunities:
- Features 02 and 04 can run in parallel (server vs client, both depend on 00+01)
- Features 07, 08, 09, 10 can run in parallel after their dependencies complete
- Feature 12 should run last

---

## Complexity Score

**Overall complexity: 3 out of 5**

**Rationale:**
- The work is primarily deletion and simplification, not creation of new functionality
- The FBX upload pipeline already exists and works -- no new conversion code needed
- The changes are spread across many files (20+ files affected) but the patterns are repetitive
- No database schema changes required (just stop writing to unused columns)
- The main risk is breaking the remaining avatar/animation system by removing too much or too little
- Type changes propagate widely but TypeScript will catch any missed references at compile time
- The generation.ts routes for world objects should be preserved (they use AI but NOT Meshy for the AI part -- Meshy was only for the 3D model generation step)

**Recommended agent count: 2-3 agents**
- Agent A: ai-service + server (Features 00, 01, 02, 03, 11)
- Agent B: client (Features 04, 05, 06, 07, 08, 09, 10)
- Agent C: documentation + verification (Feature 12 + type-check + smoke test)
