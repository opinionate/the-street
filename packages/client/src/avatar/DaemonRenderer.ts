import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { normalizeMixamoBoneName } from "./animation-converter.js";
import type { DaemonState, DaemonMood, DaemonAction, Vector3 as Vec3 } from "@the-street/shared";
import { CHAT_DISPLAY_DURATION } from "@the-street/shared";

const NPC_ACCENT_COLORS: Record<string, number> = {
  greeter: 0x44ff88,
  shopkeeper: 0xffaa00,
  guide: 0x4488ff,
  guard: 0xff4444,
  roamer: 0xaa44ff,
  socialite: 0xff44aa,
};

const MOOD_COLORS: Record<string, number> = {
  happy: 0x44ff88,
  neutral: 0x888888,
  bored: 0x666688,
  excited: 0xffff44,
  annoyed: 0xff6644,
  curious: 0x44ccff,
};

interface ChatBubble {
  sprite: THREE.Sprite;
  createdAt: number;
  duration: number;
}

interface EmoteLabel {
  sprite: THREE.Sprite;
  createdAt: number;
  duration: number;
}

interface DaemonCustomModel {
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: {
    idle?: THREE.AnimationAction;
    walk?: THREE.AnimationAction;
    run?: THREE.AnimationAction;
    emote?: THREE.AnimationAction;
  };
  currentAction: "idle" | "walk" | "run";
  baseY: number;
}

interface DaemonWispRefs {
  core: THREE.Sprite;
  coreMat: THREE.SpriteMaterial;
  glow: THREE.Sprite;
  glowMat: THREE.SpriteMaterial;
  light: THREE.PointLight;
}

interface DaemonInstance {
  group: THREE.Group;
  bodyGroup: THREE.Group;
  name: string;
  targetPosition: THREE.Vector3;
  targetRotation: number;
  currentRotation: number;
  animPhase: number;
  breathPhase: number;
  speed: number;
  action: DaemonAction;
  mood: DaemonMood;
  behaviorType: string;
  chatBubbles: ChatBubble[];
  emoteLabels: EmoteLabel[];
  moodIndicator?: null; // removed — kept for structural compat
  accentLight: THREE.PointLight;
  ringMesh: THREE.Mesh;
  // Body parts for animation
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  head: THREE.Mesh;
  bodyMesh: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  // Wisp (default appearance when no custom model)
  wisp: DaemonWispRefs | null;
  // Animation state
  gestureTimer: number;
  gesturePhase: number;
  lastAction: DaemonAction;
  customModel: DaemonCustomModel | null;
}

export class DaemonRenderer {
  private daemons = new Map<string, DaemonInstance>();
  private daemonNames = new Map<string, string>();
  private scene: THREE.Scene;
  private gltfLoader = new GLTFLoader();
  /** Cached wisp textures keyed by accent color hex to avoid per-daemon canvas allocation */
  private wispTextureCache = new Map<number, { core: THREE.Texture; glow: THREE.Texture }>();
  private fbxLoader = new FBXLoader();
  private cachedAnimClips: { idle?: THREE.AnimationClip; walk?: THREE.AnimationClip; run?: THREE.AnimationClip } = {};
  private animClipsLoading: Promise<void> | null = null;
  private static _tempVec3 = new THREE.Vector3();
  apiUrl = "";

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Build a map from normalized Mixamo bone name → actual node name in the model */
  private buildBoneMap(root: THREE.Object3D): Map<string, string> {
    const map = new Map<string, string>();
    root.traverse((obj) => {
      if (obj.name) {
        map.set(normalizeMixamoBoneName(obj.name), obj.name);
      }
    });
    return map;
  }

  /** Retarget an animation clip to match the model's bone names via normalization.
   *  Strips path prefixes (e.g. "AnimationRoot/mixamorigHips" → "mixamorigHips").
   *  Drops tracks whose normalized name has no match in the model. */
  private retargetClipToModel(clip: THREE.AnimationClip, boneMap: Map<string, string>): THREE.AnimationClip {
    const retargetedTracks: THREE.KeyframeTrack[] = [];
    for (const track of clip.tracks) {
      const dotIdx = track.name.indexOf(".");
      const fullPath = track.name.substring(0, dotIdx);
      const trackProp = track.name.substring(dotIdx); // e.g. ".quaternion"

      // Strip path prefix: "AnimationRoot/mixamorigHips" → "mixamorigHips"
      const slashIdx = fullPath.lastIndexOf("/");
      const boneName = slashIdx !== -1 ? fullPath.substring(slashIdx + 1) : fullPath;

      const normalized = normalizeMixamoBoneName(boneName);
      const modelNode = boneMap.get(normalized);
      if (!modelNode) continue; // drop unmatched tracks

      if (modelNode === boneName) {
        retargetedTracks.push(track);
      } else {
        const cloned = track.clone();
        cloned.name = modelNode + trackProp;
        retargetedTracks.push(cloned);
      }
    }

    return new THREE.AnimationClip(clip.name, clip.duration, retargetedTracks);
  }

