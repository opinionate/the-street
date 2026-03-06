/**
 * Reusable animation management panel for assigning custom Mixamo animations
 * to avatars or daemons. Handles FBX/GLB upload, client-side conversion,
 * and slot assignment.
 *
 * Embeddable in both AvatarPanel and DaemonPanel.
 */
import { convertFbxToGlb } from "../avatar/animation-converter.js";

const CORE_SLOTS = ["walk", "run", "idle"] as const;
const MOVEMENT_SLOTS = [
  "turnLeft", "turnRight",
  "strafeLeftWalk", "strafeRightWalk",
  "strafeLeftRun", "strafeRightRun",
  "jump",
] as const;
const DEFAULT_EMOTES = ["dance", "wave", "shrug", "nod", "cry", "bow", "cheer", "laugh"] as const;

interface AnimationRecord {
  id: string;
  slot: string;
  original_filename: string;
  created_at: string;
}

export interface AnimationPanelOptions {
  entityType: "avatar" | "daemon";
  getEntityId: () => string | null;
  apiUrl: string;
  getAuthToken: () => Promise<string>;
}

export class AnimationPanel {
  private container: HTMLDivElement;
  private slotsContainer: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private options: AnimationPanelOptions;
  private animations: AnimationRecord[] = [];
  private fileInput: HTMLInputElement;
  private pendingSlot: string | null = null;

  /** Called after a custom animation is uploaded or deleted so the parent can reload the avatar */
  onAnimationChanged: (() => void) | null = null;

  constructor(options: AnimationPanelOptions) {
    this.options = options;

    this.container = document.createElement("div");
    this.container.style.cssText = `
      margin-top: 12px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      display: none;
    `;

    // Header
    const header = document.createElement("div");
    header.style.cssText = `
      font-size: 13px;
      font-weight: bold;
      color: rgba(255, 255, 255, 0.7);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    `;
    header.textContent = "Custom Animations";
    this.container.appendChild(header);

    // Slots container
    this.slotsContainer = document.createElement("div");
    this.slotsContainer.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
    this.container.appendChild(this.slotsContainer);

    // Add custom emote button
    const addEmoteBtn = document.createElement("button");
    addEmoteBtn.textContent = "+ Add Custom Emote";
    addEmoteBtn.style.cssText = `
      margin-top: 8px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px dashed rgba(255, 255, 255, 0.15);
      border-radius: 4px;
      color: rgba(255, 255, 255, 0.4);
      font-size: 11px;
      padding: 5px 10px;
      cursor: pointer;
      width: 100%;
    `;
    addEmoteBtn.addEventListener("click", () => this.promptCustomEmote());
    this.container.appendChild(addEmoteBtn);

    // Status
    this.statusEl = document.createElement("div");
    this.statusEl.style.cssText = `
      margin-top: 6px;
      font-size: 10px;
      color: rgba(255, 255, 255, 0.3);
    `;
    this.container.appendChild(this.statusEl);

    // Hidden file input
    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = ".fbx,.glb,.gltf";
    this.fileInput.style.display = "none";
    this.fileInput.addEventListener("change", () => {
      console.log("[AnimPanel] File input change event fired, files:", this.fileInput.files?.length);
      this.setStatus("File selected, processing...");
      this.handleFileSelect().catch((err) => {
        console.error("[AnimPanel] handleFileSelect error:", err);
        this.setStatus(`Error: ${err instanceof Error ? err.message : err}`, true);
      });
    });
    this.container.appendChild(this.fileInput);

    // Render default slot rows immediately (no entity needed to see the list)
    this.renderSlots();
  }

  get element(): HTMLDivElement {
    return this.container;
  }

  show(entityId?: string): void {
    this.container.style.display = "block";
    this.refresh();
  }

  hide(): void {
    this.container.style.display = "none";
  }

  async refresh(): Promise<void> {
    const entityId = this.options.getEntityId();

    if (entityId) {
      try {
        const res = await fetch(
          `${this.options.apiUrl}/api/animations/${this.options.entityType}/${entityId}`,
          { headers: { Authorization: `Bearer ${await this.options.getAuthToken()}` } },
        );
        if (res.ok) {
          const data = await res.json();
          this.animations = data.animations;
        }
      } catch {
        // ignore fetch errors
      }
    }

    this.renderSlots();
  }

  private renderSlots(): void {
    this.slotsContainer.innerHTML = "";

    // Core slots (walk, run, idle)
    for (const slot of CORE_SLOTS) {
      this.slotsContainer.appendChild(this.createSlotRow(slot));
    }

    // Movement separator
    const movSep = document.createElement("div");
    movSep.style.cssText = "font-size: 10px; color: rgba(255, 255, 255, 0.3); margin: 6px 0 2px; text-transform: uppercase; letter-spacing: 0.5px;";
    movSep.textContent = "Movement";
    this.slotsContainer.appendChild(movSep);

    // Movement slots (turn, strafe, jump)
    for (const slot of MOVEMENT_SLOTS) {
      this.slotsContainer.appendChild(this.createSlotRow(slot));
    }

    // Emotes separator
    const sep = document.createElement("div");
    sep.style.cssText = "font-size: 10px; color: rgba(255, 255, 255, 0.3); margin: 6px 0 2px; text-transform: uppercase; letter-spacing: 0.5px;";
    sep.textContent = "Emotes";
    this.slotsContainer.appendChild(sep);

    // Default emote slots
    for (const emote of DEFAULT_EMOTES) {
      this.slotsContainer.appendChild(this.createSlotRow(`emote-${emote}`, emote));
    }

    // Custom emote slots (from DB, not in default list)
    const customEmotes = this.animations.filter(
      (a) => a.slot.startsWith("emote-") && !DEFAULT_EMOTES.includes(a.slot.replace("emote-", "") as any),
    );
    for (const anim of customEmotes) {
      const displayName = anim.slot.replace("emote-", "");
      this.slotsContainer.appendChild(this.createSlotRow(anim.slot, displayName));
    }
  }

