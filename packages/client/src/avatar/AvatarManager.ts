import * as THREE from "three";
import type { PlayerState, Vector3 as Vec3 } from "@the-street/shared";
import { CHAT_DISPLAY_DURATION } from "@the-street/shared";

const ACCENT_COLORS = [0x00ffff, 0xff00ff, 0x39ff14, 0xff6600, 0xaa44ff, 0xffff00];

interface ChatBubble {
  sprite: THREE.Sprite;
  createdAt: number;
  duration: number;
}

interface LimbRefs {
  body: THREE.Group;
  // Upper body
  chest: THREE.Mesh;
  neck: THREE.Mesh;
  head: THREE.Group;
  // Arms: upper + lower for elbow bend
  leftShoulderPivot: THREE.Group;
  leftElbowPivot: THREE.Group;
  rightShoulderPivot: THREE.Group;
  rightElbowPivot: THREE.Group;
  // Legs: upper + lower for knee bend
  leftHipPivot: THREE.Group;
  leftKneePivot: THREE.Group;
  rightHipPivot: THREE.Group;
  rightKneePivot: THREE.Group;
  // Coat tails
  coatTailLeft: THREE.Mesh;
  coatTailRight: THREE.Mesh;
}

interface AvatarInstance {
  group: THREE.Group;
  limbs: LimbRefs;
  targetPosition: THREE.Vector3;
  prevPosition: THREE.Vector3;
  targetRotation: number;
  currentRotation: number;
  animPhase: number;
  breathPhase: number;
  speed: number; // smoothed speed for animation blending
  chatBubbles: ChatBubble[];
}

export class AvatarManager {
  private avatars: Map<string, AvatarInstance> = new Map();
  private scene: THREE.Scene;
  localPlayerId: string | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Notify avatar manager that the local player is moving (call from game loop) */
  setLocalMoving(isMoving: boolean, isSprinting: boolean): void {
    if (!this.localPlayerId) return;
    const avatar = this.avatars.get(this.localPlayerId);
    if (!avatar) return;
    avatar.speed = isMoving ? (isSprinting ? 10 : 5) : 0;
  }