  spawnDaemon(daemon: DaemonState): void {
    if (this.daemons.has(daemon.daemonId)) return;

    const group = new THREE.Group();
    group.name = `daemon_${daemon.daemonId}`;
    group.position.set(
      daemon.currentPosition.x,
      daemon.currentPosition.y,
      daemon.currentPosition.z,
    );
    group.rotation.y = daemon.currentRotation;

    const behaviorType = daemon.definition.behavior?.type || "roamer";
    const accent = NPC_ACCENT_COLORS[behaviorType] || 0x44ff88;

    const parts = this.createNPCBody(accent);
    group.add(parts.body);

    // Name label (hidden until targeted)
    const nameSprite = this.createNameLabel(daemon.definition.name, accent);
    nameSprite.position.set(0, 2.1, 0);
    nameSprite.name = "nameLabel";
    nameSprite.visible = false;
    group.add(nameSprite);

    this.scene.add(group);

    this.daemonNames.set(daemon.daemonId, daemon.definition.name);

    this.daemons.set(daemon.daemonId, {
      group,
      bodyGroup: parts.body,
      name: daemon.definition.name,
      targetPosition: new THREE.Vector3(
        daemon.currentPosition.x,
        daemon.currentPosition.y,
        daemon.currentPosition.z,
      ),
      targetRotation: daemon.currentRotation,
      currentRotation: daemon.currentRotation,
      animPhase: Math.random() * Math.PI * 2,
      breathPhase: Math.random() * Math.PI * 2,
      speed: 0,
      action: daemon.currentAction as DaemonAction,
      mood: daemon.mood || "neutral",
      behaviorType: daemon.definition.behavior?.type || "roamer",
      chatBubbles: [],
      emoteLabels: [],
      moodIndicator: null,
      accentLight: parts.accentLight,
      ringMesh: parts.ringMesh,
      leftArm: parts.leftArm,
      rightArm: parts.rightArm,
      head: parts.head,
      bodyMesh: parts.bodyMesh,
      leftLeg: parts.leftLeg,
      rightLeg: parts.rightLeg,
      gestureTimer: 0,
      gesturePhase: 0,
      lastAction: "idle",
      customModel: null,
      wisp: parts.wisp ?? null,
    });

    // Load custom character model if available
    if (daemon.characterUploadId && this.apiUrl) {
      this.loadCustomModel(daemon.daemonId, daemon.characterUploadId);
    }
  }

  /** Replace or load a custom character model for a daemon (public for live updates) */
  reloadCustomModel(daemonId: string, uploadId: string): void {
    const instance = this.daemons.get(daemonId);
    if (!instance) return;

    // Tear down existing custom model if any
    if (instance.customModel) {
      instance.customModel.mixer.stopAllAction();
      instance.customModel.mixer.uncacheRoot(instance.customModel.model);
      instance.group.remove(instance.customModel.model);
      instance.customModel = null;
      instance.bodyGroup.visible = true;
    }

    this.loadCustomModel(daemonId, uploadId);
  }

  private async loadCustomModel(daemonId: string, uploadId: string): Promise<void> {
    const instance = this.daemons.get(daemonId);
    if (!instance) return;

    try {
      // Load model and shared animations in parallel
      const modelUrl = `${this.apiUrl}/api/daemons/assets/${uploadId}/model`;
      const [fbx] = await Promise.all([
        this.fbxLoader.loadAsync(modelUrl),
        this.ensureAnimClips(),
      ]);

      // Scale to reasonable size (FBX models are often in cm)
      const box = new THREE.Box3().setFromObject(fbx);
      const height = box.max.y - box.min.y;
      if (height > 0) {
        const targetHeight = 1.7; // ~1.7m human height
        const scale = targetHeight / height;
        fbx.scale.setScalar(scale);
      }

      // Center horizontally, feet on ground, face forward
      fbx.rotation.y = Math.PI; // Mixamo FBX models face +Z, game forward is -Z
      const scaledBox = new THREE.Box3().setFromObject(fbx);
      fbx.position.y = -scaledBox.min.y;
      fbx.position.x = -(scaledBox.min.x + scaledBox.max.x) / 2;
      fbx.position.z = -(scaledBox.min.z + scaledBox.max.z) / 2;

      // Build bone map for retargeting
      const boneMap = this.buildBoneMap(fbx);

      // Set up animation mixer and actions from shared clips
      const mixer = new THREE.AnimationMixer(fbx);
      const actions: DaemonCustomModel["actions"] = {};

      // Load custom idle animation (GLB uploaded via AnimationPanel)
      try {
        const idleUrl = `${this.apiUrl}/api/animations/daemon/${daemonId}/idle?_v=${Date.now()}`;
        const idleRes = await fetch(idleUrl);
        if (idleRes.ok) {
          const gltf = await new Promise<any>((resolve, reject) => {
            this.gltfLoader.load(idleUrl, resolve, undefined, reject);
          });
          if (gltf.animations.length > 0) {
            const retargeted = this.retargetClipToModel(gltf.animations[0], boneMap);
            actions.idle = mixer.clipAction(retargeted);
            console.log(`[Daemon] Loaded custom idle for ${daemonId}`);
          }
        }
      } catch {
        // No custom idle — will use shared
      }

      // Apply shared animation clips (idle, walk, run)
      for (const type of ["idle", "walk", "run"] as const) {
        if (actions[type]) continue; // already loaded (e.g. custom idle)
        const clip = this.cachedAnimClips[type];
        if (!clip) continue;
        const retargeted = this.retargetClipToModel(clip, boneMap);
        if (retargeted.tracks.length === 0) continue;
        actions[type] = mixer.clipAction(retargeted);
      }

      // Start idle
      if (actions.idle) {
        actions.idle.play();
      }

      // Hide entire procedural body (includes eyes, accent light, etc.)
      instance.bodyGroup.visible = false;

      instance.group.add(fbx);
      instance.customModel = {
        model: fbx,
        mixer,
        actions,
        currentAction: "idle",
        baseY: 0,
      };

      console.log(`[Daemon] Loaded custom model for ${daemonId} (idle=${!!actions.idle} walk=${!!actions.walk} run=${!!actions.run})`);
    } catch (err) {
      console.warn(`[Daemon] Failed to load custom model for ${daemonId}:`, err);
    }
  }

  /** Hot-swap the idle animation for a daemon that already has a custom model loaded. */
  async reloadIdleAnimation(daemonId: string): Promise<void> {
    const instance = this.daemons.get(daemonId);
    if (!instance?.customModel) return;

    const { mixer, actions, model } = instance.customModel;

    let newClip: THREE.AnimationClip | null = null;

    // Try custom idle animation (GLB uploaded via AnimationPanel)
    try {
      const idleUrl = `${this.apiUrl}/api/animations/daemon/${daemonId}/idle?_v=${Date.now()}`;
      const gltf = await new Promise<any>((resolve, reject) => {
        this.gltfLoader.load(idleUrl, resolve, undefined, reject);
      });
      if (gltf.animations.length > 0) {
        const boneMap = this.buildBoneMap(model);
        newClip = this.retargetClipToModel(gltf.animations[0], boneMap);
      }
    } catch {
      // No custom idle
    }

    if (!newClip) return;

    // Stop and uncache old idle
    if (actions.idle) {
      actions.idle.stop();
      mixer.uncacheAction(actions.idle.getClip());
    }

    // Play new idle
    actions.idle = mixer.clipAction(newClip);
    actions.idle.play();
    console.log(`[Daemon] Hot-swapped idle animation for ${daemonId}`);
  }

