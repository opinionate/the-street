import { CHAT_DISPLAY_DURATION } from "@the-street/shared";

interface ChatMessage {
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  element: HTMLDivElement;
}

export class ChatUI {
  private container: HTMLDivElement;
  private input: HTMLInputElement;
  private messageList: HTMLDivElement;
  private messages: ChatMessage[] = [];
  private visible = false;

  onSendMessage: ((content: string) => void) | null = null;

  constructor() {
    // Container
    this.container = document.createElement("div");
    this.container.id = "chat-ui";
    this.container.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      width: 400px;
      z-index: 100;
      pointer-events: none;
    `;

    // Message list
    this.messageList = document.createElement("div");
    this.messageList.style.cssText = `
      max-height: 200px;
      overflow-y: auto;
      margin-bottom: 8px;
    `;
    this.container.appendChild(this.messageList);

    // Input
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.placeholder = "Press Enter to chat...";
    this.input.maxLength = 200;
    this.input.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      background: rgba(0, 0, 0, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      color: white;
      font-family: system-ui, sans-serif;
      font-size: 14px;
      outline: none;
      display: none;
      pointer-events: auto;
    `;
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && this.input.value.trim()) {
        this.onSendMessage?.(this.input.value.trim());
        this.input.value = "";
        this.hide();
      }
      if (e.key === "Escape") {
        this.hide();
      }
    });
    this.container.appendChild(this.input);

    document.body.appendChild(this.container);
  }

  show(): void {
    this.visible = true;
    this.input.style.display = "block";
    this.input.focus();
  }

  hide(): void {
    this.visible = false;
    this.input.style.display = "none";
    this.input.blur();
    this.input.value = "";
  }

  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  addMessage(senderId: string, senderName: string, content: string): void {
    const el = document.createElement("div");
    el.style.cssText = `
      padding: 4px 8px;
      margin-bottom: 4px;
      background: rgba(0, 0, 0, 0.5);
      border-radius: 4px;
      color: white;
      font-family: system-ui, sans-serif;
      font-size: 13px;
      transition: opacity 0.5s;
    `;
    el.innerHTML = `<strong>${this.escapeHtml(senderName)}</strong>: ${this.escapeHtml(content)}`;
    this.messageList.appendChild(el);

    const msg: ChatMessage = {
      senderId,
      senderName,
      content,
      timestamp: Date.now(),
      element: el,
    };
    this.messages.push(msg);

    // Auto-scroll
    this.messageList.scrollTop = this.messageList.scrollHeight;

    // Fade out after duration
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => {
        el.remove();
        const idx = this.messages.indexOf(msg);
        if (idx >= 0) this.messages.splice(idx, 1);
      }, 500);
    }, CHAT_DISPLAY_DURATION * 1000);
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
