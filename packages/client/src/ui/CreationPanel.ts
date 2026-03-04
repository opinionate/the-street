export class CreationPanel {
  private container: HTMLDivElement;
  private input: HTMLTextAreaElement;
  private button: HTMLButtonElement;
  private status: HTMLDivElement;
  private visible = false;

  onGenerate: ((description: string) => Promise<void>) | null = null;

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
      this.button.disabled = false;
      this.button.textContent = "Build";
    }
  }
}
