export type ChatMessageType = "player" | "daemon-chat" | "daemon-emote" | "daemon-thought";

interface ChatMessage {
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  type: ChatMessageType;
  element: HTMLDivElement;
}

const MAX_MESSAGES = 50;

const TYPE_STYLES: Record<ChatMessageType, { nameColor: string; textColor: string; fontStyle: string }> = {
  "player":        { nameColor: "#ffffff", textColor: "#ffffff",  fontStyle: "normal" },
  "daemon-chat":   { nameColor: "#66ff99", textColor: "#ccffcc",  fontStyle: "normal" },
  "daemon-emote":  { nameColor: "#999999", textColor: "#aaaaaa",  fontStyle: "italic" },
  "daemon-thought":{ nameColor: "#6699ff", textColor: "#99bbff",  fontStyle: "italic" },
};

export class ChatUI {
  private container: HTMLDivElement;
  private input: HTMLInputElement;
  private messageList: HTMLDivElement;
  private messages: ChatMessage[] = [];
  private inputFocused = false;

  onSendMessage: ((content: string) => void) | null = null;

  constructor() {
    // Container — always visible
    this.container = document.createElement("div");
    this.container.id = "chat-ui";
    this.container.style.cssText = `
      position: fixed;
      bottom: 12px;
      left: 12px;
      width: 420px;
      z-index: 100;
      pointer-events: none;
      display: flex;
      flex-direction: column;
    `;

    // Message list — always visible, scrollable
    this.messageList = document.createElement("div");
    this.messageList.style.cssText = `
      max-height: 220px;
      overflow-y: auto;
      margin-bottom: 6px;
      background: rgba(0, 0, 0, 0.4);
      border-radius: 6px;
      padding: 6px;
      pointer-events: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.2) transparent;
    `;
    this.container.appendChild(this.messageList);

    // Input — always visible
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.placeholder = "Press Enter to chat...";
    this.input.maxLength = 200;
    this.input.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      background: rgba(0, 0, 0, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      color: white;
      font-family: system-ui, sans-serif;
      font-size: 14px;
      outline: none;
      pointer-events: auto;
      box-sizing: border-box;
    `;
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && this.input.value.trim()) {
        this.onSendMessage?.(this.input.value.trim());
        this.input.value = "";
        this.input.blur();
        this.inputFocused = false;
      }
      if (e.key === "Escape") {
        this.input.blur();
        this.inputFocused = false;
      }
    });
    this.input.addEventListener("focus", () => {
      this.inputFocused = true;
    });
    this.input.addEventListener("blur", () => {
      this.inputFocused = false;
    });
    this.container.appendChild(this.input);

    document.body.appendChild(this.container);
  }

  show(): void {
    this.inputFocused = true;
    this.input.focus();
  }

  hide(): void {
    this.inputFocused = false;
    this.input.blur();
    this.input.value = "";
  }

  toggle(): void {
    if (this.inputFocused) {
      this.hide();
    } else {
      this.show();
    }
  }

  isVisible(): boolean {
    return this.inputFocused;
  }

  addMessage(
    senderId: string,
    senderName: string,
    content: string,
    type: ChatMessageType = "player",
  ): void {
    const style = TYPE_STYLES[type];
    const el = document.createElement("div");
    el.style.cssText = `
      padding: 3px 6px;
      margin-bottom: 2px;
      color: ${style.textColor};
      font-family: system-ui, sans-serif;
      font-size: 13px;
      font-style: ${style.fontStyle};
      line-height: 1.3;
      word-wrap: break-word;
    `;

    const prefix = type === "daemon-emote"
      ? `* ${this.escapeHtml(senderName)} `
      : type === "daemon-thought"
      ? `${this.escapeHtml(senderName)} thinks: `
      : `<span style="color:${style.nameColor};font-weight:bold">${this.escapeHtml(senderName)}</span>: `;

    el.innerHTML = prefix + this.escapeHtml(content);
    this.messageList.appendChild(el);

    const msg: ChatMessage = {
      senderId,
      senderName,
      content,
      timestamp: Date.now(),
      type,
      element: el,
    };
    this.messages.push(msg);

    // Cap at MAX_MESSAGES
    while (this.messages.length > MAX_MESSAGES) {
      const old = this.messages.shift()!;
      old.element.remove();
    }

    // Auto-scroll to bottom
    this.messageList.scrollTop = this.messageList.scrollHeight;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
