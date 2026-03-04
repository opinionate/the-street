import * as THREE from "three";
import type { DaemonState, Vector3 as Vec3 } from "@the-street/shared";
import { CHAT_DISPLAY_DURATION } from "@the-street/shared";

const NPC_ACCENT_COLORS: Record<string, number> = {
  greeter: 0x44ff88,
  shopkeeper: 0xffaa00,
  guide: 0x4488ff,
  guard: 0xff4444,
};

interface ChatBubble {
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
  action: string;
  chatBubbles: ChatBubble[];
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

    // Create simple NPC mesh (colored capsule body)
    const behaviorType = daemon.definition.behavior.type;
    const accent = NPC_ACCENT_COLORS[behaviorType] || 0x44ff88;

    const body = this.createNPCBody(accent);
    group.add(body);

    // Name label with [NPC] prefix
    const nameSprite = this.createNameLabel(`[NPC] ${daemon.definition.name}`);
    nameSprite.position.set(0, 2.1, 0);
    group.add(nameSprite);

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
      chatBubbles: [],
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

  showDaemonChat(daemonId: string, daemonName: string, content: string): void {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = 512;
    canvas.height = 128;

    const displayText = content.length > 60 ? content.slice(0, 57) + "..." : content;

    // Background
    ctx.fillStyle = "rgba(0, 40, 0, 0.8)";
    ctx.beginPath();
    ctx.roundRect(4, 4, 504, 120, 12);
    ctx.fill();

    // Border
    ctx.strokeStyle = "rgba(68, 255, 136, 0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Name
    ctx.fillStyle = "#44ff88";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(`[NPC] ${daemonName}`, 16, 14, 480);

    // Message
    ctx.fillStyle = "#ffffff";
    ctx.font = "20px system-ui, sans-serif";
    ctx.fillText(displayText, 16, 44, 480);

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

    // Cap at 3
    while (daemon.chatBubbles.length > 3) {
      const old = daemon.chatBubbles.shift()!;
      old.sprite.parent?.remove(old.sprite);
      old.sprite.material.map?.dispose();
      old.sprite.material.dispose();
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

      // Simple animation
      const isWalking = daemon.action === "walking";
      if (isWalking) {
        daemon.animPhase += dt * 5;
        daemon.speed += (3 - daemon.speed) * Math.min(dt * 5, 1);
      } else {
        daemon.speed *= 1 - Math.min(dt * 5, 1);
      }

      // Bob when walking
      if (isWalking) {
        daemon.group.position.y = Math.abs(Math.sin(daemon.animPhase * 2)) * 0.02;
      }

      // Breathing
      daemon.breathPhase += dt * 1.5;

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

  private createNPCBody(accentColor: number): THREE.Group {
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

    // Legs (simple cylinders)
    const legGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.5, 6);
    const leftLeg = new THREE.Mesh(legGeo, bodyMat);
    leftLeg.position.set(-0.08, 0.3, 0);
    body.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, bodyMat);
    rightLeg.position.set(0.08, 0.3, 0);
    body.add(rightLeg);

    return body;
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
