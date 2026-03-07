# Dead Code Report

Generated during Pass 1 of the codebase review. Each entry has been verified by cross-referencing all imports across the full monorepo.

## Legend
- **DEAD**: Not imported/called/referenced anywhere outside its own file. Safe to delete.
- **SUSPECT**: Referenced but usage is vestigial or the export is unnecessary (e.g., exported but only used internally).

---

## packages/shared/src/types.ts

| Status | Block | Lines | Reason |
|--------|-------|-------|--------|
| DEAD | `PlatformPrimitive` interface | 297-305 | Exported but never imported anywhere in the codebase |
| DEAD | `ParameterDef` interface | 288-295 | Exported but never imported anywhere; only used by `PlatformPrimitive` which is also dead |
| DEAD | `AssetRecord` interface | 321-333 | Exported but never imported anywhere |
| DEAD | `DaemonMemoryStore` interface | 474-480 | Exported but never imported anywhere |
| DEAD | `TokenCost` interface | 446-451 | Exported but never imported anywhere |
| DEAD | `DaemonCreationDraft` interface | 611-630 | Exported but never imported anywhere |
| SUSPECT | `SavedPosition` interface | 9-11 | Only imported in StreetRoom.ts — minimal usage |

## packages/ai-service/src/mesh-router.ts

| Status | Block | Lines | Reason |
|--------|-------|-------|--------|
| DEAD | `routeMesh` function | 16-39 | Exported from index.ts but never imported by any consumer outside the package |
| DEAD | `ArchetypeRoute` interface | 3-7 | Part of dead `routeMesh` system |
| DEAD | `NovelRoute` interface | 9-12 | Part of dead `routeMesh` system |
| DEAD | `MeshRoute` type | 14 | Part of dead `routeMesh` system |

**Note:** The entire file `mesh-router.ts` is dead. It's also re-exported from `index.ts`.

## packages/ai-service/src/index.ts

| Status | Block | Lines | Reason |
|--------|-------|-------|--------|
| DEAD | `routeMesh` re-export | 2 | Re-exports dead mesh-router function |
| DEAD | `MeshRoute`, `ArchetypeRoute`, `NovelRoute` type re-exports | 3 | Re-exports dead mesh-router types |

## packages/server/src/env.ts

| Status | Block | Lines | Reason |
|--------|-------|-------|--------|
| DEAD | `Env` interface | 3-17 | Never imported anywhere |
| DEAD | `requireEnv` function | 19-23 | Never imported; only called by dead `loadEnv` |
| DEAD | `optionalEnv` function | 25-27 | Never imported; only called by dead `loadEnv` |
| DEAD | `loadEnv` function | 29-45 | Never imported anywhere — server/index.ts loads .env manually |

**Note:** The entire file `env.ts` is dead. The server's `index.ts` has its own manual .env loading at the top.

## packages/asset-pipeline/src/signing.ts

| Status | Block | Lines | Reason |
|--------|-------|-------|--------|
| DEAD | `verifySignature` function | 16-24 | Exported from index.ts but never imported by any consumer |

## packages/asset-pipeline/src/upload.ts

| Status | Block | Lines | Reason |
|--------|-------|-------|--------|
| DEAD | `getAssetUrl` function | 71-73 | Exported from index.ts but never imported by any consumer |

## packages/server/src/services/DaemonEvolutionEngine.ts

| Status | Block | Lines | Reason |
|--------|-------|-------|--------|
| DEAD | `checkVisitorMilestone` function | 384+ | Exported but never called from DaemonManager or anywhere else |

## packages/client/src/avatar/animation-converter.ts

| Status | Block | Lines | Reason |
|--------|-------|-------|--------|
| SUSPECT | `extractAveragePoses` function | 23-55 | Exported but only called within the same file (by `convertFbxToGlb`). Export is unnecessary but function is internally active. |

## packages/client/src/ui/GalleryPanel.ts

| Status | Block | Lines | Reason |
|--------|-------|-------|--------|
| SUSPECT | `GalleryItem` interface | 1-7 | Exported but only used within same file |

## packages/client/src/ui/AvatarPanel.ts

| Status | Block | Lines | Reason |
|--------|-------|-------|--------|
| SUSPECT | `AvatarHistoryItem` interface | 5-11 | Exported but only used within same file |

## packages/client/src/ui/ChatUI.ts

| Status | Block | Lines | Reason |
|--------|-------|-------|--------|
| SUSPECT | `ChatMessageType` type | 1 | Exported but only used within same file |

---

## Summary

| Status | Count |
|--------|-------|
| DEAD (safe to delete) | 16 blocks across 6 files (1 entire file: `env.ts`, 1 entire file: `mesh-router.ts`) |
| SUSPECT (export unnecessary) | 5 blocks (internally used, export keyword can be removed) |

### Files that can be entirely deleted:
1. `packages/server/src/env.ts` — all exports dead, superseded by manual .env loading in `index.ts`
2. `packages/ai-service/src/mesh-router.ts` — all exports dead, never consumed

### Cleanup in re-export files:
- `packages/ai-service/src/index.ts` — remove `routeMesh`, `MeshRoute`, `ArchetypeRoute`, `NovelRoute` re-exports
- `packages/asset-pipeline/src/index.ts` — remove `verifySignature` and `getAssetUrl` re-exports
