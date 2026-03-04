export class DaemonPanel {
  private container: HTMLDivElement;
  private input: HTMLTextAreaElement;
  private generateBtn: HTMLButtonElement;
  private createBtn: HTMLButtonElement;
  private status: HTMLDivElement;
  private previewArea: HTMLDivElement;
  private daemonList: HTMLDivElement;
  private plotInfoEl: HTMLDivElement;
  private visible = false;
  private plotUuid: string | null = null;
  private currentDefinition: unknown = null;

  onGenerate: ((description: string) => Promise<void>) | null = null;
  onCreate: ((definition: unknown) => Promise<void>) | null = null;
  onDelete: ((daemonId: string) => Promise<void>) | null = null;
  onRecall: ((daemonId: string) => void) | null = null;
  onToggleRoam: ((daemonId: string, enabled: boolean) => void) | null = null;
  onFetchActivity: ((daemonId: string) => Promise<Array<{
    type: string;
    content: string;
    targetName?: string;
    timestamp: number;
  }>>) | null = null;

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "daemon-panel";
    this.container.style.cssText = `
      position: fixed;
      top: 60px;
      right: 20px;
      width: 370px;
      max-height: calc(100vh - 100px);
      background: rgba(0, 0, 0, 0.9);
      border: 1px solid rgba(68, 255, 136, 0.3);
      border-radius: 8px;
      padding: 16px;
      z-index: 100;
      display: none;
      font-family: system-ui, sans-serif;
      color: white;
      overflow-y: auto;
    `;

    // Title
    const title = document.createElement("div");
    title.textContent = "Daemon Manager";
    title.style.cssText = `
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 12px;
      color: #44ff88;
    `;
    this.container.appendChild(title);

    // Plot info
    this.plotInfoEl = document.createElement("div");
    this.plotInfoEl.style.cssText = `
      font-size: 12px;
      margin-bottom: 8px;
      padding: 6px 8px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.05);
      color: rgba(255, 255, 255, 0.4);
    `;
    this.plotInfoEl.textContent = "Walk to your plot to manage daemons";
    this.container.appendChild(this.plotInfoEl);

    // Input
    this.input = document.createElement("textarea");
    this.input.placeholder =
      "Describe your NPC daemon...\ne.g. A witty roaming bard who plays invisible instruments and gossips about everyone";
    this.input.style.cssText = `
      width: 100%;
      height: 80px;
      padding: 8px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      color: white;
      font-family: system-ui, sans-serif;
      font-size: 13px;
      resize: vertical;
      outline: none;
      box-sizing: border-box;
    `;
    this.input.addEventListener("keydown", (e) => e.stopPropagation());
    this.container.appendChild(this.input);

    // Status
    this.status = document.createElement("div");
    this.status.style.cssText = `
      margin-top: 8px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.6);
      min-height: 20px;
    `;
    this.container.appendChild(this.status);

    // Preview area
    this.previewArea = document.createElement("div");
    this.previewArea.style.cssText = `
      margin-top: 8px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.7);
      max-height: 200px;
      overflow-y: auto;
      display: none;
      padding: 8px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
    `;
    this.container.appendChild(this.previewArea);

    // Generate button
    this.generateBtn = document.createElement("button");
    this.generateBtn.textContent = "Generate Daemon";
    this.generateBtn.disabled = true;
    this.generateBtn.style.cssText = this.btnStyle("#228844", "0.5");
    this.generateBtn.addEventListener("click", () => this.handleGenerate());
    this.container.appendChild(this.generateBtn);

    // Create button (hidden until generation)
    this.createBtn = document.createElement("button");
    this.createBtn.textContent = "Place Daemon";
    this.createBtn.style.cssText = this.btnStyle("#44ff88", "1") + "display: none; color: black;";
    this.createBtn.addEventListener("click", () => this.handleCreate());
    this.container.appendChild(this.createBtn);

    // Divider
    const divider = document.createElement("hr");
    divider.style.cssText = "border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 16px 0 12px;";
    this.container.appendChild(divider);

    // Existing daemons list
    const listTitle = document.createElement("div");
    listTitle.textContent = "Your Daemons";
    listTitle.style.cssText = `
      font-size: 13px;
      font-weight: bold;
      margin-bottom: 8px;
      color: rgba(255, 255, 255, 0.6);
    `;
    this.container.appendChild(listTitle);

    this.daemonList = document.createElement("div");
    this.container.appendChild(this.daemonList);

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "\u00D7";
    closeBtn.style.cssText = `
      position: absolute;
      top: 8px;
      right: 12px;
      background: none;
      border: none;
      color: rgba(255, 255, 255, 0.6);
      font-size: 20px;
      cursor: pointer;
    `;
    closeBtn.addEventListener("click", () => this.hide());
    this.container.appendChild(closeBtn);

    document.body.appendChild(this.container);
  }

  private btnStyle(bg: string, opacity: string): string {
    return `
      margin-top: 8px;
      width: 100%;
      padding: 10px;
      background: ${bg};
      border: none;
      border-radius: 4px;
      color: white;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      opacity: ${opacity};
    `;
  }

  setPlotInfo(plotUuid: string | null, ownerName: string | null): void {
    this.plotUuid = plotUuid;
    if (plotUuid && ownerName) {
      this.plotInfoEl.textContent = `Plot: ${ownerName}'s plot`;
      this.plotInfoEl.style.color = "#44ff88";
      this.generateBtn.disabled = false;
      this.generateBtn.style.opacity = "1";
    } else {
      this.plotInfoEl.textContent = "Walk to your plot to manage daemons";
      this.plotInfoEl.style.color = "rgba(255, 255, 255, 0.4)";
      this.generateBtn.disabled = true;
      this.generateBtn.style.opacity = "0.5";
    }
  }

  getPlotUuid(): string | null {
    return this.plotUuid;
  }

  setGenerationResult(definition: unknown): void {
    this.currentDefinition = definition;
    const def = definition as Record<string, unknown>;
    const behavior = def.behavior as Record<string, unknown>;
    const personality = def.personality as Record<string, unknown> | undefined;

    const escapeHtml = (t: unknown) => {
      const div = document.createElement("div");
      div.textContent = String(t || "");
      return div.innerHTML;
    };

    let html = `
      <div style="margin-bottom:6px"><strong style="color:#44ff88">${escapeHtml(def.name)}</strong></div>
      <div style="margin-bottom:4px; color:rgba(255,255,255,0.5)"><em>${escapeHtml(def.description)}</em></div>
      <div style="margin-bottom:4px"><strong>Role:</strong> ${escapeHtml(behavior?.type)}</div>
      <div style="margin-bottom:4px"><strong>Greeting:</strong> "${escapeHtml(behavior?.greetingMessage || "—")}"</div>
    `;

    if (personality) {
      html += `
        <div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.1)">
          <div style="color:#44ff88; font-weight:bold; margin-bottom:4px; font-size:11px">PERSONALITY</div>
          <div style="margin-bottom:3px"><strong>Traits:</strong> ${escapeHtml((personality.traits as string[])?.join(", "))}</div>
          <div style="margin-bottom:3px"><strong>Style:</strong> ${escapeHtml(personality.speechStyle)}</div>
          <div style="margin-bottom:3px"><strong>Interests:</strong> ${escapeHtml((personality.interests as string[])?.join(", "))}</div>
          <div style="margin-bottom:3px"><strong>Quirks:</strong> ${escapeHtml((personality.quirks as string[])?.join(", "))}</div>
          <div style="margin-bottom:3px; font-style:italic; color:rgba(255,255,255,0.5)">${escapeHtml(personality.backstory)}</div>
        </div>
      `;
    }

    if (behavior?.roamingEnabled) {
      html += `<div style="margin-top:4px; color:#aa44ff"><strong>Roaming:</strong> Will wander the street</div>`;
    }
    if (behavior?.canConverseWithDaemons !== false) {
      html += `<div style="color:#ff44aa"><strong>Social:</strong> Will chat with other NPCs</div>`;
    }

    this.previewArea.style.display = "block";
    this.previewArea.innerHTML = html;
    this.createBtn.style.display = "block";
  }

  setDaemonList(daemons: Array<{
    id: string;
    name: string;
    description: string;
    definition?: Record<string, unknown>;
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
      card.style.cssText = `
        padding: 10px;
        margin-bottom: 6px;
        background: rgba(255, 255, 255, 0.06);
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.08);
      `;

      // Name + type
      const header = document.createElement("div");
      header.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;";

      const nameEl = document.createElement("span");
      nameEl.style.cssText = "font-weight: bold; font-size: 13px; color: #44ff88;";
      nameEl.textContent = daemon.name;
      header.appendChild(nameEl);

      // Behavior type badge
      const behavior = daemon.definition?.behavior as Record<string, unknown> | undefined;
      if (behavior?.type) {
        const badge = document.createElement("span");
        badge.textContent = String(behavior.type);
        badge.style.cssText = `
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 3px;
          background: rgba(68, 255, 136, 0.15);
          color: #44ff88;
          text-transform: uppercase;
          font-weight: bold;
        `;
        header.appendChild(badge);
      }
      card.appendChild(header);

      // Description
      const desc = document.createElement("div");
      desc.textContent = daemon.description?.slice(0, 60) || "";
      desc.style.cssText = "font-size: 11px; color: rgba(255,255,255,0.4); margin-bottom: 6px;";
      card.appendChild(desc);

      // Personality preview
      const personality = daemon.definition?.personality as Record<string, unknown> | undefined;
      if (personality?.traits) {
        const traits = document.createElement("div");
        traits.textContent = (personality.traits as string[]).join(" / ");
        traits.style.cssText = "font-size: 10px; color: rgba(170, 68, 255, 0.7); margin-bottom: 6px; font-style: italic;";
        card.appendChild(traits);
      }

      // Control buttons
      const controls = document.createElement("div");
      controls.style.cssText = "display: flex; gap: 4px;";

      // Roaming toggle
      const isRoaming = behavior?.roamingEnabled !== false;
      const roamBtn = document.createElement("button");
      roamBtn.textContent = isRoaming ? "Roaming" : "Stationary";
      roamBtn.style.cssText = `
        flex: 1;
        padding: 4px 6px;
        background: ${isRoaming ? "rgba(170, 68, 255, 0.3)" : "rgba(255, 255, 255, 0.1)"};
        border: 1px solid ${isRoaming ? "rgba(170, 68, 255, 0.5)" : "rgba(255, 255, 255, 0.15)"};
        color: ${isRoaming ? "#aa44ff" : "rgba(255,255,255,0.5)"};
        font-size: 11px;
        cursor: pointer;
        border-radius: 3px;
        font-weight: bold;
      `;
      roamBtn.addEventListener("click", () => {
        this.onToggleRoam?.(daemon.id, !isRoaming);
        roamBtn.textContent = isRoaming ? "Stationary" : "Roaming";
      });
      controls.appendChild(roamBtn);

      // Recall button
      const recallBtn = document.createElement("button");
      recallBtn.textContent = "Recall";
      recallBtn.style.cssText = `
        flex: 1;
        padding: 4px 6px;
        background: rgba(68, 136, 255, 0.2);
        border: 1px solid rgba(68, 136, 255, 0.4);
        color: #4488ff;
        font-size: 11px;
        cursor: pointer;
        border-radius: 3px;
        font-weight: bold;
      `;
      recallBtn.addEventListener("click", () => {
        this.onRecall?.(daemon.id);
        recallBtn.textContent = "Recalled!";
        setTimeout(() => { recallBtn.textContent = "Recall"; }, 2000);
      });
      controls.appendChild(recallBtn);

      // Delete button
      const delBtn = document.createElement("button");
      delBtn.textContent = "Delete";
      delBtn.style.cssText = `
        padding: 4px 8px;
        background: rgba(255, 68, 68, 0.2);
        border: 1px solid rgba(255, 68, 68, 0.4);
        color: #ff4444;
        font-size: 11px;
        cursor: pointer;
        border-radius: 3px;
        font-weight: bold;
      `;
      delBtn.addEventListener("click", () => {
        if (confirm(`Delete ${daemon.name}?`)) {
          this.onDelete?.(daemon.id);
        }
      });
      controls.appendChild(delBtn);

      card.appendChild(controls);

      // Activity log section (expandable)
      const activityContainer = document.createElement("div");
      activityContainer.style.cssText = "margin-top: 6px;";

      const activityBtn = document.createElement("button");
      activityBtn.textContent = "Activity";
      activityBtn.style.cssText = `
        width: 100%;
        padding: 3px 6px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.4);
        font-size: 10px;
        cursor: pointer;
        border-radius: 3px;
      `;

      const activityLog = document.createElement("div");
      activityLog.style.cssText = `
        display: none;
        margin-top: 4px;
        max-height: 120px;
        overflow-y: auto;
        font-size: 10px;
        color: rgba(255, 255, 255, 0.5);
      `;

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
                const typeColor = entry.type === "conversation" ? "#aa44ff"
                  : entry.type === "emote" ? "#ffaa00"
                  : "#44ff88";
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
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    setTimeout(() => this.input.focus(), 50);
  }

  hide(): void {
    this.visible = false;
    this.container.style.display = "none";
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
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
      this.status.textContent = "Daemon generated! Review personality and place.";
      this.status.style.color = "#44ff88";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      this.status.textContent = `Error: ${message}`;
      this.status.style.color = "#ff4444";
    } finally {
      this.generateBtn.textContent = "Generate Daemon";
      this.generateBtn.disabled = !this.plotUuid;
      this.generateBtn.style.opacity = this.plotUuid ? "1" : "0.5";
    }
  }

  private escapeHtml(text: unknown): string {
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
    if (!this.currentDefinition || !this.plotUuid) return;

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
}
