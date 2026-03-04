import * as THREE from "three";
import type { PlayerState, Vector3 as Vec3 } from "@the-street/shared";

const AVATAR_COLORS = [0x00ffff, 0xff00ff, 0x39ff14, 0xff6600, 0xaa44ff, 0xffff00];

interface AvatarInstance {
  group: THREE.Group;
  targetPosition: THREE.Vector3;
  targetRotation: number;
  currentRotation: number;
  animState: "idle" | "walk" | "run";
  bobPhase: number;
}

export class AvatarManager {
  private avatars: Map<string, AvatarInstance> = new Map();
  private scene: THREE.Scene;
  localPlayerId: string | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private createCapsule(colorIndex: number): THREE.Group {
    const group = new THREE.Group();
    const color = AVATAR_COLORS[colorIndex % AVATAR_COLORS.length];

    const bodyMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.3,
      emissive: color,
      emissiveIntensity: 0.15,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xddbbaa,
      roughness: 0.7,
      metalness: 0.0,
    });

    // Torso
    const torsoGeo = new THREE.BoxGeometry(0.5, 0.7, 0.25);
    const torso = new THREE.Mesh(torsoGeo, bodyMat);
    torso.position.y = 1.15;
    torso.castShadow = true;
    group.add(torso);

    // Head
    const headGeo = new THREE.BoxGeometry(0.3, 0.35, 0.3);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 1.7;
    head.castShadow = true;
    group.add(head);

    // Visor (face indicator — shows facing direction)
    const visorGeo = new THREE.BoxGeometry(0.28, 0.1, 0.05);
    const visorMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.8,
      roughness: 0.2,
      metalness: 0.6,
    });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 1.72, -0.16);
    group.add(visor);

    // Left arm
    const armGeo = new THREE.BoxGeometry(0.12, 0.6, 0.12);
    const leftArm = new THREE.Mesh(armGeo, bodyMat);
    leftArm.position.set(-0.36, 1.1, 0);
    leftArm.castShadow = true;
    group.add(leftArm);

    // Right arm
    const rightArm = new THREE.Mesh(armGeo, bodyMat);
    rightArm.position.set(0.36, 1.1, 0);
    rightArm.castShadow = true;
    group.add(rightArm);

    // Left leg
    const legGeo = new THREE.BoxGeometry(0.15, 0.6, 0.15);
    const leftLeg = new THREE.Mesh(legGeo, bodyMat);
    leftLeg.position.set(-0.13, 0.45, 0);
    leftLeg.castShadow = true;
    group.add(leftLeg);

    // Right leg
    const rightLeg = new THREE.Mesh(legGeo, bodyMat);
    rightLeg.position.set(0.13, 0.45, 0);
    rightLeg.castShadow = true;
    group.add(rightLeg);

    return group;
  }

  addPlayer(state: PlayerState): void {
    if (this.avatars.has(state.userId)) return;

    const group = this.createCapsule(state.avatarDefinition.avatarIndex);
    group.name = `avatar_${state.userId}`;
    group.position.set(state.position.x, state.position.y, state.position.z);
    group.rotation.y = state.rotation;

    this.scene.add(group);

    this.avatars.set(state.userId, {
      group,
      targetPosition: new THREE.Vector3(
        state.position.x,
        state.position.y,
        state.position.z
      ),
      targetRotation: state.rotation,
      currentRotation: state.rotation,
      animState: "idle",
      bobPhase: 0,
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
      // Skip local player — controlled directly by input
      if (userId === this.localPlayerId) continue;

      // Interpolate position
      avatar.group.position.lerp(avatar.targetPosition, Math.min(dt * 10, 1));

      // Interpolate rotation
      const rotDiff = avatar.targetRotation - avatar.currentRotation;
      avatar.currentRotation += rotDiff * Math.min(dt * 10, 1);
      avatar.group.rotation.y = avatar.currentRotation;

      // Determine animation state from movement
      const dist = avatar.group.position.distanceTo(avatar.targetPosition);
      if (dist > 0.5) {
        avatar.animState = "run";
      } else if (dist > 0.05) {
        avatar.animState = "walk";
      } else {
        avatar.animState = "idle";
      }

      // Simple walk bob
      if (avatar.animState !== "idle") {
        avatar.bobPhase += dt * (avatar.animState === "run" ? 12 : 8);
        avatar.group.position.y = Math.abs(Math.sin(avatar.bobPhase)) * 0.08;
      } else {
        avatar.bobPhase = 0;
      }
    }
  }
}
