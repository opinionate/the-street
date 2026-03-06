import type { DaemonPlacement } from "@the-street/shared";

interface PlaceableDaemon {
  id: string;
  name: string;
  description: string;
}

interface PlotOption {
  uuid: string;
  position: number;
  ownerName: string;
  neighborhood: string;
  ring: number;
}

/**
 * Daemon world placement panel. Allows admins to:
 * - Select an unplaced daemon
 * - Pick a plot
 * - Set spawn point, facing direction, roam/interaction radii
 * - Activate/deactivate daemons
 */
export class DaemonPlacementPanel {
  private container: HTMLDivElement;
  private contentArea: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private visible = false;

  private selectedDaemonId: string | null = null;
  private selectedPlotUUID: string | null = null;
  private currentPlacement: DaemonPlacement | null = null;

  // Callbacks wired in main.ts
  onListPlaceable: (() => Promise<PlaceableDaemon[]>) | null = null;
  onListPlots: (() => Promise<PlotOption[]>) | null = null;
  onGetPlacement: ((daemonId: string) => Promise<DaemonPlacement | null>) | null = null;
  onSetPlacement: ((daemonId: string, placement: Omit<DaemonPlacement, "daemonId" | "active">) => Promise<DaemonPlacement>) | null = null;
  onUpdatePlacement: ((daemonId: string, placement: Partial<Omit<DaemonPlacement, "daemonId" | "active">>) => Promise<DaemonPlacement>) | null = null;
  onActivate: ((daemonId: string) => Promise<void>) | null = null;
  onDeactivate: ((daemonId: string) => Promise<void>) | null = null;

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "daemon-placement-panel";
    this.container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 700px;
      max-height: 85vh;
      background: rgba(10, 10, 15, 0.95);
      border: 1px solid rgba(0, 200, 120, 0.4);
      border-radius: 12px;
      z-index: 215;
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
    title.innerHTML = '<span style="color:#00c878;font-weight:bold">PLACEMENT</span> World Placement';
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

