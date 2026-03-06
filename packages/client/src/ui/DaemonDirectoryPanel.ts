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
  createAnimationPanel: ((daemonId: string) => AnimationPanel) | null = null;

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
      background: rgba(5, 5, 10, 0.97);
      border: 1px solid rgba(68, 170, 255, 0.3);
      border-radius: 10px;
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
    this.scrollArea.style.cssText = "overflow-y:auto;max-height:calc(85vh - 60px);padding:12px 20px;";

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
    const daemons = this.onFetchDaemons?.() || [];
    this.entries = daemons.map(d => ({ daemon: d }));
    this.statusEl.textContent = `${daemons.length} daemon${daemons.length !== 1 ? "s" : ""} active`;
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

    if (d.definition.behavior.type) {
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
    const def = details.definition;

    const form = document.createElement("div");
    form.style.cssText = "display:flex;flex-direction:column;gap:14px;";

    // Back button
    const backRow = document.createElement("div");
    const backBtn = document.createElement("button");
    backBtn.textContent = "< Back to List";
    backBtn.style.cssText = this.smallBtnStyle();
    backBtn.addEventListener("click", () => this.showList());
    backRow.appendChild(backBtn);
    form.appendChild(backRow);

    // ─── Basic Info ───
    const basicSection = this.createSection("Basic Info");

    const nameInput = this.createInput("Name", def.name);
    basicSection.appendChild(nameInput.row);

    const descInput = this.createTextarea("Description", def.description || "");
    basicSection.appendChild(descInput.row);

    form.appendChild(basicSection);

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

    form.appendChild(personalitySection);

    // ─── Behavior ───
    const behaviorSection = this.createSection("Behavior");

    const typeInput = this.createInput("Type / Role", def.behavior?.type || "");
    behaviorSection.appendChild(typeInput.row);

    const radiusInput = this.createInput("Interaction Radius", String(def.behavior?.interactionRadius ?? 10));
    behaviorSection.appendChild(radiusInput.row);

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

    form.appendChild(behaviorSection);

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
    form.appendChild(posSection);

    // ─── Animations ───
    if (details.characterUploadId) {
      // Idle animation selector (daemon-specific: picks which emote to use as idle)
      const idleSection = this.createSection("Idle Animation Override");
      const idleContent = document.createElement("div");
      idleContent.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:11px">Loading...</div>';
      idleSection.appendChild(idleContent);
      form.appendChild(idleSection);
      this.loadIdleSelector(details.id, details.behavior?.idleAnimationLabel, idleContent);

      // Full animation panel (locomotion + emotes, with upload/delete)
      if (this.createAnimationPanel) {
        const animPanel = this.createAnimationPanel(details.id);
        animPanel.show();
        form.appendChild(animPanel.element);
      }
    }

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
    form.appendChild(metaSection);

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
          greetingMessage: greetingInput.el.value.trim() || undefined,
          farewellMessage: farewellInput.el.value.trim() || undefined,
          roamingEnabled: roamCheck.el.checked,
          roamRadius: parseFloat(roamRadiusInput.el.value) || undefined,
          canConverseWithDaemons: converseCheck.el.checked,
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

    form.appendChild(btnRow);
    this.listEl.appendChild(form);
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
