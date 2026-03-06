import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSET_CACHE_DIR = join(__dirname, "..", "..", "data", "assets");

/** Asset category subdirectories */
type AssetCategory = "rig" | "mesh" | "object" | "upload";

/** Validate that a URL points to an expected asset domain to prevent SSRF */
export function isAllowedAssetUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith(".amazonaws.com");
  } catch {
    return false;
  }
}

/** Get the full path for a cached asset file (whether or not it exists). */
function assetPath(category: AssetCategory, id: string, filename: string): string {
  return join(ASSET_CACHE_DIR, category, id, filename);
}

/** Check if a specific asset file exists in the cache. Returns path or null. */
export function getCachedPath(
  category: AssetCategory,
  id: string,
  filename: string,
): string | null {
  const p = assetPath(category, id, filename);
  return existsSync(p) ? p : null;
}

/** Read a cached asset file. Returns Buffer or null if not cached. */
export function readCachedAsset(
  category: AssetCategory,
  id: string,
  filename: string,
): Buffer | null {
  const p = getCachedPath(category, id, filename);
  if (!p) return null;
  try {
    return readFileSync(p);
  } catch {
    return null;
  }
}

/** Download a URL to a local file. Validates domain. Returns true on success. */
async function downloadToFile(url: string, filePath: string): Promise<boolean> {
  if (!isAllowedAssetUrl(url)) {
    console.warn(`Blocked download from untrusted domain: ${url}`);
    return false;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`Download failed (${res.status}): ${url}`);
      return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(filePath, buf);
    return true;
  } catch (err) {
    console.warn(`Download error for ${url}:`, err);
    return false;
  }
}

/** Ensure the directory for a category/id exists. */
function ensureDir(category: AssetCategory, id: string): string {
  const dir = join(ASSET_CACHE_DIR, category, id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Download a gallery object's GLB + thumbnail to local disk.
 * Uses the gallery ID as the cache key since objects are identified by DB row.
 *
 * @returns true if the model was successfully cached
 */
export async function cacheObjectAssets(
  galleryId: string,
  glbUrl: string,
  thumbnailUrl?: string | null,
): Promise<boolean> {
  // Already cached?
  if (getCachedPath("object", galleryId, "model.glb")) return true;

  const dir = ensureDir("object", galleryId);

  const modelOk = await downloadToFile(glbUrl, join(dir, "model.glb"));
  if (!modelOk) return false;

  // Download thumbnail if it's a CDN URL
  if (thumbnailUrl && !thumbnailUrl.startsWith("data:")) {
    await downloadToFile(thumbnailUrl, join(dir, "thumbnail.jpg"));
  }

  return true;
}
