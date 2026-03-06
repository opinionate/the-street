/**
 * Basic activity log viewer for the admin panel.
 * Shows reverse-chronological event stream with per-entry token counts.
 */
export class ActivityLogViewer {
  readonly element: HTMLElement;
  private logContainer: HTMLDivElement;
  private daemonSelect: HTMLSelectElement;
  private visitorFilterInput: HTMLInputElement;
  private loadMoreBtn: HTMLButtonElement;
  private statusEl: HTMLDivElement;
  private summaryEl: HTMLDivElement;

  private apiUrl: string;
  private fetchFn: (url: string, options?: RequestInit) => Promise<Response>;
  private nextCursor: string | null = null;
  private currentDaemonId: string | null = null;
  private currentVisitorFilter: string | null = null;

  constructor(
    apiUrl: string,
    fetchFn: (url: string, options?: RequestInit) => Promise<Response>,
  ) {
    this.apiUrl = apiUrl;
    this.fetchFn = fetchFn;

    const wrapper = document.createElement("div");
    wrapper.style.cssText = `
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding: 12px 20px;
    `;

    // Section header
    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;";
    const title = document.createElement("div");
    title.innerHTML = '<span style="color:#44aaff;font-weight:bold">ACTIVITY</span> Log';
    title.style.cssText = "font-size:14px;font-weight:bold;";
    header.appendChild(title);

    // Daemon selector
    this.daemonSelect = document.createElement("select");
    this.daemonSelect.style.cssText = `
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 4px; color: rgba(255,255,255,0.7);
      font-size: 12px; padding: 3px 8px; cursor: pointer;
    `;
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "Select daemon...";
    this.daemonSelect.appendChild(defaultOpt);
    this.daemonSelect.addEventListener("change", () => {
      const id = this.daemonSelect.value;
      if (id) {
        this.currentDaemonId = id;
        this.loadLog(true);
        this.loadSummary();
      }
    });
    header.appendChild(this.daemonSelect);
    wrapper.appendChild(header);

    // Visitor ID filter bar
    const filterBar = document.createElement("div");
    filterBar.style.cssText = "display:flex;gap:6px;margin-bottom:8px;align-items:center;";
    this.visitorFilterInput = document.createElement("input");
    this.visitorFilterInput.type = "text";
    this.visitorFilterInput.placeholder = "Filter by visitor ID...";
    this.visitorFilterInput.style.cssText = `
      flex: 1; background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 4px; color: rgba(255,255,255,0.7);
      font-size: 11px; padding: 4px 8px; font-family: monospace;
    `;
    const filterBtn = document.createElement("button");
    filterBtn.textContent = "Filter";
    filterBtn.style.cssText = `
      background: rgba(68,170,255,0.15); border: 1px solid rgba(68,170,255,0.3);
      border-radius: 4px; color: #44aaff; font-size: 11px; padding: 4px 10px; cursor: pointer;
    `;
    filterBtn.addEventListener("click", () => {
      this.currentVisitorFilter = this.visitorFilterInput.value.trim() || null;
      this.loadLog(true);
    });
    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear";
    clearBtn.style.cssText = `
      background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 4px; color: rgba(255,255,255,0.4); font-size: 11px; padding: 4px 8px; cursor: pointer;
    `;
    clearBtn.addEventListener("click", () => {
      this.visitorFilterInput.value = "";
      this.currentVisitorFilter = null;
      this.loadLog(true);
    });
    filterBar.appendChild(this.visitorFilterInput);
    filterBar.appendChild(filterBtn);
    filterBar.appendChild(clearBtn);
    wrapper.appendChild(filterBar);

    // Token summary area
    this.summaryEl = document.createElement("div");
    this.summaryEl.style.cssText = `
      font-size: 11px; color: rgba(255,255,255,0.5);
      margin-bottom: 8px; display: none;
    `;
    wrapper.appendChild(this.summaryEl);

    // Log entries container
    this.logContainer = document.createElement("div");
    this.logContainer.style.cssText = `
      max-height: 300px; overflow-y: auto;
      font-size: 12px; font-family: monospace;
    `;
    wrapper.appendChild(this.logContainer);

    // Load more button
    this.loadMoreBtn = document.createElement("button");
    this.loadMoreBtn.textContent = "Load more";
    this.loadMoreBtn.style.cssText = `
      display: none; width: 100%; margin-top: 6px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 4px; color: rgba(255,255,255,0.5);
      font-size: 11px; padding: 4px; cursor: pointer;
    `;
    this.loadMoreBtn.addEventListener("click", () => this.loadLog(false));
    wrapper.appendChild(this.loadMoreBtn);

    // Status
    this.statusEl = document.createElement("div");
    this.statusEl.style.cssText = "font-size:10px;color:rgba(255,255,255,0.3);margin-top:4px;";
    wrapper.appendChild(this.statusEl);

    this.element = wrapper;
  }

