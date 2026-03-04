import * as THREE from "three";
import type { PlayerState, Vector3 as Vec3 } from "@the-street/shared";

const ACCENT_COLORS = [0x00ffff, 0xff00ff, 0x39ff14, 0xff6600, 0xaa44ff, 0xffff00];

interface LimbRefs {
  body: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  coatBack: THREE.Mesh;
  head: THREE.Group;
}

interface AvatarInstance {
  group: THREE.Group;
  limbs: LimbRefs;
  targetPosition: THREE.Vector3;
  targetRotation: number;
  currentRotation: number;
  animState: "idle" | "walk" | "run";
  animPhase: number;
  breathPhase: number;
}

export class AvatarManager {
  private avatars: Map<string, AvatarInstance> = new Map();
  private scene: THREE.Scene;
  localPlayerId: string | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private createAvatar(colorIndex: number): { group: THREE.Group; limbs: LimbRefs } {
    const group = new THREE.Group();
    const accent = ACCENT_COLORS[colorIndex % ACCENT_COLORS.length];

    // -- Materials --
    const coatMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0a0a,
      roughness: 0.55,
      metalness: 0.1,
      clearcoat: 0.3,
      clearcoatRoughness: 0.4,
      sheen: 1.0,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0x222244),
    });
    const pantsMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.7,
      metalness: 0.05,
    });
    const skinMat = new THREE.MeshPhysicalMaterial({
      color: 0xc8a882,
      roughness: 0.6,
      metalness: 0.0,
      sheen: 0.3,
      sheenRoughness: 0.8,
      sheenColor: new THREE.Color(0xffccaa),
    });
    const bootMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.4,
      metalness: 0.3,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      roughness: 0.1,
      metalness: 0.9,
      emissive: accent,
      emissiveIntensity: 0.6,
    });

    // Body group (moves for breathing)
    const body = new THREE.Group();
    group.add(body);

    // -- Torso (coat upper) --
    const torsoGeo = new THREE.CapsuleGeometry(0.22, 0.5, 4, 8);
    const torso = new THREE.Mesh(torsoGeo, coatMat);
    torso.position.y = 1.2;
    torso.scale.set(1, 1, 0.65);
    torso.castShadow = true;
    body.add(torso);

    // Collar / lapel ridge
    const collarGeo = new THREE.CylinderGeometry(0.24, 0.22, 0.08, 8);
    const collar = new THREE.Mesh(collarGeo, coatMat);
    collar.position.y = 1.52;
    collar.scale.set(1, 1, 0.7);
    body.add(collar);

    // Coat skirt (long, below waist) — tapers outward slightly
    const coatSkirtGeo = new THREE.CylinderGeometry(0.2, 0.28, 0.7, 8);
    const coatSkirt = new THREE.Mesh(coatSkirtGeo, coatMat);
    coatSkirt.position.y = 0.6;
    coatSkirt.scale.set(1, 1, 0.6);
    coatSkirt.castShadow = true;
    body.add(coatSkirt);

    // Coat back flap (animates with movement)
    const coatBackGeo = new THREE.BoxGeometry(0.35, 0.55, 0.04);
    const coatBack = new THREE.Mesh(coatBackGeo, coatMat);
    coatBack.position.set(0, 0.35, 0.12);
    coatBack.castShadow = true;
    body.add(coatBack);

    // -- Crossed katanas on back --
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0xccccdd,
      roughness: 0.15,
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

    for (const side of [-1, 1]) {
      const katanaGroup = new THREE.Group();
      katanaGroup.position.set(side * 0.08, 1.25, 0.15);
      // Cross them: tilt in opposite directions
      katanaGroup.rotation.z = side * 0.35;
      katanaGroup.rotation.x = 0.1;

      // Blade
      const bladeGeo = new THREE.BoxGeometry(0.015, 0.65, 0.04);
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.y = 0.25;
      katanaGroup.add(blade);

      // Hilt wrap
      const hiltGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.18, 6);
      const hilt = new THREE.Mesh(hiltGeo, hiltMat);
      hilt.position.y = -0.12;
      katanaGroup.add(hilt);

      // Tsuba (guard)
      const tsubaGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.012, 8);
      const tsuba = new THREE.Mesh(tsubaGeo, guardMat);
      tsuba.position.y = -0.02;
      katanaGroup.add(tsuba);

      body.add(katanaGroup);
    }

    // -- Head --
    const headGroup = new THREE.Group();
    headGroup.position.y = 1.72;
    body.add(headGroup);

    // Head shape (slightly elongated capsule)
    const headGeo = new THREE.CapsuleGeometry(0.14, 0.08, 4, 8);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.castShadow = true;
    headGroup.add(head);

    // Hair (dark, slicked back)
    const hairGeo = new THREE.CapsuleGeometry(0.145, 0.06, 4, 8);
    const hairMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      roughness: 0.3,
      metalness: 0.2,
    });
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.set(0, 0.02, 0.01);
    hair.scale.set(1.02, 1, 1.05);
    headGroup.add(hair);

    // Sunglasses — narrow wraparound
    const lensGeo = new THREE.BoxGeometry(0.28, 0.05, 0.04);
    const lens = new THREE.Mesh(lensGeo, glassMat);
    lens.position.set(0, 0.0, -0.14);
    headGroup.add(lens);

    // Subtle glow around glasses
    const glowLight = new THREE.PointLight(accent, 0.3, 2, 2);
    glowLight.position.set(0, 0, -0.2);
    headGroup.add(glowLight);

    // -- Arms (pivoted at shoulders for swing animation) --
    const armLength = 0.55;

    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-0.3, 1.4, 0);
    body.add(leftArmPivot);

    // Upper arm + forearm as single unit
    const leftArmGeo = new THREE.CapsuleGeometry(0.055, armLength, 4, 6);
    const leftArm = new THREE.Mesh(leftArmGeo, coatMat);
    leftArm.position.y = -armLength / 2 - 0.05;
    leftArm.castShadow = true;
    leftArmPivot.add(leftArm);

    // Left hand
    const handGeo = new THREE.SphereGeometry(0.04, 6, 6);
    const leftHand = new THREE.Mesh(handGeo, skinMat);
    leftHand.position.y = -armLength - 0.08;
    leftArmPivot.add(leftHand);

    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0.3, 1.4, 0);
    body.add(rightArmPivot);

    const rightArm = new THREE.Mesh(leftArmGeo.clone(), coatMat);
    rightArm.position.y = -armLength / 2 - 0.05;
    rightArm.castShadow = true;
    rightArmPivot.add(rightArm);

    const rightHand = new THREE.Mesh(handGeo, skinMat);
    rightHand.position.y = -armLength - 0.08;
    rightArmPivot.add(rightHand);

    // -- Legs (pivoted at hips) --
    const legLength = 0.45;

    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-0.1, 0.75, 0);
    body.add(leftLegPivot);

    const leftThighGeo = new THREE.CapsuleGeometry(0.065, legLength, 4, 6);
    const leftThigh = new THREE.Mesh(leftThighGeo, pantsMat);
    leftThigh.position.y = -legLength / 2 - 0.02;
    leftThigh.castShadow = true;
    leftLegPivot.add(leftThigh);

    // Boot
    const bootGeo = new THREE.BoxGeometry(0.1, 0.18, 0.16);
    const leftBoot = new THREE.Mesh(bootGeo, bootMat);
    leftBoot.position.set(0, -legLength - 0.1, -0.02);
    leftBoot.castShadow = true;
    leftLegPivot.add(leftBoot);

    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0.1, 0.75, 0);
    body.add(rightLegPivot);

    const rightThigh = new THREE.Mesh(leftThighGeo.clone(), pantsMat);
    rightThigh.position.y = -legLength / 2 - 0.02;
    rightThigh.castShadow = true;
    rightLegPivot.add(rightThigh);

    const rightBoot = new THREE.Mesh(bootGeo, bootMat);
    rightBoot.position.set(0, -legLength - 0.1, -0.02);
    rightBoot.castShadow = true;
    rightLegPivot.add(rightBoot);

    return {
      group,
      limbs: {
        body,
        leftArmPivot,
        rightArmPivot,
        leftLegPivot,
        rightLegPivot,
        coatBack,
        head: headGroup,
      },
    };
  }

  addPlayer(state: PlayerState): void {
    if (this.avatars.has(state.userId)) return;

    const { group, limbs } = this.createAvatar(state.avatarDefinition.avatarIndex);
    group.name = `avatar_${state.userId}`;
    group.position.set(state.position.x, state.position.y, state.position.z);
    group.rotation.y = state.rotation;

    this.scene.add(group);

    this.avatars.set(state.userId, {
      group,
      limbs,
      targetPosition: new THREE.Vector3(
        state.position.x,
        state.position.y,
        state.position.z
      ),
      targetRotation: state.rotation,
      currentRotation: state.rotation,
      animState: "idle",
      animPhase: 0,
      breathPhase: Math.random() * Math.PI * 2, // stagger breathing
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

  /** Set the local player's position directly (no interpolation) */
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

  update(dt: number): void {
    for (const [userId, avatar] of this.avatars) {
      const { limbs } = avatar;

      // --- Remote player interpolation ---
      if (userId !== this.localPlayerId) {
        avatar.group.position.lerp(avatar.targetPosition, Math.min(dt * 10, 1));

        // Smooth rotation (shortest path)
        let rotDiff = avatar.targetRotation - avatar.currentRotation;
        // Normalize to [-PI, PI]
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
        avatar.currentRotation += rotDiff * Math.min(dt * 10, 1);
        avatar.group.rotation.y = avatar.currentRotation;

        // Determine animation state
        const dist = avatar.group.position.distanceTo(avatar.targetPosition);
        if (dist > 0.5) {
          avatar.animState = "run";
        } else if (dist > 0.05) {
          avatar.animState = "walk";
        } else {
          avatar.animState = "idle";
        }
      } else {
        // Local player: detect movement from input manager state
        // We infer walk/run from whether position is changing
        const dist = avatar.group.position.distanceTo(avatar.targetPosition);
        if (dist > 0.3) {
          avatar.animState = "run";
        } else if (dist > 0.01) {
          avatar.animState = "walk";
        } else {
          avatar.animState = "idle";
        }
      }

      // --- Animation ---
      const isMoving = avatar.animState !== "idle";
      const speed = avatar.animState === "run" ? 10 : 6;
      const swingAmplitude = avatar.animState === "run" ? 0.7 : 0.4;
      const armSwingAmplitude = avatar.animState === "run" ? 0.8 : 0.45;

      if (isMoving) {
        avatar.animPhase += dt * speed;
      } else {
        // Ease limbs back to rest
        avatar.animPhase *= 0.85;
      }

      const phase = avatar.animPhase;

      // Leg swing (opposing)
      limbs.leftLegPivot.rotation.x = Math.sin(phase) * swingAmplitude;
      limbs.rightLegPivot.rotation.x = Math.sin(phase + Math.PI) * swingAmplitude;

      // Arm swing (opposing legs, natural gait)
      limbs.leftArmPivot.rotation.x = Math.sin(phase + Math.PI) * armSwingAmplitude;
      limbs.rightArmPivot.rotation.x = Math.sin(phase) * armSwingAmplitude;

      // Coat back flap reacts to movement
      const coatFlap = isMoving ? Math.sin(phase * 2) * 0.08 : 0;
      limbs.coatBack.rotation.x = coatFlap + (isMoving ? 0.15 : 0);

      // Subtle body lean forward when moving
      limbs.body.rotation.x = isMoving ? -0.05 : 0;

      // Vertical bob (foot-strike feel)
      if (isMoving && userId !== this.localPlayerId) {
        avatar.group.position.y =
          Math.abs(Math.sin(phase * 2)) * 0.04;
      }

      // --- Idle breathing ---
      avatar.breathPhase += dt * 1.8;
      const breathOffset = Math.sin(avatar.breathPhase) * 0.008;
      limbs.body.position.y = breathOffset;

      // Subtle head bob on idle
      if (!isMoving) {
        limbs.head.rotation.x = Math.sin(avatar.breathPhase * 0.7) * 0.015;
        limbs.head.rotation.z = Math.sin(avatar.breathPhase * 0.5) * 0.01;
      } else {
        limbs.head.rotation.x = 0;
        limbs.head.rotation.z = 0;
      }
    }
  }
}
