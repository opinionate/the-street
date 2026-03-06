/**
 * Full admin activity log viewer.
 * Features: daemon header, token summary dashboard with window toggles,
 * type/visitor/session filters, session grouping, rich per-type rendering,
 * manifest version history.
 */

interface LogEntryData {
  entryId: string;
  type: string;
  timestamp: number;
  actors: Array<{ actorName?: string; actorType: string; actorId?: string }>;
  tokensIn?: number;
  tokensOut?: number;
  modelUsed?: string;
  inferenceLatencyMs?: number;
  payload: Record<string, unknown>;
}

interface TokenBreakdown {
  type: string;
  tokensIn: number;
  tokensOut: number;
  callCount: number;
}

interface TokenSummaryData {
  window: string;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCalls: number;
  breakdown: TokenBreakdown[];
}

const TYPE_COLORS: Record<string, string> = {
  conversation_turn: "#44cc88",
  conversation_summary: "#44aaff",
  manifest_amendment: "#ffaa44",
  manifest_recompile: "#ff8844",
  behavior_event: "#aa88ff",
  inter_daemon_event: "#88ccff",
  budget_warning: "#ffcc44",
  inference_failure: "#ff4444",
};

const TYPE_LABELS: Record<string, string> = {
  conversation_turn: "Conversation",
  conversation_summary: "Summary",
  manifest_amendment: "Amendment",
  manifest_recompile: "Recompile",
  behavior_event: "Behavior",
  inter_daemon_event: "Inter-Daemon",
  budget_warning: "Budget",
  inference_failure: "Failure",
};

const ALL_TYPES = Object.keys(TYPE_COLORS);