    // Content area
    this.contentArea = document.createElement("div");
    this.contentArea.style.cssText = `
      padding: 16px 20px;
      overflow-y: auto;
      max-height: calc(85vh - 120px);
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
    this.renderDaemonSelect();
  }

  hide(): void {
    this.visible = false;
    this.container.style.display = "none";
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  private setStatus(msg: string): void {
    this.statusEl.textContent = msg;
  }

  private async renderDaemonSelect(): Promise<void> {
    this.contentArea.innerHTML = "";
    this.setStatus("Loading daemons...");

    if (!this.onListPlaceable) {
      this.setStatus("Not connected");
      return;
    }

    try {
      const daemons = await this.onListPlaceable();
      this.setStatus(`${daemons.length} unplaced daemon${daemons.length !== 1 ? "s" : ""}`);

      if (daemons.length === 0) {
        this.contentArea.innerHTML = `
          <div style="color:rgba(255,255,255,0.4);text-align:center;padding:30px">
            No unplaced daemons. Finalize a daemon first.
          </div>`;
        return;
      }

      const label = document.createElement("div");
      label.textContent = "Select a daemon to place:";
      label.style.cssText = "font-size: 13px; color: rgba(255,255,255,0.6); margin-bottom: 10px;";
      this.contentArea.appendChild(label);

      for (const daemon of daemons) {
        const row = document.createElement("div");
        row.style.cssText = `
          padding: 10px 14px;
          margin-bottom: 6px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 6px;
          cursor: pointer;
          transition: border-color 0.2s;
        `;
        row.addEventListener("mouseenter", () => {
          row.style.borderColor = "rgba(0, 200, 120, 0.4)";
        });
        row.addEventListener("mouseleave", () => {
          row.style.borderColor = "rgba(255, 255, 255, 0.08)";
        });

        const name = document.createElement("div");
        name.textContent = daemon.name;
        name.style.cssText = "font-size: 14px; font-weight: bold; margin-bottom: 4px;";
        row.appendChild(name);

        if (daemon.description) {
          const desc = document.createElement("div");
          desc.textContent = daemon.description.slice(0, 120) + (daemon.description.length > 120 ? "..." : "");
          desc.style.cssText = "font-size: 12px; color: rgba(255,255,255,0.4);";
          row.appendChild(desc);
        }

        row.addEventListener("click", () => {
          this.selectedDaemonId = daemon.id;
          this.renderPlotSelect(daemon);
        });

        this.contentArea.appendChild(row);
      }
    } catch (err) {
      this.setStatus(`Error: ${err instanceof Error ? err.message : "Failed"}`);
    }
  }

  private async renderPlotSelect(daemon: PlaceableDaemon): Promise<void> {
    this.contentArea.innerHTML = "";
    this.setStatus("Loading plots...");

    if (!this.onListPlots) return;

    try {
      const plots = await this.onListPlots();
      this.setStatus(`Placing: ${daemon.name}`);

      // Back button
      const backBtn = this.makeButton("\u2190 Back", () => this.renderDaemonSelect());
      backBtn.style.marginBottom = "12px";
      this.contentArea.appendChild(backBtn);

      const heading = document.createElement("div");
      heading.innerHTML = `Placing <strong style="color:#00c878">${this.esc(daemon.name)}</strong> — select a plot:`;
      heading.style.cssText = "font-size: 13px; margin-bottom: 10px;";
      this.contentArea.appendChild(heading);

      if (plots.length === 0) {
        this.contentArea.innerHTML += '<div style="color:rgba(255,255,255,0.4);padding:20px;text-align:center">No plots available</div>';
        return;
      }

      for (const plot of plots) {
        const row = document.createElement("div");
        row.style.cssText = `
          padding: 8px 14px;
          margin-bottom: 4px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 13px;
          transition: border-color 0.2s;
        `;
        row.addEventListener("mouseenter", () => {
          row.style.borderColor = "rgba(0, 200, 120, 0.4)";
        });
        row.addEventListener("mouseleave", () => {
          row.style.borderColor = "rgba(255, 255, 255, 0.08)";
        });

        row.innerHTML = `
          <span>Plot #${plot.position} <span style="color:rgba(255,255,255,0.4)">(${plot.neighborhood}, ring ${plot.ring})</span></span>
          <span style="color:rgba(255,255,255,0.4);font-size:11px">${this.esc(plot.ownerName)}</span>
        `;

        row.addEventListener("click", () => {
          this.selectedPlotUUID = plot.uuid;
          this.renderPlacementForm(daemon, plot);
        });

        this.contentArea.appendChild(row);
      }
    } catch (err) {
      this.setStatus(`Error: ${err instanceof Error ? err.message : "Failed"}`);
    }
  }

  private renderPlacementForm(daemon: PlaceableDaemon, plot: PlotOption): void {
    this.contentArea.innerHTML = "";
    this.setStatus(`Configuring placement on Plot #${plot.position}`);

    // Back button
    const backBtn = this.makeButton("\u2190 Back to plots", () => this.renderPlotSelect(daemon));
    backBtn.style.marginBottom = "12px";
    this.contentArea.appendChild(backBtn);

    const heading = document.createElement("div");
    heading.innerHTML = `
      <strong style="color:#00c878">${this.esc(daemon.name)}</strong>
      <span style="color:rgba(255,255,255,0.4)">→</span>
      Plot #${plot.position} (${this.esc(plot.neighborhood)})
    `;
    heading.style.cssText = "font-size: 14px; margin-bottom: 16px;";
    this.contentArea.appendChild(heading);

    // Form fields
    const form = document.createElement("div");
    form.style.cssText = "display: flex; flex-direction: column; gap: 12px;";

    // Spawn point (default to 0,0,0 — plot center)
    const spawnXInput = this.makeInput("Spawn X", "0");
    const spawnZInput = this.makeInput("Spawn Z", "0");
    const facingInput = this.makeInput("Facing Direction (radians)", "0");
    const roamInput = this.makeInput("Roam Radius", "5");
    const interactionInput = this.makeInput("Interaction Range", "10");

    form.appendChild(this.makeFieldRow("Spawn Point", [spawnXInput, spawnZInput]));
    form.appendChild(this.makeFieldRow("Facing", [facingInput]));
    form.appendChild(this.makeFieldRow("Radii", [roamInput, interactionInput]));

    // Radii preview
    const previewCanvas = document.createElement("canvas");
    previewCanvas.width = 300;
    previewCanvas.height = 200;
    previewCanvas.style.cssText = `
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      margin-top: 4px;
      background: rgba(0, 0, 0, 0.3);
      align-self: center;
    `;
    form.appendChild(previewCanvas);