  private createAvatar(colorIndex: number): { group: THREE.Group; limbs: LimbRefs } {
    const group = new THREE.Group();
    const accent = ACCENT_COLORS[colorIndex % ACCENT_COLORS.length];

    // --- Materials ---
    const coatMat = new THREE.MeshPhysicalMaterial({
      color: 0x0c0c0c,
      roughness: 0.55,
      metalness: 0.05,
      clearcoat: 0.2,
      clearcoatRoughness: 0.5,
    });
    const shirtMat = new THREE.MeshStandardMaterial({
      color: 0x151515,
      roughness: 0.8,
      metalness: 0.0,
    });
    const pantsMat = new THREE.MeshStandardMaterial({
      color: 0x0e0e0e,
      roughness: 0.7,
      metalness: 0.0,
    });
    const skinMat = new THREE.MeshPhysicalMaterial({
      color: 0xc8a07a,
      roughness: 0.55,
      metalness: 0.0,
    });
    const bootMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      roughness: 0.35,
      metalness: 0.2,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      roughness: 0.05,
      metalness: 0.95,
      emissive: accent,
      emissiveIntensity: 0.7,
    });
    const hairMat = new THREE.MeshStandardMaterial({
      color: 0x0a0808,
      roughness: 0.35,
      metalness: 0.15,
    });
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0xccccdd,
      roughness: 0.1,
      metalness: 0.95,
    });
    const hiltMat = new THREE.MeshStandardMaterial({
      color: 0x2a1510,
      roughness: 0.8,
      metalness: 0.1,
    });
    const guardMat = new THREE.MeshStandardMaterial({
      color: 0xaa8833,
      roughness: 0.3,
      metalness: 0.7,
    });

    const body = new THREE.Group();
    group.add(body);

    // ===== TORSO =====
    // Chest — wider at shoulders, narrower at waist (scaled sphere)
    const chestGeo = new THREE.SphereGeometry(1, 12, 10);
    const chest = new THREE.Mesh(chestGeo, coatMat);
    chest.scale.set(0.22, 0.2, 0.12);
    chest.position.y = 1.28;
    chest.castShadow = true;
    body.add(chest);

    // Abdomen — narrower, bridging chest to hips
    const abdomenGeo = new THREE.SphereGeometry(1, 10, 8);
    const abdomen = new THREE.Mesh(abdomenGeo, coatMat);
    abdomen.scale.set(0.17, 0.12, 0.1);
    abdomen.position.y = 1.03;
    abdomen.castShadow = true;
    body.add(abdomen);

    // Hips
    const hipsGeo = new THREE.SphereGeometry(1, 10, 8);
    const hips = new THREE.Mesh(hipsGeo, coatMat);
    hips.scale.set(0.18, 0.08, 0.1);
    hips.position.y = 0.88;
    body.add(hips);

    // ===== NECK =====
    const neckGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.1, 8);
    const neck = new THREE.Mesh(neckGeo, skinMat);
    neck.position.y = 1.52;
    body.add(neck);

    // ===== HEAD =====
    const headGroup = new THREE.Group();
    headGroup.position.y = 1.65;
    body.add(headGroup);

    // Skull
    const skullGeo = new THREE.SphereGeometry(0.115, 12, 10);
    const skull = new THREE.Mesh(skullGeo, skinMat);
    skull.scale.set(1, 1.1, 1);
    skull.castShadow = true;
    headGroup.add(skull);

    // Jaw — subtle chin
    const jawGeo = new THREE.SphereGeometry(0.07, 8, 6);
    const jaw = new THREE.Mesh(jawGeo, skinMat);
    jaw.position.set(0, -0.07, -0.04);
    jaw.scale.set(1, 0.6, 0.8);
    headGroup.add(jaw);

    // Hair — slicked back
    const hairGeo = new THREE.SphereGeometry(0.12, 10, 8);
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.scale.set(1.05, 1.0, 1.15);
    hair.position.set(0, 0.02, 0.02);
    headGroup.add(hair);

    // Hair back extension
    const hairBackGeo = new THREE.SphereGeometry(0.06, 8, 6);
    const hairBack = new THREE.Mesh(hairBackGeo, hairMat);
    hairBack.scale.set(1.2, 0.6, 1);
    hairBack.position.set(0, -0.02, 0.08);
    headGroup.add(hairBack);

    // Sunglasses — narrow wraparound
    const lensGeo = new THREE.BoxGeometry(0.22, 0.04, 0.03);
    const lens = new THREE.Mesh(lensGeo, glassMat);
    lens.position.set(0, 0.01, -0.11);
    headGroup.add(lens);

    // Glasses glow
    const glowLight = new THREE.PointLight(accent, 0.4, 2.5, 2);
    glowLight.position.set(0, 0.01, -0.18);
    headGroup.add(glowLight);

    // ===== COAT DETAILS =====
    // Collar — turned up
    const collarLGeo = new THREE.BoxGeometry(0.04, 0.1, 0.08);
    const collarL = new THREE.Mesh(collarLGeo, coatMat);
    collarL.position.set(-0.1, 1.52, -0.07);
    collarL.rotation.z = -0.2;
    body.add(collarL);
    const collarR = new THREE.Mesh(collarLGeo, coatMat);
    collarR.position.set(0.1, 1.52, -0.07);
    collarR.rotation.z = 0.2;
    body.add(collarR);

    // Coat tails — two separate flaps that animate
    const tailGeo = new THREE.BoxGeometry(0.14, 0.45, 0.025);
    const coatTailLeft = new THREE.Mesh(tailGeo, coatMat);
    coatTailLeft.position.set(-0.07, 0.55, 0.1);
    coatTailLeft.castShadow = true;
    body.add(coatTailLeft);
    const coatTailRight = new THREE.Mesh(tailGeo, coatMat);
    coatTailRight.position.set(0.07, 0.55, 0.1);
    coatTailRight.castShadow = true;
    body.add(coatTailRight);

    // ===== CROSSED KATANAS =====
    for (const side of [-1, 1]) {
      const kGroup = new THREE.Group();
      kGroup.position.set(side * 0.06, 1.2, 0.14);
      kGroup.rotation.z = side * 0.3;
      kGroup.rotation.x = 0.12;

      const bladeGeo = new THREE.BoxGeometry(0.012, 0.6, 0.03);
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.y = 0.22;
      kGroup.add(blade);

      const hiltGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.16, 6);
      const hilt = new THREE.Mesh(hiltGeo, hiltMat);
      hilt.position.y = -0.1;
      kGroup.add(hilt);

      const tsubaGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.01, 8);
      const tsuba = new THREE.Mesh(tsubaGeo, guardMat);
      tsuba.position.y = -0.01;
      kGroup.add(tsuba);

      body.add(kGroup);
    }

    // ===== LEFT ARM =====
    const leftShoulderPivot = new THREE.Group();
    leftShoulderPivot.position.set(-0.24, 1.38, 0);
    body.add(leftShoulderPivot);

    // Upper arm
    const upperArmGeo = new THREE.CapsuleGeometry(0.04, 0.22, 4, 8);
    const lUpperArm = new THREE.Mesh(upperArmGeo, coatMat);
    lUpperArm.position.y = -0.15;
    lUpperArm.castShadow = true;
    leftShoulderPivot.add(lUpperArm);

    // Elbow pivot
    const leftElbowPivot = new THREE.Group();
    leftElbowPivot.position.y = -0.3;
    leftShoulderPivot.add(leftElbowPivot);

    // Forearm
    const forearmGeo = new THREE.CapsuleGeometry(0.035, 0.2, 4, 8);
    const lForearm = new THREE.Mesh(forearmGeo, coatMat);
    lForearm.position.y = -0.13;
    lForearm.castShadow = true;
    leftElbowPivot.add(lForearm);

    // Hand
    const handGeo = new THREE.SphereGeometry(0.03, 6, 6);
    const lHand = new THREE.Mesh(handGeo, skinMat);
    lHand.position.y = -0.27;
    leftElbowPivot.add(lHand);

    // ===== RIGHT ARM =====
    const rightShoulderPivot = new THREE.Group();
    rightShoulderPivot.position.set(0.24, 1.38, 0);
    body.add(rightShoulderPivot);

    const rUpperArm = new THREE.Mesh(upperArmGeo.clone(), coatMat);
    rUpperArm.position.y = -0.15;
    rUpperArm.castShadow = true;
    rightShoulderPivot.add(rUpperArm);

    const rightElbowPivot = new THREE.Group();
    rightElbowPivot.position.y = -0.3;
    rightShoulderPivot.add(rightElbowPivot);

    const rForearm = new THREE.Mesh(forearmGeo.clone(), coatMat);
    rForearm.position.y = -0.13;
    rForearm.castShadow = true;
    rightElbowPivot.add(rForearm);

    const rHand = new THREE.Mesh(handGeo.clone(), skinMat);
    rHand.position.y = -0.27;
    rightElbowPivot.add(rHand);

    // ===== LEFT LEG =====
    const leftHipPivot = new THREE.Group();
    leftHipPivot.position.set(-0.09, 0.84, 0);
    body.add(leftHipPivot);

    const thighGeo = new THREE.CapsuleGeometry(0.055, 0.28, 4, 8);
    const lThigh = new THREE.Mesh(thighGeo, pantsMat);
    lThigh.position.y = -0.2;
    lThigh.castShadow = true;
    leftHipPivot.add(lThigh);

    const leftKneePivot = new THREE.Group();
    leftKneePivot.position.y = -0.38;
    leftHipPivot.add(leftKneePivot);

    const shinGeo = new THREE.CapsuleGeometry(0.045, 0.26, 4, 8);
    const lShin = new THREE.Mesh(shinGeo, pantsMat);
    lShin.position.y = -0.17;
    lShin.castShadow = true;
    leftKneePivot.add(lShin);

    // Boot
    const bootGeo = new THREE.BoxGeometry(0.09, 0.08, 0.14);
    const lBoot = new THREE.Mesh(bootGeo, bootMat);
    lBoot.position.set(0, -0.35, -0.01);
    lBoot.castShadow = true;
    leftKneePivot.add(lBoot);

    // ===== RIGHT LEG =====
    const rightHipPivot = new THREE.Group();
    rightHipPivot.position.set(0.09, 0.84, 0);
    body.add(rightHipPivot);

    const rThigh = new THREE.Mesh(thighGeo.clone(), pantsMat);
    rThigh.position.y = -0.2;
    rThigh.castShadow = true;
    rightHipPivot.add(rThigh);

    const rightKneePivot = new THREE.Group();
    rightKneePivot.position.y = -0.38;
    rightHipPivot.add(rightKneePivot);

    const rShin = new THREE.Mesh(shinGeo.clone(), pantsMat);
    rShin.position.y = -0.17;
    rShin.castShadow = true;
    rightKneePivot.add(rShin);

    const rBoot = new THREE.Mesh(bootGeo.clone(), bootMat);
    rBoot.position.set(0, -0.35, -0.01);
    rBoot.castShadow = true;
    rightKneePivot.add(rBoot);

    return {
      group,
      limbs: {
        body,
        chest,
        neck,
        head: headGroup,
        leftShoulderPivot,
        leftElbowPivot,
        rightShoulderPivot,
        rightElbowPivot,
        leftHipPivot,
        leftKneePivot,
        rightHipPivot,
        rightKneePivot,
        coatTailLeft,
        coatTailRight,
      },
    };
  }

  private createNameLabel(name: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = 256;
    canvas.height = 48;

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.beginPath();
    ctx.roundRect(0, 0, 256, 48, 8);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 128, 24, 240);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.5, 0.28, 1);
    return sprite;
  }

  addPlayer(state: PlayerState): void {
    if (this.avatars.has(state.userId)) return;

    const { group, limbs } = this.createAvatar(state.avatarDefinition.avatarIndex);
    group.name = `avatar_${state.userId}`;
    group.position.set(state.position.x, state.position.y, state.position.z);
    group.rotation.y = state.rotation;

    // Name label above head
    const nameSprite = this.createNameLabel(state.displayName);
    nameSprite.position.set(0, 1.95, 0);
    group.add(nameSprite);

    this.scene.add(group);

    this.avatars.set(state.userId, {
      group,
      limbs,
      targetPosition: new THREE.Vector3(state.position.x, state.position.y, state.position.z),
      prevPosition: new THREE.Vector3(state.position.x, state.position.y, state.position.z),
      targetRotation: state.rotation,
      currentRotation: state.rotation,
      animPhase: 0,
      breathPhase: Math.random() * Math.PI * 2,
      speed: 0,
      chatBubbles: [],
    });
  }

  removePlayer(userId: string): void {
    const avatar = this.avatars.get(userId);
    if (!avatar) return;
    this.scene.remove(avatar.group);
    this.avatars.delete(userId);
  }

  updatePlayerPosition(userId: string, position: Vec3, rotation: number): void {
    const avatar = this.avatars.get(userId);
    if (!avatar) return;
    avatar.targetPosition.set(position.x, position.y, position.z);
    avatar.targetRotation = rotation;
  }

  setLocalPlayerPosition(position: Vec3, rotation: number): void {
    if (!this.localPlayerId) return;
    const avatar = this.avatars.get(this.localPlayerId);
    if (!avatar) return;
    avatar.group.position.set(position.x, position.y, position.z);
    avatar.group.rotation.y = rotation;
    avatar.targetPosition.set(position.x, position.y, position.z);
    avatar.targetRotation = rotation;
  }

  getLocalPlayerPosition(): THREE.Vector3 | null {
    if (!this.localPlayerId) return null;
    const avatar = this.avatars.get(this.localPlayerId);
    return avatar ? avatar.group.position.clone() : null;
  }

  getLocalPlayerRotation(): number {
    if (!this.localPlayerId) return 0;
    const avatar = this.avatars.get(this.localPlayerId);
    return avatar ? avatar.group.rotation.y : 0;
  }

  /** Show a chat bubble floating above a player's head */
  showChatBubble(userId: string, senderName: string, content: string): void {
    const avatar = this.avatars.get(userId);
    if (!avatar) return;

    // Create canvas for the bubble
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = 512;
    canvas.height = 128;

    // Measure text to wrap
    ctx.font = "bold 22px system-ui, sans-serif";
    const nameWidth = ctx.measureText(senderName).width;
    ctx.font = "20px system-ui, sans-serif";

    const maxTextWidth = 480;
    const displayText = content.length > 60 ? content.slice(0, 57) + "..." : content;

    // Background
    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    ctx.beginPath();
    ctx.roundRect(4, 4, 504, 120, 12);
    ctx.fill();

    // Border
    ctx.strokeStyle = "rgba(0, 255, 255, 0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Name
    ctx.fillStyle = "#00ffcc";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(senderName, 16, 14, maxTextWidth);

    // Message text
    ctx.fillStyle = "#ffffff";
    ctx.font = "20px system-ui, sans-serif";
    ctx.fillText(displayText, 16, 44, maxTextWidth);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(3, 0.75, 1);

    // Stack above previous bubbles
    const stackOffset = avatar.chatBubbles.length * 0.85;
    sprite.position.set(0, 2.1 + stackOffset, 0);
    avatar.group.add(sprite);

    const bubble: ChatBubble = {
      sprite,
      createdAt: Date.now(),
      duration: CHAT_DISPLAY_DURATION * 1000,
    };
    avatar.chatBubbles.push(bubble);

    // Cap at 3 visible bubbles
    while (avatar.chatBubbles.length > 3) {
      const old = avatar.chatBubbles.shift()!;
      old.sprite.parent?.remove(old.sprite);
      old.sprite.material.map?.dispose();
      old.sprite.material.dispose();
    }
  }

  update(dt: number): void {
    for (const [userId, avatar] of this.avatars) {
      const { limbs } = avatar;

      // --- Remote player: interpolation + speed detection ---
      if (userId !== this.localPlayerId) {
        avatar.prevPosition.copy(avatar.group.position);
        avatar.group.position.lerp(avatar.targetPosition, Math.min(dt * 10, 1));

        // Smooth rotation (shortest path)
        let rotDiff = avatar.targetRotation - avatar.currentRotation;
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
        avatar.currentRotation += rotDiff * Math.min(dt * 10, 1);
        avatar.group.rotation.y = avatar.currentRotation;

        // Measure actual movement speed
        const moved = avatar.group.position.distanceTo(avatar.prevPosition);
        const measuredSpeed = dt > 0 ? moved / dt : 0;
        avatar.speed += (measuredSpeed - avatar.speed) * Math.min(dt * 8, 1);
      }
      // Local player: speed is set externally via setLocalMoving()

      // --- Animation ---
      const spd = avatar.speed;
      const isMoving = spd > 0.3;
      const runBlend = Math.min(Math.max((spd - 3) / 7, 0), 1); // 0=walk, 1=run

      // Phase advances with speed
      if (isMoving) {
        const phaseSpeed = 5 + runBlend * 6; // faster phase at run speed
        avatar.animPhase += dt * phaseSpeed;
      } else {
        // Smoothly return limbs to rest
        avatar.animPhase *= 1 - Math.min(dt * 6, 1);
      }

      const p = avatar.animPhase;
      const sinP = Math.sin(p);
      const cosP = Math.cos(p);

      // -- Legs: hip swing + knee bend --
      const hipSwing = (0.3 + runBlend * 0.4) * (isMoving ? 1 : 0);
      const kneeMax = 0.4 + runBlend * 0.6;

      // Left leg
      const leftHipAngle = sinP * hipSwing;
      limbs.leftHipPivot.rotation.x = leftHipAngle;
      // Knee bends backward on the back-swing (when hip angle is positive = leg behind)
      const leftKneeBend = Math.max(0, sinP) * kneeMax * (isMoving ? 1 : 0);
      limbs.leftKneePivot.rotation.x = leftKneeBend;

      // Right leg (opposite phase)
      const rightHipAngle = -sinP * hipSwing;
      limbs.rightHipPivot.rotation.x = rightHipAngle;
      const rightKneeBend = Math.max(0, -sinP) * kneeMax * (isMoving ? 1 : 0);
      limbs.rightKneePivot.rotation.x = rightKneeBend;

      // -- Arms: shoulder swing + elbow bend --
      const armSwing = (0.25 + runBlend * 0.45) * (isMoving ? 1 : 0);
      const elbowBend = 0.3 + runBlend * 0.5;

      // Arms oppose the legs (natural gait)
      limbs.leftShoulderPivot.rotation.x = -sinP * armSwing;
      limbs.leftElbowPivot.rotation.x = -(0.15 + Math.max(0, -sinP) * elbowBend * (isMoving ? 1 : 0));

      limbs.rightShoulderPivot.rotation.x = sinP * armSwing;
      limbs.rightElbowPivot.rotation.x = -(0.15 + Math.max(0, sinP) * elbowBend * (isMoving ? 1 : 0));

      // -- Torso: lean + sway --
      if (isMoving) {
        limbs.body.rotation.x = -(0.03 + runBlend * 0.05); // lean forward
        limbs.body.rotation.z = Math.sin(p) * 0.02; // subtle lateral sway
        limbs.chest.rotation.y = sinP * 0.04; // shoulder twist
      } else {
        limbs.body.rotation.x *= 0.9;
        limbs.body.rotation.z *= 0.9;
        limbs.chest.rotation.y *= 0.9;
      }

      // -- Coat tails flap with movement --
      if (isMoving) {
        const flapAmt = 0.05 + runBlend * 0.15;
        limbs.coatTailLeft.rotation.x = 0.1 + Math.sin(p * 1.5) * flapAmt;
        limbs.coatTailRight.rotation.x = 0.1 + Math.sin(p * 1.5 + 0.5) * flapAmt;
      } else {
        limbs.coatTailLeft.rotation.x *= 0.92;
        limbs.coatTailRight.rotation.x *= 0.92;
      }

      // -- Vertical bob (foot-strike, double frequency of step cycle) --
      if (isMoving && userId !== this.localPlayerId) {
        avatar.group.position.y = Math.abs(Math.sin(p * 2)) * (0.02 + runBlend * 0.03);
      }

      // -- Idle breathing --
      avatar.breathPhase += dt * 1.5;
      const breath = Math.sin(avatar.breathPhase);
      limbs.body.position.y = breath * 0.005;
      limbs.chest.scale.z = 0.12 + breath * 0.003; // chest expand/contract

      // Head micro-movements on idle
      if (!isMoving) {
        limbs.head.rotation.x = Math.sin(avatar.breathPhase * 0.6) * 0.012;
        limbs.head.rotation.z = Math.sin(avatar.breathPhase * 0.4) * 0.008;
      } else {
        // Slight head bob with steps
        limbs.head.rotation.x = Math.sin(p * 2) * 0.015;
        limbs.head.rotation.z = 0;
      }

      // -- Chat bubbles: fade and cleanup --
      const now = Date.now();
      for (let i = avatar.chatBubbles.length - 1; i >= 0; i--) {
        const bubble = avatar.chatBubbles[i];
        const age = now - bubble.createdAt;
        if (age >= bubble.duration) {
          // Remove expired bubble
          bubble.sprite.parent?.remove(bubble.sprite);
          bubble.sprite.material.map?.dispose();
          bubble.sprite.material.dispose();
          avatar.chatBubbles.splice(i, 1);
        } else {
          // Fade out in the last 20% of duration
          const fadeStart = bubble.duration * 0.8;
          if (age > fadeStart) {
            const fadeProgress = (age - fadeStart) / (bubble.duration - fadeStart);
            bubble.sprite.material.opacity = 1 - fadeProgress;
          }
        }
      }
    }
  }
}