  despawnDaemon(daemonId: string): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) return;

    // Stop and uncache animation mixer for custom models
    if (daemon.customModel?.mixer) {
      daemon.customModel.mixer.stopAllAction();
      daemon.customModel.mixer.uncacheRoot(daemon.customModel.model);
    }

    // Dispose emote labels
    for (const label of daemon.emoteLabels) {
      label.sprite.parent?.remove(label.sprite);
      label.sprite.material.map?.dispose();
      label.sprite.material.dispose();
    }
    daemon.emoteLabels.length = 0;

    // Dispose chat bubbles
    for (const bubble of daemon.chatBubbles) {
      bubble.sprite.parent?.remove(bubble.sprite);
      bubble.sprite.material.map?.dispose();
      bubble.sprite.material.dispose();
    }
    daemon.chatBubbles.length = 0;

    // Dispose all geometries, materials, textures in the daemon group
    this.disposeGroup(daemon.group);
    this.scene.remove(daemon.group);
    this.daemons.delete(daemonId);
    this.daemonNames.delete(daemonId);
  }

  /** Recursively dispose all geometries, materials, and textures in a group */
  private disposeGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of materials) {
          if (!mat) continue;
          const texProps = ["map", "normalMap", "emissiveMap", "roughnessMap", "metalnessMap",
            "aoMap", "alphaMap", "bumpMap", "displacementMap", "envMap", "lightMap"] as const;
          for (const prop of texProps) {
            const tex = (mat as any)[prop] as THREE.Texture | undefined;
            if (tex) tex.dispose();
          }
          mat.dispose();
        }
      }
      if (child instanceof THREE.Sprite) {
        const mat = child.material as THREE.SpriteMaterial;
        mat.map?.dispose();
        mat.dispose();
      }
    });
  }

  /** Load shared Mixamo animation clips for daemon models (cached after first load).
   *  Loads idle (shared), walk-mixamo, run. Strips position tracks. */
  private async ensureAnimClips(): Promise<void> {
    if (this.cachedAnimClips.idle) return;
    if (this.animClipsLoading) { await this.animClipsLoading; return; }
    this.animClipsLoading = (async () => {
      // idle has no -mixamo variant; walk/run prefer -mixamo, fall back to plain
      const toLoad: Array<{ key: "idle" | "walk" | "run"; urls: string[] }> = [
        { key: "idle", urls: [`${this.apiUrl}/api/avatar/animations/idle`] },
        { key: "walk", urls: [`${this.apiUrl}/api/avatar/animations/walk-mixamo`, `${this.apiUrl}/api/avatar/animations/walk`] },
        { key: "run",  urls: [`${this.apiUrl}/api/avatar/animations/run`] },
      ];
      for (const { key, urls } of toLoad) {
        for (const url of urls) {
          try {
            const gltf = await this.gltfLoader.loadAsync(url);
            if (gltf.animations?.length > 0) {
              const srcClip = gltf.animations[0];
              // Strip position tracks to prevent sinking/floating
              const filtered = srcClip.tracks.filter(
                (t: THREE.KeyframeTrack) => !t.name.endsWith(".position"),
              );
              this.cachedAnimClips[key] = new THREE.AnimationClip(
                srcClip.name, srcClip.duration, filtered,
              );
              break; // loaded successfully, skip fallback URLs
            }
          } catch {
            // Try next URL or skip
          }
        }
      }
      if (!this.cachedAnimClips.idle && !this.cachedAnimClips.walk) {
        this.animClipsLoading = null;
      }
    })();
    await this.animClipsLoading;
  }

  moveDaemon(daemonId: string, position: Vec3, rotation: number, action: string): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) return;
    daemon.targetPosition.set(position.x, position.y, position.z);
    daemon.targetRotation = rotation;
    daemon.action = action as DaemonAction;
  }

  showDaemonChat(daemonId: string, daemonName: string, content: string, targetDaemonId?: string): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const canvasWidth = 512;
    const padding = 16;
    const maxTextWidth = canvasWidth - padding * 2;

    // Word-wrap the full message text
    ctx.font = "18px system-ui, sans-serif";
    const lines = this.wrapText(ctx, content, maxTextWidth);

    // Calculate canvas height dynamically
    const nameLineHeight = 26;
    const textLineHeight = 22;
    const topPad = 14;
    const bottomPad = 14;
    const canvasHeight = topPad + nameLineHeight + lines.length * textLineHeight + bottomPad;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Background — neutral gray
    ctx.fillStyle = "rgba(30, 30, 30, 0.85)";
    ctx.beginPath();
    ctx.roundRect(4, 4, canvasWidth - 8, canvasHeight - 8, 12);
    ctx.fill();

    // Border — subtle white
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Name
    const isDaemonChat = !!targetDaemonId;
    ctx.fillStyle = isDaemonChat ? "#cc99ff" : "#88ddaa";
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(daemonName, padding, topPad, maxTextWidth);

    // Message lines
    ctx.fillStyle = "#ffffff";
    ctx.font = "18px system-ui, sans-serif";
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], padding, topPad + nameLineHeight + i * textLineHeight, maxTextWidth);
    }

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    const spriteHeight = (canvasHeight / canvasWidth) * 3;
    sprite.scale.set(3, spriteHeight, 1);

    const stackOffset = daemon.chatBubbles.length * (spriteHeight + 0.1);
    const bubbleBaseY = daemon.wisp && !daemon.customModel ? 1.8 : 2.4;
    sprite.position.set(0, bubbleBaseY + stackOffset, 0);
    daemon.group.add(sprite);

    const bubble: ChatBubble = {
      sprite,
      createdAt: Date.now(),
      duration: CHAT_DISPLAY_DURATION * 1000,
    };
    daemon.chatBubbles.push(bubble);

    while (daemon.chatBubbles.length > 3) {
      const old = daemon.chatBubbles.shift()!;
      old.sprite.parent?.remove(old.sprite);
      old.sprite.material.map?.dispose();
      old.sprite.material.dispose();
    }

    // Trigger talking gesture
    daemon.gestureTimer = 2.0;
    daemon.gesturePhase = 0;
  }

  /** Word-wrap text into lines that fit within maxWidth */
  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? currentLine + " " + word : word;
      const width = ctx.measureText(testLine).width;
      if (width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines.length > 0 ? lines : [""];
  }

  showDaemonThought(daemonId: string, thought: string): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = 320;
    canvas.height = 48;

    const displayThought = thought.length > 35 ? thought.slice(0, 32) + "..." : thought;

    // Translucent cloud-like background
    ctx.fillStyle = "rgba(60, 60, 80, 0.5)";
    ctx.beginPath();
    ctx.roundRect(4, 4, 312, 40, 16);
    ctx.fill();

    // Dotted border for thought-bubble feel
    ctx.strokeStyle = "rgba(150, 150, 200, 0.4)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();

    // Italic text in soft color
    ctx.fillStyle = "rgba(180, 180, 220, 0.9)";
    ctx.font = "italic 14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(displayThought, 160, 24, 296);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.8, 0.27, 1);
    const emoteBaseY = daemon.wisp && !daemon.customModel ? 1.9 : 2.5;
    sprite.position.set(0, emoteBaseY, 0);
    daemon.group.add(sprite);

    // Thought bubbles float up gently and fade out over 4 seconds
    const createdAt = Date.now();
    const duration = 4000;
    const label: EmoteLabel = { sprite, createdAt, duration };
    daemon.emoteLabels.push(label);

    // Max 1 thought bubble at a time
    while (daemon.emoteLabels.length > 2) {
      const old = daemon.emoteLabels.shift()!;
      old.sprite.parent?.remove(old.sprite);
      old.sprite.material.map?.dispose();
      old.sprite.material.dispose();
    }
  }

  showDaemonEmote(daemonId: string, emote: string, mood: DaemonMood): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) return;

    daemon.mood = mood;

    const color = MOOD_COLORS[mood] || 0x888888;

    // Show emote text as floating label
    if (emote) {
      this.showEmoteLabel(daemon, emote, color);
    }

    // Pulse the accent light
    daemon.accentLight.intensity = 1.5;

    // Update ring color to match mood (skip if stub/basic material)
    const ringMat = daemon.ringMesh.material;
    if ("color" in ringMat) (ringMat as THREE.MeshStandardMaterial).color.setHex(color);
    if ("emissive" in ringMat) (ringMat as THREE.MeshStandardMaterial).emissive.setHex(color);

    // Trigger gesture based on mood
    daemon.gestureTimer = 1.5;
    daemon.gesturePhase = 0;
  }

  /** Play an animated emote on a daemon's rigged model */
  async playDaemonEmote(daemonId: string, emoteId: string): Promise<void> {
    const instance = this.daemons.get(daemonId);
    if (!instance?.customModel) return;

    const cm = instance.customModel;

    // Try loading custom emote for this daemon, then shared fallback
    let clip: THREE.AnimationClip | null = null;
    try {
      const url = `${this.apiUrl}/api/animations/daemon/${daemonId}/emote-${emoteId}`;
      const gltf = await this.gltfLoader.loadAsync(url);
      if (gltf.animations.length > 0) clip = gltf.animations[0];
    } catch {
      // No custom emote — try shared default
      try {
        const url = `${this.apiUrl}/api/avatar/emotes/${emoteId}`;
        const gltf = await this.gltfLoader.loadAsync(url);
        if (gltf.animations.length > 0) clip = gltf.animations[0];
      } catch {
        console.warn(`[Daemon] No emote animation found for ${emoteId}`);
        return;
      }
    }
    if (!clip) return;

    // Retarget GLB bone names to match the FBX model
    const boneMap = this.buildBoneMap(cm.model);
    clip = this.retargetClipToModel(clip, boneMap);

    // Stop any existing emote
    if (cm.actions.emote) {
      cm.actions.emote.fadeOut(0.3);
      cm.actions.emote = undefined;
    }

    // Crossfade from current action to emote
    const prevAction = cm.actions[cm.currentAction] || cm.actions.idle;
    const emoteAction = cm.mixer.clipAction(clip);
    emoteAction.setLoop(THREE.LoopOnce, 1);
    emoteAction.clampWhenFinished = true;
    emoteAction.reset();
    if (prevAction) {
      prevAction.crossFadeTo(emoteAction, 0.3, true);
    }
    emoteAction.play();
    cm.actions.emote = emoteAction;

    // Auto-return to idle after clip finishes
    const duration = clip.duration * 1000;
    setTimeout(() => {
      // Verify this emote action is still the active one
      if (cm.actions.emote !== emoteAction) return;
      emoteAction.fadeOut(0.3);
      cm.actions.emote = undefined;
      const idleAction = cm.actions.idle;
      if (idleAction) {
        idleAction.reset().fadeIn(0.3).play();
      }
      cm.currentAction = "idle";
    }, duration + 100);
  }

  /** Get animation speed multiplier based on mood */
  private getMoodSpeedMultiplier(mood: DaemonMood): number {
    switch (mood) {
      case "excited": return 1.4;
      case "happy": return 1.1;
      case "curious": return 1.05;
      case "annoyed": return 0.9;
      case "bored": return 0.6;
      case "neutral":
      default: return 1.0;
    }
  }

  update(dt: number): void {
    const now = Date.now();

    for (const [_id, daemon] of this.daemons) {
      // Interpolate position
      daemon.group.position.lerp(daemon.targetPosition, Math.min(dt * 8, 1));

      // Smooth rotation
      let rotDiff = daemon.targetRotation - daemon.currentRotation;
      while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
      while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
      daemon.currentRotation += rotDiff * Math.min(dt * 8, 1);
      daemon.group.rotation.y = daemon.currentRotation;

      // --- Custom model animation ---
      if (daemon.customModel) {
        const cm = daemon.customModel;
        const CROSS_FADE_DURATION = 0.3;

        // Derive speed from actual movement (position delta)
        const dist = daemon.group.position.distanceTo(daemon.targetPosition);
        if (dist > 0.1) {
          daemon.speed += (3 - daemon.speed) * Math.min(dt * 5, 1);
        } else {
          daemon.speed *= 1 - Math.min(dt * 5, 1);
        }

        let targetAction: "idle" | "walk" | "run";
        if (daemon.speed > 5) {
          targetAction = "run";
        } else if (daemon.speed > 0.3) {
          targetAction = "walk";
        } else {
          targetAction = "idle";
        }

        if (targetAction !== cm.currentAction) {
          const prevClip = cm.actions[cm.currentAction];
          const nextClip = cm.actions[targetAction];

          if (prevClip && nextClip) {
            nextClip.reset();
            prevClip.crossFadeTo(nextClip, CROSS_FADE_DURATION, true);
            nextClip.play();
          } else if (nextClip) {
            nextClip.reset();
            nextClip.time = nextClip.getClip().duration * 0.25;
            nextClip.fadeIn(CROSS_FADE_DURATION).play();
          } else if (prevClip) {
            prevClip.fadeOut(CROSS_FADE_DURATION);
          }

          cm.currentAction = targetAction;
        }

        // Idle breathing
        if (targetAction === "idle") {
          daemon.breathPhase += dt * 1.5;
          const breath = Math.sin(daemon.breathPhase);
          cm.model.position.y = cm.baseY + breath * 0.003;
        } else {
          cm.model.position.y = cm.baseY;
        }

        cm.mixer.update(dt);

        // Skip procedural animation for custom models
        // (still process chat bubbles, emotes, mood below)
      }

      if (daemon.wisp && !daemon.customModel) {
        // Wisp animation (matches avatar wisp style)
        const w = daemon.wisp;
        daemon.breathPhase += dt * 2.0;
        const t = daemon.breathPhase;
        // Gentle float
        w.core.position.y = 1.0 + Math.sin(t * 0.8) * 0.06;
        w.glow.position.y = w.core.position.y;
        w.light.position.y = w.core.position.y;
        // Pulsing opacity
        w.coreMat.opacity = 0.8 + Math.sin(t * 1.2) * 0.15;
        w.glowMat.opacity = 0.7 + Math.sin(t * 0.9) * 0.15;
        w.light.intensity = 1.5 + Math.sin(t * 1.3) * 0.5;
        // Breathing glow scale
        const glowScale = 1.4 + Math.sin(t * 1.0) * 0.15;
        w.glow.scale.set(glowScale, glowScale, 1);
      } else if (!daemon.customModel) {
        // Breathing (always active — subtle body scale pulse)
        daemon.breathPhase += dt * 1.5;
        const breathScale = 1 + Math.sin(daemon.breathPhase) * 0.008;
        daemon.bodyMesh.scale.set(1, breathScale, 1);

        // Animate based on action
        this.animateAction(daemon, dt);

        // Gesture animation (arms, head bobbing during emotes/chat)
        if (daemon.gestureTimer > 0) {
          daemon.gestureTimer -= dt;
          daemon.gesturePhase += dt * 6;
          this.animateGesture(daemon);
        } else {
          // Return arms to rest
          this.returnToRest(daemon, dt);
        }
      }

      // Track action transitions
      daemon.lastAction = daemon.action;

      // Accent light decay (skip for wisps — wisp animation controls the light)
      if (!daemon.wisp && daemon.accentLight.intensity > 0.3) {
        daemon.accentLight.intensity -= dt * 2;
        if (daemon.accentLight.intensity < 0.3) daemon.accentLight.intensity = 0.3;
      }

      // Emote labels
      for (let i = daemon.emoteLabels.length - 1; i >= 0; i--) {
        const label = daemon.emoteLabels[i];
        const age = now - label.createdAt;
        if (age >= label.duration) {
          label.sprite.parent?.remove(label.sprite);
          label.sprite.material.map?.dispose();
          label.sprite.material.dispose();
          daemon.emoteLabels.splice(i, 1);
        } else {
          // Float upward and fade
          const progress = age / label.duration;
          const labelBaseY = daemon.wisp && !daemon.customModel ? 2.0 : 2.6;
          label.sprite.position.y = labelBaseY + progress * 0.4;
          label.sprite.material.opacity = 1 - progress * progress;
        }
      }

      // Chat bubble cleanup
      for (let i = daemon.chatBubbles.length - 1; i >= 0; i--) {
        const bubble = daemon.chatBubbles[i];
        const age = now - bubble.createdAt;
        if (age >= bubble.duration) {
          bubble.sprite.parent?.remove(bubble.sprite);
          bubble.sprite.material.map?.dispose();
          bubble.sprite.material.dispose();
          daemon.chatBubbles.splice(i, 1);
        } else {
          const fadeStart = bubble.duration * 0.8;
          if (age > fadeStart) {
            const fadeProgress = (age - fadeStart) / (bubble.duration - fadeStart);
            bubble.sprite.material.opacity = 1 - fadeProgress;
          }
        }
      }
    }
  }

  /** Set a movement intent from DaemonThought (approach/retreat/idle/face/patrol) */
  setDaemonMovementIntent(daemonId: string, movement: string, _addressedTo: string): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) return;

    // Map movement intents to daemon actions
    switch (movement) {
      case "approach":
        daemon.action = "walking";
        break;
      case "retreat":
        daemon.action = "walking";
        break;
      case "face":
        daemon.action = "idle";
        break;
      case "patrol":
        daemon.action = "walking";
        break;
      case "idle":
      default:
        daemon.action = "idle";
        break;
    }
  }

  /** Get the name of a daemon by ID */
  getDaemonName(daemonId: string): string | null {
    return this.daemonNames.get(daemonId) || null;
  }

  /** Get all daemon IDs */
  getAllDaemonIds(): string[] {
    return Array.from(this.daemons.keys());
  }

  /** Get daemon position by ID */
  getDaemonPosition(daemonId: string): THREE.Vector3 | null {
    const daemon = this.daemons.get(daemonId);
    return daemon ? daemon.group.position.clone() : null;
  }

  /** Get daemon info for the targeting info card */
  getDaemonInfo(daemonId: string): {
    name: string;
    role: string;
    mood: string;
    action: string;
  } | null {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) return null;
    return {
      name: daemon.name,
      role: daemon.behaviorType,
      mood: daemon.mood,
      action: daemon.action,
    };
  }

  /** Show name label for a specific daemon */
  showNameLabel(daemonId: string): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) return;
    const label = daemon.group.getObjectByName("nameLabel");
    if (label) label.visible = true;
  }

  /** Hide name label for a specific daemon */
  hideNameLabel(daemonId: string): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) return;
    const label = daemon.group.getObjectByName("nameLabel");
    if (label) label.visible = false;
  }

  /** Get daemon IDs near a world position */
  getDaemonsNear(pos: THREE.Vector3, radius: number): string[] {
    const results: string[] = [];
    for (const [id, daemon] of this.daemons) {
      if (daemon.group.position.distanceTo(pos) < radius) {
        results.push(id);
      }
    }
    return results;
  }

  getAllDaemonStates(): DaemonState[] {
    const states: DaemonState[] = [];
    for (const [id, daemon] of this.daemons) {
      states.push({
        daemonId: id,
        definition: { name: daemon.name, description: "", behavior: { type: daemon.behaviorType } } as DaemonState["definition"],
        currentPosition: { x: daemon.group.position.x, y: daemon.group.position.y, z: daemon.group.position.z },
        currentRotation: daemon.currentRotation,
        currentAction: daemon.action,
        mood: daemon.mood,
        characterUploadId: daemon.customModel ? id : undefined,
      });
    }
    return states;
  }

  // ─── Action Animations ────────────────────────────────────────

  private animateAction(daemon: DaemonInstance, dt: number): void {
    const action = daemon.action;
    // Apply mood-based animation speed multiplier
    const moodDt = dt * this.getMoodSpeedMultiplier(daemon.mood);

    switch (action) {
      case "walking":
        this.animateWalking(daemon, moodDt);
        break;
      case "waving":
        this.animateWaving(daemon, moodDt);
        break;
      case "laughing":
        this.animateLaughing(daemon, moodDt);
        break;
      case "thinking":
        this.animateThinking(daemon, moodDt);
        break;
      case "talking":
        this.animateTalking(daemon, moodDt);
        break;
      case "emoting":
        this.animateEmoting(daemon, moodDt);
        break;
      case "idle":
      default:
        this.animateIdle(daemon, moodDt);
        break;
    }
  }

  private animateWalking(daemon: DaemonInstance, dt: number): void {
    daemon.animPhase += dt * 5;
    daemon.speed += (3 - daemon.speed) * Math.min(dt * 5, 1);

    // Leg swing
    const legSwing = Math.sin(daemon.animPhase) * 0.3;
    daemon.leftLeg.rotation.x = legSwing;
    daemon.rightLeg.rotation.x = -legSwing;

    // Arm swing (opposite to legs)
    daemon.leftArm.rotation.x = -legSwing * 0.6;
    daemon.rightArm.rotation.x = legSwing * 0.6;

    // Subtle body bob
    daemon.group.position.y = Math.abs(Math.sin(daemon.animPhase * 2)) * 0.02;

    // Head slight turn in walk direction
    daemon.head.rotation.y = Math.sin(daemon.animPhase * 0.5) * 0.05;
  }

  private animateWaving(daemon: DaemonInstance, dt: number): void {
    daemon.animPhase += dt * 8;

    // Right arm waves up and down
    daemon.rightArm.rotation.x = -2.0; // Arm raised
    daemon.rightArm.rotation.z = Math.sin(daemon.animPhase) * 0.4 - 0.5;

    // Body slight bob
    daemon.group.position.y = Math.sin(daemon.animPhase * 0.5) * 0.01;

    // Head tilts slightly
    daemon.head.rotation.z = Math.sin(daemon.animPhase * 0.7) * 0.08;
  }

  private animateLaughing(daemon: DaemonInstance, dt: number): void {
    daemon.animPhase += dt * 12;

    // Rapid body shake
    daemon.bodyMesh.rotation.z = Math.sin(daemon.animPhase) * 0.05;
    daemon.bodyMesh.position.y = 1.0 + Math.abs(Math.sin(daemon.animPhase * 2)) * 0.02;

    // Arms shake outward
    daemon.leftArm.rotation.z = 0.3 + Math.sin(daemon.animPhase * 1.5) * 0.15;
    daemon.rightArm.rotation.z = -0.3 - Math.sin(daemon.animPhase * 1.5) * 0.15;
    daemon.leftArm.rotation.x = -0.4 + Math.sin(daemon.animPhase) * 0.1;
    daemon.rightArm.rotation.x = -0.4 + Math.sin(daemon.animPhase) * 0.1;

    // Head tilts back
    daemon.head.rotation.x = -0.15 + Math.sin(daemon.animPhase * 3) * 0.05;
  }

  private animateThinking(daemon: DaemonInstance, dt: number): void {
    daemon.animPhase += dt * 2;

    // Right arm up to chin (thinking pose)
    daemon.rightArm.rotation.x = -1.2;
    daemon.rightArm.rotation.z = -0.3;

    // Left arm hangs
    daemon.leftArm.rotation.x = 0;
    daemon.leftArm.rotation.z = 0.05;

    // Head tilts slightly, slow sway
    daemon.head.rotation.z = 0.1 + Math.sin(daemon.animPhase) * 0.03;
    daemon.head.rotation.x = -0.05;

  }

  private animateTalking(daemon: DaemonInstance, dt: number): void {
    daemon.animPhase += dt * 4;

    // Subtle hand gestures while talking
    daemon.leftArm.rotation.x = -0.3 + Math.sin(daemon.animPhase) * 0.15;
    daemon.rightArm.rotation.x = -0.3 + Math.sin(daemon.animPhase + 1.5) * 0.15;
    daemon.leftArm.rotation.z = 0.15 + Math.sin(daemon.animPhase * 0.7) * 0.05;
    daemon.rightArm.rotation.z = -0.15 - Math.sin(daemon.animPhase * 0.7) * 0.05;

    // Slight head nod
    daemon.head.rotation.x = Math.sin(daemon.animPhase * 1.5) * 0.05;
  }

  private animateEmoting(daemon: DaemonInstance, dt: number): void {
    daemon.animPhase += dt * 6;

    // Expressive full-body movement
    daemon.bodyMesh.rotation.z = Math.sin(daemon.animPhase) * 0.03;

    // Arms spread out
    daemon.leftArm.rotation.z = 0.5 + Math.sin(daemon.animPhase) * 0.2;
    daemon.rightArm.rotation.z = -0.5 - Math.sin(daemon.animPhase) * 0.2;
    daemon.leftArm.rotation.x = -0.5 + Math.sin(daemon.animPhase * 0.5) * 0.1;
    daemon.rightArm.rotation.x = -0.5 + Math.sin(daemon.animPhase * 0.5) * 0.1;

    // Bouncy head
    daemon.head.rotation.y = Math.sin(daemon.animPhase * 0.8) * 0.1;
  }

  private animateIdle(daemon: DaemonInstance, dt: number): void {
    daemon.speed *= 1 - Math.min(dt * 5, 1);
    daemon.animPhase += dt * 0.5;

    // Personality-driven idle animations
    switch (daemon.behaviorType) {
      case "guard":
        // Rigid, alert stance — minimal movement, occasional head scan
        daemon.bodyMesh.rotation.z = 0;
        daemon.head.rotation.y = Math.sin(daemon.animPhase * 0.15) * 0.12; // slow scan
        daemon.leftArm.rotation.x *= 1 - Math.min(dt * 5, 1); // arms at sides
        daemon.rightArm.rotation.x *= 1 - Math.min(dt * 5, 1);
        break;

      case "socialite":
        // Fidgety, looking around — weight shifting, head turning
        daemon.bodyMesh.rotation.z = Math.sin(daemon.animPhase * 0.6) * 0.02;
        daemon.head.rotation.y = Math.sin(daemon.animPhase * 0.4) * 0.15;
        daemon.head.rotation.x = Math.sin(daemon.animPhase * 0.25) * 0.04;
        // Weight shift — body sways side to side
        daemon.bodyMesh.position.x = Math.sin(daemon.animPhase * 0.35) * 0.01;
        break;

      case "shopkeeper":
        // Leaning forward slightly, hands together
        daemon.bodyMesh.rotation.x = -0.03; // slight lean
        daemon.bodyMesh.rotation.z = Math.sin(daemon.animPhase * 0.2) * 0.005;
        daemon.leftArm.rotation.z = 0.15; // arms closer to body
        daemon.rightArm.rotation.z = -0.15;
        break;

      case "greeter":
        // Upbeat, slight bouncy energy
        daemon.bodyMesh.rotation.z = Math.sin(daemon.animPhase * 0.4) * 0.015;
        daemon.group.position.y = Math.abs(Math.sin(daemon.animPhase * 0.3)) * 0.005;
        daemon.head.rotation.y = Math.sin(daemon.animPhase * 0.5) * 0.08;
        break;

      case "roamer":
        // Relaxed, looking around curiously
        daemon.bodyMesh.rotation.z = Math.sin(daemon.animPhase * 0.25) * 0.012;
        daemon.head.rotation.y = Math.sin(daemon.animPhase * 0.3) * 0.2; // wide head turns
        break;

      default:
        // Generic subtle sway
        daemon.bodyMesh.rotation.z = Math.sin(daemon.animPhase * 0.3) * 0.01;
        break;
    }

    // Legs return to rest (all types)
    daemon.leftLeg.rotation.x *= 1 - Math.min(dt * 3, 1);
    daemon.rightLeg.rotation.x *= 1 - Math.min(dt * 3, 1);

  }

  // ─── Gesture Overlay (during chat/emote events) ────────────────

  private animateGesture(daemon: DaemonInstance): void {
    const phase = daemon.gesturePhase;
    const mood = daemon.mood;

    // Mood-specific gesture overlay
    switch (mood) {
      case "excited":
        // Bouncy arms
        daemon.leftArm.rotation.x = -0.8 + Math.sin(phase * 2) * 0.3;
        daemon.rightArm.rotation.x = -0.8 + Math.sin(phase * 2 + 1) * 0.3;
        daemon.group.position.y = Math.abs(Math.sin(phase * 3)) * 0.03;
        break;
      case "happy":
        // Light arm movement
        daemon.leftArm.rotation.z = 0.1 + Math.sin(phase) * 0.1;
        daemon.rightArm.rotation.z = -0.1 - Math.sin(phase) * 0.1;
        break;
      case "annoyed":
        // Tense posture, arms crossed feel
        daemon.leftArm.rotation.x = -0.5;
        daemon.rightArm.rotation.x = -0.5;
        daemon.leftArm.rotation.z = 0.3;
        daemon.rightArm.rotation.z = -0.3;
        daemon.head.rotation.z = -0.1;
        break;
      case "curious":
        // Head tilt, one arm up
        daemon.head.rotation.z = 0.15;
        daemon.head.rotation.x = 0.1;
        daemon.rightArm.rotation.x = -0.6 + Math.sin(phase) * 0.1;
        break;
      case "bored":
        // Slouchy, slow sway
        daemon.bodyMesh.position.y = 0.98;
        daemon.leftArm.rotation.x = Math.sin(phase * 0.3) * 0.05;
        break;
    }
  }

  private returnToRest(daemon: DaemonInstance, dt: number): void {
    // Only apply if not in an action that controls arms
    if (daemon.action !== "idle") return;

    const lerp = Math.min(dt * 3, 1);
    daemon.leftArm.rotation.x *= 1 - lerp;
    daemon.leftArm.rotation.z = daemon.leftArm.rotation.z * (1 - lerp) + 0.05 * lerp;
    daemon.rightArm.rotation.x *= 1 - lerp;
    daemon.rightArm.rotation.z = daemon.rightArm.rotation.z * (1 - lerp) - 0.05 * lerp;
    daemon.head.rotation.x *= 1 - lerp;
    daemon.head.rotation.y *= 1 - lerp;
    daemon.head.rotation.z *= 1 - lerp;
    daemon.bodyMesh.position.y = daemon.bodyMesh.position.y * (1 - lerp) + 1.0 * lerp;
    daemon.bodyMesh.rotation.z *= 1 - lerp;
  }

  // ─── Emote Label ──────────────────────────────────────────────

  private showEmoteLabel(daemon: DaemonInstance, emote: string, color: number): void {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = 256;
    canvas.height = 40;

    const displayEmote = emote.length > 30 ? emote.slice(0, 27) + "..." : emote;

    // Semi-transparent background
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.beginPath();
    ctx.roundRect(2, 2, 252, 36, 6);
    ctx.fill();

    // Emote text in mood color
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.font = "italic 16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(displayEmote, 128, 20, 240);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.5, 0.23, 1);
    sprite.position.set(0, 2.6, 0);
    daemon.group.add(sprite);

    daemon.emoteLabels.push({
      sprite,
      createdAt: Date.now(),
      duration: 3000,
    });

    // Max 2 emote labels
    while (daemon.emoteLabels.length > 2) {
      const old = daemon.emoteLabels.shift()!;
      old.sprite.parent?.remove(old.sprite);
      old.sprite.material.map?.dispose();
      old.sprite.material.dispose();
    }
  }


  // ─── NPC Body Construction ────────────────────────────────────

  private createNPCBody(accentColor: number): {
    body: THREE.Group;
    accentLight: THREE.PointLight;
    ringMesh: THREE.Mesh;
    leftArm: THREE.Mesh;
    rightArm: THREE.Mesh;
    head: THREE.Mesh;
    bodyMesh: THREE.Mesh;
    leftLeg: THREE.Mesh;
    rightLeg: THREE.Mesh;
    wisp: DaemonWispRefs;
  } {
    const body = new THREE.Group();

    // --- Wisp textures (cached per accent color) ---
    let cached = this.wispTextureCache.get(accentColor);
    if (!cached) {
      const c = new THREE.Color(accentColor);
      const r = Math.round(c.r * 255);
      const g = Math.round(c.g * 255);
      const b = Math.round(c.b * 255);

      const coreCanvas = document.createElement("canvas");
      coreCanvas.width = 128;
      coreCanvas.height = 128;
      const cCtx = coreCanvas.getContext("2d")!;
      const coreGrad = cCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
      coreGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.5)`);
      coreGrad.addColorStop(0.25, `rgba(${r}, ${g}, ${b}, 0.2)`);
      coreGrad.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, 0.05)`);
      coreGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      cCtx.fillStyle = coreGrad;
      cCtx.fillRect(0, 0, 128, 128);
      const coreTex = new THREE.CanvasTexture(coreCanvas);

      const glowCanvas = document.createElement("canvas");
      glowCanvas.width = 128;
      glowCanvas.height = 128;
      const gCtx = glowCanvas.getContext("2d")!;
      const gradient = gCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.6)`);
      gradient.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, 0.25)`);
      gradient.addColorStop(0.7, `rgba(${r}, ${g}, ${b}, 0.05)`);
      gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      gCtx.fillStyle = gradient;
      gCtx.fillRect(0, 0, 128, 128);
      const glowTex = new THREE.CanvasTexture(glowCanvas);

      cached = { core: coreTex, glow: glowTex };
      this.wispTextureCache.set(accentColor, cached);
    }

    const coreMat = new THREE.SpriteMaterial({
      map: cached.core,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const core = new THREE.Sprite(coreMat);
    core.scale.set(0.7, 0.7, 1);
    core.position.y = 1.0;
    body.add(core);

    const glowMat = new THREE.SpriteMaterial({
      map: cached.glow,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(1.4, 1.4, 1);
    glow.position.y = 1.0;
    body.add(glow);

    // --- Point light with accent color ---
    const light = new THREE.PointLight(accentColor, 1.5, 5, 2);
    light.position.y = 1.0;
    body.add(light);

    // --- Stub mesh refs so procedural animation code writes harmlessly ---
    const stubMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    stubMesh.visible = false;

    return {
      body,
      accentLight: light,
      ringMesh: stubMesh,
      leftArm: stubMesh,
      rightArm: stubMesh,
      head: stubMesh,
      bodyMesh: stubMesh,
      leftLeg: stubMesh,
      rightLeg: stubMesh,
      wisp: { core, coreMat, glow, glowMat, light },
    };
  }

  private createNameLabel(name: string, accentColor = 0x44ff88): THREE.Sprite {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    // Dynamic width based on name length
    const fontSize = 22;
    const font = `bold ${fontSize}px 'Courier New', monospace`;
    ctx.font = font;
    const textWidth = ctx.measureText(name).width;
    const hPad = 24;
    const canvasWidth = Math.ceil(textWidth + hPad * 2);
    const canvasHeight = 40;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const r = ((accentColor >> 16) & 0xff);
    const g = ((accentColor >> 8) & 0xff);
    const b = (accentColor & 0xff);

    // Background — dark translucent with accent border
    ctx.fillStyle = `rgba(5, 5, 15, 0.75)`;
    ctx.beginPath();
    ctx.roundRect(1, 1, canvasWidth - 2, canvasHeight - 2, 3);
    ctx.fill();

    // Accent border (thin)
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.7)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(1, 1, canvasWidth - 2, canvasHeight - 2, 3);
    ctx.stroke();

    // Accent glow line at bottom
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(6, canvasHeight - 3);
    ctx.lineTo(canvasWidth - 6, canvasHeight - 3);
    ctx.stroke();

    // Name text with subtle glow
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.6)`;
    ctx.shadowBlur = 6;
    ctx.fillStyle = `rgb(${Math.min(r + 80, 255)}, ${Math.min(g + 80, 255)}, ${Math.min(b + 80, 255)})`;
    ctx.fillText(name, canvasWidth / 2, canvasHeight / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    // Scale proportional to canvas aspect ratio
    const aspect = canvasWidth / canvasHeight;
    const spriteHeight = 0.22;
    sprite.scale.set(spriteHeight * aspect, spriteHeight, 1);
    return sprite;
  }
}