  async loadDaemons(): Promise<void> {
    try {
      const res = await this.fetchFn(`${this.apiUrl}/api/daemons/global`);
      if (!res.ok) return;
      const data = await res.json();
      // Clear existing options except default
      while (this.daemonSelect.options.length > 1) {
        this.daemonSelect.remove(1);
      }
      for (const d of data.daemons) {
        const opt = document.createElement("option");
        opt.value = d.id;
        opt.textContent = d.name;
        this.daemonSelect.appendChild(opt);
      }
    } catch {
      // silently fail
    }
  }

  private async loadLog(reset: boolean): Promise<void> {
    if (!this.currentDaemonId) return;

    if (reset) {
      this.logContainer.innerHTML = "";
      this.nextCursor = null;
    }

    this.statusEl.textContent = "Loading...";

    try {
      let url = `${this.apiUrl}/api/daemons/${this.currentDaemonId}/activity-log?limit=30`;
      if (this.nextCursor) {
        url += `&cursor=${encodeURIComponent(this.nextCursor)}`;
      }
      if (this.currentVisitorFilter) {
        url += `&visitorId=${encodeURIComponent(this.currentVisitorFilter)}`;
      }

      const res = await this.fetchFn(url);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();

      for (const entry of data.entries) {
        this.logContainer.appendChild(this.renderEntry(entry));
      }

      this.nextCursor = data.nextCursor;
      this.loadMoreBtn.style.display = data.hasMore ? "block" : "none";
      this.statusEl.textContent = `${this.logContainer.childElementCount} entries loaded`;
    } catch (err) {
      this.statusEl.textContent = `Error: ${err instanceof Error ? err.message : "failed"}`;
    }
  }

  private async loadSummary(): Promise<void> {
    if (!this.currentDaemonId) return;

    try {
      const res = await this.fetchFn(
        `${this.apiUrl}/api/daemons/${this.currentDaemonId}/token-summary?window=30d`,
      );
      if (!res.ok) return;
      const data = await res.json();

      this.summaryEl.style.display = "block";
      this.summaryEl.innerHTML = `
        <strong style="color:rgba(255,255,255,0.7)">30-day totals:</strong>
        ${data.totalCalls} calls |
        ${data.totalTokensIn.toLocaleString()} tokens in |
        ${data.totalTokensOut.toLocaleString()} tokens out
      `;
    } catch {
      this.summaryEl.style.display = "none";
    }
  }

  private renderEntry(entry: {
    type: string;
    timestamp: number;
    actors: Array<{ actorName?: string; actorType: string }>;
    tokensIn?: number;
    tokensOut?: number;
    modelUsed?: string;
    inferenceLatencyMs?: number;
    payload: Record<string, unknown>;
  }): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText = `
      padding: 4px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      line-height: 1.4;
    `;

    const time = new Date(entry.timestamp);
    const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const dateStr = time.toLocaleDateString([], { month: "short", day: "numeric" });

    const typeColors: Record<string, string> = {
      conversation_turn: "#44cc88",
      conversation_summary: "#44aaff",
      manifest_amendment: "#ffaa44",
      manifest_recompile: "#ff8844",
      behavior_event: "#aa88ff",
      inter_daemon_event: "#88ccff",
      budget_warning: "#ffcc44",
      inference_failure: "#ff4444",
    };

    const color = typeColors[entry.type] ?? "#888";

    let tokenInfo = "";
    if (entry.tokensIn != null || entry.tokensOut != null) {
      tokenInfo = ` <span style="color:rgba(255,255,255,0.35)">[${entry.tokensIn ?? 0}in/${entry.tokensOut ?? 0}out]</span>`;
    }

    let latencyInfo = "";
    if (entry.inferenceLatencyMs != null) {
      latencyInfo = ` <span style="color:rgba(255,255,255,0.25)">${entry.inferenceLatencyMs}ms</span>`;
    }

    const actorNames = entry.actors
      .filter((a) => a.actorName)
      .map((a) => a.actorName)
      .join(", ");

    let detail = "";
    const p = entry.payload;
    if (entry.type === "conversation_turn" && p.speech) {
      const speech = String(p.speech).slice(0, 80);
      detail = ` "${speech}${String(p.speech).length > 80 ? "..." : ""}"`;
    } else if (entry.type === "inference_failure") {
      detail = ` ${p.failureType}`;
    } else if (entry.type === "budget_warning") {
      detail = ` ${p.warningType} (${p.currentUsage}/${p.limit})`;
    } else if (entry.type === "behavior_event") {
      detail = ` ${p.eventType}`;
    }

    row.innerHTML = `
      <span style="color:rgba(255,255,255,0.3)">${dateStr} ${timeStr}</span>
      <span style="color:${color};font-weight:bold">${entry.type}</span>${tokenInfo}${latencyInfo}
      <span style="color:rgba(255,255,255,0.4)">${actorNames}</span>
      <span style="color:rgba(255,255,255,0.5)">${detail}</span>
    `;

    return row;
  }
}
