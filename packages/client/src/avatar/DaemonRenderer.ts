import * as THREE from "three";
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

const MOOD_EMOJIS: Record<string, string> = {
  happy: ":)",
  neutral: ":|",
  bored: "._.",
  excited: ":D",
  annoyed: ">:|",
  curious: "?",
};

interface ChatBubble {
  sprite: THREE.Sprite;
  createdAt: number;
  duration: number;
}

interface EmoteParticle {
  mesh: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface EmoteLabel {
  sprite: THREE.Sprite;
  createdAt: number;
  duration: number;
}

interface DaemonInstance {
  group: THREE.Group;
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
  emoteParticles: EmoteParticle[];
  emoteLabels: EmoteLabel[];
  moodIndicator: THREE.Sprite | null;
  accentLight: THREE.PointLight;
  ringMesh: THREE.Mesh;
  // Body parts for animation
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  head: THREE.Mesh;
  bodyMesh: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  // Animation state
  gestureTimer: number;
  gesturePhase: number;
  // Thinking dots animation
  thinkingDots: THREE.Group | null;
  thinkingPhase: number;
  // Status indicators
  trailTimer: number;
  trailParticles: Array<{ mesh: THREE.Sprite; life: number }>;
  sleepZs: THREE.Group | null;
  sleepPhase: number;
  lastAction: DaemonAction;
}

export class DaemonRenderer {
  private daemons = new Map<string, DaemonInstance>();
  private daemonNames = new Map<string, string>();
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
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

    const behaviorType = daemon.definition.behavior.type;
    const accent = NPC_ACCENT_COLORS[behaviorType] || 0x44ff88;

    const parts = this.createNPCBody(accent);
    group.add(parts.body);

    // Name label with behavior tag
    const roleTag = behaviorType.charAt(0).toUpperCase() + behaviorType.slice(1);
    const nameSprite = this.createNameLabel(`[${roleTag}] ${daemon.definition.name}`);
    nameSprite.position.set(0, 2.1, 0);
    group.add(nameSprite);

    // Mood indicator
    const moodIndicator = this.createMoodIndicator(daemon.mood || "neutral");
    moodIndicator.position.set(0.3, 2.1, 0);
    group.add(moodIndicator);

    this.scene.add(group);

    this.daemonNames.set(daemon.daemonId, daemon.definition.name);

    this.daemons.set(daemon.daemonId, {
      group,
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
      behaviorType: daemon.definition.behavior.type,
      chatBubbles: [],
      emoteParticles: [],
      emoteLabels: [],
      moodIndicator,
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
      thinkingDots: null,
      thinkingPhase: 0,
      trailTimer: 0,
      trailParticles: [],
      sleepZs: null,
      sleepPhase: 0,
      lastAction: "idle",
    });
  }

