/**
 * Admin tool: allows uploading new movement animations from Mixamo FBX files.
 *
 * Upload Mixamo FBX for walk/run/turn/strafe/jump slots.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

const MOVEMENT_SLOTS = [
  "idle", "walk", "run",
  "turnLeft", "turnRight",
  "strafeLeftWalk", "strafeRightWalk",
  "strafeLeftRun", "strafeRightRun",
  "jump",
] as const;

export class AnimationConverterTool {
  private container: HTMLDivElement;
  private logEl: HTMLDivElement;
  private apiUrl: string;
  private authToken: string;

  // Movement upload UI
  private slotSelect: HTMLSelectElement;
  private fileInput: HTMLInputElement;
  private uploadBtn: HTMLButtonElement;

  /** Set of slot names that already have a custom upload */
  private uploadedSlots: Set<string> = new Set();

  /** Called after shared animations are uploaded so the caller can reload clips */
  onSharedAnimsUploaded: (() => void) | null = null;

  constructor(apiUrl: string, authToken: string) {
    this.apiUrl = apiUrl;
    this.authToken = authToken;

    this.container = document.createElement("div");
    this.container.style.cssText = `
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    `;

    const label = document.createElement("div");
    label.style.cssText = "font-size: 12px; color: rgba(255, 255, 255, 0.5); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;";
    label.textContent = "Upload Movement Animation";
    this.container.appendChild(label);

    const desc = document.createElement("div");
    desc.style.cssText = "font-size: 11px; color: rgba(255, 255, 255, 0.3); margin-bottom: 10px;";
    desc.textContent = "Upload a Mixamo FBX file for a movement slot. Slots marked with \u2713 already have a custom animation.";
    this.container.appendChild(desc);

    // Slot selector
    const selectRow = document.createElement("div");
    selectRow.style.cssText = "display: flex; gap: 8px; margin-bottom: 8px; align-items: center;";

    this.slotSelect = document.createElement("select");
    this.slotSelect.style.cssText = `
      flex: 1; padding: 6px 8px;
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 4px;
      color: white;
      font-size: 12px;
      font-family: system-ui, sans-serif;
      outline: none;
    `;
    this.rebuildSlotOptions();
    selectRow.appendChild(this.slotSelect);

    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = ".fbx,.glb,.gltf";
    this.fileInput.style.cssText = "flex: 1; font-size: 11px; color: rgba(255,255,255,0.6);";
    selectRow.appendChild(this.fileInput);

    this.container.appendChild(selectRow);

    this.uploadBtn = document.createElement("button");
    this.uploadBtn.textContent = "Convert & Upload";
    this.uploadBtn.style.cssText = `
      background: rgba(68, 136, 255, 0.2);
      border: 1px solid rgba(68, 136, 255, 0.4);
      border-radius: 4px;
      color: #4488ff;
      font-size: 12px;
      padding: 6px 16px;
      cursor: pointer;
      width: 100%;
    `;
    this.uploadBtn.addEventListener("click", () => this.uploadMovementAnimation());
    this.container.appendChild(this.uploadBtn);

    // Log area
    this.logEl = document.createElement("div");
    this.logEl.style.cssText = `
      margin-top: 8px;
      max-height: 200px;
      overflow-y: auto;
      font-size: 11px;
      font-family: monospace;
      color: rgba(255, 255, 255, 0.5);
    `;
    this.container.appendChild(this.logEl);

    // Load existing uploads to mark which slots are filled
    this.loadExistingUploads();
  }

  private rebuildSlotOptions(): void {
    const prev = this.slotSelect.value;
    this.slotSelect.innerHTML = "";
    for (const slot of MOVEMENT_SLOTS) {
      const opt = document.createElement("option");
      opt.value = slot;
      // Browser dropdown menus render options on a white background,
      // so use dark text colors for readability in the dropdown list
      opt.style.cssText = "font-family: system-ui, sans-serif; background: #1a1a2e;";
      if (this.uploadedSlots.has(slot)) {
        opt.textContent = `\u2713  ${slot}`;
        opt.style.color = "#22aa55";
      } else {
        opt.textContent = `\u2500  ${slot}`;
        opt.style.color = "#999999";
      }
      this.slotSelect.appendChild(opt);
    }
    if (prev) this.slotSelect.value = prev;
  }

  private async loadExistingUploads(): Promise<void> {
    try {
      const res = await fetch(`${this.apiUrl}/api/animations/shared`, {
        headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {},
      });
      if (!res.ok) return;
      const data = await res.json();
      this.uploadedSlots.clear();
      for (const anim of data.animations ?? []) {
        this.uploadedSlots.add(anim.slot);
      }
      this.rebuildSlotOptions();
    } catch {
      // ignore — will just show no checkmarks
    }
  }

  get element(): HTMLDivElement {
    return this.container;
  }

  private log(msg: string, color = "rgba(255, 255, 255, 0.5)"): void {
    const line = document.createElement("div");
    line.style.cssText = `color: ${color}; padding: 1px 0;`;
    line.textContent = msg;
    this.logEl.appendChild(line);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private async uploadMovementAnimation(): Promise<void> {
    const file = this.fileInput.files?.[0];
    if (!file) {
      this.log("No file selected", "#ffaa00");
      return;
    }

    const slot = this.slotSelect.value;
    this.uploadBtn.disabled = true;
    this.uploadBtn.textContent = "Converting...";
    this.logEl.innerHTML = "";

    const gltfLoader = new GLTFLoader();
    const fbxLoader = new FBXLoader();
    const exporter = new GLTFExporter();

    try {
      // Step 1: Load the FBX/GLB file
      this.log(`Loading ${file.name}...`);
      const arrayBuffer = await file.arrayBuffer();
      let clip: THREE.AnimationClip;

      if (file.name.toLowerCase().endsWith(".fbx")) {
        const group = fbxLoader.parse(arrayBuffer, "");
        if (!group.animations.length) {
          this.log("ERROR: FBX has no animation clips", "#ff4444");
          return;
        }
        clip = group.animations[0];
      } else {
        // GLB/GLTF
        const blob = new Blob([arrayBuffer]);
        const url = URL.createObjectURL(blob);
        try {
          const gltf = await gltfLoader.loadAsync(url);
          if (!gltf.animations.length) {
            this.log("ERROR: GLB has no animation clips", "#ff4444");
            return;
          }
          clip = gltf.animations[0];
        } finally {
          URL.revokeObjectURL(url);
        }
      }

      this.log(`  Found clip: ${clip.name}, ${clip.duration.toFixed(2)}s, ${clip.tracks.length} tracks`);

      // Step 2: Strip position tracks and export
      this.log(`Exporting ${slot}.glb...`);
      const cleanClip = this.stripPositionTracks(clip);
      await this.exportAndUpload(exporter, cleanClip, slot);

      this.log(`${slot} uploaded successfully!`, "#44ff44");
      this.uploadedSlots.add(slot);
      this.rebuildSlotOptions();
      this.onSharedAnimsUploaded?.();
    } catch (err) {
      this.log(`ERROR: ${err instanceof Error ? err.message : err}`, "#ff4444");
    } finally {
      this.uploadBtn.disabled = false;
      this.uploadBtn.textContent = "Convert & Upload";
    }
  }

  /** Strip .position tracks from a clip (prevents sinking/floating with Mixamo characters) */
  private stripPositionTracks(clip: THREE.AnimationClip): THREE.AnimationClip {
    const filtered = clip.tracks.filter(
      (t: THREE.KeyframeTrack) => !t.name.endsWith(".position"),
    );
    return new THREE.AnimationClip(clip.name, clip.duration, filtered);
  }

  private async exportAndUpload(
    exporter: GLTFExporter,
    clip: THREE.AnimationClip,
    slot: string,
  ): Promise<void> {
    // Export clip as GLB
    const root = new THREE.Object3D();
    root.name = "AnimationRoot";
    root.animations = [clip];

    // GLTFExporter needs named objects in scene graph for animation track targets
    const boneNames = new Set<string>();
    for (const track of clip.tracks) {
      const boneName = track.name.split(".")[0];
      if (boneName) boneNames.add(boneName);
    }
    for (const name of boneNames) {
      const bone = new THREE.Bone();
      bone.name = name;
      root.add(bone);
    }

    const glb = await exporter.parseAsync(root, { binary: true, animations: [clip] });
    const buffer = glb as ArrayBuffer;

    this.log(`  Uploading ${slot} (${(buffer.byteLength / 1024).toFixed(1)} KB)...`);

    const res = await fetch(`${this.apiUrl}/api/animations/convert-shared`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-slot": slot,
        Authorization: `Bearer ${this.authToken}`,
      },
      body: buffer,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Upload failed for ${slot}: ${err.error}`);
    }

    this.log(`  ${slot} uploaded successfully`, "#44ff44");
  }
}
