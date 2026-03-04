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

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "daemon-panel";
    this.container.style.cssText = `
      position: fixed;
      top: 60px;
      right: 20px;
      width: 350px;
      max-height: calc(100vh - 100px);
      background: rgba(0, 0, 0, 0.88);
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
      "Describe your NPC daemon...\ne.g. A friendly shopkeeper who sells potions and tells bad jokes";
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
      max-height: 150px;
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
    this.generateBtn.style.cssText = `
      margin-top: 8px;
      width: 100%;
      padding: 10px;
      background: #228844;
      border: none;
      border-radius: 4px;
      color: white;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      opacity: 0.5;
    `;
    this.generateBtn.addEventListener("click", () => this.handleGenerate());
    this.container.appendChild(this.generateBtn);

    // Create button (hidden until generation)
    this.createBtn = document.createElement("button");
    this.createBtn.textContent = "Place Daemon";
    this.createBtn.style.cssText = `
      margin-top: 6px;
      width: 100%;
      padding: 10px;
      background: #44ff88;
      border: none;
      border-radius: 4px;
      color: black;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      display: none;
    `;
    this.createBtn.addEventListener("click", () => this.handleCreate());
    this.container.appendChild(this.createBtn);

    // Existing daemons list
    const listTitle = document.createElement("div");
    listTitle.textContent = "Daemons on this plot";
    listTitle.style.cssText = `
      font-size: 13px;
      font-weight: bold;
      margin-top: 16px;
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

    this.previewArea.style.display = "block";
    this.previewArea.innerHTML = `
      <div style="margin-bottom:4px"><strong>Name:</strong> ${def.name}</div>
      <div style="margin-bottom:4px"><strong>Type:</strong> ${behavior?.type}</div>
      <div style="margin-bottom:4px"><strong>Description:</strong> ${def.description}</div>
      <div style="margin-bottom:4px"><strong>Greeting:</strong> ${behavior?.greetingMessage || "—"}</div>
    `;

    this.createBtn.style.display = "block";
  }

  setDaemonList(daemons: Array<{ id: string; name: string; description: string }>): void {
    this.daemonList.innerHTML = "";

    if (daemons.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No daemons yet";
      empty.style.cssText = "color: rgba(255,255,255,0.4); font-size: 12px;";
      this.daemonList.appendChild(empty);
      return;
    }

    for (const daemon of daemons) {
      const row = document.createElement("div");
      row.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 8px;
        margin-bottom: 4px;
        background: rgba(255, 255, 255, 0.06);
        border-radius: 4px;
      `;

      const info = document.createElement("div");
      info.style.cssText = "font-size: 12px;";
      info.innerHTML = `<strong>${daemon.name}</strong><br><span style="color:rgba(255,255,255,0.5)">${daemon.description.slice(0, 40)}</span>`;
      row.appendChild(info);

      const delBtn = document.createElement("button");
      delBtn.textContent = "\u2715";
      delBtn.style.cssText = `
        background: rgba(255, 68, 68, 0.3);
        border: none;
        color: #ff4444;
        font-size: 14px;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 3px;
      `;
      delBtn.addEventListener("click", () => this.onDelete?.(daemon.id));
      row.appendChild(delBtn);

      this.daemonList.appendChild(row);
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
    this.status.textContent = "AI is designing your daemon...";
    this.status.style.color = "#44ff88";
    this.createBtn.style.display = "none";
    this.previewArea.style.display = "none";

    try {
      await this.onGenerate?.(description);
      this.status.textContent = "Daemon generated! Review and place.";
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

  private async handleCreate(): Promise<void> {
    if (!this.currentDefinition || !this.plotUuid) return;

    this.createBtn.disabled = true;
    this.createBtn.textContent = "Placing...";

    try {
      await this.onCreate?.(this.currentDefinition);
      this.status.textContent = "Daemon placed!";
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
