/**
 * Animation converter utilities.
 *
 * Extracted from AvatarManager.ts to be reusable by both runtime loading
 * and the animation upload/conversion UI. Handles FBX/GLB → GLB export
 * and bone name normalization.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

/** Normalize a Mixamo bone name by stripping numeric prefix variants.
 *  Handles: "mixamorig9Hips" → "mixamorigHips", "mixamorig10Spine" → "mixamorigSpine".
 *  Three.js FBXLoader sanitizes colons, so "mixamorig:Hips" → "mixamorigHips" already. */
export function normalizeMixamoBoneName(name: string): string {
  return name.replace(/^mixamorig\d+/, "mixamorig");
}

/** Average all quaternion keyframes across an animation clip to get a "mean pose".
 *  For cyclic animations (walk/run) this averages out limb motion → ≈ standing pose.
 *  Returns a map of boneName → averaged quaternion. */
export function extractAveragePoses(clip: THREE.AnimationClip): Map<string, THREE.Quaternion> {
  const poses = new Map<string, THREE.Quaternion>();
  for (const track of clip.tracks) {
    if (!track.name.endsWith(".quaternion")) continue;
    const boneName = track.name.replace(".quaternion", "");
    const numFrames = track.values.length / 4;
    if (numFrames === 0) continue;

    // Start with first frame
    const avg = new THREE.Quaternion(
      track.values[0], track.values[1], track.values[2], track.values[3],
    );
    // Accumulate remaining frames, ensuring consistent hemisphere (avoid sign flips)
    for (let i = 1; i < numFrames; i++) {
      const q = new THREE.Quaternion(
        track.values[i * 4], track.values[i * 4 + 1], track.values[i * 4 + 2], track.values[i * 4 + 3],
      );
      // Flip to same hemisphere as running average
      if (avg.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      avg.x += q.x;
      avg.y += q.y;
      avg.z += q.z;
      avg.w += q.w;
    }
    avg.normalize();
    poses.set(boneName, avg);
  }
  return poses;
}

/** Convert a Mixamo FBX/GLB animation file to GLB without any bone renaming or retargeting.
 *  Used for uploading custom animations to Mixamo-bone-space avatars.
 *  @param file — the uploaded File (.fbx, .glb, or .gltf)
 *  @returns ArrayBuffer of the GLB */
export async function convertFbxToGlb(file: File): Promise<ArrayBuffer> {
  const ext = file.name.toLowerCase().split(".").pop();
  const url = URL.createObjectURL(file);

  let clip: THREE.AnimationClip;
  try {
    if (ext === "fbx") {
      const loader = new FBXLoader();
      const group = await loader.loadAsync(url);
      if (!group.animations || group.animations.length === 0) {
        throw new Error("FBX file contains no animations");
      }
      clip = group.animations[0];
    } else if (ext === "glb" || ext === "gltf") {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url);
      if (!gltf.animations || gltf.animations.length === 0) {
        throw new Error("File contains no animations");
      }
      clip = gltf.animations[0];
    } else {
      throw new Error(`Unsupported file format: .${ext}`);
    }
  } finally {
    URL.revokeObjectURL(url);
  }

  // Strip position tracks — Mixamo hip height (Y≈102) vs avatar rest pose (Y≈86) causes
  // legs to flip 180° and sinking/floating. Quaternion rotations are sufficient.
  const stripped = clip.tracks.filter(
    (t: THREE.KeyframeTrack) => !t.name.endsWith(".position"),
  );
  const strippedClip = new THREE.AnimationClip(clip.name, clip.duration, stripped);

  // Export as GLB with bone hierarchy (no retargeting)
  const scene = new THREE.Scene();
  const root = new THREE.Object3D();
  root.name = "AnimationRoot";
  scene.add(root);

  const bonesByName = new Map<string, THREE.Bone>();
  for (const track of strippedClip.tracks) {
    const boneName = track.name.split(".")[0];
    if (!bonesByName.has(boneName)) {
      const bone = new THREE.Bone();
      bone.name = boneName;
      bonesByName.set(boneName, bone);
    }
  }

  // Find the hip bone using normalized name (handles "mixamorig9Hips" etc.)
  let hipsBone: THREE.Bone | undefined;
  let hipsKey: string | undefined;
  for (const [name, bone] of bonesByName) {
    if (normalizeMixamoBoneName(name) === "mixamorigHips") {
      hipsBone = bone;
      hipsKey = name;
      break;
    }
  }
  if (hipsBone) {
    root.add(hipsBone);
    for (const [name, bone] of bonesByName) {
      if (name !== hipsKey) hipsBone.add(bone);
    }
  } else {
    for (const bone of bonesByName.values()) root.add(bone);
  }

  root.animations = [strippedClip];
  const exporter = new GLTFExporter();
  const glb = await exporter.parseAsync(root, { binary: true, animations: [strippedClip] });
  return glb as ArrayBuffer;
}