  despawnDaemon(daemonId: string): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) return;
    this.scene.remove(daemon.group);
    this.daemons.delete(daemonId);
    this.daemonNames.delete(daemonId);
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
    canvas.width = 512;
    canvas.height = 128;

    const displayText = content.length > 70 ? content.slice(0, 67) + "..." : content;
    const isDaemonChat = !!targetDaemonId;

    // Background — different tint for daemon-daemon chat
    ctx.fillStyle = isDaemonChat ? "rgba(40, 0, 40, 0.85)" : "rgba(0, 40, 0, 0.85)";
    ctx.beginPath();
    ctx.roundRect(4, 4, 504, 120, 12);
    ctx.fill();

    // Border
    const borderColor = isDaemonChat ? "rgba(170, 68, 255, 0.5)" : "rgba(68, 255, 136, 0.5)";
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Name
    ctx.fillStyle = isDaemonChat ? "#aa44ff" : "#44ff88";
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(daemonName, 16, 14, 480);

    // Mood emoji
    const moodEmoji = MOOD_EMOJIS[daemon.mood] || "";
    if (moodEmoji) {
      ctx.fillStyle = "#888888";
      ctx.font = "16px system-ui, sans-serif";
      const nameWidth = ctx.measureText(daemonName).width;
      ctx.fillText(moodEmoji, 20 + nameWidth + 8, 16);
    }

    // Message
    ctx.fillStyle = "#ffffff";
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText(displayText, 16, 48, 480);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(3, 0.75, 1);

    const stackOffset = daemon.chatBubbles.length * 0.85;
    sprite.position.set(0, 2.4 + stackOffset, 0);
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
    sprite.position.set(0, 2.5, 0);
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
    this.updateMoodIndicator(daemon);
    this.updateMoodVisuals(daemon);

    // Spawn emote particles
    const color = MOOD_COLORS[mood] || 0x888888;
    for (let i = 0; i < 5; i++) {
      this.spawnEmoteParticle(daemon, color);
    }

    // Show emote text as floating label
    if (emote) {
      this.showEmoteLabel(daemon, emote, color);
    }

    // Pulse the accent light
    daemon.accentLight.intensity = 1.5;

    // Update ring color to match mood
    const ringMat = daemon.ringMesh.material as THREE.MeshStandardMaterial;
    ringMat.color.setHex(color);
    ringMat.emissive.setHex(color);

    // Trigger gesture based on mood
    daemon.gestureTimer = 1.5;
    daemon.gesturePhase = 0;
  }

  /** Update mood-driven visual properties: accent light color, body tint, animation speed */
  private updateMoodVisuals(daemon: DaemonInstance): void {
    const moodColor = MOOD_COLORS[daemon.mood] || 0x888888;

    // Accent light shifts color to match mood
    daemon.accentLight.color.setHex(moodColor);

    // Subtle body emissive tint — very faint mood coloring
    const bodyMat = daemon.bodyMesh.material as THREE.MeshStandardMaterial;
    bodyMat.emissive.setHex(moodColor);
    bodyMat.emissiveIntensity = daemon.mood === "excited" ? 0.08
      : daemon.mood === "happy" ? 0.04
      : daemon.mood === "annoyed" ? 0.06
      : daemon.mood === "curious" ? 0.03
      : 0.01; // bored/neutral barely glows
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

      // Status indicators
      this.updateStatusIndicators(daemon, dt);

      // Track action transitions
      daemon.lastAction = daemon.action;

      // Accent light decay
      if (daemon.accentLight.intensity > 0.3) {
        daemon.accentLight.intensity -= dt * 2;
        if (daemon.accentLight.intensity < 0.3) daemon.accentLight.intensity = 0.3;
      }

      // Emote particles
      for (let i = daemon.emoteParticles.length - 1; i >= 0; i--) {
        const p = daemon.emoteParticles[i];
        p.life -= dt;
        p.mesh.position.add(p.velocity.clone().multiplyScalar(dt));
        p.velocity.y -= dt * 0.5; // gravity
        const alpha = p.life / p.maxLife;
        (p.mesh.material as THREE.SpriteMaterial).opacity = alpha;
        p.mesh.scale.setScalar(0.1 + (1 - alpha) * 0.1);

        if (p.life <= 0) {
          p.mesh.parent?.remove(p.mesh);
          (p.mesh.material as THREE.SpriteMaterial).dispose();
          daemon.emoteParticles.splice(i, 1);
        }
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
          label.sprite.position.y = 2.6 + progress * 0.4;
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

  /** Get the name of a daemon by ID */
  getDaemonName(daemonId: string): string | null {
    return this.daemonNames.get(daemonId) || null;
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

    // Thinking dots
    if (!daemon.thinkingDots) {
      daemon.thinkingDots = this.createThinkingDots();
      daemon.thinkingDots.position.set(0, 2.3, 0);
      daemon.group.add(daemon.thinkingDots);
    }
    daemon.thinkingPhase += dt * 3;
    this.updateThinkingDots(daemon.thinkingDots, daemon.thinkingPhase);
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

    // Clean up thinking dots if present
    if (daemon.thinkingDots) {
      daemon.group.remove(daemon.thinkingDots);
      daemon.thinkingDots = null;
    }
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

  // ─── Status Indicators ─────────────────────────────────────────

  private updateStatusIndicators(daemon: DaemonInstance, dt: number): void {
    // Walking trail particles
    if (daemon.action === "walking") {
      daemon.trailTimer -= dt;
      if (daemon.trailTimer <= 0) {
        daemon.trailTimer = 0.3; // Spawn every 0.3s
        this.spawnTrailParticle(daemon);
      }
    }

    // Update trail particles
    for (let i = daemon.trailParticles.length - 1; i >= 0; i--) {
      const p = daemon.trailParticles[i];
      p.life -= dt;
      const alpha = p.life / 1.5;
      (p.mesh.material as THREE.SpriteMaterial).opacity = alpha * 0.4;
      p.mesh.scale.setScalar(0.04 + (1 - alpha) * 0.02);
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.SpriteMaterial).dispose();
        daemon.trailParticles.splice(i, 1);
      }
    }

    // Sleep Z's when bored
    if (daemon.mood === "bored" && daemon.action === "idle") {
      if (!daemon.sleepZs) {
        daemon.sleepZs = this.createSleepZs();
        daemon.sleepZs.position.set(0.2, 1.8, 0);
        daemon.group.add(daemon.sleepZs);
      }
      daemon.sleepPhase += dt * 1.5;
      this.updateSleepZs(daemon.sleepZs, daemon.sleepPhase);
    } else if (daemon.sleepZs) {
      daemon.group.remove(daemon.sleepZs);
      daemon.sleepZs = null;
    }

    // Ring rotation when walking (subtle spin effect)
    if (daemon.action === "walking") {
      daemon.ringMesh.rotation.z += dt * 2;
    }
  }

  private spawnTrailParticle(daemon: DaemonInstance): void {
    const accentColor = (daemon.ringMesh.material as THREE.MeshStandardMaterial).color.getHex();
    const mat = new THREE.SpriteMaterial({
      color: accentColor,
      transparent: true,
      opacity: 0.3,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(0.04);
    // Place at daemon's world position (feet level)
    sprite.position.copy(daemon.group.position);
    sprite.position.y = 0.05;
    this.scene.add(sprite); // Add to scene, not group, so it stays in place

    daemon.trailParticles.push({ mesh: sprite, life: 1.5 });

    // Limit trail length
    while (daemon.trailParticles.length > 15) {
      const old = daemon.trailParticles.shift()!;
      this.scene.remove(old.mesh);
      (old.mesh.material as THREE.SpriteMaterial).dispose();
    }
  }

  private createSleepZs(): THREE.Group {
    const group = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      canvas.width = 24;
      canvas.height = 24;

      ctx.fillStyle = "#6666aa";
      ctx.font = `bold ${14 - i * 2}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("z", 12, 12);

      const texture = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.12 - i * 0.02, 0.12 - i * 0.02, 1);
      sprite.position.set(i * 0.1, i * 0.15, 0);
      group.add(sprite);
    }
    return group;
  }

  private updateSleepZs(zGroup: THREE.Group, phase: number): void {
    zGroup.children.forEach((z, i) => {
      const offset = i * 1.2;
      const cyclePhase = (phase + offset) % 3;
      // Float up and fade
      (z as THREE.Sprite).position.y = i * 0.15 + Math.sin(cyclePhase * 0.7) * 0.1;
      const alpha = 0.3 + Math.sin(cyclePhase) * 0.2;
      ((z as THREE.Sprite).material as THREE.SpriteMaterial).opacity = alpha;
    });
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

  // ─── Particles ────────────────────────────────────────────────

  private spawnEmoteParticle(daemon: DaemonInstance, color: number): void {
    const mat = new THREE.SpriteMaterial({
      color,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(0.1);
    sprite.position.set(
      (Math.random() - 0.5) * 0.4,
      1.8 + Math.random() * 0.3,
      (Math.random() - 0.5) * 0.4,
    );
    daemon.group.add(sprite);

    daemon.emoteParticles.push({
      mesh: sprite,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.8,
        0.5 + Math.random() * 0.5,
        (Math.random() - 0.5) * 0.8,
      ),
      life: 1.5 + Math.random() * 0.5,
      maxLife: 2,
    });
  }

  // ─── Thinking Dots ────────────────────────────────────────────

  private createThinkingDots(): THREE.Group {
    const group = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.SpriteMaterial({
        color: 0xaaaaaa,
        transparent: true,
        depthTest: false,
      });
      const dot = new THREE.Sprite(mat);
      dot.scale.setScalar(0.06);
      dot.position.x = (i - 1) * 0.12;
      group.add(dot);
    }
    return group;
  }

  private updateThinkingDots(dots: THREE.Group, phase: number): void {
    dots.children.forEach((dot, i) => {
      const offset = i * 0.8;
      (dot as THREE.Sprite).position.y = Math.sin(phase + offset) * 0.05;
      const alpha = 0.4 + Math.sin(phase + offset) * 0.3;
      ((dot as THREE.Sprite).material as THREE.SpriteMaterial).opacity = alpha;
    });
  }

  // ─── Mood Indicator ───────────────────────────────────────────

  private updateMoodIndicator(daemon: DaemonInstance): void {
    if (!daemon.moodIndicator) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = 32;
    canvas.height = 32;

    const color = MOOD_COLORS[daemon.mood] || 0x888888;
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;

    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.beginPath();
    ctx.arc(16, 16, 10, 0, Math.PI * 2);
    ctx.fill();

    const oldTex = daemon.moodIndicator.material.map;
    if (oldTex) oldTex.dispose();

    daemon.moodIndicator.material.map = new THREE.CanvasTexture(canvas);
    daemon.moodIndicator.material.needsUpdate = true;
  }

  private createMoodIndicator(mood: DaemonMood): THREE.Sprite {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = 32;
    canvas.height = 32;

    const color = MOOD_COLORS[mood] || 0x888888;
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;

    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.beginPath();
    ctx.arc(16, 16, 10, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.15, 0.15, 1);
    return sprite;
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
  } {
    const body = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.7,
      metalness: 0.1,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.5,
      metalness: 0.2,
      emissive: accentColor,
      emissiveIntensity: 0.3,
    });

    // Torso (capsule)
    const bodyGeo = new THREE.CapsuleGeometry(0.2, 0.8, 8, 12);
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = 1.0;
    bodyMesh.castShadow = true;
    body.add(bodyMesh);

    // Head
    const headGeo = new THREE.SphereGeometry(0.14, 10, 8);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.y = 1.6;
    head.castShadow = true;
    body.add(head);

    // Eyes (small accent-colored dots)
    const eyeGeo = new THREE.SphereGeometry(0.02, 6, 4);
    const eyeMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      emissive: accentColor,
      emissiveIntensity: 0.5,
    });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.05, 1.62, 0.12);
    body.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.05, 1.62, 0.12);
    body.add(rightEye);

    // Accent ring (role indicator)
    const ringGeo = new THREE.TorusGeometry(0.18, 0.02, 8, 16);
    const ring = new THREE.Mesh(ringGeo, accentMat);
    ring.position.y = 1.75;
    ring.rotation.x = Math.PI / 2;
    body.add(ring);

    // Accent glow
    const glowLight = new THREE.PointLight(accentColor, 0.3, 2, 2);
    glowLight.position.set(0, 1.75, 0);
    body.add(glowLight);

    // Arms (capsules, attached at shoulder height)
    const armGeo = new THREE.CapsuleGeometry(0.035, 0.4, 6, 8);

    const leftArm = new THREE.Mesh(armGeo, bodyMat);
    leftArm.position.set(-0.25, 1.2, 0);
    leftArm.rotation.z = 0.05; // Slight outward rest
    body.add(leftArm);

    const rightArm = new THREE.Mesh(armGeo, bodyMat);
    rightArm.position.set(0.25, 1.2, 0);
    rightArm.rotation.z = -0.05;
    body.add(rightArm);

    // Hands (small spheres at arm tips)
    const handGeo = new THREE.SphereGeometry(0.04, 6, 4);
    const leftHand = new THREE.Mesh(handGeo, accentMat);
    leftHand.position.y = -0.24;
    leftArm.add(leftHand);

    const rightHand = new THREE.Mesh(handGeo, accentMat);
    rightHand.position.y = -0.24;
    rightArm.add(rightHand);

    // Legs
    const legGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.5, 6);
    const leftLeg = new THREE.Mesh(legGeo, bodyMat);
    leftLeg.position.set(-0.08, 0.3, 0);
    body.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, bodyMat);
    rightLeg.position.set(0.08, 0.3, 0);
    body.add(rightLeg);

    // Feet (small accent-colored cylinders)
    const footGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.03, 6);
    const leftFoot = new THREE.Mesh(footGeo, accentMat);
    leftFoot.position.y = -0.26;
    leftLeg.add(leftFoot);
    const rightFoot = new THREE.Mesh(footGeo, accentMat);
    rightFoot.position.y = -0.26;
    rightLeg.add(rightFoot);

    return { body, accentLight: glowLight, ringMesh: ring, leftArm, rightArm, head, bodyMesh, leftLeg, rightLeg };
  }

  private createNameLabel(name: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = 320;
    canvas.height = 48;

    ctx.fillStyle = "rgba(0, 30, 0, 0.6)";
    ctx.beginPath();
    ctx.roundRect(0, 0, 320, 48, 8);
    ctx.fill();

    ctx.fillStyle = "#44ff88";
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 160, 24, 300);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.8, 0.27, 1);
    return sprite;
  }
}
