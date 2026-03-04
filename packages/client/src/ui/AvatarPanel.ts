export class AvatarPanel {
  private container: HTMLDivElement;
  private input: HTMLTextAreaElement;
  private generateBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;
  private status: HTMLDivElement;
  private previewArea: HTMLDivElement;
  private visible = false;
  private currentAppearance: unknown = null;
  private currentMeshyTaskId: string | null = null;

  onGenerate: ((description: string) => Promise<void>) | null = null;
  onSave: ((avatarDefinition: unknown) => Promise<void>) | null = null;

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "avatar-panel";
    this.container.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      width: 350px;
      background: rgba(0, 0, 0, 0.88);
      border: 1px solid rgba(0, 255, 255, 0.3);
      border-radius: 8px;
      padding: 16px;
      z-index: 100;
      display: none;
      font-family: system-ui, sans-serif;
      color: white;
    `;

    // Title
    const title = document.createElement("div");
    title.textContent = "Customize Avatar";
    title.style.cssText = `
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 12px;
      color: #00ffff;
    `;
    this.container.appendChild(title);

    // Input
    this.input = document.createElement("textarea");
    this.input.placeholder =
      "Describe your avatar...\ne.g. A cyber-punk warrior with neon blue hair and a leather jacket";
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
      max-height: 120px;
      overflow-y: auto;
      display: none;
      padding: 8px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
    `;
    this.container.appendChild(this.previewArea);

    // Generate button
    this.generateBtn = document.createElement("button");
    this.generateBtn.textContent = "Generate";
    this.generateBtn.style.cssText = `
      margin-top: 8px;
      width: 100%;
      padding: 10px;
      background: #00aacc;
      border: none;
      border-radius: 4px;
      color: white;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
    `;
    this.generateBtn.addEventListener("click", () => this.handleGenerate());
    this.container.appendChild(this.generateBtn);

    // Save button (hidden until generation completes)
    this.saveBtn = document.createElement("button");
    this.saveBtn.textContent = "Save Avatar";
    this.saveBtn.style.cssText = `
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
    this.saveBtn.addEventListener("click", () => this.handleSave());
    this.container.appendChild(this.saveBtn);

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

  setGenerationResult(appearance: unknown, meshyTaskId: string | null): void {
    this.currentAppearance = appearance;
    this.currentMeshyTaskId = meshyTaskId;

    // Show preview
    this.previewArea.style.display = "block";
    const app = appearance as Record<string, unknown>;
    this.previewArea.innerHTML = `
      <div style="margin-bottom:4px"><strong>Body:</strong> ${app.bodyType}</div>
      <div style="margin-bottom:4px"><strong>Hair:</strong> ${app.hairStyle}</div>
      <div style="margin-bottom:4px"><strong>Outfit:</strong> ${app.outfit}</div>
      <div style="margin-bottom:4px"><strong>Accessories:</strong> ${(app.accessories as string[])?.join(", ") || "none"}</div>
    `;

    this.saveBtn.style.display = "block";
  }

  private async handleGenerate(): Promise<void> {
    const description = this.input.value.trim();
    if (!description) return;

    this.generateBtn.disabled = true;
    this.generateBtn.textContent = "Generating...";
    this.status.textContent = "AI is designing your avatar...";
    this.status.style.color = "#00aacc";
    this.saveBtn.style.display = "none";
    this.previewArea.style.display = "none";

    try {
      await this.onGenerate?.(description);
      this.status.textContent = "Avatar generated! Review and save.";
      this.status.style.color = "#44ff88";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      this.status.textContent = `Error: ${message}`;
      this.status.style.color = "#ff4444";
    } finally {
      this.generateBtn.textContent = "Generate";
      this.generateBtn.disabled = false;
    }
  }

  private async handleSave(): Promise<void> {
    if (!this.currentAppearance) return;

    this.saveBtn.disabled = true;
    this.saveBtn.textContent = "Saving...";

    try {
      const avatarDefinition = {
        avatarIndex: 0,
        customAppearance: this.currentAppearance,
        meshyTaskId: this.currentMeshyTaskId,
      };
      await this.onSave?.(avatarDefinition);
      this.status.textContent = "Avatar saved!";
      this.status.style.color = "#44ff88";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      this.status.textContent = `Error: ${message}`;
      this.status.style.color = "#ff4444";
    } finally {
      this.saveBtn.textContent = "Save Avatar";
      this.saveBtn.disabled = false;
    }
  }
}
