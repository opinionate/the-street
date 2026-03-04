export class CreationPanel {
  private container: HTMLDivElement;
  private input: HTMLTextAreaElement;
  private button: HTMLButtonElement;
  private status: HTMLDivElement;
  private plotInfoEl: HTMLDivElement;
  private plotUuid: string | null = null;
  private visible = false;

  onGenerate: ((description: string) => Promise<void>) | null = null;

  /** Update the status text from outside */
  setStatus(text: string, color: string = "#4488ff"): void {
    this.status.textContent = text;
    this.status.style.color = color;
  }

  /** Update plot context — controls whether building is enabled */
  setPlotInfo(plotUuid: string | null, ownerName: string | null): void {
    this.plotUuid = plotUuid;
    if (plotUuid && ownerName) {
      this.plotInfoEl.textContent = `Building on: ${ownerName}'s plot`;
      this.plotInfoEl.style.color = "#44ff88";
      this.button.disabled = false;
      this.button.style.opacity = "1";
    } else {
      this.plotInfoEl.textContent = "Walk to a plot to build";
      this.plotInfoEl.style.color = "rgba(255, 255, 255, 0.4)";
      this.button.disabled = true;
      this.button.style.opacity = "0.5";
    }
  }

  /** Get the currently active plot UUID (null if not on a plot) */
  getPlotUuid(): string | null {
    return this.plotUuid;
  }

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "creation-panel";
    this.container.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 350px;
      background: rgba(0, 0, 0, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      padding: 16px;
      z-index: 100;
      display: none;
      font-family: system-ui, sans-serif;
      color: white;
    `;

    // Title
    const title = document.createElement("div");
    title.textContent = "Create Object";
    title.style.cssText = `
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 12px;
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
    this.plotInfoEl.textContent = "Walk to a plot to build";
    this.container.appendChild(this.plotInfoEl);

    // Text input
    this.input = document.createElement("textarea");
    this.input.placeholder =
      "Describe what you want to build...\ne.g. A cozy brick bookshop with a wooden door and a sign that says 'Books & More'";
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
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // prevent game input capture
    });
    this.container.appendChild(this.input);

    // Status area
    this.status = document.createElement("div");
    this.status.style.cssText = `
      margin-top: 8px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.6);
      min-height: 20px;
    `;
    this.container.appendChild(this.status);

    // Create button
    this.button = document.createElement("button");
    this.button.textContent = "Build";
    this.button.disabled = true;
    this.button.style.cssText = `
      margin-top: 8px;
      width: 100%;
      padding: 10px;
      background: #4488ff;
      border: none;
      border-radius: 4px;
      color: white;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      opacity: 0.5;
    `;
    this.button.addEventListener("click", () => this.handleGenerate());
    this.container.appendChild(this.button);

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

  show(): void {
    this.visible = true;
    this.container.style.display = "block";
    // Release pointer lock so user can type
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    // Focus after a tick (pointer lock release is async)
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

    this.button.disabled = true;
    this.button.textContent = "Building...";
    this.status.textContent = "Generating object with AI...";
    this.status.style.color = "#4488ff";

    try {
      await this.onGenerate?.(description);
      this.status.textContent = "Object placed successfully!";
      this.status.style.color = "#44ff88";
      this.input.value = "";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      this.status.textContent = `Error: ${message}. Try again or revise your description.`;
      this.status.style.color = "#ff4444";
    } finally {
      this.button.textContent = "Build";
      // Re-enable only if still on a plot (user may have moved off during generation)
      this.button.disabled = !this.plotUuid;
      this.button.style.opacity = this.plotUuid ? "1" : "0.5";
    }
  }
}