/** All texture property names on Three.js materials. Checked explicitly because
 *  Object.keys() may not reliably return inherited/prototype properties. */
const TEXTURE_PROPS = [
  "map", "normalMap", "specularMap", "emissiveMap", "aoMap", "bumpMap",
  "alphaMap", "envMap", "lightMap", "displacementMap", "roughnessMap",
  "metalnessMap", "gradientMap", "clearcoatMap", "clearcoatNormalMap",
  "clearcoatRoughnessMap", "sheenColorMap", "sheenRoughnessMap",
  "transmissionMap", "thicknessMap", "iridescenceMap",
] as const;

/** Convert a texture's image to an HTMLCanvasElement, handling all image source types.
 *  Returns null if conversion fails. */
async function imageToCanvas(img: any): Promise<HTMLCanvasElement | null> {
  if (!img) return null;

  // Already a canvas
  if (img instanceof HTMLCanvasElement) return img;

  // HTMLImageElement — must ensure it's loaded, then draw to canvas
  if (img instanceof HTMLImageElement) {
    // For blob: URLs, fetch raw blob data and use createImageBitmap (most reliable)
    if (img.src?.startsWith("blob:")) {
      try {
        const resp = await fetch(img.src);
        const blob = await resp.blob();
        const bmp = await createImageBitmap(blob);
        const c = document.createElement("canvas");
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext("2d")!.drawImage(bmp, 0, 0);
        bmp.close();
        return c;
      } catch (e) {
        console.warn("[FBX→GLB] Blob fetch failed:", e);
      }
    }
    // Standard loaded image
    if (!img.complete || img.naturalWidth === 0) {
      await new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
        setTimeout(resolve, 3000); // safety timeout
      });
    }
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w === 0 || h === 0) return null;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return c;
  }

  // ImageBitmap
  if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d")!.drawImage(img, 0, 0);
    return c;
  }

  // DataTexture-style { data, width, height }
  if (img.data && img.width && img.height) {
    const w = img.width, h = img.height;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    const channels = img.data.length / (w * h);
    const id = ctx.createImageData(w, h);
    if (channels === 4) {
      id.data.set(img.data);
    } else if (channels === 3) {
      for (let i = 0, j = 0; i < img.data.length; i += 3, j += 4) {
        id.data[j] = img.data[i]; id.data[j+1] = img.data[i+1];
        id.data[j+2] = img.data[i+2]; id.data[j+3] = 255;
      }
    } else return null;
    ctx.putImageData(id, 0, 0);
    return c;
  }

  // Generic drawable
  if (img.width > 0 && img.height > 0) {
    try {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      c.getContext("2d")!.drawImage(img, 0, 0);
      return c;
    } catch { return null; }
  }
  return null;
}

/** Replace all textures in the scene with CanvasTexture objects so GLTFExporter
 *  can embed them as binary image data in the GLB. Creates brand-new CanvasTexture
 *  instances rather than modifying existing texture objects in-place. */
