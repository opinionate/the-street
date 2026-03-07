export interface DaemonInfo {
  role: string;
  mood: string;
  action: string;
  distance?: number;
}

/**
 * Floating panel that appears when targeting/clicking a daemon.
 * Shows the daemon's name, info, text input, and optional admin directive field.
 */
export class DaemonChatUI {
  private container: HTMLDivElement;
  private nameLabel: HTMLSpanElement;
  private infoRow: HTMLDivElement;
  private input: HTMLInputElement;
  private directiveRow: HTMLDivElement;
  private directiveInput: HTMLInputElement;
  private visible = false;
  private currentDaemonId: string | null = null;
  private isSuperAdmin = false;

  onSendMessage: ((daemonId: string, message: string) => void) | null = null;
  onSendDirective: ((daemonId: string, directive: string) => void) | null = null;

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "daemon-chat-ui";
    this.container.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      width: 420px;
      z-index: 200;
      display: none;
      pointer-events: auto;
    `;

    // Header
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: rgba(0, 40, 0, 0.9);
      border: 1px solid rgba(68, 255, 136, 0.4);
      border-bottom: none;
      border-radius: 8px 8px 0 0;
      font-family: system-ui, sans-serif;
    `;

    const npcTag = document.createElement("span");
    npcTag.textContent = "[NPC]";
    npcTag.style.cssText = `
      color: #44ff88;
      font-size: 11px;
      font-weight: bold;
      background: rgba(68, 255, 136, 0.15);
      padding: 2px 6px;
      border-radius: 3px;
    `;
    header.appendChild(npcTag);

    this.nameLabel = document.createElement("span");
    this.nameLabel.style.cssText = `
      color: #44ff88;
      font-size: 14px;
      font-weight: bold;
    `;
    header.appendChild(this.nameLabel);

    const hint = document.createElement("span");
    hint.textContent = "ESC to close";
    hint.style.cssText = `
      color: rgba(255,255,255,0.3);
      font-size: 11px;
      margin-left: auto;
    `;
    header.appendChild(hint);

    this.container.appendChild(header);

    // Info row (role / mood / action / distance)
    this.infoRow = document.createElement("div");
    this.infoRow.style.cssText = `
      display: none;
      padding: 4px 12px;
      background: rgba(0, 30, 0, 0.9);
      border-left: 1px solid rgba(68, 255, 136, 0.4);
      border-right: 1px solid rgba(68, 255, 136, 0.4);
      font-family: system-ui, sans-serif;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.5);
      gap: 12px;
      flex-wrap: wrap;
    `;
    this.container.appendChild(this.infoRow);

    // Input
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.placeholder = "Say something... (or press Enter to just interact)";
    this.input.maxLength = 200;
    this.input.style.cssText = `
      width: 100%;
      padding: 10px 14px;
      background: rgba(0, 0, 0, 0.85);
      border: 1px solid rgba(68, 255, 136, 0.4);
      border-radius: 0;
      color: white;
      font-family: system-ui, sans-serif;
      font-size: 14px;
      outline: none;
      box-sizing: border-box;
    `;

    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        // Let Tab propagate to InputManager for target cycling
        return;
      }
      e.stopPropagation();
      if (e.key === "Enter" && this.currentDaemonId) {
        const msg = this.input.value.trim() || undefined;
        this.onSendMessage?.(this.currentDaemonId, msg || "");
        this.input.value = "";
      }
      if (e.key === "Escape") {
        this.hide();
      }
    });

    this.input.addEventListener("focus", () => {
      this.input.style.borderColor = "rgba(68, 255, 136, 0.7)";
    });
    this.input.addEventListener("blur", () => {
      this.input.style.borderColor = "rgba(68, 255, 136, 0.4)";
    });

    this.container.appendChild(this.input);

    // Admin directive row (super_admin only)
    this.directiveRow = document.createElement("div");
    this.directiveRow.style.cssText = `
      display: none;
      padding: 0;
    `;

    this.directiveInput = document.createElement("input");
    this.directiveInput.type = "text";
    this.directiveInput.placeholder = "Admin directive...";
    this.directiveInput.maxLength = 300;
    this.directiveInput.style.cssText = `
      width: 100%;
      padding: 8px 14px;
      background: rgba(40, 0, 0, 0.85);
      border: 1px solid rgba(255, 68, 68, 0.4);
      border-top: none;
      border-radius: 0 0 8px 8px;
      color: #ff8888;
      font-family: system-ui, sans-serif;
      font-size: 12px;
      outline: none;
      box-sizing: border-box;
    `;

    this.directiveInput.addEventListener("keydown", (e) => {
      if (e.key === "Tab") return;
      e.stopPropagation();
      if (e.key === "Enter" && this.currentDaemonId) {
        const directive = this.directiveInput.value.trim();
        if (directive) {
          this.onSendDirective?.(this.currentDaemonId, directive);
          this.directiveInput.value = "";
        }
      }
      if (e.key === "Escape") {
        this.hide();
      }
    });

    this.directiveInput.addEventListener("focus", () => {
      this.directiveInput.style.borderColor = "rgba(255, 68, 68, 0.7)";
    });
    this.directiveInput.addEventListener("blur", () => {
      this.directiveInput.style.borderColor = "rgba(255, 68, 68, 0.4)";
    });

    this.directiveRow.appendChild(this.directiveInput);
    this.container.appendChild(this.directiveRow);

    document.body.appendChild(this.container);
  }

  setSuperAdmin(isAdmin: boolean): void {
    this.isSuperAdmin = isAdmin;
  }

  show(daemonId: string, daemonName: string, info?: DaemonInfo): void {
    this.currentDaemonId = daemonId;
    this.nameLabel.textContent = daemonName;
    this.container.style.display = "block";
    this.visible = true;
    this.input.value = "";

    // Update info row
    if (info) {
      this.infoRow.innerHTML = "";
      const items = [
        { label: "Role", value: info.role },
        { label: "Mood", value: info.mood },
        { label: "Action", value: info.action },
      ];
      if (info.distance !== undefined) {
        items.push({ label: "Dist", value: `${info.distance.toFixed(1)}m` });
      }
      for (const { label, value } of items) {
        const span = document.createElement("span");
        span.innerHTML = `<span style="color:rgba(255,255,255,0.3)">${label}:</span> ${this.escapeHtml(value)}`;
        this.infoRow.appendChild(span);
      }
      this.infoRow.style.display = "flex";
    } else {
      this.infoRow.style.display = "none";
    }

    // Update border radius based on whether directive row shows
    if (this.isSuperAdmin) {
      this.directiveRow.style.display = "block";
      this.input.style.borderRadius = "0";
    } else {
      this.directiveRow.style.display = "none";
      this.input.style.borderRadius = "0 0 8px 8px";
    }

    // Slight delay to avoid capturing the click that opened this
    setTimeout(() => {
      this.input.focus();
    }, 50);
  }

  hide(): void {
    this.container.style.display = "none";
    this.visible = false;
    this.currentDaemonId = null;
    this.input.blur();
    this.input.value = "";
    this.directiveInput.value = "";
  }

  isVisible(): boolean {
    return this.visible;
  }

  getCurrentDaemonId(): string | null {
    return this.currentDaemonId;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