  private createSlotRow(slot: string, displayName?: string): HTMLDivElement {
    const row = document.createElement("div");
    row.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 3px 0;
      font-size: 12px;
    `;

    const label = document.createElement("span");
    label.style.cssText = "color: rgba(255, 255, 255, 0.6); min-width: 70px;";
    label.textContent = displayName || slot;
    row.appendChild(label);

    const rightSide = document.createElement("div");
    rightSide.style.cssText = "display: flex; align-items: center; gap: 4px;";

    const customAnim = this.animations.find((a) => a.slot === slot);

    if (customAnim) {
      // Show custom badge + delete button
      const badge = document.createElement("span");
      badge.style.cssText = `
        font-size: 10px;
        color: #44aaff;
        background: rgba(68, 170, 255, 0.1);
        padding: 1px 6px;
        border-radius: 3px;
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      `;
      badge.textContent = customAnim.original_filename || "Custom";
      badge.title = customAnim.original_filename || "";
      rightSide.appendChild(badge);

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "\u00D7";
      deleteBtn.style.cssText = `
        background: none; border: none;
        color: rgba(255, 100, 100, 0.5);
        font-size: 14px; cursor: pointer; padding: 0 2px;
      `;
      deleteBtn.title = "Remove custom animation";
      deleteBtn.addEventListener("click", () => this.deleteAnimation(customAnim.id));
      rightSide.appendChild(deleteBtn);
    } else {
      const defaultBadge = document.createElement("span");
      defaultBadge.style.cssText = "font-size: 10px; color: rgba(255, 255, 255, 0.25);";
      defaultBadge.textContent = "Default";
      rightSide.appendChild(defaultBadge);
    }

    const uploadBtn = document.createElement("button");
    uploadBtn.textContent = "Upload";
    uploadBtn.style.cssText = `
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 3px;
      color: rgba(255, 255, 255, 0.5);
      font-size: 10px;
      padding: 2px 8px;
      cursor: pointer;
    `;
    uploadBtn.addEventListener("click", () => {
      console.log("[AnimPanel] Upload clicked for slot:", slot);
      this.setStatus(`Waiting for file selection (${displayName || slot})...`);
      this.pendingSlot = slot;
      this.fileInput.click();
    });
    rightSide.appendChild(uploadBtn);

    row.appendChild(rightSide);
    return row;
  }

  private promptCustomEmote(): void {
    const name = prompt("Enter custom emote name (e.g. 'backflip', 'sit'):");
    if (!name) return;
    const sanitized = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    if (!sanitized) return;
    this.pendingSlot = `emote-${sanitized}`;
    this.fileInput.click();
  }

  private async handleFileSelect(): Promise<void> {
    const file = this.fileInput.files?.[0];
    if (!file || !this.pendingSlot) {
      console.warn("[AnimPanel] handleFileSelect: no file or no pendingSlot", { file: !!file, pendingSlot: this.pendingSlot });
      return;
    }

    const slot = this.pendingSlot;
    this.pendingSlot = null;
    this.fileInput.value = ""; // reset

    const entityId = this.options.getEntityId();
    if (!entityId) {
      console.warn("[AnimPanel] No entity selected");
      this.setStatus("No entity selected", true);
      return;
    }

    try {
      this.setStatus(`Converting ${file.name}...`);

      console.log("[AnimPanel] Starting conversion for", file.name, "slot:", slot);
      const glbBuffer = await convertFbxToGlb(file);
      console.log("[AnimPanel] Conversion complete, size:", glbBuffer.byteLength);
      this.setStatus(`Uploading ${slot} (${(glbBuffer.byteLength / 1024).toFixed(1)} KB)...`);

      const res = await fetch(`${this.options.apiUrl}/api/animations/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-entity-type": this.options.entityType,
          "x-entity-id": entityId,
          "x-slot": slot,
          "x-original-filename": file.name,
          Authorization: `Bearer ${await this.options.getAuthToken()}`,
        },
        body: glbBuffer,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        this.setStatus(`Upload failed: ${err.error}`, true);
        return;
      }

      this.setStatus(`${slot} uploaded successfully`);
      await this.refresh();
      this.onAnimationChanged?.();
    } catch (err) {
      this.setStatus(`Error: ${err instanceof Error ? err.message : err}`, true);
    }
  }

  private async deleteAnimation(animId: string): Promise<void> {
    try {
      this.setStatus("Removing...");
      const res = await fetch(`${this.options.apiUrl}/api/animations/${animId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${await this.options.getAuthToken()}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        this.setStatus(`Delete failed: ${err.error}`, true);
        return;
      }
      this.setStatus("Animation removed");
      await this.refresh();
      this.onAnimationChanged?.();
    } catch (err) {
      this.setStatus(`Error: ${err instanceof Error ? err.message : err}`, true);
    }
  }

  private setStatus(msg: string, isError = false): void {
    this.statusEl.textContent = msg;
    this.statusEl.style.color = isError ? "#ff6666" : "rgba(255, 255, 255, 0.3)";
  }
}
