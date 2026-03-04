import * as THREE from "three";
import type { DaemonState, DaemonMood, Vector3 as Vec3 } from "@the-street/shared";
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

interface DaemonInstance {
  group: THREE.Group;
  targetPosition: THREE.Vector3;
  targetRotation: number;
  currentRotation: number;
  animPhase: number;
  breathPhase: number;
  speed: number;
  action: string;
  mood: DaemonMood;
  chatBubbles: ChatBubble[];
  emoteParticles: EmoteParticle[];
  moodIndicator: THREE.Sprite | null;
  accentLight: THREE.PointLight;
  ringMesh: THREE.Mesh;
  // Thinking dots animation
  thinkingDots: THREE.Group | null;
  thinkingPhase: number;
}

export class DaemonRenderer {
  private daemons = new Map<string, DaemonInstance>();
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

    const { body, accentLight, ringMesh } = this.createNPCBody(accent);
    group.add(body);

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
      action: daemon.currentAction,
      mood: daemon.mood || "neutral",
      chatBubbles: [],
      emoteParticles: [],
      moodIndicator,
      accentLight,
      ringMesh,
      thinkingDots: null,
      thinkingPhase: 0,
    });
  }

  despawnDaemon(daemonId: string): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) return;
    this.scene.remove(daemon.group);
    this.daemons.delete(daemonId);
  }

  moveDaemon(daemonId: string, position: Vec3, rotation: number, action: string): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) return;
    daemon.targetPosition.set(position.x, position.y, position.z);
    daemon.targetRotation = rotation;
    daemon.action = action;
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
  }

  showDaemonEmote(daemonId: string, emote: string, mood: DaemonMood): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) return;

    daemon.mood = mood;
    this.updateMoodIndicator(daemon);

    // Spawn emote particles
    const color = MOOD_COLORS[mood] || 0x888888;
    for (let i = 0; i < 5; i++) {
      this.spawnEmoteParticle(daemon, color);
    }

    // Pulse the accent light
    daemon.accentLight.intensity = 1.5;

    // Update ring color to match mood
    const ringMat = daemon.ringMesh.material as THREE.MeshStandardMaterial;
    ringMat.color.setHex(color);
    ringMat.emissive.setHex(color);
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

      // Walking animation
      const isWalking = daemon.action === "walking";
      if (isWalking) {
        daemon.animPhase += dt * 5;
        daemon.speed += (3 - daemon.speed) * Math.min(dt * 5, 1);
      } else {
        daemon.speed *= 1 - Math.min(dt * 5, 1);
      }

      if (isWalking) {
        daemon.group.position.y = Math.abs(Math.sin(daemon.animPhase * 2)) * 0.02;
      }

      // Breathing
      daemon.breathPhase += dt * 1.5;

      // Thinking animation
      if (daemon.action === "thinking") {
        if (!daemon.thinkingDots) {
          daemon.thinkingDots = this.createThinkingDots();
          daemon.thinkingDots.position.set(0, 2.3, 0);
          daemon.group.add(daemon.thinkingDots);
        }
        daemon.thinkingPhase += dt * 3;
        this.updateThinkingDots(daemon.thinkingDots, daemon.thinkingPhase);
      } else if (daemon.thinkingDots) {
        daemon.group.remove(daemon.thinkingDots);
        daemon.thinkingDots = null;
      }

      // Waving animation (simple bob + rotation)
      if (daemon.action === "waving") {
        daemon.group.position.y = Math.sin(now * 0.005) * 0.03;
      }

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

  private updateMoodIndicator(daemon: DaemonInstance): void {
    if (!daemon.moodIndicator) return;

    // Update mood indicator texture
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

    // Dispose old texture
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

  private createNPCBody(accentColor: number): { body: THREE.Group; accentLight: THREE.PointLight; ringMesh: THREE.Mesh } {
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

    // Body capsule
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

    // Legs
    const legGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.5, 6);
    const leftLeg = new THREE.Mesh(legGeo, bodyMat);
    leftLeg.position.set(-0.08, 0.3, 0);
    body.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, bodyMat);
    rightLeg.position.set(0.08, 0.3, 0);
    body.add(rightLeg);

    return { body, accentLight: glowLight, ringMesh: ring };
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
