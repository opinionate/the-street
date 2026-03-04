import * as THREE from "three";
import type { PlayerState, Vector3 as Vec3 } from "@the-street/shared";

const AVATAR_COLORS = [0x4488ff, 0xff4488, 0x44ff88, 0xffaa44, 0xaa44ff, 0x44aaff];

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

    // Body (cylinder)
    const bodyGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.2, 8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.6,
      metalness: 0.1,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.0;
    body.castShadow = true;
    group.add(body);

    // Head (sphere)
    const headGeo = new THREE.SphereGeometry(0.25, 8, 8);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xffccaa,
      roughness: 0.7,
      metalness: 0.0,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.85;
    head.castShadow = true;
    group.add(head);

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
