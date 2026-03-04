export type ChatMessageType = "player" | "player-emote" | "daemon-chat" | "daemon-emote" | "daemon-thought";

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
  "player-emote":  { nameColor: "#dddddd", textColor: "#cccccc",  fontStyle: "italic" },
  "daemon-chat":   { nameColor: "#66ff99", textColor: "#ccffcc",  fontStyle: "normal" },
  "daemon-emote":  { nameColor: "#999999", textColor: "#aaaaaa",  fontStyle: "italic" },
  "daemon-thought":{ nameColor: "#6699ff", textColor: "#99bbff",  fontStyle: "italic" },
};

/** Slash-emote definitions: /command → verb for "[Name] verbs." */
const EMOTE_VERBS: Record<string, string> = {
  wave: "waves",
  dance: "dances",
  bow: "bows",
  cheer: "cheers",
  laugh: "laughs",
  cry: "cries",
  shrug: "shrugs",
  nod: "nods",
  clap: "claps",
  sit: "sits down",
  stretch: "stretches",
  yawn: "yawns",
  salute: "salutes",
  flex: "flexes",
  think: "thinks",
  facepalm: "facepalms",
  point: "points",
};

export class ChatUI {
  private container: HTMLDivElement;
  private input: HTMLInputElement;
  private messageList: HTMLDivElement;
  private resizeHandle: HTMLDivElement;
  private messages: ChatMessage[] = [];
  private inputFocused = false;
  private userScrolledUp = false;

  onSendMessage: ((content: string) => void) | null = null;
  /** Called when the user types a /emote command. Receives the emote text (e.g. "waves.") */
  onEmote: ((emoteText: string) => void) | null = null;

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

    // Message list — always visible, scrollable, resizable
    this.messageList = document.createElement("div");
    this.messageList.style.cssText = `
      height: 220px;
      min-height: 80px;
      max-height: 600px;
      overflow-y: auto;
      margin-bottom: 6px;
      background: rgba(0, 0, 0, 0.4);
      border-radius: 6px;
      padding: 6px;
      pointer-events: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.2) transparent;
      position: relative;
    `;
    // Track whether the user has scrolled away from the bottom
    this.messageList.addEventListener("scroll", () => {
      const el = this.messageList;
      // Consider "at bottom" if within 30px of the end
      this.userScrolledUp = el.scrollTop + el.clientHeight < el.scrollHeight - 30;
    });
    this.container.appendChild(this.messageList);

    // Resize handle — top edge of the message list
    this.resizeHandle = document.createElement("div");
    this.resizeHandle.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 6px;
      cursor: ns-resize;
      pointer-events: auto;
      opacity: 0;
      background: rgba(255, 255, 255, 0.3);
      border-radius: 6px 6px 0 0;
      transition: opacity 0.2s;
      z-index: 1;
    `;
    // Make the container position:relative so the handle sits inside it
    this.messageList.style.position = "relative";
    this.messageList.appendChild(this.resizeHandle);

    // Show resize handle on hover over message list
    this.messageList.addEventListener("mouseenter", () => {
      this.resizeHandle.style.opacity = "1";
    });
    this.messageList.addEventListener("mouseleave", () => {
      this.resizeHandle.style.opacity = "0";
    });

    // Drag to resize
    this.resizeHandle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = this.messageList.offsetHeight;

      const onMove = (ev: MouseEvent) => {
        // Dragging up = increase height (startY - ev.clientY is positive when going up)
        const newHeight = Math.max(80, Math.min(600, startHeight + (startY - ev.clientY)));
        this.messageList.style.height = newHeight + "px";
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

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
        const text = this.input.value.trim();
        // Check for /emote commands
        const emoteMatch = text.match(/^\/(\w+)$/);
        if (emoteMatch && EMOTE_VERBS[emoteMatch[1].toLowerCase()]) {
          const verb = EMOTE_VERBS[emoteMatch[1].toLowerCase()];
          this.onEmote?.(verb);
        } else {
          this.onSendMessage?.(text);
        }
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

    const prefix = type === "daemon-emote" || type === "player-emote"
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

    // Only auto-scroll if the user hasn't scrolled up to read history
    if (!this.userScrolledUp) {
      this.messageList.scrollTop = this.messageList.scrollHeight;
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
