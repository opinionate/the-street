import type { DaemonState, DaemonDefinition, Vector3 } from "@the-street/shared";
import type { AnimationPanel } from "./AnimationPanel.js";

interface DaemonEntry {
  daemon: DaemonState;
  emotes?: Array<{ id: string; label: string }>;
}

interface DaemonFullDetails {
  id: string;
  name: string;
  description: string;
  definition: DaemonDefinition;
  behavior?: { idleAnimationLabel?: string; [key: string]: unknown };
  position: Vector3;
  rotation: number;
  isActive: boolean;
  plotUuid?: string;
  ownerId?: string;
  characterUploadId?: string;
  createdAt: string;
}

/**
 * Daemon Directory Panel — lists all daemons in the world.
 * Features: teleport, idle animation selector, activity log, detail/edit view.
 * Toggled with F10.
 */
export class DaemonDirectoryPanel {
  private container: HTMLDivElement;
  private listEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private scrollArea: HTMLDivElement;
  private headerTitle: HTMLDivElement;
  private visible = false;
  private entries: DaemonEntry[] = [];
  private currentView: "list" | "detail" = "list";

  // Callbacks set by main.ts
  onTeleport: ((position: Vector3) => void) | null = null;
  onSetIdleAnimation: ((daemonId: string, label: string) => Promise<void>) | null = null;
  onFetchDaemons: (() => DaemonState[]) | null = null;
  onFetchEmotes: ((daemonId: string) => Promise<Array<{ id: string; label: string }>>) | null = null;
  onFetchActivity: ((daemonId: string) => Promise<Array<{
    type: string;
    content: string;
    targetName?: string;
    timestamp: number;
  }>>) | null = null;
  onFetchDaemonDetails: ((daemonId: string) => Promise<DaemonFullDetails | null>) | null = null;
  onSaveDaemon: ((daemonId: string, definition: DaemonDefinition) => Promise<boolean>) | null = null;
  onSendDirective: ((daemonId: string, directive: string) => Promise<boolean>) | null = null;
  onRemoveDesire: ((daemonId: string, index: number) => Promise<string[]>) | null = null;
  onFetchDesires: ((daemonId: string) => Promise<string[]>) | null = null;
  onUploadCharacterModel: ((daemonId: string, file: File) => Promise<boolean>) | null = null;
  onFetchAllDaemons: (() => Promise<Array<{ id: string; name: string; description: string; isActive: boolean; plotUuid?: string; position: { x: number; y: number; z: number } }>>) | null = null;
  onActivateDaemon: ((daemonId: string) => Promise<boolean>) | null = null;
  onDeactivateDaemon: ((daemonId: string) => Promise<boolean>) | null = null;
  createAnimationPanel: ((daemonId: string) => AnimationPanel) | null = null;
  onFetchActivityLog: ((daemonId: string, limit?: number, cursor?: string) => Promise<{
    entries: Array<{
      entryId: string;
      daemonId: string;
      type: string;
      timestamp: number;
      actors: Array<{ actorType: string; actorId: string; actorName?: string }>;
      tokensIn?: number;
      tokensOut?: number;
      modelUsed?: string;
      inferenceLatencyMs?: number;
      payload: Record<string, unknown>;
    }>;
    nextCursor?: string;
    total: number;
  }>) | null = null;
  onFetchTokenSummary: ((daemonId: string) => Promise<{
    totalTokensIn: number;
    totalTokensOut: number;
    totalCalls: number;
    byModel: Record<string, { tokensIn: number; tokensOut: number; calls: number }>;
    byType: Record<string, { tokensIn: number; tokensOut: number; calls: number }>;
  }>) | null = null;

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "daemon-directory-panel";
    this.container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 720px;
      max-width: 95vw;
      max-height: 85vh;
      background: rgba(10, 10, 15, 0.95);
      border: 1px solid rgba(68, 170, 255, 0.3);
      border-radius: 12px;
      z-index: 200;
      display: none;
      font-family: system-ui, sans-serif;
      color: white;
      overflow: hidden;
      pointer-events: auto;
    `;

    // Header
    const header = document.createElement("div");
    header.style.cssText = `
      padding: 14px 20px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      display: flex; align-items: center; justify-content: space-between;
    `;
    this.headerTitle = document.createElement("div");
    this.headerTitle.innerHTML = '<span style="color:#44aaff;font-weight:bold">DAEMON</span> Directory';
    this.headerTitle.style.cssText = "font-size: 16px; font-weight: bold;";
    header.appendChild(this.headerTitle);

    const btnGroup = document.createElement("div");
    btnGroup.style.cssText = "display:flex;gap:6px;align-items:center;";

    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "Refresh";
    refreshBtn.style.cssText = this.smallBtnStyle();
    refreshBtn.addEventListener("click", () => this.refresh());
    btnGroup.appendChild(refreshBtn);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "\u00D7";
    closeBtn.style.cssText = "background:none;border:none;color:rgba(255,255,255,0.6);font-size:22px;cursor:pointer;padding:0 4px;";
    closeBtn.addEventListener("click", () => this.hide());
    btnGroup.appendChild(closeBtn);

    header.appendChild(btnGroup);
    this.container.appendChild(header);

    // Scrollable area
    this.scrollArea = document.createElement("div");
    this.scrollArea.style.cssText = "overflow-y:auto;max-height:calc(85vh - 100px);padding:12px 20px;";

    this.statusEl = document.createElement("div");
    this.statusEl.style.cssText = "font-size:11px;color:rgba(255,255,255,0.3);margin-bottom:8px;";
    this.scrollArea.appendChild(this.statusEl);

    this.listEl = document.createElement("div");
    this.scrollArea.appendChild(this.listEl);

    this.container.appendChild(this.scrollArea);
    document.body.appendChild(this.container);
  }

  private smallBtnStyle(): string {
    return "background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);border-radius:4px;color:rgba(255,255,255,0.7);font-size:12px;padding:4px 12px;cursor:pointer;";
  }

  private actionBtnStyle(color = "#44aaff"): string {
    const bg = color === "#44aaff" ? "rgba(68,170,255,0.2)" : color === "#44ff88" ? "rgba(68,255,136,0.2)" : "rgba(255,255,255,0.08)";
    const border = color === "#44aaff" ? "rgba(68,170,255,0.4)" : color === "#44ff88" ? "rgba(68,255,136,0.4)" : "rgba(255,255,255,0.2)";
    return `padding:4px 12px;background:${bg};border:1px solid ${border};color:${color};font-size:11px;cursor:pointer;border-radius:4px;font-weight:bold;`;
  }

  private inputStyle(): string {
    return "width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:white;font-size:12px;padding:6px 8px;font-family:system-ui,sans-serif;box-sizing:border-box;";
  }

  private textareaStyle(): string {
    return this.inputStyle() + "resize:vertical;min-height:60px;";
  }

  private labelStyle(): string {
    return "font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:3px;display:block;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;";
  }

  /** Append a custom section element to the panel (before the scroll area) */
  appendSection(element: HTMLElement): void {
    this.container.insertBefore(element, this.scrollArea);
  }

  show(): void {
    this.visible = true;
    this.container.style.display = "block";
    if (document.pointerLockElement) document.exitPointerLock();
    this.showList();
  }

  hide(): void {
    this.visible = false;
    this.container.style.display = "none";
  }

  toggle(): void {
    if (this.visible) this.hide(); else this.show();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  private showList(): void {
    this.currentView = "list";
    this.headerTitle.innerHTML = '<span style="color:#44aaff;font-weight:bold">DAEMON</span> Directory';
    this.statusEl.style.display = "";
    this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.currentView !== "list") return;
    const activeDaemons = this.onFetchDaemons?.() || [];
    const activeIds = new Set(activeDaemons.map(d => d.daemonId));
    this.entries = activeDaemons.map(d => ({ daemon: d }));

    // Fetch all daemons (including inactive) from API
    if (this.onFetchAllDaemons) {
      try {
        const all = await this.onFetchAllDaemons();
        const inactive = all.filter(d => !d.isActive && !activeIds.has(d.id));
        for (const d of inactive) {
          this.entries.push({
            daemon: {
              daemonId: d.id,
              definition: { name: d.name, description: d.description, behavior: {}, personality: { traits: [], backstory: "", speechStyle: "", interests: [], quirks: [] }, appearance: {}, position: d.position, rotation: 0 } as any,
              currentPosition: d.position,
              currentRotation: 0,
              currentAction: "idle",
              mood: "neutral",
              _inactive: true,
            } as any,
          });
        }
      } catch { /* ignore */ }
    }

    const activeCount = activeDaemons.length;
    const totalCount = this.entries.length;
    const inactiveCount = totalCount - activeCount;
    this.statusEl.textContent = `${activeCount} active` + (inactiveCount > 0 ? `, ${inactiveCount} inactive` : "");
    this.renderList();
  }

  private renderList(): void {
    this.listEl.innerHTML = "";

    if (this.entries.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No daemons in the world";
      empty.style.cssText = "color:rgba(255,255,255,0.4);font-size:13px;padding:20px 0;text-align:center;";
      this.listEl.appendChild(empty);
      return;
    }

    for (const entry of this.entries) {
      this.listEl.appendChild(this.renderDaemonCard(entry));
    }
  }

  private renderDaemonCard(entry: DaemonEntry): HTMLElement {
    const d = entry.daemon;
    const card = document.createElement("div");
    card.style.cssText = `
      padding: 12px 14px; margin-bottom: 8px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      cursor: pointer;
      transition: border-color 0.15s;
    `;
    card.addEventListener("mouseenter", () => { card.style.borderColor = "rgba(68,170,255,0.3)"; });
    card.addEventListener("mouseleave", () => { card.style.borderColor = "rgba(255,255,255,0.08)"; });

    // Row 1: Name + type + position
    const topRow = document.createElement("div");
    topRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;";

    const nameGroup = document.createElement("div");
    nameGroup.style.cssText = "display:flex;align-items:center;gap:8px;";
    const nameEl = document.createElement("span");
    nameEl.textContent = d.definition.name;
    nameEl.style.cssText = "font-weight:bold;font-size:14px;color:#44aaff;";
    nameGroup.appendChild(nameEl);

    if ((d as any)._inactive) {
      const inactiveBadge = document.createElement("span");
      inactiveBadge.textContent = "INACTIVE";
      inactiveBadge.style.cssText = "font-size:10px;padding:2px 6px;border-radius:3px;background:rgba(255,100,68,0.15);color:#ff6644;text-transform:uppercase;font-weight:bold;";
      nameGroup.appendChild(inactiveBadge);
    } else if (d.definition.behavior.type) {
      const typeBadge = document.createElement("span");
      typeBadge.textContent = d.definition.behavior.type;
      typeBadge.style.cssText = "font-size:10px;padding:2px 6px;border-radius:3px;background:rgba(68,255,136,0.12);color:#44ff88;text-transform:uppercase;font-weight:bold;";
      nameGroup.appendChild(typeBadge);
    }
    topRow.appendChild(nameGroup);

    const rightGroup = document.createElement("div");
    rightGroup.style.cssText = "display:flex;align-items:center;gap:8px;";

    const posEl = document.createElement("span");
    const pos = d.currentPosition;
    posEl.textContent = `(${Math.round(pos.x)}, ${Math.round(pos.z)})`;
    posEl.style.cssText = "font-size:11px;color:rgba(255,255,255,0.3);font-family:monospace;";
    rightGroup.appendChild(posEl);

    const moodEl = document.createElement("span");
    moodEl.textContent = d.mood;
    const moodColors: Record<string, string> = {
      happy: "#44ff88", neutral: "#888", bored: "#666688",
      excited: "#ffff44", annoyed: "#ff6644", curious: "#44ccff",
    };
    moodEl.style.cssText = `font-size:10px;padding:2px 6px;border-radius:3px;background:rgba(255,255,255,0.06);color:${moodColors[d.mood] || "#888"};`;
    rightGroup.appendChild(moodEl);

    topRow.appendChild(rightGroup);
    card.appendChild(topRow);

    // Row 2: Description
    if (d.definition.description) {
      const descEl = document.createElement("div");
      descEl.textContent = d.definition.description.slice(0, 120);
      descEl.style.cssText = "font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:8px;";
      card.appendChild(descEl);
    }

    // Row 3: Action buttons
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:6px;align-items:center;flex-wrap:wrap;";

    // Teleport button
    const teleportBtn = document.createElement("button");
    teleportBtn.textContent = "Teleport";
    teleportBtn.style.cssText = this.actionBtnStyle();
    teleportBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const tp = { x: d.currentPosition.x + 3, y: 0, z: d.currentPosition.z + 3 };
      this.onTeleport?.(tp);
      this.hide();
    });
    actions.appendChild(teleportBtn);

    // Edit button
    const editBtn = document.createElement("button");
    editBtn.textContent = "Details / Edit";
    editBtn.style.cssText = this.actionBtnStyle("#44ff88");
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openDetailView(d.daemonId);
    });
    actions.appendChild(editBtn);

    // Activate button for inactive daemons
    if ((d as any)._inactive && this.onActivateDaemon) {
      const activateBtn = document.createElement("button");
      activateBtn.textContent = "Activate";
      activateBtn.style.cssText = this.actionBtnStyle("#ff8c00");
      activateBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        activateBtn.textContent = "Activating...";
        activateBtn.style.opacity = "0.5";
        const ok = await this.onActivateDaemon!(d.daemonId);
        if (ok) {
          this.refresh();
        } else {
          activateBtn.textContent = "Failed";
          activateBtn.style.color = "#ff4444";
          setTimeout(() => {
            activateBtn.textContent = "Activate";
            activateBtn.style.cssText = this.actionBtnStyle("#ff8c00");
          }, 2000);
        }
      });
      actions.appendChild(activateBtn);
    }

    card.appendChild(actions);

    // Expandable activity log
    const activitySection = document.createElement("div");
    activitySection.style.cssText = "margin-top:8px;";

    const activityBtn = document.createElement("button");
    activityBtn.textContent = "Activity Log";
    activityBtn.style.cssText = "width:100%;padding:4px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.35);font-size:10px;cursor:pointer;border-radius:3px;";

    const activityLog = document.createElement("div");
    activityLog.style.cssText = "display:none;margin-top:6px;max-height:200px;overflow-y:auto;font-size:11px;";

    let activityLoaded = false;
    activityBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (activityLog.style.display === "none") {
        activityLog.style.display = "block";
        activityBtn.textContent = "Activity Log (hide)";
        if (!activityLoaded) {
          activityLoaded = true;
          activityLog.innerHTML = '<div style="color:rgba(255,255,255,0.3)">Loading...</div>';
          try {
            const activity = await this.onFetchActivity?.(d.daemonId) || [];
            this.renderActivityLog(activityLog, activity);
          } catch {
            activityLog.innerHTML = '<div style="color:#ff4444">Failed to load activity</div>';
          }
        }
      } else {
        activityLog.style.display = "none";
        activityBtn.textContent = "Activity Log";
      }
    });

    activitySection.appendChild(activityBtn);
    activitySection.appendChild(activityLog);
    card.appendChild(activitySection);

    // Click entire card to open detail
    card.addEventListener("click", () => this.openDetailView(d.daemonId));

    return card;
  }

  // ─── Detail / Edit View ────────────────────────────────────

  private async openDetailView(daemonId: string): Promise<void> {
    this.currentView = "detail";
    this.statusEl.style.display = "none";
    this.listEl.innerHTML = '<div style="color:rgba(255,255,255,0.3);padding:20px;text-align:center">Loading daemon details...</div>';

    const details = await this.onFetchDaemonDetails?.(daemonId);
    if (!details) {
      this.listEl.innerHTML = '<div style="color:#ff4444;padding:20px;text-align:center">Failed to load daemon details</div>';
      return;
    }

    this.headerTitle.innerHTML = `<span style="color:#44aaff;font-weight:bold">${this.escapeHtml(details.name)}</span> <span style="color:rgba(255,255,255,0.4);font-size:12px">/ Edit</span>`;
    this.renderDetailView(details);
  }

  private renderDetailView(details: DaemonFullDetails): void {
    this.listEl.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.style.cssText = "display:flex;flex-direction:column;gap:0;";

    // Back button + activate/deactivate
    const backRow = document.createElement("div");
    backRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;";
    const backBtn = document.createElement("button");
    backBtn.textContent = "< Back to List";
    backBtn.style.cssText = this.smallBtnStyle();
    backBtn.addEventListener("click", () => this.showList());
    backRow.appendChild(backBtn);

    // Activate / Deactivate toggle
    if (details.isActive && this.onDeactivateDaemon) {
      const deactivateBtn = document.createElement("button");
      deactivateBtn.textContent = "Deactivate";
      deactivateBtn.style.cssText = this.actionBtnStyle("#ff4444");
      deactivateBtn.addEventListener("click", async () => {
        deactivateBtn.textContent = "Deactivating...";
        deactivateBtn.style.opacity = "0.5";
        const ok = await this.onDeactivateDaemon!(details.id);
        if (ok) {
          this.showList();
        } else {
          deactivateBtn.textContent = "Failed";
          setTimeout(() => {
            deactivateBtn.textContent = "Deactivate";
            deactivateBtn.style.cssText = this.actionBtnStyle("#ff4444");
          }, 2000);
        }
      });
      backRow.appendChild(deactivateBtn);
    } else if (!details.isActive && this.onActivateDaemon) {
      const activateBtn = document.createElement("button");
      activateBtn.textContent = "Activate";
      activateBtn.style.cssText = this.actionBtnStyle("#ff8c00");
      activateBtn.addEventListener("click", async () => {
        activateBtn.textContent = "Activating...";
        activateBtn.style.opacity = "0.5";
        const ok = await this.onActivateDaemon!(details.id);
        if (ok) {
          this.showList();
        } else {
          activateBtn.textContent = "Failed — needs placement";
          activateBtn.style.color = "#ff4444";
          setTimeout(() => {
            activateBtn.textContent = "Activate";
            activateBtn.style.cssText = this.actionBtnStyle("#ff8c00");
          }, 3000);
        }
      });
      backRow.appendChild(activateBtn);
    }

    wrapper.appendChild(backRow);

    // ─── Desires ───
    const desireSection = document.createElement("div");
    desireSection.style.cssText = "margin-bottom:12px;";

    const directiveRow = document.createElement("div");
    directiveRow.style.cssText = "display:flex;gap:6px;align-items:stretch;";
    const directiveInput = document.createElement("input");
    directiveInput.type = "text";
    directiveInput.placeholder = "Implant desire… e.g. \"go speak to Vinny\"";
    directiveInput.style.cssText = this.inputStyle() + "flex:1;margin:0;";
    directiveRow.appendChild(directiveInput);
    const directiveSendBtn = document.createElement("button");
    directiveSendBtn.textContent = "Implant";
    directiveSendBtn.style.cssText = "padding:4px 14px;background:rgba(68,170,255,0.15);border:1px solid rgba(68,170,255,0.3);color:#44aaff;font-size:12px;cursor:pointer;border-radius:4px;white-space:nowrap;";
    directiveRow.appendChild(directiveSendBtn);
    desireSection.appendChild(directiveRow);

    const desireList = document.createElement("div");
    desireList.style.cssText = "display:flex;flex-direction:column;gap:4px;margin-top:6px;";
    desireSection.appendChild(desireList);

    const renderDesires = (desires: string[]) => {
      desireList.innerHTML = "";
      desires.forEach((desire, idx) => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:6px;padding:4px 8px;background:rgba(68,170,255,0.08);border:1px solid rgba(68,170,255,0.15);border-radius:4px;";
        const text = document.createElement("span");
        text.textContent = desire;
        text.style.cssText = "flex:1;font-size:11px;color:rgba(255,255,255,0.7);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        row.appendChild(text);
        const removeBtn = document.createElement("button");
        removeBtn.innerHTML = "&#x2715;";
        removeBtn.style.cssText = "background:none;border:none;color:rgba(255,100,100,0.7);font-size:13px;cursor:pointer;padding:0 2px;line-height:1;";
        removeBtn.title = "Remove desire";
        removeBtn.addEventListener("click", async () => {
          removeBtn.disabled = true;
          const updated = await this.onRemoveDesire?.(details.id, idx) ?? [];
          renderDesires(updated);
        });
        row.appendChild(removeBtn);
        desireList.appendChild(row);
      });
    };

    directiveSendBtn.addEventListener("click", async () => {
      const text = directiveInput.value.trim();
      if (!text) return;
      directiveSendBtn.disabled = true;
      directiveSendBtn.style.opacity = "0.5";
      const ok = await this.onSendDirective?.(details.id, text);
      if (ok) {
        directiveInput.value = "";
        // Refresh the desire list
        const desires = await this.onFetchDesires?.(details.id) ?? [];
        renderDesires(desires);
      }
      directiveSendBtn.disabled = false;
      directiveSendBtn.style.opacity = "1";
    });
    directiveInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") directiveSendBtn.click();
    });

    // Load existing desires
    this.onFetchDesires?.(details.id).then(desires => renderDesires(desires));

    wrapper.appendChild(desireSection);

    // ─── Tab Bar ───
    const tabBar = document.createElement("div");
    tabBar.style.cssText = "display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:14px;";

    const tabNames = ["Description", "Animations", "Activity"];
    const tabPanels: HTMLDivElement[] = [];
    const tabButtons: HTMLButtonElement[] = [];

    const activeTabStyle = "padding:8px 18px;background:rgba(68,170,255,0.12);border:1px solid rgba(68,170,255,0.3);border-bottom:none;color:#44aaff;font-size:12px;cursor:pointer;font-weight:bold;border-radius:6px 6px 0 0;margin-bottom:-1px;";
    const inactiveTabStyle = "padding:8px 18px;background:none;border:1px solid transparent;border-bottom:none;color:rgba(255,255,255,0.4);font-size:12px;cursor:pointer;font-weight:bold;border-radius:6px 6px 0 0;margin-bottom:-1px;";

    for (let i = 0; i < tabNames.length; i++) {
      const btn = document.createElement("button");
      btn.textContent = tabNames[i];
      btn.style.cssText = i === 0 ? activeTabStyle : inactiveTabStyle;
      btn.addEventListener("click", () => {
        for (let j = 0; j < tabButtons.length; j++) {
          tabButtons[j].style.cssText = j === i ? activeTabStyle : inactiveTabStyle;
          tabPanels[j].style.display = j === i ? "flex" : "none";
        }
      });
      tabButtons.push(btn);
      tabBar.appendChild(btn);
    }
    wrapper.appendChild(tabBar);

    // ─── Tab Content ───
    const tab1 = this.renderDescriptionTab(details);
    const tab2 = this.renderAnimationsTab(details);
    const tab3 = this.renderActivityTab(details);

    tab1.style.display = "flex";
    tab2.style.display = "none";
    tab3.style.display = "none";

    tabPanels.push(tab1, tab2, tab3);
    wrapper.appendChild(tab1);
    wrapper.appendChild(tab2);
    wrapper.appendChild(tab3);

    this.listEl.appendChild(wrapper);
  }

  // ─── Tab 1: Description / Attributes ─────────────────────

  private renderDescriptionTab(details: DaemonFullDetails): HTMLDivElement {
    const tab = document.createElement("div");
    tab.style.cssText = "display:flex;flex-direction:column;gap:14px;";
    const def = details.definition;

    // ─── Basic Info ───
    const basicSection = this.createSection("Basic Info");
    const nameInput = this.createInput("Name", def.name);
    basicSection.appendChild(nameInput.row);
    const descInput = this.createTextarea("Description", def.description || "");
    basicSection.appendChild(descInput.row);
    tab.appendChild(basicSection);

    // ─── Personality ───
    const personalitySection = this.createSection("Personality");
    const traitsInput = this.createInput("Traits (comma-separated)", (def.personality?.traits || []).join(", "));
    personalitySection.appendChild(traitsInput.row);
    const backstoryInput = this.createTextarea("Backstory", def.personality?.backstory || "");
    personalitySection.appendChild(backstoryInput.row);
    const speechInput = this.createInput("Speech Style", def.personality?.speechStyle || "");
    personalitySection.appendChild(speechInput.row);
    const interestsInput = this.createInput("Interests (comma-separated)", (def.personality?.interests || []).join(", "));
    personalitySection.appendChild(interestsInput.row);
    const quirksInput = this.createInput("Quirks (comma-separated)", (def.personality?.quirks || []).join(", "));
    personalitySection.appendChild(quirksInput.row);
    tab.appendChild(personalitySection);

    // ─── Behavior ───
    const behaviorSection = this.createSection("Behavior");
    const typeInput = this.createInput("Type / Role", def.behavior?.type || "");
    behaviorSection.appendChild(typeInput.row);
    const radiusInput = this.createInput("Interaction Radius", String(def.behavior?.interactionRadius ?? 10));
    behaviorSection.appendChild(radiusInput.row);
    const overhearRadiusInput = this.createInput("Overhear Radius", String(def.behavior?.overhearRadius ?? ""));
    behaviorSection.appendChild(overhearRadiusInput.row);
    const greetingInput = this.createInput("Greeting Message", def.behavior?.greetingMessage || "");
    behaviorSection.appendChild(greetingInput.row);
    const farewellInput = this.createInput("Farewell Message", def.behavior?.farewellMessage || "");
    behaviorSection.appendChild(farewellInput.row);
    const roamCheck = this.createCheckbox("Roaming Enabled", def.behavior?.roamingEnabled ?? false);
    behaviorSection.appendChild(roamCheck.row);
    const roamRadiusInput = this.createInput("Roam Radius", String(def.behavior?.roamRadius ?? ""));
    behaviorSection.appendChild(roamRadiusInput.row);
    const converseCheck = this.createCheckbox("Can Converse with Daemons", def.behavior?.canConverseWithDaemons ?? true);
    behaviorSection.appendChild(converseCheck.row);
    const aiModelSelect = this.createSelect("AI Model", [
      { value: "", label: "Default (Haiku)" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
      { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
    ], def.behavior?.aiModel || "");
    behaviorSection.appendChild(aiModelSelect.row);
    tab.appendChild(behaviorSection);

    // ─── Position ───
    const posSection = this.createSection("Position");
    const posXInput = this.createInput("X", String(Math.round(details.position.x)));
    const posZInput = this.createInput("Z", String(Math.round(details.position.z)));
    const posRow = document.createElement("div");
    posRow.style.cssText = "display:flex;gap:8px;";
    posXInput.row.style.flex = "1";
    posZInput.row.style.flex = "1";
    posRow.appendChild(posXInput.row);
    posRow.appendChild(posZInput.row);
    posSection.appendChild(posRow);
    tab.appendChild(posSection);

    // ─── Save / Cancel ───
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText = this.smallBtnStyle();
    cancelBtn.addEventListener("click", () => this.showList());
    btnRow.appendChild(cancelBtn);

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save Changes";
    saveBtn.style.cssText = "padding:6px 20px;background:rgba(68,255,136,0.2);border:1px solid rgba(68,255,136,0.4);color:#44ff88;font-size:12px;cursor:pointer;border-radius:4px;font-weight:bold;";
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";

      const updatedDef: DaemonDefinition = {
        ...def,
        name: nameInput.el.value.trim() || def.name,
        description: descInput.el.value.trim(),
        personality: {
          traits: this.splitComma(traitsInput.el.value),
          backstory: backstoryInput.el.value.trim(),
          speechStyle: speechInput.el.value.trim(),
          interests: this.splitComma(interestsInput.el.value),
          quirks: this.splitComma(quirksInput.el.value),
        },
        behavior: {
          ...def.behavior,
          type: typeInput.el.value.trim() || undefined,
          interactionRadius: parseFloat(radiusInput.el.value) || 10,
          overhearRadius: parseFloat(overhearRadiusInput.el.value) || undefined,
          greetingMessage: greetingInput.el.value.trim() || undefined,
          farewellMessage: farewellInput.el.value.trim() || undefined,
          roamingEnabled: roamCheck.el.checked,
          roamRadius: parseFloat(roamRadiusInput.el.value) || undefined,
          canConverseWithDaemons: converseCheck.el.checked,
          aiModel: aiModelSelect.el.value || undefined,
        },
        position: {
          x: parseFloat(posXInput.el.value) || details.position.x,
          y: details.position.y,
          z: parseFloat(posZInput.el.value) || details.position.z,
        },
      };

      try {
        const ok = await this.onSaveDaemon?.(details.id, updatedDef);
        if (ok) {
          saveBtn.textContent = "Saved!";
          saveBtn.style.borderColor = "rgba(68,255,136,0.6)";
          setTimeout(() => this.showList(), 800);
        } else {
          saveBtn.textContent = "Save Failed";
          saveBtn.style.borderColor = "rgba(255,68,68,0.5)";
          setTimeout(() => {
            saveBtn.textContent = "Save Changes";
            saveBtn.style.borderColor = "rgba(68,255,136,0.4)";
            saveBtn.disabled = false;
          }, 1500);
        }
      } catch {
        saveBtn.textContent = "Save Failed";
        saveBtn.style.borderColor = "rgba(255,68,68,0.5)";
        setTimeout(() => {
          saveBtn.textContent = "Save Changes";
          saveBtn.style.borderColor = "rgba(68,255,136,0.4)";
          saveBtn.disabled = false;
        }, 1500);
      }
    });
    btnRow.appendChild(saveBtn);
    tab.appendChild(btnRow);

    return tab;
  }

  // ─── Tab 2: Animations / Emotes ──────────────────────────

  private renderAnimationsTab(details: DaemonFullDetails): HTMLDivElement {
    const tab = document.createElement("div");
    tab.style.cssText = "display:flex;flex-direction:column;gap:14px;";

    // Character model upload section (always shown)
    const uploadSection = this.createSection("Character Model");
    const uploadRow = document.createElement("div");
    uploadRow.style.cssText = "display:flex;align-items:center;gap:10px;";

    const statusLabel = document.createElement("span");
    statusLabel.style.cssText = "font-size:11px;color:rgba(255,255,255,0.4);flex:1;";
    statusLabel.textContent = details.characterUploadId
      ? `Model: ${details.characterUploadId.slice(0, 8)}...`
      : "No model uploaded";
    uploadRow.appendChild(statusLabel);

    const uploadBtn = document.createElement("button");
    uploadBtn.style.cssText = "padding:4px 12px;font-size:11px;background:rgba(100,180,255,0.15);color:rgba(100,180,255,0.9);border:1px solid rgba(100,180,255,0.3);border-radius:4px;cursor:pointer;";
    uploadBtn.textContent = details.characterUploadId ? "Replace FBX" : "Upload FBX";
    uploadBtn.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".fbx";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        uploadBtn.textContent = "Uploading...";
        uploadBtn.style.opacity = "0.5";
        try {
          const ok = await this.onUploadCharacterModel?.(details.id, file);
          if (ok) {
            statusLabel.textContent = "Uploaded! Reloading...";
            uploadBtn.textContent = "Replace FBX";
          } else {
            statusLabel.textContent = "Upload failed";
            uploadBtn.textContent = details.characterUploadId ? "Replace FBX" : "Upload FBX";
          }
        } catch {
          statusLabel.textContent = "Upload failed";
          uploadBtn.textContent = details.characterUploadId ? "Replace FBX" : "Upload FBX";
        }
        uploadBtn.style.opacity = "1";
      });
      input.click();
    });
    uploadRow.appendChild(uploadBtn);
    uploadSection.appendChild(uploadRow);
    tab.appendChild(uploadSection);

    if (!details.characterUploadId) {
      return tab;
    }

    // Idle animation selector
    const idleSection = this.createSection("Idle Animation Override");
    const idleContent = document.createElement("div");
    idleContent.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:11px">Loading...</div>';
    idleSection.appendChild(idleContent);
    tab.appendChild(idleSection);
    this.loadIdleSelector(details.id, details.behavior?.idleAnimationLabel, idleContent);

    // Full animation panel (locomotion + emotes, with upload/delete)
    if (this.createAnimationPanel) {
      const animPanel = this.createAnimationPanel(details.id);
      animPanel.show();
      tab.appendChild(animPanel.element);
    }

    return tab;
  }

  // ─── Tab 3: Activity / History ───────────────────────────

  private renderActivityTab(details: DaemonFullDetails): HTMLDivElement {
    const tab = document.createElement("div");
    tab.style.cssText = "display:flex;flex-direction:column;gap:14px;";

    // ─── Meta (read-only) ───
    const metaSection = this.createSection("Info");
    const metaText = document.createElement("div");
    metaText.style.cssText = "font-size:11px;color:rgba(255,255,255,0.3);line-height:1.6;";
    metaText.innerHTML = `
      <b>ID:</b> ${this.escapeHtml(details.id)}<br>
      <b>Plot:</b> ${details.plotUuid ? this.escapeHtml(details.plotUuid) : "Global"}<br>
      <b>Character Upload:</b> ${details.characterUploadId || "None"}<br>
      <b>Created:</b> ${new Date(details.createdAt).toLocaleString()}
    `;
    metaSection.appendChild(metaText);
    tab.appendChild(metaSection);

    // ─── Token Usage ───
    const tokenSection = this.createSection("Token Usage (30 days)");
    const tokenContent = document.createElement("div");
    tokenContent.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:11px">Loading...</div>';
    tokenSection.appendChild(tokenContent);
    tab.appendChild(tokenSection);
    this.loadTokenSummary(details.id, tokenContent);

    // ─── Activity Log ───
    const logSection = this.createSection("Activity Log");
    const logContent = document.createElement("div");
    logContent.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:11px">Loading...</div>';
    logSection.appendChild(logContent);
    tab.appendChild(logSection);
    this.loadDetailedActivityLog(details.id, logContent);

    return tab;
  }

  // ─── Activity Tab Loaders ────────────────────────────────

  private async loadTokenSummary(daemonId: string, container: HTMLElement): Promise<void> {
    try {
      const summary = await this.onFetchTokenSummary?.(daemonId);
      container.innerHTML = "";

      if (!summary || summary.totalCalls === 0) {
        container.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:11px">No token usage recorded</div>';
        return;
      }

      const grid = document.createElement("div");
      grid.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;";

      const statBox = (label: string, value: string, color: string) => {
        const box = document.createElement("div");
        box.style.cssText = "background:rgba(255,255,255,0.04);border-radius:4px;padding:8px;text-align:center;";
        box.innerHTML = `<div style="font-size:16px;font-weight:bold;color:${color}">${value}</div><div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:2px">${label}</div>`;
        return box;
      };

      grid.appendChild(statBox("Total Calls", String(summary.totalCalls), "#44aaff"));
      grid.appendChild(statBox("Tokens In", this.formatNumber(summary.totalTokensIn), "#44ff88"));
      grid.appendChild(statBox("Tokens Out", this.formatNumber(summary.totalTokensOut), "#ffaa44"));
      container.appendChild(grid);

      // By-type breakdown
      if (summary.byType && Object.keys(summary.byType).length > 0) {
        const typeLabel = document.createElement("div");
        typeLabel.textContent = "By Type";
        typeLabel.style.cssText = "font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;font-weight:bold;margin-bottom:4px;";
        container.appendChild(typeLabel);

        for (const [type, stats] of Object.entries(summary.byType)) {
          const row = document.createElement("div");
          row.style.cssText = "display:flex;justify-content:space-between;font-size:11px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.04);";
          row.innerHTML = `<span style="color:rgba(255,255,255,0.5)">${this.escapeHtml(type)}</span><span style="color:rgba(255,255,255,0.3)">${stats.calls} calls · ${this.formatNumber(stats.tokensIn + stats.tokensOut)} tokens</span>`;
          container.appendChild(row);
        }
      }
    } catch {
      container.innerHTML = '<div style="color:#ff4444;font-size:11px">Failed to load token summary</div>';
    }
  }

  private async loadDetailedActivityLog(daemonId: string, container: HTMLElement): Promise<void> {
    try {
      const result = await this.onFetchActivityLog?.(daemonId, 50);
      container.innerHTML = "";

      if (!result || result.entries.length === 0) {
        container.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:11px">No activity recorded</div>';
        return;
      }

      const typeColors: Record<string, string> = {
        conversation_turn: "#aa44ff",
        conversation_summary: "#44ccff",
        manifest_amendment: "#ff8844",
        manifest_recompile: "#ffcc44",
        behavior_event: "#44ff88",
        inter_daemon_event: "#ff44aa",
        inference_failure: "#ff4444",
        budget_warning: "#ffaa00",
      };

      for (const entry of result.entries) {
        const row = document.createElement("div");
        row.style.cssText = "padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);";

        const header = document.createElement("div");
        header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;";

        const typeColor = typeColors[entry.type] || "#888";
        const typeBadge = document.createElement("span");
        typeBadge.textContent = entry.type.replace(/_/g, " ");
        typeBadge.style.cssText = `font-size:10px;padding:1px 6px;border-radius:3px;background:${typeColor}20;color:${typeColor};font-weight:bold;text-transform:uppercase;`;

        const timeEl = document.createElement("span");
        timeEl.textContent = this.formatAge(entry.timestamp);
        timeEl.style.cssText = "font-size:10px;color:rgba(255,255,255,0.2);";

        header.appendChild(typeBadge);
        header.appendChild(timeEl);
        row.appendChild(header);

        // Render payload summary based on type
        const payloadEl = document.createElement("div");
        payloadEl.style.cssText = "font-size:11px;color:rgba(255,255,255,0.5);margin-top:2px;";
        payloadEl.innerHTML = this.renderLogPayload(entry.type, entry.payload);
        row.appendChild(payloadEl);

        // Token info if present
        if (entry.tokensIn || entry.tokensOut) {
          const tokenEl = document.createElement("div");
          tokenEl.style.cssText = "font-size:10px;color:rgba(255,255,255,0.2);margin-top:2px;";
          const parts: string[] = [];
          if (entry.modelUsed) parts.push(entry.modelUsed);
          if (entry.tokensIn) parts.push(`${entry.tokensIn} in`);
          if (entry.tokensOut) parts.push(`${entry.tokensOut} out`);
          if (entry.inferenceLatencyMs) parts.push(`${entry.inferenceLatencyMs}ms`);
          tokenEl.textContent = parts.join(" · ");
          row.appendChild(tokenEl);
        }

        container.appendChild(row);
      }

      // Load more button if there's a next cursor
      if (result.nextCursor) {
        const loadMoreBtn = document.createElement("button");
        loadMoreBtn.textContent = `Load More (${result.total - result.entries.length} remaining)`;
        loadMoreBtn.style.cssText = this.smallBtnStyle() + "width:100%;margin-top:8px;";
        loadMoreBtn.addEventListener("click", async () => {
          loadMoreBtn.disabled = true;
          loadMoreBtn.textContent = "Loading...";
          try {
            const more = await this.onFetchActivityLog?.(daemonId, 50, result.nextCursor);
            if (more && more.entries.length > 0) {
              loadMoreBtn.remove();
              // Recursively append — reuse same container
              const tempContainer = document.createElement("div");
              result.entries.push(...more.entries);
              result.nextCursor = more.nextCursor;
              // Re-render just the new entries
              for (const entry of more.entries) {
                const entryRow = container.querySelector(`[data-entry-id="${entry.entryId}"]`);
                if (entryRow) continue; // skip duplicates
                // Clone the rendering logic inline
                this.appendLogEntry(container, entry, typeColors);
              }
              if (more.nextCursor) {
                container.appendChild(loadMoreBtn);
                loadMoreBtn.disabled = false;
                loadMoreBtn.textContent = `Load More`;
              }
            }
          } catch {
            loadMoreBtn.textContent = "Load failed";
          }
        });
        container.appendChild(loadMoreBtn);
      }
    } catch {
      container.innerHTML = '<div style="color:#ff4444;font-size:11px">Failed to load activity log</div>';
    }
  }

  private appendLogEntry(
    container: HTMLElement,
    entry: { entryId: string; type: string; timestamp: number; tokensIn?: number; tokensOut?: number; modelUsed?: string; inferenceLatencyMs?: number; payload: Record<string, unknown> },
    typeColors: Record<string, string>,
  ): void {
    const row = document.createElement("div");
    row.style.cssText = "padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);";
    row.setAttribute("data-entry-id", entry.entryId);

    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;";
    const typeColor = typeColors[entry.type] || "#888";
    header.innerHTML = `<span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${typeColor}20;color:${typeColor};font-weight:bold;text-transform:uppercase;">${entry.type.replace(/_/g, " ")}</span><span style="font-size:10px;color:rgba(255,255,255,0.2)">${this.formatAge(entry.timestamp)}</span>`;
    row.appendChild(header);

    const payloadEl = document.createElement("div");
    payloadEl.style.cssText = "font-size:11px;color:rgba(255,255,255,0.5);margin-top:2px;";
    payloadEl.innerHTML = this.renderLogPayload(entry.type, entry.payload);
    row.appendChild(payloadEl);

    if (entry.tokensIn || entry.tokensOut) {
      const tokenEl = document.createElement("div");
      tokenEl.style.cssText = "font-size:10px;color:rgba(255,255,255,0.2);margin-top:2px;";
      const parts: string[] = [];
      if (entry.modelUsed) parts.push(entry.modelUsed);
      if (entry.tokensIn) parts.push(`${entry.tokensIn} in`);
      if (entry.tokensOut) parts.push(`${entry.tokensOut} out`);
      if (entry.inferenceLatencyMs) parts.push(`${entry.inferenceLatencyMs}ms`);
      tokenEl.textContent = parts.join(" · ");
      row.appendChild(tokenEl);
    }

    container.appendChild(row);
  }

  private renderLogPayload(type: string, payload: Record<string, unknown>): string {
    switch (type) {
      case "conversation_turn": {
        const speech = payload.speech ? this.escapeHtml(String(payload.speech)) : "";
        const speaker = payload.speakerType === "daemon" ? "Daemon" : payload.speakerType === "visitor" ? "Visitor" : "Self";
        const emote = payload.emoteFired ? ` <span style="color:#ffaa00">[${this.escapeHtml(String(payload.emoteFired))}]</span>` : "";
        return `<b>${speaker}:</b> ${speech}${emote}`;
      }
      case "conversation_summary": {
        const summary = payload.impressionGenerated ? this.escapeHtml(String(payload.impressionGenerated)) : "No summary";
        const turns = payload.turnCount ?? "?";
        return `${turns} turns — ${summary}`;
      }
      case "manifest_amendment": {
        const decision = payload.validatorDecision === "accepted"
          ? '<span style="color:#44ff88">accepted</span>'
          : '<span style="color:#ff4444">rejected</span>';
        return `<b>${this.escapeHtml(String(payload.traitName || ""))}</b>: ${this.escapeHtml(String(payload.previousValue || ""))} → ${this.escapeHtml(String(payload.proposedValue || ""))} (${decision})`;
      }
      case "manifest_recompile": {
        return `v${payload.previousVersion} → v${payload.newVersion} (${payload.previousTokenCount} → ${payload.newTokenCount} tokens)`;
      }
      case "behavior_event": {
        const eventType = payload.eventType ? this.escapeHtml(String(payload.eventType)) : "unknown";
        const result = payload.result ? ` — ${this.escapeHtml(String(payload.result))}` : "";
        return `${eventType}${result}`;
      }
      case "inter_daemon_event": {
        const other = payload.otherDaemonName ? this.escapeHtml(String(payload.otherDaemonName)) : "unknown";
        const speech = payload.speech ? this.escapeHtml(String(payload.speech)) : "";
        return `with <b>${other}</b>: ${speech}`;
      }
      case "inference_failure": {
        return `<span style="color:#ff4444">${this.escapeHtml(String(payload.failureType || "unknown"))}</span> — fallback: ${this.escapeHtml(String(payload.fallbackUsed || "none"))}`;
      }
      case "budget_warning": {
        return `${this.escapeHtml(String(payload.warningType || ""))} — ${payload.currentUsage}/${payload.limit}`;
      }
      default:
        return `<span style="color:rgba(255,255,255,0.3)">${this.escapeHtml(JSON.stringify(payload).slice(0, 120))}</span>`;
    }
  }

  private formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  // ─── Form Helpers ──────────────────────────────────────────

  private createSection(title: string): HTMLDivElement {
    const section = document.createElement("div");
    section.style.cssText = "background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:10px 12px;";
    const heading = document.createElement("div");
    heading.textContent = title;
    heading.style.cssText = "font-size:12px;font-weight:bold;color:rgba(255,255,255,0.6);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;";
    section.appendChild(heading);
    return section;
  }

  private createInput(label: string, value: string): { row: HTMLDivElement; el: HTMLInputElement } {
    const row = document.createElement("div");
    row.style.cssText = "margin-bottom:6px;";
    const lbl = document.createElement("label");
    lbl.textContent = label;
    lbl.style.cssText = this.labelStyle();
    row.appendChild(lbl);
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.style.cssText = this.inputStyle();
    row.appendChild(input);
    return { row, el: input };
  }

  private createTextarea(label: string, value: string): { row: HTMLDivElement; el: HTMLTextAreaElement } {
    const row = document.createElement("div");
    row.style.cssText = "margin-bottom:6px;";
    const lbl = document.createElement("label");
    lbl.textContent = label;
    lbl.style.cssText = this.labelStyle();
    row.appendChild(lbl);
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.cssText = this.textareaStyle();
    textarea.rows = 3;
    row.appendChild(textarea);
    return { row, el: textarea };
  }

  private createCheckbox(label: string, checked: boolean): { row: HTMLDivElement; el: HTMLInputElement } {
    const row = document.createElement("div");
    row.style.cssText = "margin-bottom:6px;display:flex;align-items:center;gap:8px;";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.style.cssText = "cursor:pointer;";
    row.appendChild(input);
    const lbl = document.createElement("span");
    lbl.textContent = label;
    lbl.style.cssText = "font-size:12px;color:rgba(255,255,255,0.6);cursor:pointer;";
    lbl.addEventListener("click", () => { input.checked = !input.checked; });
    row.appendChild(lbl);
    return { row, el: input };
  }

  private createSelect(label: string, options: Array<{ value: string; label: string }>, selected: string): { row: HTMLDivElement; el: HTMLSelectElement } {
    const row = document.createElement("div");
    row.style.cssText = "margin-bottom:6px;";
    const lbl = document.createElement("label");
    lbl.textContent = label;
    lbl.style.cssText = this.labelStyle();
    row.appendChild(lbl);
    const select = document.createElement("select");
    select.style.cssText = this.inputStyle() + "cursor:pointer;";
    for (const opt of options) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === selected) o.selected = true;
      select.appendChild(o);
    }
    row.appendChild(select);
    return { row, el: select };
  }

  private splitComma(value: string): string[] {
    return value.split(",").map(s => s.trim()).filter(Boolean);
  }

  // ─── Emotes Select ─────────────────────────────────────────

  private async loadEmotesForSelect(
    daemonId: string,
    currentLabel: string | undefined,
    select: HTMLSelectElement,
  ): Promise<void> {
    try {
      const emotes = await this.onFetchEmotes?.(daemonId) || [];
      select.innerHTML = "";
      select.disabled = false;

      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "(default)";
      select.appendChild(noneOpt);

      for (const emote of emotes) {
        const opt = document.createElement("option");
        opt.value = emote.label;
        opt.textContent = emote.label;
        if (emote.label === currentLabel) opt.selected = true;
        select.appendChild(opt);
      }

      if (currentLabel && !emotes.find(e => e.label === currentLabel)) {
        select.value = "";
      }

      select.addEventListener("change", async () => {
        const label = select.value;
        select.disabled = true;
        try {
          await this.onSetIdleAnimation?.(daemonId, label);
          select.style.borderColor = "rgba(68,255,136,0.5)";
          setTimeout(() => { select.style.borderColor = "rgba(255,255,255,0.15)"; }, 1000);
        } catch {
          select.style.borderColor = "rgba(255,68,68,0.5)";
        } finally {
          select.disabled = false;
        }
      });
    } catch {
      select.innerHTML = "";
      const errOpt = document.createElement("option");
      errOpt.textContent = "Error loading";
      select.appendChild(errOpt);
    }
  }

  // ─── Idle Selector ─────────────────────────────────────────

  private async loadIdleSelector(
    daemonId: string,
    currentIdleLabel: string | undefined,
    container: HTMLElement,
  ): Promise<void> {
    try {
      const emotes = await this.onFetchEmotes?.(daemonId) || [];
      container.innerHTML = "";

      const hint = document.createElement("div");
      hint.textContent = "Pick an emote animation to play instead of the default idle pose.";
      hint.style.cssText = "font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:6px;";
      container.appendChild(hint);

      const idleSelect = document.createElement("select");
      idleSelect.style.cssText = this.inputStyle() + "cursor:pointer;";

      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "(default idle)";
      idleSelect.appendChild(noneOpt);

      for (const emote of emotes) {
        const opt = document.createElement("option");
        opt.value = emote.label;
        opt.textContent = emote.label;
        if (emote.label === currentIdleLabel) opt.selected = true;
        idleSelect.appendChild(opt);
      }

      if (emotes.length === 0) {
        const noEmotes = document.createElement("option");
        noEmotes.textContent = "No emotes uploaded yet";
        noEmotes.disabled = true;
        idleSelect.appendChild(noEmotes);
        idleSelect.disabled = true;
      }

      const statusSpan = document.createElement("span");
      statusSpan.style.cssText = "font-size:10px;margin-left:8px;";

      idleSelect.addEventListener("change", async () => {
        idleSelect.disabled = true;
        statusSpan.textContent = "Saving...";
        statusSpan.style.color = "rgba(255,255,255,0.4)";
        try {
          await this.onSetIdleAnimation?.(daemonId, idleSelect.value);
          statusSpan.textContent = "Saved";
          statusSpan.style.color = "#44ff88";
          setTimeout(() => { statusSpan.textContent = ""; }, 2000);
        } catch {
          statusSpan.textContent = "Failed";
          statusSpan.style.color = "#ff4444";
        } finally {
          idleSelect.disabled = false;
        }
      });

      container.appendChild(idleSelect);
      container.appendChild(statusSpan);
    } catch {
      container.innerHTML = '<div style="color:#ff4444;font-size:12px">Failed to load idle options.</div>';
    }
  }

  // ─── Activity Log ──────────────────────────────────────────

  private renderActivityLog(
    container: HTMLElement,
    activity: Array<{ type: string; content: string; targetName?: string; timestamp: number }>,
  ): void {
    container.innerHTML = "";
    if (activity.length === 0) {
      container.innerHTML = '<div style="color:rgba(255,255,255,0.3);padding:4px 0">No recent activity</div>';
      return;
    }

    const typeColors: Record<string, string> = {
      conversation: "#aa44ff",
      emote: "#ffaa00",
      chat: "#44ff88",
      greeting: "#44aaff",
      mood_change: "#ffcc44",
    };

    for (const entry of activity.slice().reverse().slice(0, 50)) {
      const row = document.createElement("div");
      row.style.cssText = "padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04);";

      const age = this.formatAge(entry.timestamp);
      const color = typeColors[entry.type] || "#888";

      row.innerHTML = `
        <span style="color:rgba(255,255,255,0.2);font-size:10px">${age}</span>
        <span style="color:${color};font-size:10px;font-weight:bold">[${entry.type}]</span>
        <span style="color:rgba(255,255,255,0.6)">${this.escapeHtml(entry.content)}</span>
        ${entry.targetName ? `<span style="color:rgba(255,255,255,0.25)">with ${this.escapeHtml(entry.targetName)}</span>` : ""}
      `;
      container.appendChild(row);
    }
  }

  private formatAge(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = String(text || "");
    return div.innerHTML;
  }
}