const COST_PER_TOKEN_IN = 0.00000025;  // rough haiku pricing
const COST_PER_TOKEN_OUT = 0.00000125;

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function formatTime(ts: number): { date: string; time: string } {
  const d = new Date(ts);
  return {
    date: d.toLocaleDateString([], { month: "short", day: "numeric" }),
    time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
}

function estimateCost(tokensIn: number, tokensOut: number): string {
  const cost = tokensIn * COST_PER_TOKEN_IN + tokensOut * COST_PER_TOKEN_OUT;
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

export class ActivityLogViewer {
  readonly element: HTMLElement;

  private apiUrl: string;
  private fetchFn: (url: string, options?: RequestInit) => Promise<Response>;

  // State
  private currentDaemonId: string | null = null;
  private nextCursor: string | null = null;
  private currentFilters: {
    types: string[];
    visitorId: string | null;
    sessionId: string | null;
  } = { types: [], visitorId: null, sessionId: null };
  private summaryWindow: "30d" | "90d" | "all" = "30d";
  private entries: LogEntryData[] = [];

  // DOM refs
  private daemonSelect!: HTMLSelectElement;
  private daemonHeader!: HTMLDivElement;
  private summaryDashboard!: HTMLDivElement;
  private filterBar!: HTMLDivElement;
  private logContainer!: HTMLDivElement;
  private loadMoreBtn!: HTMLButtonElement;
  private statusEl!: HTMLDivElement;
  private typeCheckboxes: Map<string, HTMLInputElement> = new Map();

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

    wrapper.appendChild(this.buildHeader());
    wrapper.appendChild(this.buildDaemonHeader());
    wrapper.appendChild(this.buildSummaryDashboard());
    wrapper.appendChild(this.buildFilterBar());
    wrapper.appendChild(this.buildLogContainer());
    wrapper.appendChild(this.buildLoadMore());
    wrapper.appendChild(this.buildStatus());

    this.element = wrapper;
  }

  // --- Build UI sections ---

  private buildHeader(): HTMLElement {
    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;";
    const title = document.createElement("div");
    title.innerHTML = '<span style="color:#44aaff;font-weight:bold">ACTIVITY</span> Log';
    title.style.cssText = "font-size:14px;font-weight:bold;";
    header.appendChild(title);

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
        this.loadAll();
      }
    });
    header.appendChild(this.daemonSelect);
    return header;
  }

  private buildDaemonHeader(): HTMLElement {
    this.daemonHeader = document.createElement("div");
    this.daemonHeader.style.cssText = `
      display: none; padding: 8px 12px; margin-bottom: 8px;
      background: rgba(255,255,255,0.04); border-radius: 6px;
      font-size: 12px; color: rgba(255,255,255,0.6);
    `;
    return this.daemonHeader;
  }

  private buildSummaryDashboard(): HTMLElement {
    this.summaryDashboard = document.createElement("div");
    this.summaryDashboard.style.cssText = `
      display: none; margin-bottom: 10px; padding: 10px 12px;
      background: rgba(255,255,255,0.03); border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.06);
    `;
    return this.summaryDashboard;
  }

  private buildFilterBar(): HTMLElement {
    this.filterBar = document.createElement("div");
    this.filterBar.style.cssText = "display:none;margin-bottom:8px;";

    // Type filter checkboxes
    const typeRow = document.createElement("div");
    typeRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;";

    for (const type of ALL_TYPES) {
      const label = document.createElement("label");
      label.style.cssText = `
        display:flex;align-items:center;gap:2px;
        font-size:10px;color:${TYPE_COLORS[type]};cursor:pointer;
        padding:2px 6px;border-radius:3px;
        background:rgba(255,255,255,0.04);
      `;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.style.cssText = "width:12px;height:12px;cursor:pointer;";
      cb.addEventListener("change", () => this.applyTypeFilter());
      this.typeCheckboxes.set(type, cb);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(TYPE_LABELS[type] ?? type));
      typeRow.appendChild(label);
    }
    this.filterBar.appendChild(typeRow);

    // Text filters row
    const textRow = document.createElement("div");
    textRow.style.cssText = "display:flex;gap:6px;align-items:center;";

    const visitorInput = this.createFilterInput("Visitor ID...", (v) => {
      this.currentFilters.visitorId = v || null;
    });
    const sessionInput = this.createFilterInput("Session ID...", (v) => {
      this.currentFilters.sessionId = v || null;
    });

    const applyBtn = this.createButton("Apply", "#44aaff", () => this.loadLog(true));
    const clearBtn = this.createButton("Clear", "rgba(255,255,255,0.4)", () => {
      (visitorInput as HTMLInputElement).value = "";
      (sessionInput as HTMLInputElement).value = "";
      this.currentFilters = { types: [], visitorId: null, sessionId: null };
      this.typeCheckboxes.forEach((cb) => { cb.checked = true; });
      this.loadLog(true);
    });

    textRow.appendChild(visitorInput);
    textRow.appendChild(sessionInput);
    textRow.appendChild(applyBtn);
    textRow.appendChild(clearBtn);
    this.filterBar.appendChild(textRow);

    return this.filterBar;
  }

  private buildLogContainer(): HTMLElement {
    this.logContainer = document.createElement("div");
    this.logContainer.style.cssText = `
      max-height: 400px; overflow-y: auto;
      font-size: 12px; font-family: monospace;
    `;
    return this.logContainer;
  }

  private buildLoadMore(): HTMLElement {
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
    return this.loadMoreBtn;
  }

  private buildStatus(): HTMLElement {
    this.statusEl = document.createElement("div");
    this.statusEl.style.cssText = "font-size:10px;color:rgba(255,255,255,0.3);margin-top:4px;";
    return this.statusEl;
  }

  // --- Helpers ---

  private createFilterInput(placeholder: string, onInput: (v: string) => void): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.style.cssText = `
      flex: 1; background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 4px; color: rgba(255,255,255,0.7);
      font-size: 11px; padding: 4px 8px; font-family: monospace;
      min-width: 100px;
    `;
    input.addEventListener("input", () => onInput(input.value.trim()));
    return input;
  }

  private createButton(text: string, color: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = text;
    const isAccent = color.startsWith("#");
    btn.style.cssText = `
      background: ${isAccent ? `rgba(68,170,255,0.15)` : "rgba(255,255,255,0.06)"};
      border: 1px solid ${isAccent ? "rgba(68,170,255,0.3)" : "rgba(255,255,255,0.1)"};
      border-radius: 4px; color: ${color}; font-size: 11px;
      padding: 4px 10px; cursor: pointer; white-space: nowrap;
    `;
    btn.addEventListener("click", onClick);
    return btn;
  }

  private applyTypeFilter(): void {
    const active: string[] = [];
    this.typeCheckboxes.forEach((cb, type) => {
      if (cb.checked) active.push(type);
    });
    // If all checked, send empty (no filter)
    this.currentFilters.types = active.length === ALL_TYPES.length ? [] : active;
    this.loadLog(true);
  }

  // --- Public API ---

  async loadDaemons(): Promise<void> {
    try {
      const res = await this.fetchFn(`${this.apiUrl}/api/daemons/global`);
      if (!res.ok) return;
      const data = await res.json();
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

  // --- Data loading ---

  private async loadAll(): Promise<void> {
    await Promise.all([
      this.loadDaemonInfo(),
      this.loadSummary(),
      this.loadLog(true),
    ]);
    this.filterBar.style.display = "block";
  }

  private async loadDaemonInfo(): Promise<void> {
    if (!this.currentDaemonId) return;
    try {
      const res = await this.fetchFn(`${this.apiUrl}/api/daemons/${this.currentDaemonId}`);
      if (!res.ok) return;
      const d = await res.json();
      this.daemonHeader.style.display = "block";
      this.daemonHeader.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <span style="color:rgba(255,255,255,0.9);font-weight:bold;font-size:13px">${esc(d.name ?? "Unknown")}</span>
            <span style="color:rgba(255,255,255,0.3);margin-left:8px">v${d.manifestVersion ?? "?"}</span>
          </div>
          <div style="font-size:10px;color:rgba(255,255,255,0.3)">
            ${d.compiledTokenCount ? `${d.compiledTokenCount} prompt tokens` : ""}
            ${d.lastActive ? ` | last active ${formatTime(d.lastActive).date}` : ""}
          </div>
        </div>
      `;
    } catch {
      this.daemonHeader.style.display = "none";
    }
  }

  private async loadSummary(): Promise<void> {
    if (!this.currentDaemonId) return;
    try {
      const res = await this.fetchFn(
        `${this.apiUrl}/api/daemons/${this.currentDaemonId}/token-summary?window=${this.summaryWindow}`,
      );
      if (!res.ok) return;
      const data: TokenSummaryData = await res.json();
      this.renderSummaryDashboard(data);
    } catch {
      this.summaryDashboard.style.display = "none";
    }
  }

  private renderSummaryDashboard(data: TokenSummaryData): void {
    this.summaryDashboard.style.display = "block";
    const cost = estimateCost(data.totalTokensIn, data.totalTokensOut);

    // Window toggle buttons
    const windowBtns = (["30d", "90d", "all"] as const)
      .map((w) => {
        const active = w === this.summaryWindow;
        return `<span class="window-btn" data-window="${w}" style="
          cursor:pointer;padding:2px 8px;border-radius:3px;font-size:10px;
          background:${active ? "rgba(68,170,255,0.2)" : "rgba(255,255,255,0.04)"};
          color:${active ? "#44aaff" : "rgba(255,255,255,0.4)"};
          border:1px solid ${active ? "rgba(68,170,255,0.3)" : "rgba(255,255,255,0.08)"};
        ">${w}</span>`;
      })
      .join("");

    // Breakdown rows
    const breakdownRows = data.breakdown
      .map((b) => {
        const c = TYPE_COLORS[b.type] ?? "#888";
        return `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:10px">
          <span style="color:${c}">${TYPE_LABELS[b.type] ?? b.type}</span>
          <span style="color:rgba(255,255,255,0.4)">${b.callCount} calls | ${b.tokensIn.toLocaleString()}in/${b.tokensOut.toLocaleString()}out</span>
        </div>`;
      })
      .join("");

    this.summaryDashboard.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:12px;font-weight:bold;color:rgba(255,255,255,0.7)">Token Usage</span>
        <div style="display:flex;gap:4px">${windowBtns}</div>
      </div>
      <div style="display:flex;gap:16px;margin-bottom:8px;font-size:12px">
        <div><span style="color:rgba(255,255,255,0.4)">Calls:</span> <span style="color:rgba(255,255,255,0.8)">${data.totalCalls.toLocaleString()}</span></div>
        <div><span style="color:rgba(255,255,255,0.4)">Tokens in:</span> <span style="color:#44cc88">${data.totalTokensIn.toLocaleString()}</span></div>
        <div><span style="color:rgba(255,255,255,0.4)">Tokens out:</span> <span style="color:#44aaff">${data.totalTokensOut.toLocaleString()}</span></div>
        <div><span style="color:rgba(255,255,255,0.4)">Est. cost:</span> <span style="color:#ffaa44">${cost}</span></div>
      </div>
      <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:4px">${breakdownRows}</div>
    `;

    // Bind window toggle events
    this.summaryDashboard.querySelectorAll(".window-btn").forEach((el) => {
      el.addEventListener("click", () => {
        this.summaryWindow = (el as HTMLElement).dataset.window as "30d" | "90d" | "all";
        this.loadSummary();
      });
    });
  }

  private async loadLog(reset: boolean): Promise<void> {
    if (!this.currentDaemonId) return;

    if (reset) {
      this.logContainer.innerHTML = "";
      this.nextCursor = null;
      this.entries = [];
    }

    this.statusEl.textContent = "Loading...";

    try {
      let url = `${this.apiUrl}/api/daemons/${this.currentDaemonId}/activity-log?limit=50`;
      if (this.nextCursor) {
        url += `&cursor=${encodeURIComponent(this.nextCursor)}`;
      }
      if (this.currentFilters.visitorId) {
        url += `&visitorId=${encodeURIComponent(this.currentFilters.visitorId)}`;
      }
      if (this.currentFilters.sessionId) {
        url += `&sessionId=${encodeURIComponent(this.currentFilters.sessionId)}`;
      }
      if (this.currentFilters.types.length > 0) {
        url += `&types=${encodeURIComponent(this.currentFilters.types.join(","))}`;
      }

      const res = await this.fetchFn(url);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();

      const newEntries: LogEntryData[] = data.entries;
      this.entries.push(...newEntries);

      // Group by session and render
      this.renderGroupedEntries(newEntries);

      this.nextCursor = data.nextCursor;
      this.loadMoreBtn.style.display = data.hasMore ? "block" : "none";
      this.statusEl.textContent = `${this.entries.length} entries loaded`;
    } catch (err) {
      this.statusEl.textContent = `Error: ${err instanceof Error ? err.message : "failed"}`;
    }
  }

  // --- Session grouping ---

  private renderGroupedEntries(entries: LogEntryData[]): void {
    // Group entries by sessionId (if present in payload)
    const sessionGroups = new Map<string, LogEntryData[]>();
    const ungrouped: LogEntryData[] = [];

    for (const entry of entries) {
      const sessionId = entry.payload?.sessionId as string | undefined;
      if (sessionId && (entry.type === "conversation_turn" || entry.type === "conversation_summary")) {
        if (!sessionGroups.has(sessionId)) {
          sessionGroups.set(sessionId, []);
        }
        sessionGroups.get(sessionId)!.push(entry);
      } else {
        ungrouped.push(entry);
      }
    }

    // Render session groups as collapsible sections
    for (const [sessionId, group] of sessionGroups) {
      const container = this.renderSessionGroup(sessionId, group);
      this.logContainer.appendChild(container);
    }

    // Render ungrouped entries
    for (const entry of ungrouped) {
      this.logContainer.appendChild(this.renderEntry(entry));
    }
  }

  private renderSessionGroup(sessionId: string, entries: LogEntryData[]): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = `
      margin: 4px 0; border: 1px solid rgba(68,170,255,0.15);
      border-radius: 4px; overflow: hidden;
    `;

    // Find summary entry if present
    const summary = entries.find((e) => e.type === "conversation_summary");
    const turns = entries.filter((e) => e.type === "conversation_turn");
    const firstEntry = entries[0];
    const { date, time } = formatTime(firstEntry.timestamp);

    const totalTokensIn = entries.reduce((s, e) => s + (e.tokensIn ?? 0), 0);
    const totalTokensOut = entries.reduce((s, e) => s + (e.tokensOut ?? 0), 0);

    // Participant name from actors
    const participants = new Set<string>();
    for (const e of entries) {
      for (const a of e.actors) {
        if (a.actorName) participants.add(a.actorName);
      }
    }
    const participantStr = [...participants].join(", ");

    // Header (clickable to expand/collapse)
    const header = document.createElement("div");
    header.style.cssText = `
      padding: 4px 8px; cursor: pointer;
      background: rgba(68,170,255,0.06);
      display: flex; justify-content: space-between; align-items: center;
      font-size: 11px;
    `;

    const endReason = summary?.payload?.endReason as string ?? "";
    header.innerHTML = `
      <div>
        <span style="color:rgba(255,255,255,0.3)">▶</span>
        <span style="color:#44aaff;font-weight:bold">SESSION</span>
        <span style="color:rgba(255,255,255,0.5)">${esc(participantStr)}</span>
        <span style="color:rgba(255,255,255,0.3)">${date} ${time}</span>
        ${endReason ? `<span style="color:rgba(255,255,255,0.25);margin-left:4px">(${esc(endReason)})</span>` : ""}
      </div>
      <div style="color:rgba(255,255,255,0.35)">
        ${turns.length} turns | ${totalTokensIn}in/${totalTokensOut}out
      </div>
    `;

    const body = document.createElement("div");
    body.style.cssText = "display:none;padding:2px 8px 4px;";

    // Summary at top of group if available
    if (summary) {
      body.appendChild(this.renderConversationSummary(summary));
    }

    for (const turn of turns) {
      body.appendChild(this.renderConversationTurn(turn));
    }

    let expanded = false;
    header.addEventListener("click", () => {
      expanded = !expanded;
      body.style.display = expanded ? "block" : "none";
      const arrow = header.querySelector("span");
      if (arrow) arrow.textContent = expanded ? "▼" : "▶";
    });

    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
  }

  // --- Per-type entry renderers ---

  private renderEntry(entry: LogEntryData): HTMLElement {
    switch (entry.type) {
      case "conversation_turn":
        return this.renderConversationTurn(entry);
      case "conversation_summary":
        return this.renderConversationSummary(entry);
      case "manifest_amendment":
        return this.renderManifestAmendment(entry);
      case "manifest_recompile":
        return this.renderManifestRecompile(entry);
      case "behavior_event":
        return this.renderBehaviorEvent(entry);
      case "inter_daemon_event":
        return this.renderInterDaemonEvent(entry);
      case "inference_failure":
        return this.renderInferenceFailure(entry);
      case "budget_warning":
        return this.renderBudgetWarning(entry);
      default:
        return this.renderGenericEntry(entry);
    }
  }

  private renderConversationTurn(entry: LogEntryData): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText = "padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.03);line-height:1.4;";
    const p = entry.payload;
    const { time } = formatTime(entry.timestamp);

    const speaker = entry.actors.find((a) => a.actorName)?.actorName ?? "Unknown";
    const speech = p.speech ? String(p.speech) : "";
    const emote = p.emote ? `<span style="background:rgba(170,136,255,0.15);color:#aa88ff;padding:1px 4px;border-radius:2px;font-size:9px;margin-left:4px">${esc(String(p.emote))}</span>` : "";
    const movement = p.movement && p.movement !== "idle" ? `<span style="color:rgba(255,255,255,0.25);font-size:9px;margin-left:4px">[${esc(String(p.movement))}]</span>` : "";
    const tokens = entry.tokensIn != null ? `<span style="color:rgba(255,255,255,0.2);font-size:9px;margin-left:4px">[${entry.tokensIn}/${entry.tokensOut ?? 0}]</span>` : "";
    const internal = p.internalState ? `<div style="color:rgba(255,255,255,0.15);font-size:10px;font-style:italic;margin-left:20px;cursor:help" title="Internal state">💭 ${esc(String(p.internalState).slice(0, 120))}</div>` : "";

    row.innerHTML = `
      <div>
        <span style="color:rgba(255,255,255,0.25);font-size:10px">${time}</span>
        <span style="color:#44cc88;font-weight:bold">${esc(speaker)}</span>${emote}${movement}${tokens}
        ${speech ? `<span style="color:rgba(255,255,255,0.7)"> "${esc(speech.slice(0, 150))}${speech.length > 150 ? "..." : ""}"</span>` : '<span style="color:rgba(255,255,255,0.2)">(silent)</span>'}
      </div>
      ${internal}
    `;
    return row;
  }

  private renderConversationSummary(entry: LogEntryData): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText = `
      padding: 4px 8px; margin: 2px 0; border-radius: 3px;
      background: rgba(68,170,255,0.06); border-left: 2px solid #44aaff;
      font-size: 11px; cursor: pointer;
    `;
    const p = entry.payload;
    const { date, time } = formatTime(entry.timestamp);
    const duration = p.duration ? `${Math.round(Number(p.duration))}s` : "";
    const impression = p.impressionGenerated ? String(p.impressionGenerated).slice(0, 100) : "";
    const cost = entry.tokensIn != null ? estimateCost(entry.tokensIn ?? 0, entry.tokensOut ?? 0) : "";

    let expanded = false;
    const detail = document.createElement("div");
    detail.style.cssText = "display:none;margin-top:4px;color:rgba(255,255,255,0.4);font-size:10px;";
    detail.innerHTML = `
      ${p.participantId ? `<div>Participant: ${esc(String(p.participantId))} (${esc(String(p.participantType ?? ""))}) </div>` : ""}
      ${duration ? `<div>Duration: ${duration} | ${p.turnCount ?? "?"} turns</div>` : ""}
      ${impression ? `<div>Impression: "${esc(impression)}"</div>` : ""}
      ${cost ? `<div>Cost: ${cost}</div>` : ""}
    `;

    row.innerHTML = `
      <span style="color:rgba(255,255,255,0.3)">▶ ${date} ${time}</span>
      <span style="color:#44aaff;font-weight:bold">SUMMARY</span>
      <span style="color:rgba(255,255,255,0.4)">${duration} | ${p.turnCount ?? "?"} turns</span>
    `;
    row.appendChild(detail);

    row.addEventListener("click", () => {
      expanded = !expanded;
      detail.style.display = expanded ? "block" : "none";
    });

    return row;
  }

  private renderManifestAmendment(entry: LogEntryData): HTMLElement {
    const row = document.createElement("div");
    const p = entry.payload;
    const accepted = p.validatorDecision === "accepted";
    const borderColor = accepted ? "#ffaa44" : "rgba(255,68,68,0.4)";

    row.style.cssText = `
      padding: 6px 8px; margin: 4px 0; border-radius: 4px;
      background: ${accepted ? "rgba(255,170,68,0.08)" : "rgba(255,68,68,0.05)"};
      border-left: 3px solid ${borderColor};
      font-size: 11px;
    `;

    const { date, time } = formatTime(entry.timestamp);
    const cost = entry.tokensIn != null ? estimateCost(entry.tokensIn ?? 0, entry.tokensOut ?? 0) : "";

    row.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <span style="color:rgba(255,255,255,0.3)">${date} ${time}</span>
          <span style="color:${accepted ? "#ffaa44" : "#ff4444"};font-weight:bold">
            AMENDMENT ${accepted ? "ACCEPTED" : "REJECTED"}
          </span>
        </div>
        ${cost ? `<span style="color:rgba(255,255,255,0.2);font-size:9px">${cost}</span>` : ""}
      </div>
      <div style="margin-top:4px">
        <span style="color:rgba(255,255,255,0.5)">Trait:</span>
        <span style="color:rgba(255,255,255,0.8)">${esc(String(p.traitName ?? ""))}</span>
      </div>
      <div style="margin-top:2px">
        <span style="color:rgba(255,68,68,0.6);text-decoration:line-through">${esc(String(p.previousValue ?? ""))}</span>
        <span style="color:rgba(255,255,255,0.3)"> → </span>
        <span style="color:${accepted ? "#44cc88" : "rgba(255,255,255,0.3)"}">${esc(String(p.proposedValue ?? ""))}</span>
      </div>
      <div style="margin-top:2px;color:rgba(255,255,255,0.3);font-size:10px">
        Trigger: ${esc(String(p.triggeringEventType ?? ""))} — ${esc(String(p.triggeringEvent ?? "").slice(0, 100))}
      </div>
      ${p.rejectionReason ? `<div style="color:rgba(255,68,68,0.6);font-size:10px;margin-top:2px">Reason: ${esc(String(p.rejectionReason))}</div>` : ""}
    `;
    return row;
  }

  private renderManifestRecompile(entry: LogEntryData): HTMLElement {
    const row = document.createElement("div");
    const p = entry.payload;
    const { date, time } = formatTime(entry.timestamp);

    row.style.cssText = `
      padding: 4px 8px; margin: 2px 0; border-radius: 3px;
      background: rgba(255,136,68,0.06); border-left: 2px solid #ff8844;
      font-size: 11px;
    `;

    row.innerHTML = `
      <span style="color:rgba(255,255,255,0.3)">${date} ${time}</span>
      <span style="color:#ff8844;font-weight:bold">RECOMPILE</span>
      <span style="color:rgba(255,255,255,0.4)">v${p.previousVersion} → v${p.newVersion}</span>
      <span style="color:rgba(255,255,255,0.3)">(${p.reason})</span>
      <span style="color:rgba(255,255,255,0.25);font-size:10px">${p.previousTokenCount} → ${p.newTokenCount} tokens</span>
    `;
    return row;
  }

  private renderBehaviorEvent(entry: LogEntryData): HTMLElement {
    const row = document.createElement("div");
    const p = entry.payload;
    const { time } = formatTime(entry.timestamp);

    row.style.cssText = "padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.02);font-size:11px;";

    const fallback = p.fallbackReason ? `<span style="color:#ffcc44;font-size:9px;margin-left:4px">[fallback: ${esc(String(p.fallbackReason))}]</span>` : "";

    row.innerHTML = `
      <span style="color:rgba(255,255,255,0.25)">${time}</span>
      <span style="color:#aa88ff">behavior</span>
      <span style="color:rgba(255,255,255,0.5)">${esc(String(p.eventType ?? ""))}</span>
      ${fallback}
    `;
    return row;
  }

  private renderInterDaemonEvent(entry: LogEntryData): HTMLElement {
    const row = document.createElement("div");
    const { date, time } = formatTime(entry.timestamp);

    row.style.cssText = "padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.03);font-size:11px;";

    const names = entry.actors
      .filter((a) => a.actorName)
      .map((a) => `<span style="color:#88ccff">${esc(a.actorName!)}</span>`)
      .join(" ↔ ");

    row.innerHTML = `
      <span style="color:rgba(255,255,255,0.25)">${date} ${time}</span>
      <span style="color:#88ccff;font-weight:bold">INTER-DAEMON</span>
      ${names}
    `;
    return row;
  }

  private renderInferenceFailure(entry: LogEntryData): HTMLElement {
    const row = document.createElement("div");
    const p = entry.payload;
    const { date, time } = formatTime(entry.timestamp);

    row.style.cssText = `
      padding: 4px 8px; margin: 2px 0; border-radius: 3px;
      background: rgba(255,68,68,0.08); border-left: 2px solid #ff4444;
      font-size: 11px;
    `;

    const retried = p.retryAttempted ? `<span style="color:rgba(255,255,255,0.3);font-size:9px">retried</span>` : "";
    const fallback = p.fallbackUsed ? `<span style="color:#ffcc44;font-size:9px;margin-left:4px">→ fallback</span>` : "";

    row.innerHTML = `
      <span style="color:rgba(255,255,255,0.3)">${date} ${time}</span>
      <span style="color:#ff4444;font-weight:bold">FAILURE</span>
      <span style="color:rgba(255,255,255,0.6)">${esc(String(p.failureType ?? "unknown"))}</span>
      ${retried}${fallback}
      ${p.errorMessage ? `<div style="color:rgba(255,68,68,0.5);font-size:10px;margin-top:2px">${esc(String(p.errorMessage).slice(0, 200))}</div>` : ""}
    `;
    return row;
  }

  private renderBudgetWarning(entry: LogEntryData): HTMLElement {
    const row = document.createElement("div");
    const p = entry.payload;
    const { date, time } = formatTime(entry.timestamp);

    row.style.cssText = `
      padding: 4px 8px; margin: 2px 0; border-radius: 3px;
      background: rgba(255,204,68,0.08); border-left: 2px solid #ffcc44;
      font-size: 11px;
    `;

    row.innerHTML = `
      <span style="color:rgba(255,255,255,0.3)">${date} ${time}</span>
      <span style="color:#ffcc44;font-weight:bold">BUDGET</span>
      <span style="color:rgba(255,255,255,0.6)">${esc(String(p.warningType ?? ""))}</span>
      <span style="color:rgba(255,255,255,0.4)">${p.currentUsage}/${p.limit}</span>
    `;
    return row;
  }

  private renderGenericEntry(entry: LogEntryData): HTMLElement {
    const row = document.createElement("div");
    const { date, time } = formatTime(entry.timestamp);
    const color = TYPE_COLORS[entry.type] ?? "#888";

    row.style.cssText = "padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.03);line-height:1.4;font-size:11px;";

    const actorNames = entry.actors.filter((a) => a.actorName).map((a) => a.actorName).join(", ");
    const tokens = entry.tokensIn != null ? `[${entry.tokensIn}in/${entry.tokensOut ?? 0}out]` : "";

    row.innerHTML = `
      <span style="color:rgba(255,255,255,0.3)">${date} ${time}</span>
      <span style="color:${color};font-weight:bold">${entry.type}</span>
      <span style="color:rgba(255,255,255,0.2)">${tokens}</span>
      <span style="color:rgba(255,255,255,0.4)">${esc(actorNames)}</span>
    `;
    return row;
  }
}