async function bakeTexturesForExport(root: THREE.Object3D): Promise<number> {
  let converted = 0;
  const processed = new Map<THREE.Texture, THREE.CanvasTexture | null>();

  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    // Collect all {material, prop, texture} entries first
  });

  // Collect entries: {mat, prop, tex} for deferred async processing
  const entries: { mat: THREE.Material; prop: string; tex: THREE.Texture }[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      for (const prop of TEXTURE_PROPS) {
        const tex = (mat as any)[prop];
        if (tex && tex.isTexture) {
          entries.push({ mat, prop, tex });
        }
      }
      // Also scan Object.keys for any non-standard texture properties
      for (const key of Object.keys(mat)) {
        const val = (mat as any)[key];
        if (val && val.isTexture && !TEXTURE_PROPS.includes(key as any)) {
          entries.push({ mat, prop: key, tex: val });
        }
      }
    }
  });

  console.log(`[FBX→GLB] Found ${entries.length} texture slots to process`);

  for (const { mat, prop, tex } of entries) {
    // Check if we already processed this texture
    if (processed.has(tex)) {
      const cached = processed.get(tex)!;
      if (cached) (mat as any)[prop] = cached;
      else (mat as any)[prop] = null;
      continue;
    }

    try {
      const canvas = await imageToCanvas(tex.image);
      if (canvas) {
        // Create a brand new CanvasTexture — GLTFExporter handles these natively
        const canvasTex = new THREE.CanvasTexture(canvas);
        canvasTex.flipY = tex.flipY;
        canvasTex.wrapS = tex.wrapS;
        canvasTex.wrapT = tex.wrapT;
        canvasTex.colorSpace = tex.colorSpace;
        (mat as any)[prop] = canvasTex;
        processed.set(tex, canvasTex);
        converted++;
        console.log(`[FBX→GLB] Baked texture "${(mat as any).name}".${prop} ${canvas.width}x${canvas.height}`);
      } else {
        console.warn(`[FBX→GLB] Could not bake "${(mat as any).name}".${prop}, removing`);
        (mat as any)[prop] = null;
        processed.set(tex, null);
      }
    } catch (e) {
      console.warn(`[FBX→GLB] Failed to bake "${(mat as any).name}".${prop}:`, e);
      (mat as any)[prop] = null;
      processed.set(tex, null);
    }
  }

  return converted;
}

/** Convert a full Mixamo FBX character (mesh + skeleton + textures) to GLB.
 *  Used when uploading a Mixamo character as a custom avatar.
 *  Preserves original Mixamo bone names — no retargeting needed.
 *  @param file — the uploaded .fbx character file
 *  @returns ArrayBuffer of the GLB */
export async function convertFbxCharacterToGlb(file: File): Promise<ArrayBuffer> {
  const url = URL.createObjectURL(file);
  try {
    // Use LoadingManager to track ALL sub-resource loads (textures from embedded data)
    const manager = new THREE.LoadingManager();
    let pendingItems = 0;
    const allLoaded = new Promise<void>((resolve) => {
      let resolved = false;
      manager.onStart = (_u, loaded, total) => { pendingItems = total - loaded; };
      manager.onProgress = (_u, loaded, total) => { pendingItems = total - loaded; };
      manager.onLoad = () => { if (!resolved) { resolved = true; resolve(); } };
      // Give generous time for embedded textures to decode
      setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, 2000);
    });

    const loader = new FBXLoader(manager);
    const group = await loader.loadAsync(url);

    // Wait for all sub-resources (embedded textures) to finish loading
    await allLoaded;
    // Extra safety: wait for any blob images created by FBXLoader to fully load
    await new Promise(r => setTimeout(r, 500));

    // Log what FBXLoader produced
    let matCount = 0;
    group.traverse((obj: any) => {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (!mat) continue;
        matCount++;
        const found: string[] = [];
        for (const p of TEXTURE_PROPS) {
          if ((mat as any)[p]) found.push(p);
        }
        console.log(`[FBX→GLB] Material "${mat.name}" type=${mat.type}`,
          `color=${mat.color?.getHexString()}`,
          `textures=[${found.join(",")}]`);
        // Log image details for each texture
        for (const p of found) {
          const tex = (mat as any)[p];
          const img = tex?.image;
          console.log(`[FBX→GLB]   .${p} image:`,
            img?.constructor?.name,
            `${img?.width}x${img?.height}`,
            img?.src ? `src=${img.src.substring(0, 60)}...` : "(no src)");
        }
      }
    });
    console.log(`[FBX→GLB] ${matCount} materials found, pending sub-resources: ${pendingItems}`);

    // Scale to ~1.8m avatar height
    const box = new THREE.Box3().setFromObject(group);
    const height = box.max.y - box.min.y;
    if (height > 0) {
      const scale = 1.8 / height;
      group.scale.setScalar(scale);
    }

    // Bake all textures to CanvasTexture objects for reliable GLB embedding
    const baked = await bakeTexturesForExport(group);
    console.log(`[FBX→GLB] Baked ${baked} textures for export`);

    // Export full scene (mesh + skeleton + textures + any embedded animations)
    const exporter = new GLTFExporter();
    const glb = await exporter.parseAsync(group, {
      binary: true,
      animations: group.animations || [],
    });
    console.log(`[FBX→GLB] Exported GLB: ${(glb as ArrayBuffer).byteLength} bytes`);
    return glb as ArrayBuffer;
  } finally {
    URL.revokeObjectURL(url);
  }
}
