import type { ExpandedManifestFields, DaemonAssetUpload } from "@the-street/shared";

interface DraftState {
  draftId: string;
  characterUploadId?: string;
  emoteUploadIds: string[];
  adminPrompt?: string;
  expandedFields?: ExpandedManifestFields;
  expansionStatus: "none" | "processing" | "ready" | "failed";
  maxConversationTurns: number;
  maxDailyCalls: number;
  rememberVisitors: boolean;
  uploads: DaemonAssetUpload[];
}

/**
 * Daemon creation wizard panel. Full draft-based flow:
 * 1. Upload character FBX
 * 2. Upload emote FBX files with labels
 * 3. Write prompt describing the daemon
 * 4. Trigger expansion, review/edit expanded fields
 * 5. Set budget params
 * 6. Review compiled token count
 * 7. Finalize
 */
export class DaemonCreationPanel {
  private container: HTMLDivElement;
  private contentArea: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private visible = false;
  private draft: DraftState | null = null;

  // Callbacks wired in main.ts
  onCreateDraft: (() => Promise<{ id: string }>) | null = null;
  onLoadDraft: ((id: string) => Promise<DraftState>) | null = null;
  onUpdateDraft: ((id: string, fields: Record<string, unknown>) => Promise<void>) | null = null;
  onUploadCharacter: ((draftId: string, file: File) => Promise<{ uploadId: string; filename: string }>) | null = null;
  onUploadEmote: ((draftId: string, file: File, label: string) => Promise<{ uploadId: string; label: string; filename: string }>) | null = null;
  onExpand: ((draftId: string, prompt?: string, clearedFields?: string[]) => Promise<{ expandedFields: ExpandedManifestFields }>) | null = null;
  onFinalize: ((draftId: string) => Promise<{ daemonId: string; name: string; compiledTokenCount: number }>) | null = null;
  onAbandon: ((draftId: string) => Promise<void>) | null = null;

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "daemon-creation-panel";
    this.container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 680px;
      max-height: 85vh;
      background: rgba(10, 10, 15, 0.95);
      border: 1px solid rgba(255, 140, 0, 0.4);
      border-radius: 12px;
      z-index: 210;
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
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: space-between;
    `;
    const title = document.createElement("div");
    title.innerHTML = '<span style="color:#ff8c00;font-weight:bold">DAEMON</span> Creation';
    title.style.cssText = "font-size: 16px; font-weight: bold;";
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "\u00D7";
    closeBtn.style.cssText = `
      background: none; border: none;
      color: rgba(255, 255, 255, 0.6);
      font-size: 22px; cursor: pointer; padding: 0 4px;
    `;
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);
    this.container.appendChild(header);

    // Content area (scrollable)
    this.contentArea = document.createElement("div");
    this.contentArea.style.cssText = `
      padding: 16px 20px;
      overflow-y: auto;
      max-height: calc(85vh - 100px);
    `;
    this.container.appendChild(this.contentArea);

    // Status bar
    this.statusEl = document.createElement("div");
    this.statusEl.style.cssText = `
      padding: 8px 20px;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.3);
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    `;
    this.container.appendChild(this.statusEl);

    document.body.appendChild(this.container);
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.container.style.display = "block";
    if (document.pointerLockElement) document.exitPointerLock();
    if (!this.draft) {
      this.renderStartScreen();
    }
  }

  hide(): void {
    this.visible = false;
    this.container.style.display = "none";
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  private setStatus(msg: string, isError = false): void {
    this.statusEl.textContent = msg;
    this.statusEl.style.color = isError ? "#ff4444" : "rgba(255, 255, 255, 0.3)";
  }

  private clear(): void {
    this.contentArea.innerHTML = "";
  }

  // --- Screens ---

  private renderStartScreen(): void {
    this.clear();
    const wrap = document.createElement("div");
    wrap.style.cssText = "text-align: center; padding: 40px 0;";

    const desc = document.createElement("p");
    desc.textContent = "Create a new daemon NPC with custom character model, emotes, and AI personality.";
    desc.style.cssText = "color: rgba(255,255,255,0.6); font-size: 13px; margin-bottom: 24px;";
    wrap.appendChild(desc);

    const startBtn = this.makeButton("New Daemon Draft", "#ff8c00");
    startBtn.addEventListener("click", () => this.startNewDraft());
    wrap.appendChild(startBtn);

    this.contentArea.appendChild(wrap);
  }

  private async startNewDraft(): Promise<void> {
    if (!this.onCreateDraft) return;
    this.setStatus("Creating draft...");
    try {
      const { id } = await this.onCreateDraft();
      await this.loadDraft(id);
    } catch (err) {
      this.setStatus(`Failed: ${err instanceof Error ? err.message : "Unknown error"}`, true);
    }
  }

  private async loadDraft(id: string): Promise<void> {
    if (!this.onLoadDraft) return;
    this.setStatus("Loading draft...");
    try {
      this.draft = await this.onLoadDraft(id);
      this.renderDraftEditor();
      this.setStatus(`Draft ${id.slice(0, 8)}...`);
    } catch (err) {
      this.setStatus(`Failed: ${err instanceof Error ? err.message : "Unknown error"}`, true);
    }
  }

  private renderDraftEditor(): void {
    this.clear();
    if (!this.draft) return;

    // Section 1: Character Upload
    this.renderSection("1. Character Model", () => this.renderCharacterUpload());

    // Section 2: Emote Uploads
    this.renderSection("2. Emote Animations", () => this.renderEmoteUploads());

    // Section 3: Prompt
    this.renderSection("3. Describe Your Daemon", () => this.renderPromptSection());

    // Section 4: Expanded Fields (visible after expansion)
    if (this.draft.expansionStatus !== "none") {
      this.renderSection("4. Expanded Personality", () => this.renderExpandedFields());
    }

    // Section 5: Budget Params
    this.renderSection("5. Budget Parameters", () => this.renderBudgetParams());

    // Section 6: Finalize
    this.renderSection("6. Finalize", () => this.renderFinalizeSection());
  }

  private renderSection(title: string, renderContent: () => HTMLElement): void {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 20px;";

    const heading = document.createElement("div");
    heading.textContent = title;
    heading.style.cssText = `
      font-size: 13px; font-weight: bold;
      color: rgba(255, 140, 0, 0.8);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    section.appendChild(heading);
    section.appendChild(renderContent());
    this.contentArea.appendChild(section);
  }

  // --- Character Upload ---

  private renderCharacterUpload(): HTMLElement {
    const wrap = document.createElement("div");
    const charUpload = this.draft?.uploads.find(u => u.uploadType === "character");

    if (charUpload) {
      const info = document.createElement("div");
      info.style.cssText = "display: flex; align-items: center; gap: 8px;";
      info.innerHTML = `
        <span style="color: #44ff88;">\u2713</span>
        <span>${this.esc(charUpload.fbxFilename)}</span>
        <span style="color: rgba(255,255,255,0.4); font-size: 11px;">${charUpload.conversionStatus}</span>
      `;
      wrap.appendChild(info);
    }

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".fbx";
    fileInput.style.display = "none";
    wrap.appendChild(fileInput);

    const uploadBtn = this.makeButton(charUpload ? "Replace Character FBX" : "Upload Character FBX", "#4488ff");
    uploadBtn.addEventListener("click", () => fileInput.click());
    wrap.appendChild(uploadBtn);

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file || !this.draft || !this.onUploadCharacter) return;
      fileInput.value = "";
      uploadBtn.disabled = true;
      uploadBtn.textContent = "Uploading...";
      try {
        const result = await this.onUploadCharacter(this.draft.draftId, file);
        this.draft.characterUploadId = result.uploadId;
        await this.loadDraft(this.draft.draftId);
      } catch (err) {
        this.setStatus(`Upload failed: ${err instanceof Error ? err.message : "Unknown"}`, true);
        uploadBtn.disabled = false;
        uploadBtn.textContent = charUpload ? "Replace Character FBX" : "Upload Character FBX";
      }
    });

    return wrap;
  }

  // --- Emote Uploads ---

  private renderEmoteUploads(): HTMLElement {
    const wrap = document.createElement("div");
    const emoteUploads = this.draft?.uploads.filter(u => u.uploadType === "emote") || [];

    if (emoteUploads.length > 0) {
      const list = document.createElement("div");
      list.style.cssText = "margin-bottom: 8px;";
      for (const emote of emoteUploads) {
        const row = document.createElement("div");
        row.style.cssText = "display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px;";
        row.innerHTML = `
          <span style="color: #44ff88;">\u2713</span>
          <span style="color: #ff8c00; font-weight: bold;">${this.esc(emote.label || "unlabeled")}</span>
          <span style="color: rgba(255,255,255,0.5);">${this.esc(emote.fbxFilename)}</span>
          <span style="color: rgba(255,255,255,0.3); font-size: 11px;">${emote.conversionStatus}</span>
        `;
        list.appendChild(row);
      }
      wrap.appendChild(list);
    }

    // Add emote form
    const addRow = document.createElement("div");
    addRow.style.cssText = "display: flex; gap: 8px; align-items: center;";

    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.placeholder = "Emote label (e.g. wave, dance)";
    labelInput.style.cssText = this.inputStyle() + "flex: 1;";
    labelInput.addEventListener("keydown", (e) => e.stopPropagation());
    addRow.appendChild(labelInput);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".fbx";
    fileInput.style.display = "none";
    wrap.appendChild(fileInput);

    const addBtn = this.makeButton("+ Add Emote FBX", "#4488ff");
    addBtn.style.cssText += "font-size: 12px; padding: 6px 12px;";
    addBtn.addEventListener("click", () => {
      if (!labelInput.value.trim()) {
        this.setStatus("Enter an emote label first", true);
        return;
      }
      fileInput.click();
    });
    addRow.appendChild(addBtn);
    wrap.appendChild(addRow);

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      const label = labelInput.value.trim();
      if (!file || !label || !this.draft || !this.onUploadEmote) return;
      fileInput.value = "";
      addBtn.disabled = true;
      addBtn.textContent = "Uploading...";
      try {
        await this.onUploadEmote(this.draft.draftId, file, label);
        labelInput.value = "";
        await this.loadDraft(this.draft.draftId);
      } catch (err) {
        this.setStatus(`Emote upload failed: ${err instanceof Error ? err.message : "Unknown"}`, true);
        addBtn.disabled = false;
        addBtn.textContent = "+ Add Emote FBX";
      }
    });

    return wrap;
  }

  // --- Prompt Section ---

  private renderPromptSection(): HTMLElement {
    const wrap = document.createElement("div");

    const textarea = document.createElement("textarea");
    textarea.placeholder = "Describe this daemon's personality, appearance, behavior...";
    textarea.value = this.draft?.adminPrompt || "";
    textarea.style.cssText = `
      width: 100%; height: 100px; padding: 10px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px; color: white;
      font-family: system-ui, sans-serif;
      font-size: 13px; outline: none;
      box-sizing: border-box; resize: vertical;
    `;
    textarea.addEventListener("keydown", (e) => e.stopPropagation());
    wrap.appendChild(textarea);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display: flex; gap: 8px; margin-top: 8px;";

    const saveBtn = this.makeButton("Save Prompt", "rgba(255,255,255,0.3)");
    saveBtn.addEventListener("click", async () => {
      if (!this.draft || !this.onUpdateDraft) return;
      saveBtn.disabled = true;
      try {
        await this.onUpdateDraft(this.draft.draftId, { adminPrompt: textarea.value });
        this.draft.adminPrompt = textarea.value;
        this.setStatus("Prompt saved");
      } catch (err) {
        this.setStatus(`Save failed: ${err instanceof Error ? err.message : "Unknown"}`, true);
      }
      saveBtn.disabled = false;
    });
    btnRow.appendChild(saveBtn);

    const expandBtn = this.makeButton(
      this.draft?.expansionStatus === "ready" ? "Re-expand with AI" : "Expand with AI",
      "#ff8c00",
    );
    expandBtn.addEventListener("click", async () => {
      if (!this.draft || !this.onExpand) return;
      expandBtn.disabled = true;
      expandBtn.textContent = "Expanding...";
      this.setStatus("AI is expanding personality fields...");
      try {
        const result = await this.onExpand(this.draft.draftId, textarea.value);
        this.draft.expandedFields = result.expandedFields;
        this.draft.expansionStatus = "ready";
        this.renderDraftEditor();
        this.setStatus("Expansion complete");
      } catch (err) {
        this.setStatus(`Expansion failed: ${err instanceof Error ? err.message : "Unknown"}`, true);
        expandBtn.disabled = false;
        expandBtn.textContent = "Expand with AI";
      }
    });
    btnRow.appendChild(expandBtn);

    wrap.appendChild(btnRow);
    return wrap;
  }

  // --- Expanded Fields ---

  private renderExpandedFields(): HTMLElement {
    const wrap = document.createElement("div");
    const fields = this.draft?.expandedFields;

    if (this.draft?.expansionStatus === "processing") {
      wrap.innerHTML = '<div style="color: rgba(255,255,255,0.5); font-style: italic;">Expansion in progress...</div>';
      return wrap;
    }

    if (this.draft?.expansionStatus === "failed") {
      wrap.innerHTML = '<div style="color: #ff4444;">Expansion failed. Try re-expanding.</div>';
      return wrap;
    }

    if (!fields) return wrap;

    // Editable fields
    const nameInput = this.makeField("Name", fields.name, (v) => { fields.name = v; });
    wrap.appendChild(nameInput);

    const voiceInput = this.makeField("Voice Description", fields.voiceDescription, (v) => { fields.voiceDescription = v; });
    wrap.appendChild(voiceInput);

    const backstoryArea = this.makeTextarea("Backstory", fields.backstory, (v) => { fields.backstory = v; });
    wrap.appendChild(backstoryArea);

    const interestsInput = this.makeField("Interests (comma-separated)", fields.interests.join(", "), (v) => {
      fields.interests = v.split(",").map(s => s.trim()).filter(Boolean);
    });
    wrap.appendChild(interestsInput);

    const dislikesInput = this.makeField("Dislikes (comma-separated)", fields.dislikes.join(", "), (v) => {
      fields.dislikes = v.split(",").map(s => s.trim()).filter(Boolean);
    });
    wrap.appendChild(dislikesInput);

    // Behavior preferences
    const behaviorHeading = document.createElement("div");
    behaviorHeading.textContent = "Behavior Preferences";
    behaviorHeading.style.cssText = "font-size: 12px; color: rgba(255,255,255,0.5); margin: 12px 0 6px; text-transform: uppercase;";
    wrap.appendChild(behaviorHeading);

    const bp = fields.behaviorPreferences;

    const crowdRow = this.makeSlider("Crowd Affinity", bp.crowdAffinity, 0, 1, 0.1, (v) => { bp.crowdAffinity = v; });
    wrap.appendChild(crowdRow);

    const terrRow = this.makeSlider("Territoriality", bp.territoriality, 0, 1, 0.1, (v) => { bp.territoriality = v; });
    wrap.appendChild(terrRow);

    const convLenRow = this.makeSelect("Conversation Length", bp.conversationLength,
      ["brief", "moderate", "extended"], (v) => { bp.conversationLength = v as "brief" | "moderate" | "extended"; });
    wrap.appendChild(convLenRow);

    const initRow = this.makeCheckbox("Initiates Conversation", bp.initiatesConversation, (v) => { bp.initiatesConversation = v; });
    wrap.appendChild(initRow);

    // Expansion notes (read-only)
    if (fields.expansionNotes) {
      const notesHeading = document.createElement("div");
      notesHeading.textContent = "Expansion Notes (AI Reasoning)";
      notesHeading.style.cssText = "font-size: 12px; color: rgba(255,255,255,0.5); margin: 12px 0 6px; text-transform: uppercase;";
      wrap.appendChild(notesHeading);

      const notes = document.createElement("div");
      notes.textContent = fields.expansionNotes;
      notes.style.cssText = `
        padding: 10px; background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 6px; font-size: 12px;
        color: rgba(255,255,255,0.5); font-style: italic;
        white-space: pre-wrap;
      `;
      wrap.appendChild(notes);
    }

    // Save expanded fields button
    const saveFieldsBtn = this.makeButton("Save Edits", "rgba(255,255,255,0.3)");
    saveFieldsBtn.style.cssText += "margin-top: 12px;";
    saveFieldsBtn.addEventListener("click", async () => {
      if (!this.draft || !this.onUpdateDraft) return;
      saveFieldsBtn.disabled = true;
      try {
        await this.onUpdateDraft(this.draft.draftId, { expandedFields: fields });
        this.setStatus("Fields saved");
      } catch (err) {
        this.setStatus(`Save failed: ${err instanceof Error ? err.message : "Unknown"}`, true);
      }
      saveFieldsBtn.disabled = false;
    });
    wrap.appendChild(saveFieldsBtn);

    return wrap;
  }

  // --- Budget Params ---

  private renderBudgetParams(): HTMLElement {
    const wrap = document.createElement("div");
    if (!this.draft) return wrap;

    const turnsInput = this.makeNumberField("Max Conversation Turns", this.draft.maxConversationTurns, (v) => {
      if (this.draft) this.draft.maxConversationTurns = v;
    });
    wrap.appendChild(turnsInput);

    const callsInput = this.makeNumberField("Max Daily Calls", this.draft.maxDailyCalls, (v) => {
      if (this.draft) this.draft.maxDailyCalls = v;
    });
    wrap.appendChild(callsInput);

    const rememberRow = this.makeCheckbox("Remember Visitors", this.draft.rememberVisitors, (v) => {
      if (this.draft) this.draft.rememberVisitors = v;
    });
    wrap.appendChild(rememberRow);

    const saveBudgetBtn = this.makeButton("Save Budget", "rgba(255,255,255,0.3)");
    saveBudgetBtn.style.cssText += "margin-top: 8px;";
    saveBudgetBtn.addEventListener("click", async () => {
      if (!this.draft || !this.onUpdateDraft) return;
      saveBudgetBtn.disabled = true;
      try {
        await this.onUpdateDraft(this.draft.draftId, {
          maxConversationTurns: this.draft.maxConversationTurns,
          maxDailyCalls: this.draft.maxDailyCalls,
          rememberVisitors: this.draft.rememberVisitors,
        });
        this.setStatus("Budget saved");
      } catch (err) {
        this.setStatus(`Save failed: ${err instanceof Error ? err.message : "Unknown"}`, true);
      }
      saveBudgetBtn.disabled = false;
    });
    wrap.appendChild(saveBudgetBtn);

    return wrap;
  }

  // --- Finalize ---

  private renderFinalizeSection(): HTMLElement {
    const wrap = document.createElement("div");
    if (!this.draft) return wrap;

    const charUpload = this.draft.uploads.find(u => u.uploadType === "character");
    const allUploadsReady = this.draft.uploads.every(u => u.conversionStatus === "ready");
    const hasCharacter = !!charUpload;
    const hasExpansion = this.draft.expansionStatus === "ready" && !!this.draft.expandedFields;

    // Checklist
    const checks = [
      { label: "Character model uploaded", ok: hasCharacter },
      { label: "All assets processed", ok: allUploadsReady || this.draft.uploads.length === 0 },
      { label: "Personality expanded", ok: hasExpansion },
    ];

    for (const check of checks) {
      const row = document.createElement("div");
      row.style.cssText = "font-size: 13px; padding: 3px 0;";
      row.innerHTML = `<span style="color: ${check.ok ? "#44ff88" : "#ff4444"};">${check.ok ? "\u2713" : "\u2717"}</span> ${this.esc(check.label)}`;
      wrap.appendChild(row);
    }

    const canFinalize = hasCharacter && hasExpansion && (allUploadsReady || this.draft.uploads.length === 0);

    const finalizeBtn = this.makeButton("Finalize Daemon", canFinalize ? "#44ff88" : "#666");
    finalizeBtn.disabled = !canFinalize;
    finalizeBtn.style.cssText += "margin-top: 12px; font-size: 14px; padding: 10px 24px;";
    finalizeBtn.addEventListener("click", async () => {
      if (!this.draft || !this.onFinalize) return;
      finalizeBtn.disabled = true;
      finalizeBtn.textContent = "Finalizing...";
      this.setStatus("Compiling personality manifest...");
      try {
        const result = await this.onFinalize(this.draft.draftId);
        this.setStatus(`Daemon "${result.name}" created! Token count: ${result.compiledTokenCount}`);
        this.draft = null;
        this.clear();

        const doneMsg = document.createElement("div");
        doneMsg.style.cssText = "text-align: center; padding: 40px 0;";
        doneMsg.innerHTML = `
          <div style="color: #44ff88; font-size: 18px; margin-bottom: 12px;">\u2713 Daemon Created</div>
          <div style="color: rgba(255,255,255,0.6); font-size: 14px; margin-bottom: 8px;">${this.esc(result.name)}</div>
          <div style="color: rgba(255,255,255,0.4); font-size: 12px;">Compiled token count: ${result.compiledTokenCount}</div>
        `;

        const newBtn = this.makeButton("Create Another", "#ff8c00");
        newBtn.style.cssText += "margin-top: 20px;";
        newBtn.addEventListener("click", () => this.renderStartScreen());
        doneMsg.appendChild(newBtn);

        this.contentArea.appendChild(doneMsg);
      } catch (err) {
        this.setStatus(`Finalize failed: ${err instanceof Error ? err.message : "Unknown"}`, true);
        finalizeBtn.disabled = false;
        finalizeBtn.textContent = "Finalize Daemon";
      }
    });
    wrap.appendChild(finalizeBtn);

    // Abandon button
    const abandonBtn = this.makeButton("Abandon Draft", "#ff4444");
    abandonBtn.style.cssText += "margin-top: 8px; font-size: 11px; padding: 4px 12px; opacity: 0.6;";
    abandonBtn.addEventListener("click", async () => {
      if (!this.draft || !this.onAbandon) return;
      abandonBtn.disabled = true;
      try {
        await this.onAbandon(this.draft.draftId);
        this.draft = null;
        this.setStatus("Draft abandoned");
        this.renderStartScreen();
      } catch (err) {
        this.setStatus(`Abandon failed: ${err instanceof Error ? err.message : "Unknown"}`, true);
        abandonBtn.disabled = false;
      }
    });
    wrap.appendChild(abandonBtn);

    return wrap;
  }

  // --- UI Helpers ---

  private makeButton(text: string, color: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.style.cssText = `
      background: ${color.startsWith("rgba") ? color : `${color}33`};
      border: 1px solid ${color.startsWith("rgba") ? "rgba(255,255,255,0.2)" : `${color}88`};
      border-radius: 6px;
      color: ${color.startsWith("rgba") ? "rgba(255,255,255,0.7)" : color};
      font-size: 13px;
      padding: 8px 16px;
      cursor: pointer;
      font-family: system-ui, sans-serif;
    `;
    return btn;
  }

  private inputStyle(): string {
    return `
      padding: 6px 10px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      color: white;
      font-size: 13px;
      font-family: system-ui, sans-serif;
      outline: none;
      box-sizing: border-box;
    `;
  }

  private makeField(label: string, value: string, onChange: (v: string) => void): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText = "margin-bottom: 8px;";

    const lbl = document.createElement("label");
    lbl.textContent = label;
    lbl.style.cssText = "display: block; font-size: 11px; color: rgba(255,255,255,0.5); margin-bottom: 3px;";
    row.appendChild(lbl);

    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.style.cssText = this.inputStyle() + "width: 100%;";
    input.addEventListener("keydown", (e) => e.stopPropagation());
    input.addEventListener("input", () => onChange(input.value));
    row.appendChild(input);

    return row;
  }

  private makeTextarea(label: string, value: string, onChange: (v: string) => void): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText = "margin-bottom: 8px;";

    const lbl = document.createElement("label");
    lbl.textContent = label;
    lbl.style.cssText = "display: block; font-size: 11px; color: rgba(255,255,255,0.5); margin-bottom: 3px;";
    row.appendChild(lbl);

    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.cssText = `
      width: 100%; height: 70px; padding: 8px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px; color: white;
      font-family: system-ui, sans-serif;
      font-size: 13px; outline: none;
      box-sizing: border-box; resize: vertical;
    `;
    ta.addEventListener("keydown", (e) => e.stopPropagation());
    ta.addEventListener("input", () => onChange(ta.value));
    row.appendChild(ta);

    return row;
  }

  private makeNumberField(label: string, value: number, onChange: (v: number) => void): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText = "margin-bottom: 8px; display: flex; align-items: center; gap: 10px;";

    const lbl = document.createElement("label");
    lbl.textContent = label;
    lbl.style.cssText = "font-size: 12px; color: rgba(255,255,255,0.6); min-width: 160px;";
    row.appendChild(lbl);

    const input = document.createElement("input");
    input.type = "number";
    input.value = String(value);
    input.style.cssText = this.inputStyle() + "width: 100px;";
    input.addEventListener("keydown", (e) => e.stopPropagation());
    input.addEventListener("input", () => {
      const n = parseInt(input.value, 10);
      if (!isNaN(n)) onChange(n);
    });
    row.appendChild(input);

    return row;
  }

  private makeSlider(label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText = "margin-bottom: 8px; display: flex; align-items: center; gap: 10px;";

    const lbl = document.createElement("label");
    lbl.textContent = label;
    lbl.style.cssText = "font-size: 12px; color: rgba(255,255,255,0.6); min-width: 130px;";
    row.appendChild(lbl);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);
    slider.style.cssText = "flex: 1; accent-color: #ff8c00;";
    row.appendChild(slider);

    const valLabel = document.createElement("span");
    valLabel.textContent = String(value);
    valLabel.style.cssText = "font-size: 12px; color: rgba(255,255,255,0.5); min-width: 30px; text-align: right;";
    row.appendChild(valLabel);

    slider.addEventListener("input", () => {
      const v = parseFloat(slider.value);
      valLabel.textContent = String(v);
      onChange(v);
    });

    return row;
  }

  private makeSelect(label: string, value: string, options: string[], onChange: (v: string) => void): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText = "margin-bottom: 8px; display: flex; align-items: center; gap: 10px;";

    const lbl = document.createElement("label");
    lbl.textContent = label;
    lbl.style.cssText = "font-size: 12px; color: rgba(255,255,255,0.6); min-width: 130px;";
    row.appendChild(lbl);

    const select = document.createElement("select");
    select.style.cssText = `
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px; color: white;
      font-size: 12px; padding: 4px 8px;
      cursor: pointer;
    `;
    for (const opt of options) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      o.style.background = "#1a1a1a";
      select.appendChild(o);
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    row.appendChild(select);

    return row;
  }

  private makeCheckbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText = "margin-bottom: 8px; display: flex; align-items: center; gap: 10px;";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = checked;
    cb.style.cssText = "accent-color: #ff8c00;";
    cb.addEventListener("change", () => onChange(cb.checked));
    row.appendChild(cb);

    const lbl = document.createElement("label");
    lbl.textContent = label;
    lbl.style.cssText = "font-size: 12px; color: rgba(255,255,255,0.6); cursor: pointer;";
    lbl.addEventListener("click", () => { cb.checked = !cb.checked; onChange(cb.checked); });
    row.appendChild(lbl);

    return row;
  }

  private esc(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
