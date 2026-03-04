/**
 * Floating chat input that appears when interacting with a daemon.
 * Shows the daemon's name and a text input for the player to type a message.
 */
export class DaemonChatUI {
  private container: HTMLDivElement;
  private nameLabel: HTMLSpanElement;
  private input: HTMLInputElement;
  private visible = false;
  private currentDaemonId: string | null = null;

  onSendMessage: ((daemonId: string, message: string) => void) | null = null;

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
      border-radius: 0 0 8px 8px;
      color: white;
      font-family: system-ui, sans-serif;
      font-size: 14px;
      outline: none;
      box-sizing: border-box;
    `;

    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && this.currentDaemonId) {
        const msg = this.input.value.trim() || undefined;
        this.onSendMessage?.(this.currentDaemonId, msg || "");
        this.hide();
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
    document.body.appendChild(this.container);
  }

  show(daemonId: string, daemonName: string): void {
    this.currentDaemonId = daemonId;
    this.nameLabel.textContent = daemonName;
    this.container.style.display = "block";
    this.visible = true;
    this.input.value = "";

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
  }

  isVisible(): boolean {
    return this.visible;
  }

  getCurrentDaemonId(): string | null {
    return this.currentDaemonId;
  }
}
