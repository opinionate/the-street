import * as THREE from "three";
import type { DaemonDefinition } from "@the-street/shared";
import { AnimationPanel } from "./AnimationPanel.js";

export class DaemonPanel {
  private container: HTMLDivElement;
  private input: HTMLTextAreaElement;
  private generateBtn: HTMLButtonElement;
  private createBtn: HTMLButtonElement;
  private status: HTMLDivElement;
  private previewArea: HTMLDivElement;
  private daemonList: HTMLDivElement;
  private plotInfoEl: HTMLDivElement;
  private placementSelect: HTMLSelectElement | null = null;
  private visible = false;
  private plotUuid: string | null = null;
  private _isSuperAdmin = false;
  private placementMode: "current-plot" | "no-plot" = "current-plot";
  private currentDefinition: DaemonDefinition | null = null;
  private currentDaemonId: string | null = null;
  private daemonAnimPanels: Map<string, AnimationPanel> = new Map();

  /** Set externally by main.ts — factory to create AnimationPanels for daemons */
  createAnimationPanel: ((daemonId: string) => AnimationPanel) | null = null;

  // 3D preview
  private previewCanvas: HTMLCanvasElement | null = null;
  private previewRenderer: THREE.WebGLRenderer | null = null;
  private previewScene: THREE.Scene | null = null;
  private previewCamera: THREE.PerspectiveCamera | null = null;
  private previewModel: THREE.Group | null = null;
  private previewRotationY = Math.PI + Math.PI / 6;
  private previewAnimFrame = 0;
  private isDragging = false;
  private lastDragX = 0;

