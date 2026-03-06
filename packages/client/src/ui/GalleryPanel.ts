export interface GalleryItem {
  id: string;
  name: string;
  description: string;
  thumbnail_url: string | null;
  status: string;
}

export class GalleryPanel {
  private container: HTMLDivElement;
  private grid: HTMLDivElement;
  private status: HTMLDivElement;
  private visible = false;
  private items: GalleryItem[] = [];
  private apiUrl: string;
  private _fetchFn: (url: string, options?: RequestInit) => Promise<Response> = (url, opts) => fetch(url, opts);

  onSelect: ((item: GalleryItem) => void) | null = null;

  /** Set a custom fetch function (e.g. authFetch) for authenticated API calls */
  set fetchFn(fn: (url: string, options?: RequestInit) => Promise<Response>) {
    this._fetchFn = fn;
  }

  constructor(apiUrl: string) {
    this.apiUrl = apiUrl;

    this.container = document.createElement("div");
    this.container.id = "gallery-panel";
    this.container.style.cssText = `
      position: fixed;
      top: 60px;
      left: 20px;
      width: 320px;
      max-height: calc(100vh - 100px);
      background: rgba(0, 0, 0, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.2);
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
    title.textContent = "Gallery";
    title.style.cssText = `
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 12px;
    `;
    this.container.appendChild(title);

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

    // Status
    this.status = document.createElement("div");
    this.status.style.cssText = `
      font-size: 12px;
      color: rgba(255, 255, 255, 0.5);
      margin-bottom: 8px;
    `;
    this.container.appendChild(this.status);

    // Grid
    this.grid = document.createElement("div");
    this.grid.style.cssText = `
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    `;
    this.container.appendChild(this.grid);

    document.body.appendChild(this.container);
  }

  show(): void {
    this.visible = true;
    this.container.style.display = "block";
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    this.loadItems();
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

  private async loadItems(): Promise<void> {
    this.status.textContent = "Loading...";
    this.grid.innerHTML = "";

    try {
      const res = await this._fetchFn(`${this.apiUrl}/api/gallery`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      this.items = data.objects || [];

      if (this.items.length === 0) {
        this.status.textContent = "No objects yet. Build something with B!";
        return;
      }

      this.status.textContent = `${this.items.length} object${this.items.length !== 1 ? "s" : ""}`;
      this.renderGrid();
    } catch (err) {
      this.status.textContent = "Failed to load gallery";
      this.status.style.color = "#ff4444";
    }
  }

  private renderGrid(): void {
    this.grid.innerHTML = "";

    for (const item of this.items) {
      const card = document.createElement("div");
      card.style.cssText = `
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 6px;
        padding: 8px;
        cursor: pointer;
        transition: background 0.15s;
      `;
      card.addEventListener("mouseenter", () => {
        card.style.background = "rgba(255, 255, 255, 0.15)";
      });
      card.addEventListener("mouseleave", () => {
        card.style.background = "rgba(255, 255, 255, 0.08)";
      });

      // Thumbnail or placeholder
      const thumb = document.createElement("div");
      thumb.style.cssText = `
        width: 100%;
        aspect-ratio: 1;
        border-radius: 4px;
        margin-bottom: 6px;
        background-size: cover;
        background-position: center;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
      `;

      if (item.thumbnail_url) {
        thumb.style.backgroundImage = `url(${item.thumbnail_url})`;
      } else {
        // Colored placeholder based on status
        const colors: Record<string, string> = {
          pending: "#4488ff",
          failed: "#ff4444",
        };
        thumb.style.background = colors[item.status] || "#666";
        thumb.style.opacity = "0.4";
        thumb.textContent = "\u25A6";
      }
      card.appendChild(thumb);

      // Name
      const name = document.createElement("div");
      name.textContent = item.name;
      name.style.cssText = `
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      `;
      card.appendChild(name);

      // Description snippet
      const desc = document.createElement("div");
      desc.textContent = item.description.slice(0, 40) + (item.description.length > 40 ? "..." : "");
      desc.style.cssText = `
        font-size: 10px;
        color: rgba(255, 255, 255, 0.5);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
      `;
      card.appendChild(desc);

      card.addEventListener("click", () => {
        this.onSelect?.(item);
      });

      this.grid.appendChild(card);
    }
  }
}
