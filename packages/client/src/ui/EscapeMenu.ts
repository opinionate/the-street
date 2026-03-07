/**
 * Escape Menu — central hub for accessing all game panels and utilities.
 * Opens when Escape is pressed and no other panel is open.
 */
export class EscapeMenu {
  private container: HTMLDivElement;
  private visible = false;

  /** Map of button label → callback */
  private items: Array<{ label: string; shortcut: string; action: () => void; condition?: () => boolean }> = [];

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "escape-menu";
    this.container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 320px;
      background: rgba(10, 10, 15, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      z-index: 300;
      display: none;
      font-family: system-ui, sans-serif;
      color: white;
      padding: 0;
      overflow: hidden;
    `;

    document.body.appendChild(this.container);
  }

  /** Register a menu item. condition() returning false hides the item. */
  addItem(label: string, shortcut: string, action: () => void, condition?: () => boolean): void {
    this.items.push({ label, shortcut, action, condition });
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.render();
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

  private render(): void {
    this.container.innerHTML = "";

    // Title
    const title = document.createElement("div");
    title.textContent = "Menu";
    title.style.cssText = `
      padding: 16px 20px 12px;
      font-size: 16px;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.9);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      letter-spacing: 0.5px;
    `;
    this.container.appendChild(title);

    // Items
    const list = document.createElement("div");
    list.style.cssText = "padding: 8px 0;";

    for (const item of this.items) {
      if (item.condition && !item.condition()) continue;

      const row = document.createElement("div");
      row.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 20px;
        cursor: pointer;
        transition: background 0.15s;
        user-select: none;
      `;
      row.addEventListener("mouseenter", () => {
        row.style.background = "rgba(255, 255, 255, 0.08)";
      });
      row.addEventListener("mouseleave", () => {
        row.style.background = "transparent";
      });
      row.addEventListener("click", () => {
        this.hide();
        item.action();
      });

      const label = document.createElement("span");
      label.textContent = item.label;
      label.style.cssText = "font-size: 14px; color: rgba(255, 255, 255, 0.85);";

      const shortcut = document.createElement("span");
      shortcut.textContent = item.shortcut;
      shortcut.style.cssText = `
        font-size: 11px;
        color: rgba(255, 255, 255, 0.35);
        background: rgba(255, 255, 255, 0.06);
        padding: 2px 8px;
        border-radius: 4px;
        font-family: monospace;
      `;

      row.appendChild(label);
      row.appendChild(shortcut);
      list.appendChild(row);
    }

    this.container.appendChild(list);

    // Close hint
    const hint = document.createElement("div");
    hint.textContent = "Press Esc to close";
    hint.style.cssText = `
      padding: 10px 20px;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.25);
      text-align: center;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    `;
    this.container.appendChild(hint);
  }
}