  // Callbacks
  onPlacementChange: ((mode: "current-plot" | "no-plot") => void) | null = null;
  onGenerate: ((description: string) => Promise<void>) | null = null;
  onCreate: ((definition: DaemonDefinition) => Promise<void>) | null = null;
  onDelete: ((daemonId: string) => Promise<void>) | null = null;
  onUpdate: ((daemonId: string, definition: DaemonDefinition) => Promise<void>) | null = null;
  onRecall: ((daemonId: string) => void) | null = null;
  onToggleRoam: ((daemonId: string, enabled: boolean) => void) | null = null;
  onFetchActivity: ((daemonId: string) => Promise<Array<{
    type: string;
    content: string;
    targetName?: string;
    timestamp: number;
  }>>) | null = null;
  onGetPreviewModel: (() => THREE.Group | null) | null = null;

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "daemon-panel";
    this.container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 720px;
      max-width: 95vw;
      max-height: 90vh;
      background: rgba(10, 10, 15, 0.95);
      border: 1px solid rgba(68, 255, 136, 0.3);
      border-radius: 12px;
      z-index: 200;
      display: none;
      font-family: system-ui, sans-serif;
      color: white;
      overflow: hidden;
    `;

    // Header
    const header = document.createElement("div");
    header.style.cssText = `
      padding: 14px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: space-between;
    `;
    const title = document.createElement("div");
    title.innerHTML = '<span style="color:#44ff88;font-weight:bold">DAEMON</span> Manager';
    title.style.cssText = "font-size: 16px; font-weight: bold;";
    header.appendChild(title);
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "\u00D7";
    closeBtn.style.cssText = `
      background: none; border: none;
      color: rgba(255, 255, 255, 0.6);
      font-size: 22px; cursor: pointer; padding: 0 4px;
    `;
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);
    this.container.appendChild(header);

    // Body wrapper
    const body = document.createElement("div");
    body.style.cssText = "padding: 16px 20px; overflow-y: auto; max-height: calc(90vh - 60px);";

    // Plot info
    this.plotInfoEl = document.createElement("div");
    this.plotInfoEl.style.cssText = "font-size: 12px; margin-bottom: 12px; padding: 6px 8px; border-radius: 4px; background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.4);";
    this.plotInfoEl.textContent = "Walk to your plot to manage daemons";
    body.appendChild(this.plotInfoEl);

    // Two-column layout
    const columns = document.createElement("div");
    columns.style.cssText = "display: flex; gap: 16px; margin-bottom: 16px;";

    // Left column: 3D preview
    const leftCol = document.createElement("div");
    leftCol.style.cssText = "flex: 0 0 300px;";
    this.previewCanvas = document.createElement("canvas");
    this.previewCanvas.width = 300;
    this.previewCanvas.height = 350;
    this.previewCanvas.style.cssText = "width: 300px; height: 350px; border-radius: 8px; background: #111; cursor: grab;";
    this.previewCanvas.addEventListener("mousedown", (e) => { this.isDragging = true; this.lastDragX = e.clientX; this.previewCanvas!.style.cursor = "grabbing"; });
    window.addEventListener("mousemove", (e) => { if (this.isDragging) { this.previewRotationY += (e.clientX - this.lastDragX) * 0.01; this.lastDragX = e.clientX; } });
    window.addEventListener("mouseup", () => { this.isDragging = false; if (this.previewCanvas) this.previewCanvas.style.cursor = "grab"; });
    leftCol.appendChild(this.previewCanvas);
    columns.appendChild(leftCol);

    // Right column: controls
    const rightCol = document.createElement("div");
    rightCol.style.cssText = "flex: 1; display: flex; flex-direction: column; gap: 8px;";

    // Description input
    this.input = document.createElement("textarea");
    this.input.placeholder = "Describe your NPC daemon...\ne.g. A witty roaming bard who plays invisible instruments";
    this.input.style.cssText = "width: 100%; height: 80px; padding: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: white; font-family: system-ui, sans-serif; font-size: 13px; resize: vertical; outline: none; box-sizing: border-box;";
    this.input.addEventListener("keydown", (e) => e.stopPropagation());
    rightCol.appendChild(this.input);

    // Generate button
    this.generateBtn = document.createElement("button");
    this.generateBtn.textContent = "Generate Daemon";
    this.generateBtn.disabled = true;
    this.generateBtn.style.cssText = this.btnStyle("#228844", "0.5");
    this.generateBtn.addEventListener("click", () => this.handleGenerate());
    rightCol.appendChild(this.generateBtn);

    // Status
    this.status = document.createElement("div");
    this.status.style.cssText = "font-size: 12px; color: rgba(255,255,255,0.6); min-height: 20px;";
    rightCol.appendChild(this.status);

    // Preview area (personality preview)
    this.previewArea = document.createElement("div");
    this.previewArea.style.cssText = "font-size: 12px; color: rgba(255,255,255,0.7); max-height: 150px; overflow-y: auto; display: none; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;";
    rightCol.appendChild(this.previewArea);

    // Create button
    this.createBtn = document.createElement("button");
    this.createBtn.textContent = "Place Daemon";
    this.createBtn.style.cssText = this.btnStyle("#44ff88", "1") + "display: none; color: black;";
    this.createBtn.addEventListener("click", () => this.handleCreate());
    rightCol.appendChild(this.createBtn);

    columns.appendChild(rightCol);
    body.appendChild(columns);

    // Divider
    const divider = document.createElement("hr");
    divider.style.cssText = "border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 0 0 12px;";
    body.appendChild(divider);

    // Daemon list
    const listTitle = document.createElement("div");
    listTitle.textContent = "Your Daemons";
    listTitle.style.cssText = "font-size: 14px; font-weight: bold; margin-bottom: 8px; color: rgba(255,255,255,0.6);";
    body.appendChild(listTitle);

    this.daemonList = document.createElement("div");
    body.appendChild(this.daemonList);

    this.container.appendChild(body);

    document.body.appendChild(this.container);
  }

  private btnStyle(bg: string, opacity: string): string {
    return `width: 100%; padding: 10px; background: ${bg}; border: none; border-radius: 4px; color: white; font-size: 14px; font-weight: bold; cursor: pointer; opacity: ${opacity};`;
  }

  private initPreview(): void {
    if (this.previewRenderer || !this.previewCanvas) return;

    this.previewScene = new THREE.Scene();
    this.previewScene.background = new THREE.Color(0x111111);

    this.previewCamera = new THREE.PerspectiveCamera(40, 300 / 350, 0.1, 50);
    this.previewCamera.position.set(0, 1.2, 3.5);
    this.previewCamera.lookAt(0, 0.9, 0);

    this.previewRenderer = new THREE.WebGLRenderer({ canvas: this.previewCanvas, antialias: true });
    this.previewRenderer.setSize(300, 350);
    this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.previewScene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(2, 3, 2);
    this.previewScene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x4488ff, 0.3);
    fillLight.position.set(-2, 1, -1);
    this.previewScene.add(fillLight);

    // Ground circle
    const groundGeo = new THREE.CircleGeometry(1, 32);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    this.previewScene.add(ground);

    this.startPreviewLoop();
  }

  private startPreviewLoop(): void {
    const animate = () => {
      this.previewAnimFrame = requestAnimationFrame(animate);
      if (!this.previewRenderer || !this.previewScene || !this.previewCamera) return;
      if (this.previewModel) {
        this.previewModel.rotation.y = this.previewRotationY;
      }
      this.previewRenderer.render(this.previewScene, this.previewCamera);
    };
    animate();
  }

  refreshPreview(): void {
    if (!this.previewScene) return;

    // Remove old model
    if (this.previewModel) {
      this.previewScene.remove(this.previewModel);
      this.previewModel = null;
    }

    // Get model from callback
    const model = this.onGetPreviewModel?.();
    if (model) {
      this.previewModel = model;
      this.previewModel.rotation.y = this.previewRotationY;
      this.previewScene.add(this.previewModel);
    }
  }

  setSuperAdmin(isSuperAdmin: boolean): void {
    this._isSuperAdmin = isSuperAdmin;
    this.updatePlacementUI();
  }

  setPlotInfo(plotUuid: string | null, ownerName: string | null): void {
    this.plotUuid = plotUuid;
    this.updatePlacementUI();
  }

  private updatePlacementUI(): void {
    if (this._isSuperAdmin) {
      // Show placement dropdown for admins
      this.plotInfoEl.style.display = "none";
      if (!this.placementSelect) {
        this.placementSelect = document.createElement("select");
        this.placementSelect.style.cssText = "width: 100%; padding: 6px 8px; background: rgba(255,255,255,0.1); border: 1px solid #ffaa44; border-radius: 4px; color: #ffaa44; font-size: 12px; outline: none; cursor: pointer; margin-bottom: 12px;";
        this.placementSelect.addEventListener("change", () => {
          this.placementMode = this.placementSelect!.value as "current-plot" | "no-plot";
          this.updateGenerateButton();
          this.onPlacementChange?.(this.placementMode);
        });
        // Insert after plotInfoEl
        this.plotInfoEl.parentElement?.insertBefore(this.placementSelect, this.plotInfoEl.nextSibling);
      }
      // Rebuild options based on current state
      const prevValue = this.placementSelect.value || this.placementMode;
      this.placementSelect.innerHTML = "";

      const plotOpt = document.createElement("option");
      plotOpt.value = "current-plot";
      plotOpt.textContent = this.plotUuid ? `Current Plot` : "Current Plot (walk to a plot)";
      plotOpt.disabled = !this.plotUuid;
      this.placementSelect.appendChild(plotOpt);

      const streetOpt = document.createElement("option");
      streetOpt.value = "no-plot";
      streetOpt.textContent = "Street Daemon (no plot)";
      this.placementSelect.appendChild(streetOpt);

      // Restore previous selection, or auto-select street if not on a plot
      if (prevValue === "current-plot" && this.plotUuid) {
        this.placementSelect.value = "current-plot";
        this.placementMode = "current-plot";
      } else if (prevValue === "no-plot" || !this.plotUuid) {
        this.placementSelect.value = "no-plot";
        this.placementMode = "no-plot";
      }

      this.placementSelect.style.display = "";
    } else {
      // Non-admin: show static plot info text
      this.plotInfoEl.style.display = "";
      if (this.placementSelect) {
        this.placementSelect.style.display = "none";
      }
      if (this.plotUuid) {
        this.plotInfoEl.textContent = "On your plot";
        this.plotInfoEl.style.color = "#44ff88";
      } else {
        this.plotInfoEl.textContent = "Walk to your plot to manage daemons";
        this.plotInfoEl.style.color = "rgba(255, 255, 255, 0.4)";
      }
    }
    this.updateGenerateButton();
  }

  private updateGenerateButton(): void {
    const canGenerate = this._isSuperAdmin
      ? (this.placementMode === "no-plot" || !!this.plotUuid)
      : !!this.plotUuid;
    this.generateBtn.disabled = !canGenerate;
    this.generateBtn.style.opacity = canGenerate ? "1" : "0.5";
  }

  /** Returns the current plotUuid (whatever plot the player is standing on) */
  getPlotUuid(): string | null {
    return this.plotUuid;
  }

  /** Returns the effective plotUuid based on admin placement mode */
  getEffectivePlotUuid(): string | null {
    if (this._isSuperAdmin && this.placementMode === "no-plot") {
      return null;
    }
    return this.plotUuid;
  }

  setGenerationResult(definition: DaemonDefinition): void {
    this.currentDefinition = definition;

    const escapeHtml = (t: string | undefined) => {
      const div = document.createElement("div");
      div.textContent = String(t || "");
      return div.innerHTML;
    };

    const behavior = definition.behavior;
    const personality = definition.personality;

    let html = `
      <div style="margin-bottom:6px"><strong style="color:#44ff88">${escapeHtml(definition.name)}</strong></div>
      <div style="margin-bottom:4px; color:rgba(255,255,255,0.5)"><em>${escapeHtml(definition.description)}</em></div>
      <div style="margin-bottom:4px"><strong>Role:</strong> ${escapeHtml(behavior.type)}</div>
      <div style="margin-bottom:4px"><strong>Greeting:</strong> "${escapeHtml(behavior.greetingMessage || "—")}"</div>
    `;

    if (personality) {
      html += `
        <div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.1)">
          <div style="color:#44ff88; font-weight:bold; margin-bottom:4px; font-size:11px">PERSONALITY</div>
          <div style="margin-bottom:3px"><strong>Traits:</strong> ${escapeHtml(personality.traits?.join(", "))}</div>
          <div style="margin-bottom:3px"><strong>Style:</strong> ${escapeHtml(personality.speechStyle)}</div>
          <div style="margin-bottom:3px"><strong>Interests:</strong> ${escapeHtml(personality.interests?.join(", "))}</div>
          <div style="margin-bottom:3px"><strong>Quirks:</strong> ${escapeHtml(personality.quirks?.join(", "))}</div>
          <div style="margin-bottom:3px; font-style:italic; color:rgba(255,255,255,0.5)">${escapeHtml(personality.backstory)}</div>
        </div>
      `;
    }

    this.previewArea.style.display = "block";
    this.previewArea.innerHTML = html;
    this.createBtn.style.display = "block";
  }

  setDaemonList(daemons: Array<{
    id: string;
    name: string;
    description: string;
    definition?: DaemonDefinition;
  }>): void {
    this.daemonList.innerHTML = "";

    if (daemons.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No daemons yet";
      empty.style.cssText = "color: rgba(255,255,255,0.4); font-size: 12px;";
      this.daemonList.appendChild(empty);
      return;
    }

    for (const daemon of daemons) {
      const card = document.createElement("div");
      card.style.cssText = "padding: 10px; margin-bottom: 6px; background: rgba(255,255,255,0.06); border-radius: 6px; border: 1px solid rgba(255,255,255,0.08);";

      // Header: name + type badge
      const header = document.createElement("div");
      header.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;";
      const nameEl = document.createElement("span");
      nameEl.style.cssText = "font-weight: bold; font-size: 13px; color: #44ff88;";
      nameEl.textContent = daemon.name;
      header.appendChild(nameEl);

      const behavior = daemon.definition?.behavior;
      if (behavior?.type) {
        const badge = document.createElement("span");
        badge.textContent = String(behavior.type);
        badge.style.cssText = "font-size: 10px; padding: 2px 6px; border-radius: 3px; background: rgba(68,255,136,0.15); color: #44ff88; text-transform: uppercase; font-weight: bold;";
        header.appendChild(badge);
      }
      card.appendChild(header);

      // Description
      const desc = document.createElement("div");
      desc.textContent = daemon.description?.slice(0, 60) || "";
      desc.style.cssText = "font-size: 11px; color: rgba(255,255,255,0.4); margin-bottom: 6px;";
      card.appendChild(desc);

      // Personality traits
      const personality = daemon.definition?.personality;
      if (personality?.traits) {
        const traits = document.createElement("div");
        traits.textContent = personality.traits.join(" / ");
        traits.style.cssText = "font-size: 10px; color: rgba(170,68,255,0.7); margin-bottom: 6px; font-style: italic;";
        card.appendChild(traits);
      }

      // Control buttons
      const controls = document.createElement("div");
      controls.style.cssText = "display: flex; gap: 4px; flex-wrap: wrap;";

      // Roaming toggle
      const isRoaming = behavior?.roamingEnabled !== false;
      const roamBtn = document.createElement("button");
      roamBtn.textContent = isRoaming ? "Roaming" : "Stationary";
      roamBtn.style.cssText = `flex: 1; padding: 4px 6px; background: ${isRoaming ? "rgba(170,68,255,0.3)" : "rgba(255,255,255,0.1)"}; border: 1px solid ${isRoaming ? "rgba(170,68,255,0.5)" : "rgba(255,255,255,0.15)"}; color: ${isRoaming ? "#aa44ff" : "rgba(255,255,255,0.5)"}; font-size: 11px; cursor: pointer; border-radius: 3px; font-weight: bold;`;
      roamBtn.addEventListener("click", () => { this.onToggleRoam?.(daemon.id, !isRoaming); roamBtn.textContent = isRoaming ? "Stationary" : "Roaming"; });
      controls.appendChild(roamBtn);

      // Recall
      const recallBtn = document.createElement("button");
      recallBtn.textContent = "Recall";
      recallBtn.style.cssText = "flex: 1; padding: 4px 6px; background: rgba(68,136,255,0.2); border: 1px solid rgba(68,136,255,0.4); color: #4488ff; font-size: 11px; cursor: pointer; border-radius: 3px; font-weight: bold;";
      recallBtn.addEventListener("click", () => { this.onRecall?.(daemon.id); recallBtn.textContent = "Recalled!"; setTimeout(() => { recallBtn.textContent = "Recall"; }, 2000); });
      controls.appendChild(recallBtn);

      // Delete
      const delBtn = document.createElement("button");
      delBtn.textContent = "Delete";
      delBtn.style.cssText = "padding: 4px 8px; background: rgba(255,68,68,0.2); border: 1px solid rgba(255,68,68,0.4); color: #ff4444; font-size: 11px; cursor: pointer; border-radius: 3px; font-weight: bold;";
      delBtn.addEventListener("click", () => { if (confirm(`Delete ${daemon.name}?`)) this.onDelete?.(daemon.id); });
      controls.appendChild(delBtn);

      card.appendChild(controls);

      // Activity log
      const activityContainer = document.createElement("div");
      activityContainer.style.cssText = "margin-top: 6px;";
      const activityBtn = document.createElement("button");
      activityBtn.textContent = "Activity";
      activityBtn.style.cssText = "width: 100%; padding: 3px 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.4); font-size: 10px; cursor: pointer; border-radius: 3px;";
      const activityLog = document.createElement("div");
      activityLog.style.cssText = "display: none; margin-top: 4px; max-height: 120px; overflow-y: auto; font-size: 10px; color: rgba(255,255,255,0.5);";
      activityBtn.addEventListener("click", async () => {
        if (activityLog.style.display === "none") {
          activityLog.style.display = "block";
          activityBtn.textContent = "Activity (loading...)";
          try {
            const activity = await this.onFetchActivity?.(daemon.id) || [];
            activityLog.innerHTML = "";
            if (activity.length === 0) {
              activityLog.textContent = "No recent activity";
            } else {
              for (const entry of activity.reverse()) {
                const line = document.createElement("div");
                line.style.cssText = "padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.04);";
                const age = this.formatAge(entry.timestamp);
                const typeColor = entry.type === "conversation" ? "#aa44ff" : entry.type === "emote" ? "#ffaa00" : "#44ff88";
                line.innerHTML = `<span style="color:${typeColor}">[${entry.type}]</span> ${this.escapeHtml(entry.content)}${entry.targetName ? ` <span style="color:rgba(255,255,255,0.3)">with ${this.escapeHtml(entry.targetName)}</span>` : ""} <span style="color:rgba(255,255,255,0.2)">${age}</span>`;
                activityLog.appendChild(line);
              }
            }
            activityBtn.textContent = "Activity (hide)";
          } catch {
            activityLog.textContent = "Failed to load activity";
            activityBtn.textContent = "Activity";
          }
        } else {
          activityLog.style.display = "none";
          activityBtn.textContent = "Activity";
        }
      });
      activityContainer.appendChild(activityBtn);
      activityContainer.appendChild(activityLog);
      card.appendChild(activityContainer);

      this.daemonList.appendChild(card);
    }
  }

  show(): void {
    this.visible = true;
    this.container.style.display = "block";
    if (document.pointerLockElement) document.exitPointerLock();
    this.initPreview();
    // Restart the render loop if it was stopped by hide()
    if (this.previewRenderer && !this.previewAnimFrame) {
      this.startPreviewLoop();
    }
    setTimeout(() => this.input.focus(), 50);
  }

  hide(): void {
    this.visible = false;
    this.container.style.display = "none";
    // Stop the preview render loop to avoid wasting GPU cycles while hidden
    if (this.previewAnimFrame) {
      cancelAnimationFrame(this.previewAnimFrame);
      this.previewAnimFrame = 0;
    }
  }

  toggle(): void {
    if (this.visible) this.hide(); else this.show();
  }

  isVisible(): boolean {
    return this.visible;
  }

  private async handleGenerate(): Promise<void> {
    const description = this.input.value.trim();
    if (!description) return;

    this.generateBtn.disabled = true;
    this.generateBtn.textContent = "Generating...";
    this.status.textContent = "AI is designing your daemon's personality and appearance...";
    this.status.style.color = "#44ff88";
    this.createBtn.style.display = "none";
    this.previewArea.style.display = "none";

    try {
      await this.onGenerate?.(description);
      this.status.textContent = "Daemon generated! Review personality, then place it.";
      this.status.style.color = "#44ff88";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      this.status.textContent = `Error: ${message}`;
      this.status.style.color = "#ff4444";
    } finally {
      this.generateBtn.textContent = "Generate Daemon";
      this.updateGenerateButton();
    }
  }

  setCurrentDaemonId(id: string): void {
    this.currentDaemonId = id;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = String(text || "");
    return div.innerHTML;
  }

  private formatAge(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  private async handleCreate(): Promise<void> {
    const effectivePlotUuid = this.getEffectivePlotUuid();
    if (!this.currentDefinition || (!effectivePlotUuid && this.placementMode !== "no-plot")) return;

    this.createBtn.disabled = true;
    this.createBtn.textContent = "Placing...";

    try {
      await this.onCreate?.(this.currentDefinition);
      this.status.textContent = "Daemon placed! It may start roaming the street.";
      this.status.style.color = "#44ff88";
      this.input.value = "";
      this.previewArea.style.display = "none";
      this.createBtn.style.display = "none";
      this.currentDefinition = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Creation failed";
      this.status.textContent = `Error: ${message}`;
      this.status.style.color = "#ff4444";
    } finally {
      this.createBtn.textContent = "Place Daemon";
      this.createBtn.disabled = false;
    }
  }

  dispose(): void {
    if (this.previewAnimFrame) cancelAnimationFrame(this.previewAnimFrame);
    this.previewRenderer?.dispose();
  }
}
