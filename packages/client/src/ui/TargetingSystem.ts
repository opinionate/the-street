import * as THREE from "three";
import type { AvatarManager } from "../avatar/AvatarManager.js";
import type { DaemonRenderer } from "../avatar/DaemonRenderer.js";

const CONE_ANGLE = Math.PI / 3; // 60 degrees
const CONE_RANGE = 30;

interface TargetEntity {
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

  // Info card HTML
  private infoCard: HTMLDivElement;

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
      depthTest: false,
    });
    this.highlightRing = new THREE.Mesh(ringGeo, ringMat);
    this.highlightRing.visible = false;
    this.highlightRing.renderOrder = 999;
    this.scene.add(this.highlightRing);

    // Create info card
    this.infoCard = document.createElement("div");
    this.infoCard.id = "target-info-card";
    this.infoCard.style.cssText = `
      position: fixed;
      top: 50%;
      right: 20px;
      transform: translateY(-50%);
      width: 240px;
      background: rgba(10, 10, 15, 0.9);
      border: 1px solid rgba(0, 255, 255, 0.3);
      border-radius: 8px;
      padding: 16px;
      color: white;
      font-family: system-ui, sans-serif;
      font-size: 13px;
      z-index: 200;
      display: none;
      pointer-events: none;
    `;
    document.body.appendChild(this.infoCard);
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

  /** Deselect current target */
  deselect(): void {
    this.currentTarget = null;
    this.targetIndex = -1;
    if (this.highlightRing) this.highlightRing.visible = false;
    this.infoCard.style.display = "none";
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
    const playerRot = this.avatarManager.getLocalPlayerRotation();
    if (!playerPos) return;

    const forward = new THREE.Vector3(
      -Math.sin(playerRot),
      0,
      -Math.cos(playerRot),
    );

    this.sortedTargets = [];

    // Collect daemons
    for (const id of this.daemonRenderer.getAllDaemonIds()) {
      const pos = this.daemonRenderer.getDaemonPosition(id);
      if (!pos) continue;
      const toTarget = new THREE.Vector3().subVectors(pos, playerPos);
      toTarget.y = 0;
      const dist = toTarget.length();
      if (dist > CONE_RANGE || dist < 0.5) continue;

      const angle = forward.angleTo(toTarget.normalize());
      if (angle > CONE_ANGLE / 2) continue;

      this.sortedTargets.push({ id, type: "daemon", position: pos, distance: dist });
    }

    // Collect other players
    for (const id of this.avatarManager.getOtherPlayerIds()) {
      const pos = this.avatarManager.getPlayerPosition(id);
      if (!pos) continue;
      const toTarget = new THREE.Vector3().subVectors(pos, playerPos);
      toTarget.y = 0;
      const dist = toTarget.length();
      if (dist > CONE_RANGE || dist < 0.5) continue;

      const angle = forward.angleTo(toTarget.normalize());
      if (angle > CONE_ANGLE / 2) continue;

      this.sortedTargets.push({ id, type: "player", position: pos, distance: dist });
    }

    // Sort by distance
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
    this.currentTarget = target;

    // Show highlight ring
    if (this.highlightRing) {
      this.highlightRing.visible = true;
      this.highlightRing.position.set(target.position.x, 0.05, target.position.z);
    }

    // Update info card
    this.updateInfoCard(target);
  }

  private updateInfoCard(target: TargetEntity): void {
    if (target.type === "daemon") {
      const info = this.daemonRenderer.getDaemonInfo(target.id);
      if (!info) {
        this.infoCard.style.display = "none";
        return;
      }
      this.infoCard.innerHTML = `
        <div style="font-size:16px;font-weight:bold;margin-bottom:8px;color:#88ddaa">${this.escapeHtml(info.name)}</div>
        <div style="margin-bottom:4px"><span style="color:#888">Role:</span> ${this.escapeHtml(info.role)}</div>
        <div style="margin-bottom:4px"><span style="color:#888">Mood:</span> ${this.escapeHtml(info.mood)}</div>
        <div style="margin-bottom:4px"><span style="color:#888">Action:</span> ${this.escapeHtml(info.action)}</div>
        <div style="margin-top:8px;color:#666;font-size:11px">Distance: ${target.distance.toFixed(1)}m</div>
      `;
    } else {
      const name = target.id;
      this.infoCard.innerHTML = `
        <div style="font-size:16px;font-weight:bold;margin-bottom:8px;color:#aaddff">${this.escapeHtml(name)}</div>
        <div style="margin-bottom:4px"><span style="color:#888">Player</span></div>
        <div style="margin-top:8px;color:#666;font-size:11px">Distance: ${target.distance.toFixed(1)}m</div>
      `;
    }
    this.infoCard.style.display = "block";
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