    const drawPreview = () => {
      const ctx = previewCanvas.getContext("2d");
      if (!ctx) return;
      const w = previewCanvas.width;
      const h = previewCanvas.height;
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const scale = 8; // pixels per world unit

      const roam = parseFloat((roamInput.querySelector("input") as HTMLInputElement).value) || 5;
      const interaction = parseFloat((interactionInput.querySelector("input") as HTMLInputElement).value) || 10;
      const facing = parseFloat((facingInput.querySelector("input") as HTMLInputElement).value) || 0;

      // Interaction range (outer)
      ctx.beginPath();
      ctx.arc(cx, cy, interaction * scale, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 120, 255, 0.08)";
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 120, 255, 0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Roam radius (inner)
      ctx.beginPath();
      ctx.arc(cx, cy, roam * scale, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 200, 120, 0.1)";
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 200, 120, 0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Spawn point
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#00c878";
      ctx.fill();

      // Facing direction arrow
      const arrowLen = 20;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(facing) * arrowLen, cy - Math.cos(facing) * arrowLen);
      ctx.strokeStyle = "#ffaa00";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Labels
      ctx.font = "10px system-ui";
      ctx.fillStyle = "rgba(0, 200, 120, 0.7)";
      ctx.fillText(`roam: ${roam}`, cx + roam * scale + 4, cy - 4);
      ctx.fillStyle = "rgba(0, 120, 255, 0.7)";
      ctx.fillText(`interact: ${interaction}`, cx + interaction * scale + 4, cy + 10);
    };

    // Update preview on input change
    for (const wrapper of [roamInput, interactionInput, facingInput]) {
      const input = wrapper.querySelector("input") as HTMLInputElement;
      input.addEventListener("input", drawPreview);
    }
    setTimeout(drawPreview, 0);

    // Validation hint
    const hint = document.createElement("div");
    hint.style.cssText = "font-size: 11px; color: rgba(255,255,255,0.3);";
    hint.textContent = "Roam radius must be \u2264 interaction range. Spawn point relative to plot center.";
    form.appendChild(hint);

    // Submit button
    const submitBtn = this.makeButton("Place Daemon", async () => {
      const spawnX = parseFloat((spawnXInput.querySelector("input") as HTMLInputElement).value) || 0;
      const spawnZ = parseFloat((spawnZInput.querySelector("input") as HTMLInputElement).value) || 0;
      const facing = parseFloat((facingInput.querySelector("input") as HTMLInputElement).value) || 0;
      const roam = parseFloat((roamInput.querySelector("input") as HTMLInputElement).value) || 5;
      const interaction = parseFloat((interactionInput.querySelector("input") as HTMLInputElement).value) || 10;

      if (roam > interaction) {
        this.setStatus("Error: roam radius must be \u2264 interaction range");
        return;
      }

      if (!this.selectedDaemonId || !this.selectedPlotUUID || !this.onSetPlacement) return;

      submitBtn.setAttribute("disabled", "true");
      this.setStatus("Placing daemon...");

      try {
        const placement = await this.onSetPlacement(this.selectedDaemonId, {
          plotUUID: this.selectedPlotUUID,
          spawnPoint: { x: spawnX, y: 0, z: spawnZ },
          facingDirection: facing,
          roamRadius: roam,
          interactionRange: interaction,
        });
        this.currentPlacement = placement;
        this.renderPlacementResult(daemon, placement);
      } catch (err) {
        this.setStatus(`Error: ${err instanceof Error ? err.message : "Placement failed"}`);
        submitBtn.removeAttribute("disabled");
      }
    });
    submitBtn.style.cssText += "background: rgba(0, 200, 120, 0.15); border-color: rgba(0, 200, 120, 0.4); color: #00c878; margin-top: 8px;";
    form.appendChild(submitBtn);

    this.contentArea.appendChild(form);
  }

  private renderPlacementResult(daemon: PlaceableDaemon, placement: DaemonPlacement): void {
    this.contentArea.innerHTML = "";
    this.setStatus("Placement saved");

    const success = document.createElement("div");
    success.style.cssText = "text-align: center; padding: 20px;";
    success.innerHTML = `
      <div style="font-size: 24px; color: #00c878; margin-bottom: 8px;">\u2713</div>
      <div style="font-size: 16px; font-weight: bold; margin-bottom: 4px;">${this.esc(daemon.name)} placed</div>
      <div style="font-size: 12px; color: rgba(255,255,255,0.4); margin-bottom: 16px;">
        Spawn: (${placement.spawnPoint.x.toFixed(1)}, ${placement.spawnPoint.z.toFixed(1)})
        | Roam: ${placement.roamRadius} | Interact: ${placement.interactionRange}
      </div>
    `;
    this.contentArea.appendChild(success);

    // Activate button
    const activateBtn = this.makeButton("Activate (Spawn in World)", async () => {
      if (!this.selectedDaemonId || !this.onActivate) return;
      activateBtn.setAttribute("disabled", "true");
      this.setStatus("Activating...");
      try {
        await this.onActivate(this.selectedDaemonId);
        this.setStatus("Daemon activated! It is now in the world.");
        activateBtn.textContent = "Active";
        activateBtn.style.background = "rgba(0, 200, 120, 0.3)";
        activateBtn.style.color = "#00c878";

        // Show deactivate option
        const deactivateBtn = this.makeButton("Deactivate", async () => {
          if (!this.selectedDaemonId || !this.onDeactivate) return;
          deactivateBtn.setAttribute("disabled", "true");
          this.setStatus("Deactivating...");
          try {
            await this.onDeactivate(this.selectedDaemonId);
            this.setStatus("Daemon deactivated.");
            this.renderDaemonSelect();
          } catch (err) {
            this.setStatus(`Error: ${err instanceof Error ? err.message : "Failed"}`);
            deactivateBtn.removeAttribute("disabled");
          }
        });
        deactivateBtn.style.cssText += "background: rgba(255, 68, 68, 0.1); border-color: rgba(255, 68, 68, 0.3); color: #ff6666; margin-top: 8px;";
        this.contentArea.appendChild(deactivateBtn);
      } catch (err) {
        this.setStatus(`Error: ${err instanceof Error ? err.message : "Activation failed"}`);
        activateBtn.removeAttribute("disabled");
      }
    });
    activateBtn.style.cssText += "background: rgba(0, 200, 120, 0.15); border-color: rgba(0, 200, 120, 0.4); color: #00c878;";
    this.contentArea.appendChild(activateBtn);

    // Place another button
    const anotherBtn = this.makeButton("Place Another Daemon", () => this.renderDaemonSelect());
    anotherBtn.style.marginTop = "8px";
    this.contentArea.appendChild(anotherBtn);
  }

  // --- Helpers ---

  private makeButton(text: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.style.cssText = `
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      color: rgba(255, 255, 255, 0.7);
      font-size: 13px;
      padding: 8px 16px;
      cursor: pointer;
      width: 100%;
      font-family: system-ui, sans-serif;
    `;
    btn.addEventListener("click", onClick);
    return btn;
  }

  private makeInput(placeholder: string, defaultVal: string): HTMLDivElement {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "flex: 1;";
    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.1";
    input.placeholder = placeholder;
    input.value = defaultVal;
    input.style.cssText = `
      width: 100%;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 4px;
      color: white;
      font-size: 13px;
      padding: 6px 10px;
      font-family: system-ui, sans-serif;
      box-sizing: border-box;
    `;
    const label = document.createElement("div");
    label.textContent = placeholder;
    label.style.cssText = "font-size: 10px; color: rgba(255,255,255,0.3); margin-bottom: 3px;";
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    return wrapper;
  }

  private makeFieldRow(label: string, inputs: HTMLDivElement[]): HTMLDivElement {
    const row = document.createElement("div");
    const rowLabel = document.createElement("div");
    rowLabel.textContent = label;
    rowLabel.style.cssText = "font-size: 12px; color: rgba(255,255,255,0.5); margin-bottom: 4px;";
    row.appendChild(rowLabel);
    const inputRow = document.createElement("div");
    inputRow.style.cssText = "display: flex; gap: 8px;";
    for (const input of inputs) {
      inputRow.appendChild(input);
    }
    row.appendChild(inputRow);
    return row;
  }

  private esc(s: string): string {
    const el = document.createElement("span");
    el.textContent = s;
    return el.innerHTML;
  }
}
