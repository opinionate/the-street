import * as THREE from "three";
import type { AvatarManager } from "../avatar/AvatarManager.js";
import type { DaemonRenderer } from "../avatar/DaemonRenderer.js";

const TARGET_RANGE = 50;

export interface TargetEntity {
  id: string;
  type: "daemon" | "player";
  position: THREE.Vector3;
  distance: number;
}

export class TargetingSystem {
  private avatarManager: AvatarManager;
  private daemonRenderer: DaemonRenderer;
  private scene: THREE.Scene;

  private currentTarget: TargetEntity | null = null;
  private sortedTargets: TargetEntity[] = [];
  private targetIndex = -1;

  // Highlight ring
  private highlightRing: THREE.Mesh | null = null;

  /** Called when target changes (null = deselected) */
  onTargetChange: ((target: TargetEntity | null) => void) | null = null;

  constructor(
    scene: THREE.Scene,
    avatarManager: AvatarManager,
    daemonRenderer: DaemonRenderer,
  ) {
    this.scene = scene;
    this.avatarManager = avatarManager;
    this.daemonRenderer = daemonRenderer;

    // Create highlight ring mesh
    const ringGeo = new THREE.RingGeometry(0.6, 0.8, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });
    this.highlightRing = new THREE.Mesh(ringGeo, ringMat);
    this.highlightRing.visible = false;
    this.scene.add(this.highlightRing);
  }

  /** Get the current target */
  getTarget(): TargetEntity | null {
    return this.currentTarget;
  }

  /** Select a specific entity by id and type (used by click targeting) */
  selectById(id: string, type: "daemon" | "player"): void {
    // Get position
    let pos: THREE.Vector3 | null = null;
    if (type === "daemon") {
      pos = this.daemonRenderer.getDaemonPosition(id);
    } else {
      pos = this.avatarManager.getPlayerPosition(id);
    }
    if (!pos) return;

    const playerPos = this.avatarManager.getLocalPlayerPosition();
    const distance = playerPos ? pos.distanceTo(playerPos) : 0;

    this.selectTarget({ id, type, position: pos, distance });
  }

  /** Cycle to next target in forward cone */
  cycleNext(): void {
    this.refreshTargets();
    if (this.sortedTargets.length === 0) {
      this.deselect();
      return;
    }
    this.targetIndex = (this.targetIndex + 1) % this.sortedTargets.length;
    this.selectTarget(this.sortedTargets[this.targetIndex]);
  }

  /** Cycle to previous target */
  cyclePrevious(): void {
    this.refreshTargets();
    if (this.sortedTargets.length === 0) {
      this.deselect();
      return;
    }
    this.targetIndex = this.targetIndex <= 0
      ? this.sortedTargets.length - 1
      : this.targetIndex - 1;
    this.selectTarget(this.sortedTargets[this.targetIndex]);
  }

  /** Whether a target is currently selected */
  get hasTarget(): boolean {
    return this.currentTarget !== null;
  }

  /** Deselect current target */
  deselect(): void {
    if (this.currentTarget) {
      this.hideTargetLabel(this.currentTarget);
    }
    this.currentTarget = null;
    this.targetIndex = -1;
    if (this.highlightRing) this.highlightRing.visible = false;
    this.onTargetChange?.(null);
  }

  /** Update per frame (move highlight ring to track target) */
  update(): void {
    if (!this.currentTarget || !this.highlightRing) return;

    // Get current position of target
    let pos: THREE.Vector3 | null = null;
    if (this.currentTarget.type === "daemon") {
      pos = this.daemonRenderer.getDaemonPosition(this.currentTarget.id);
    } else {
      pos = this.avatarManager.getPlayerPosition(this.currentTarget.id);
    }

    if (!pos) {
      this.deselect();
      return;
    }

    this.highlightRing.position.set(pos.x, 0.05, pos.z);
    // Pulse opacity
    const t = Date.now() * 0.003;
    (this.highlightRing.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(t) * 0.15;
  }

  private refreshTargets(): void {
    const playerPos = this.avatarManager.getLocalPlayerPosition();
    if (!playerPos) return;

    this.sortedTargets = [];

    // Collect daemons within radius
    for (const id of this.daemonRenderer.getAllDaemonIds()) {
      const pos = this.daemonRenderer.getDaemonPosition(id);
      if (!pos) continue;
      const toTarget = new THREE.Vector3().subVectors(pos, playerPos);
      toTarget.y = 0;
      const dist = toTarget.length();
      if (dist > TARGET_RANGE || dist < 0.5) continue;

      this.sortedTargets.push({ id, type: "daemon", position: pos, distance: dist });
    }

    // Collect other players within radius
    for (const id of this.avatarManager.getOtherPlayerIds()) {
      const pos = this.avatarManager.getPlayerPosition(id);
      if (!pos) continue;
      const toTarget = new THREE.Vector3().subVectors(pos, playerPos);
      toTarget.y = 0;
      const dist = toTarget.length();
      if (dist > TARGET_RANGE || dist < 0.5) continue;

      this.sortedTargets.push({ id, type: "player", position: pos, distance: dist });
    }

    // Sort by distance (nearest first)
    this.sortedTargets.sort((a, b) => a.distance - b.distance);

    // If current target no longer in list, reset index
    if (this.currentTarget) {
      const idx = this.sortedTargets.findIndex(
        t => t.id === this.currentTarget!.id && t.type === this.currentTarget!.type
      );
      if (idx >= 0) {
        this.targetIndex = idx;
      } else {
        this.targetIndex = -1;
      }
    }
  }

  private selectTarget(target: TargetEntity): void {
    // Hide previous target's label
    if (this.currentTarget) {
      this.hideTargetLabel(this.currentTarget);
    }

    this.currentTarget = target;

    // Show highlight ring
    if (this.highlightRing) {
      this.highlightRing.visible = true;
      this.highlightRing.position.set(target.position.x, 0.05, target.position.z);
    }

    // Show name label on new target
    this.showTargetLabel(target);

    // Notify listener
    this.onTargetChange?.(target);
  }

  private showTargetLabel(target: TargetEntity): void {
    if (target.type === "daemon") {
      this.daemonRenderer.showNameLabel(target.id);
    } else {
      this.avatarManager.showNameLabel(target.id);
    }
  }

  private hideTargetLabel(target: TargetEntity): void {
    if (target.type === "daemon") {
      this.daemonRenderer.hideNameLabel(target.id);
    } else {
      this.avatarManager.hideNameLabel(target.id);
    }
  }

}
