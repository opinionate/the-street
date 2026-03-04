import * as THREE from "three";

export interface AvatarHistoryItem {
  id: string;
  avatar_definition: unknown;
  mesh_description: string | null;
  meshy_task_id: string | null;
  thumbnail_url: string | null;
  created_at: string;
}

export class AvatarPanel {
  private container: HTMLDivElement;
  private input: HTMLTextAreaElement;
  private generateBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;
  private status: HTMLDivElement;
  private meshPromptArea: HTMLDivElement;
  private meshPromptInput: HTMLTextAreaElement;
  private startMeshBtn: HTMLButtonElement;
  private meshProgress: HTMLDivElement;
  private meshProgressBar: HTMLDivElement;
  private meshProgressLabel: HTMLDivElement;
  private galleryStrip: HTMLDivElement;
  private galleryInfo: HTMLDivElement;
  private promptViewer: HTMLDivElement;
  private previewCanvas: HTMLCanvasElement;
  private visible = false;
  private currentAppearance: unknown = null;
  private currentMeshDescription: string | null = null;
  private currentMeshyTaskId: string | null = null;
  private currentThumbnailUrl: string | null = null;
  private selectedHistoryId: string | null = null;
  private historyItems: AvatarHistoryItem[] = [];

  // 3D Preview
  private previewRenderer: THREE.WebGLRenderer | null = null;
  private previewScene: THREE.Scene | null = null;
  private previewCamera: THREE.PerspectiveCamera | null = null;
  private previewModel: THREE.Group | null = null;
  private previewAnimId: number = 0;
  private isDragging = false;
  private dragStartX = 0;
  private previewRotationY = 0;

  onGenerate: ((description: string) => Promise<void>) | null = null;
  onSave: ((avatarDefinition: unknown, meshDescription?: string, meshyTaskId?: string) => Promise<void>) | null = null;
  onStartMesh: ((description: string) => Promise<void>) | null = null;
  onLoadHistory: (() => Promise<AvatarHistoryItem[]>) | null = null;
  onSelectHistoryItem: ((avatarDefinition: unknown) => void) | null = null;
  onDeleteHistoryItem: ((id: string) => Promise<void>) | null = null;
  onGetPreviewModel: (() => THREE.Group | null) | null = null;

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "avatar-panel";
    this.container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 720px;
      max-height: 90vh;
      background: rgba(10, 10, 15, 0.95);
      border: 1px solid rgba(0, 255, 255, 0.3);
      border-radius: 12px;
      z-index: 100;
      display: none;
      font-family: system-ui, sans-serif;
      color: white;
      overflow: hidden;
    `;

    // ── Header ──
    const header = document.createElement("div");
    header.style.cssText = `
      padding: 14px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: space-between;
    `;
    const title = document.createElement("div");
    title.textContent = "My Avatar";
    title.style.cssText = "font-size:16px;font-weight:bold;color:#00ffff;";
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "\u00D7";
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: rgba(255, 255, 255, 0.6);
      font-size: 22px;
      cursor: pointer;
      padding: 0 4px;
    `;
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);
    this.container.appendChild(header);

    // ── Main body (two columns) ──
    const body = document.createElement("div");
    body.style.cssText = `
      display: flex;
      padding: 16px 20px;
      gap: 20px;
      min-height: 360px;
    `;

    // Left: 3D preview
    const previewCol = document.createElement("div");
    previewCol.style.cssText = `
      flex: 0 0 300px;
      display: flex;
      flex-direction: column;
      align-items: center;
    `;

    this.previewCanvas = document.createElement("canvas");
    this.previewCanvas.width = 300;
    this.previewCanvas.height = 350;
    this.previewCanvas.style.cssText = `
      width: 300px;
      height: 350px;
      border-radius: 8px;
      background: rgba(20, 20, 30, 1);
      cursor: grab;
    `;
    this.setupPreviewDrag();
    previewCol.appendChild(this.previewCanvas);

    const dragHint = document.createElement("div");
    dragHint.textContent = "click + drag to rotate";
    dragHint.style.cssText = "font-size:11px;color:rgba(255,255,255,0.3);margin-top:6px;";
    previewCol.appendChild(dragHint);
    body.appendChild(previewCol);

    // Right: customize controls
    const controlCol = document.createElement("div");
    controlCol.style.cssText = `
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow-y: auto;
      max-height: 370px;
    `;

    const ctrlTitle = document.createElement("div");
    ctrlTitle.textContent = "Customize Avatar";
    ctrlTitle.style.cssText = "font-size:14px;font-weight:bold;color:rgba(255,255,255,0.8);margin-bottom:4px;";
    controlCol.appendChild(ctrlTitle);

    // Description input
    this.input = document.createElement("textarea");
    this.input.placeholder = "Describe your avatar...\ne.g. A cyber-punk warrior with neon blue hair";
    this.input.style.cssText = `
      width: 100%;
      height: 70px;
      padding: 8px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      color: white;
      font-family: system-ui, sans-serif;
      font-size: 13px;
      resize: vertical;
      outline: none;
      box-sizing: border-box;
    `;
    this.input.addEventListener("keydown", (e) => e.stopPropagation());
    controlCol.appendChild(this.input);

    // Generate button
    this.generateBtn = document.createElement("button");
    this.generateBtn.textContent = "Generate";
    this.generateBtn.style.cssText = `
      width: 100%;
      padding: 9px;
      background: #00aacc;
      border: none;
      border-radius: 4px;
      color: white;
      font-size: 13px;
      font-weight: bold;
      cursor: pointer;
    `;
    this.generateBtn.addEventListener("click", () => this.handleGenerate());
    controlCol.appendChild(this.generateBtn);

    // Status
    this.status = document.createElement("div");
    this.status.style.cssText = `
      font-size: 12px;
      color: rgba(255, 255, 255, 0.6);
      min-height: 18px;
    `;
    controlCol.appendChild(this.status);

    // Mesh prompt area (hidden until generation)
    this.meshPromptArea = document.createElement("div");
    this.meshPromptArea.style.cssText = "display:none;";
    const meshLabel = document.createElement("div");
    meshLabel.textContent = "3D Model Prompt";
    meshLabel.style.cssText = "font-size:12px;font-weight:bold;color:rgba(255,255,255,0.7);margin-bottom:4px;";
    this.meshPromptArea.appendChild(meshLabel);

    this.meshPromptInput = document.createElement("textarea");
    this.meshPromptInput.style.cssText = `
      width: 100%;
      min-height: 55px;
      padding: 8px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(0, 170, 204, 0.4);
      border-radius: 4px;
      color: white;
      font-family: system-ui, sans-serif;
      font-size: 12px;
      resize: vertical;
      outline: none;
      box-sizing: border-box;
      overflow: hidden;
    `;
    this.meshPromptInput.addEventListener("keydown", (e) => e.stopPropagation());
    this.meshPromptArea.appendChild(this.meshPromptInput);

    this.startMeshBtn = document.createElement("button");
    this.startMeshBtn.textContent = "Generate 3D Model";
    this.startMeshBtn.style.cssText = `
      margin-top: 6px;
      width: 100%;
      padding: 8px;
      background: #00aacc;
      border: none;
      border-radius: 4px;
      color: white;
      font-size: 13px;
      font-weight: bold;
      cursor: pointer;
    `;
    this.startMeshBtn.addEventListener("click", () => this.handleStartMesh());
    this.meshPromptArea.appendChild(this.startMeshBtn);
    controlCol.appendChild(this.meshPromptArea);

    // Mesh progress
    this.meshProgress = document.createElement("div");
    this.meshProgress.style.cssText = "display:none;";
    this.meshProgressLabel = document.createElement("div");
    this.meshProgressLabel.style.cssText = "font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:4px;";
    this.meshProgress.appendChild(this.meshProgressLabel);
    const progressTrack = document.createElement("div");
    progressTrack.style.cssText = "width:100%;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;";
    this.meshProgressBar = document.createElement("div");
    this.meshProgressBar.style.cssText = "width:0%;height:100%;background:#00aacc;border-radius:3px;transition:width 0.3s;";
    progressTrack.appendChild(this.meshProgressBar);
    this.meshProgress.appendChild(progressTrack);
    controlCol.appendChild(this.meshProgress);

    // Save button
    this.saveBtn = document.createElement("button");
    this.saveBtn.textContent = "Save Avatar";
    this.saveBtn.style.cssText = `
      width: 100%;
      padding: 9px;
      background: #44ff88;
      border: none;
      border-radius: 4px;
      color: black;
      font-size: 13px;
      font-weight: bold;
      cursor: pointer;
      display: none;
    `;
    this.saveBtn.addEventListener("click", () => this.handleSave());
    controlCol.appendChild(this.saveBtn);

    body.appendChild(controlCol);
    this.container.appendChild(body);

    // ── Gallery section (bottom) ──
    const gallerySection = document.createElement("div");
    gallerySection.style.cssText = `
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding: 12px 20px 14px;
    `;

    const galleryHeader = document.createElement("div");
    galleryHeader.textContent = "My Avatars";
    galleryHeader.style.cssText = "font-size:13px;font-weight:bold;color:rgba(255,255,255,0.7);margin-bottom:8px;";
    gallerySection.appendChild(galleryHeader);

    // Horizontal scroll strip
    this.galleryStrip = document.createElement("div");
    this.galleryStrip.style.cssText = `
      display: flex;
      gap: 8px;
      overflow-x: auto;
      overflow-y: hidden;
      white-space: nowrap;
      padding-bottom: 6px;
      min-height: 80px;
    `;
    gallerySection.appendChild(this.galleryStrip);

    // Info row for selected avatar
    this.galleryInfo = document.createElement("div");
    this.galleryInfo.style.cssText = `
      margin-top: 8px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.6);
      display: none;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    `;
    gallerySection.appendChild(this.galleryInfo);

    // Prompt viewer (toggled)
    this.promptViewer = document.createElement("div");
    this.promptViewer.style.cssText = `
      margin-top: 6px;
      padding: 8px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.5);
      white-space: pre-wrap;
      display: none;
      max-height: 80px;
      overflow-y: auto;
    `;
    gallerySection.appendChild(this.promptViewer);

    this.container.appendChild(gallerySection);
    document.body.appendChild(this.container);
  }

  private setupPreviewDrag(): void {
    this.previewCanvas.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.previewCanvas.style.cursor = "grabbing";
    });
    window.addEventListener("mousemove", (e) => {
      if (!this.isDragging) return;
      const deltaX = e.clientX - this.dragStartX;
      this.dragStartX = e.clientX;
      this.previewRotationY += deltaX * 0.01;
      if (this.previewModel) {
        this.previewModel.rotation.y = this.previewRotationY;
      }
    });
    window.addEventListener("mouseup", () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.previewCanvas.style.cursor = "grab";
      }
    });
  }

  private initPreview(): void {
    if (this.previewRenderer) return;

    this.previewRenderer = new THREE.WebGLRenderer({
      canvas: this.previewCanvas,
      antialias: true,
      alpha: true,
    });
    this.previewRenderer.setSize(300, 350);
    this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.previewScene = new THREE.Scene();
    this.previewScene.background = new THREE.Color(0x14141e);

    this.previewCamera = new THREE.PerspectiveCamera(35, 300 / 350, 0.1, 50);
    this.previewCamera.position.set(0, 1.0, 3.5);
    this.previewCamera.lookAt(0, 0.9, 0);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.previewScene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(2, 3, 2);
    this.previewScene.add(dirLight);
    const backLight = new THREE.DirectionalLight(0x4488ff, 0.3);
    backLight.position.set(-2, 1, -2);
    this.previewScene.add(backLight);

    // Ground plane
    const groundGeo = new THREE.CircleGeometry(1.5, 32);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    this.previewScene.add(ground);

    this.startPreviewLoop();
  }

  private startPreviewLoop(): void {
    const animate = () => {
      this.previewAnimId = requestAnimationFrame(animate);
      if (this.previewRenderer && this.previewScene && this.previewCamera) {
        this.previewRenderer.render(this.previewScene, this.previewCamera);
      }
    };
    animate();
  }

  private stopPreview(): void {
    if (this.previewAnimId) {
      cancelAnimationFrame(this.previewAnimId);
      this.previewAnimId = 0;
    }
    if (this.previewModel && this.previewScene) {
      this.previewScene.remove(this.previewModel);
      this.previewModel = null;
    }
    if (this.previewRenderer) {
      this.previewRenderer.dispose();
      this.previewRenderer = null;
    }
    this.previewScene = null;
    this.previewCamera = null;
  }

  private updatePreviewModel(): void {
    if (!this.previewScene) return;

    // Remove old model
    if (this.previewModel) {
      this.previewScene.remove(this.previewModel);
      this.previewModel = null;
    }

    // Get new model clone
    const model = this.onGetPreviewModel?.();
    if (!model) return;

    this.previewModel = model;
    // Face camera (front-facing) + apply user rotation
    this.previewModel.rotation.y = this.previewRotationY;
    this.previewScene.add(this.previewModel);
  }

  show(): void {
    this.visible = true;
    this.container.style.display = "block";
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    this.initPreview();
    this.updatePreviewModel();
    setTimeout(() => this.input.focus(), 50);
    this.loadHistory();
  }

  hide(): void {
    this.visible = false;
    this.container.style.display = "none";
    this.stopPreview();
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible(): boolean {
    return this.visible;
  }

  getMeshyTaskId(): string | null {
    return this.currentMeshyTaskId;
  }

  getThumbnailUrl(): string | null {
    return this.currentThumbnailUrl;
  }

  setMeshProgress(progress: number, label: string): void {
    this.meshProgress.style.display = "block";
    this.meshProgressLabel.textContent = label;
    this.meshProgressBar.style.width = `${Math.round(progress)}%`;
  }

  clearMeshProgress(): void {
    this.meshProgress.style.display = "none";
  }

  setMeshComplete(): void {
    this.meshProgressLabel.textContent = "3D model ready!";
    this.meshProgressLabel.style.color = "#44ff88";
    this.meshProgressBar.style.width = "100%";
    this.meshProgressBar.style.background = "#44ff88";

    this.meshPromptArea.style.display = "none";
    this.saveBtn.style.display = "block";
    // Keep Generate visible so user can always start a new avatar
    this.generateBtn.style.display = "block";
    this.generateBtn.disabled = false;
    this.generateBtn.textContent = "Generate";
    // Preview refresh is handled externally via refreshPreview() after model loads
  }

  /** Refresh the 3D preview with the current avatar model and capture thumbnail */
  refreshPreview(): void {
    if (!this.visible) return;
    this.updatePreviewModel();
    // Capture thumbnail after two frames so the renderer has drawn the model
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.capturePreviewThumbnail();
      });
    });
  }

  /** Capture the preview canvas as a small JPEG data URL for thumbnails */
  private capturePreviewThumbnail(): void {
    if (!this.previewRenderer || !this.previewScene || !this.previewCamera) return;
    // Render a clean frame
    this.previewRenderer.render(this.previewScene, this.previewCamera);
    // Create a small thumbnail from the canvas
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = 128;
    thumbCanvas.height = 128;
    const ctx = thumbCanvas.getContext("2d");
    if (!ctx) return;
    const src = this.previewCanvas;
    // Center-crop the preview (slightly shifted up to capture head+torso)
    const cropSize = Math.min(src.width, src.height);
    const sx = (src.width - cropSize) / 2;
    const sy = Math.max(0, (src.height - cropSize) / 4);
    ctx.drawImage(src, sx, sy, cropSize, cropSize, 0, 0, 128, 128);
    this.currentThumbnailUrl = thumbCanvas.toDataURL("image/jpeg", 0.75);
  }

  setGenerationResult(appearance: unknown, meshDescription?: string): void {
    this.currentAppearance = appearance;
    this.currentMeshDescription = meshDescription || null;
    this.currentMeshyTaskId = null;

    this.saveBtn.style.display = "none";
    // Keep Generate visible for starting over with a new description
    this.generateBtn.style.display = "block";
    this.generateBtn.disabled = false;
    this.generateBtn.textContent = "Generate";
    if (meshDescription) {
      this.meshPromptInput.value = meshDescription;
      this.meshPromptArea.style.display = "block";
      this.startMeshBtn.style.display = "block";
      this.startMeshBtn.textContent = "Generate 3D Model";
      this.startMeshBtn.disabled = false;
      this.autoExpandTextarea(this.meshPromptInput);
    }
  }

  setMeshyTaskId(taskId: string): void {
    this.currentMeshyTaskId = taskId;
  }

  setThumbnailUrl(url: string): void {
    this.currentThumbnailUrl = url;
  }

  private async loadHistory(): Promise<void> {
    if (!this.onLoadHistory) return;
    try {
      const items = await this.onLoadHistory();
      this.historyItems = items;
      this.renderGallery(items);
    } catch {
      this.galleryStrip.innerHTML = `<div style="font-size:11px;color:rgba(255,255,255,0.3);padding:20px">Could not load history</div>`;
    }
  }

  private renderGallery(items: AvatarHistoryItem[]): void {
    this.galleryStrip.innerHTML = "";
    if (items.length === 0) {
      this.galleryStrip.innerHTML = `<div style="font-size:11px;color:rgba(255,255,255,0.3);padding:20px">No saved avatars yet</div>`;
      return;
    }

    for (const item of items) {
      const card = document.createElement("div");
      card.dataset.historyId = item.id;
      const def = item.avatar_definition as Record<string, unknown>;
      const appearance = def?.customAppearance as Record<string, unknown> | undefined;
      const accent = (appearance?.accentColor as string) || "#00aacc";
      const isSelected = item.id === this.selectedHistoryId;

      card.style.cssText = `
        width: 76px;
        height: 76px;
        flex-shrink: 0;
        border-radius: 6px;
        border: 2px solid ${isSelected ? "#00ffff" : "rgba(255, 255, 255, 0.15)"};
        cursor: pointer;
        overflow: hidden;
        position: relative;
        transition: border-color 0.2s;
      `;

      if (item.thumbnail_url) {
        const img = document.createElement("img");
        img.src = item.thumbnail_url;
        img.style.cssText = "width:100%;height:100%;object-fit:cover;";
        img.onerror = () => {
          img.remove();
          card.style.background = accent;
        };
        card.appendChild(img);
      } else {
        // Color gradient placeholder
        card.style.background = `linear-gradient(135deg, ${accent}, ${accent}88)`;
      }

      card.addEventListener("mouseenter", () => {
        if (item.id !== this.selectedHistoryId) {
          card.style.borderColor = "rgba(0, 255, 255, 0.5)";
        }
      });
      card.addEventListener("mouseleave", () => {
        if (item.id !== this.selectedHistoryId) {
          card.style.borderColor = "rgba(255, 255, 255, 0.15)";
        }
      });

      card.addEventListener("click", () => {
        this.selectHistoryItem(item);
      });

      this.galleryStrip.appendChild(card);
    }
  }

  private selectHistoryItem(item: AvatarHistoryItem): void {
    const def = item.avatar_definition as Record<string, unknown>;
    const appearance = def?.customAppearance as Record<string, unknown> | undefined;

    this.selectedHistoryId = item.id;
    this.currentAppearance = appearance || null;
    this.currentMeshyTaskId = (def?.meshyTaskId as string) || null;
    this.currentMeshDescription = item.mesh_description || null;

    // Apply avatar — the callback in main.ts loads the model and calls refreshPreview()
    this.onSelectHistoryItem?.(item.avatar_definition);

    // Update gallery selection highlight
    this.galleryStrip.querySelectorAll("[data-history-id]").forEach((el) => {
      const card = el as HTMLDivElement;
      card.style.borderColor = card.dataset.historyId === item.id
        ? "#00ffff"
        : "rgba(255, 255, 255, 0.15)";
    });

    // Reset control panel — keep Generate visible for new avatar creation
    this.generateBtn.style.display = "block";
    this.generateBtn.disabled = false;
    this.generateBtn.textContent = "Generate";
    this.saveBtn.style.display = "none";
    this.meshPromptArea.style.display = "none";
    this.meshProgress.style.display = "none";
    this.meshProgressLabel.style.color = "rgba(255, 255, 255, 0.7)";
    this.meshProgressBar.style.background = "#00aacc";

    const hasMesh = !!(def?.meshyTaskId);
    if (item.mesh_description) {
      this.meshPromptInput.value = item.mesh_description;
      this.meshPromptArea.style.display = "block";
      this.startMeshBtn.style.display = "block";
      this.startMeshBtn.textContent = hasMesh ? "Regenerate 3D Model" : "Generate 3D Model";
      this.startMeshBtn.disabled = false;
      this.autoExpandTextarea(this.meshPromptInput);
      this.status.textContent = hasMesh
        ? "Avatar loaded. Edit prompt to regenerate."
        : "Loaded. Edit prompt or generate 3D model.";
    } else {
      this.status.textContent = "Loaded from history.";
    }
    this.status.style.color = "#00aacc";

    // Show info row
    this.updateGalleryInfo(item);
  }

  private updateGalleryInfo(item: AvatarHistoryItem): void {
    this.galleryInfo.innerHTML = "";
    this.galleryInfo.style.display = "flex";

    const def = item.avatar_definition as Record<string, unknown>;
    const appearance = def?.customAppearance as Record<string, unknown> | undefined;
    const outfit = (appearance?.outfit as string) || "Custom avatar";

    // Outfit description
    const descEl = document.createElement("span");
    descEl.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(255,255,255,0.7);";
    descEl.textContent = outfit;
    this.galleryInfo.appendChild(descEl);

    // Date
    const dateEl = document.createElement("span");
    dateEl.style.cssText = "color:rgba(255,255,255,0.35);font-size:11px;flex-shrink:0;";
    dateEl.textContent = new Date(item.created_at).toLocaleDateString();
    this.galleryInfo.appendChild(dateEl);

    // View Prompt button
    if (item.mesh_description) {
      const promptBtn = document.createElement("button");
      promptBtn.textContent = "View Prompt";
      promptBtn.style.cssText = `
        padding: 3px 8px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 3px;
        color: rgba(255, 255, 255, 0.7);
        font-size: 11px;
        cursor: pointer;
        flex-shrink: 0;
      `;
      promptBtn.addEventListener("click", () => {
        if (this.promptViewer.style.display === "none") {
          this.promptViewer.textContent = item.mesh_description || "";
          this.promptViewer.style.display = "block";
          promptBtn.textContent = "Hide Prompt";
        } else {
          this.promptViewer.style.display = "none";
          promptBtn.textContent = "View Prompt";
        }
      });
      this.galleryInfo.appendChild(promptBtn);
    }

    // Delete button
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.style.cssText = `
      padding: 3px 8px;
      background: rgba(255, 68, 68, 0.15);
      border: 1px solid rgba(255, 68, 68, 0.3);
      border-radius: 3px;
      color: #ff6666;
      font-size: 11px;
      cursor: pointer;
      flex-shrink: 0;
    `;
    deleteBtn.addEventListener("click", async () => {
      if (!this.onDeleteHistoryItem) return;
      deleteBtn.disabled = true;
      deleteBtn.textContent = "...";
      try {
        await this.onDeleteHistoryItem(item.id);
        // Remove from local state
        this.historyItems = this.historyItems.filter((h) => h.id !== item.id);
        if (this.selectedHistoryId === item.id) {
          this.selectedHistoryId = null;
          this.galleryInfo.style.display = "none";
          this.promptViewer.style.display = "none";
        }
        this.renderGallery(this.historyItems);
      } catch {
        deleteBtn.textContent = "Failed";
        setTimeout(() => { deleteBtn.textContent = "Delete"; deleteBtn.disabled = false; }, 1500);
      }
    });
    this.galleryInfo.appendChild(deleteBtn);
  }

  private autoExpandTextarea(textarea: HTMLTextAreaElement): void {
    requestAnimationFrame(() => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    });
  }

  private async handleGenerate(): Promise<void> {
    const description = this.input.value.trim();
    if (!description) return;

    this.generateBtn.disabled = true;
    this.generateBtn.textContent = "Generating...";
    this.status.textContent = "AI is designing your avatar...";
    this.status.style.color = "#00aacc";
    // Reset any in-progress state
    this.saveBtn.style.display = "none";
    this.meshPromptArea.style.display = "none";
    this.meshProgress.style.display = "none";
    this.selectedHistoryId = null;
    this.currentMeshyTaskId = null;
    this.currentThumbnailUrl = null;

    try {
      await this.onGenerate?.(description);
      this.generateBtn.textContent = "Generate";
      this.generateBtn.disabled = false;
      this.status.textContent = "Edit the 3D prompt below, then generate.";
      this.status.style.color = "#44ff88";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      this.status.textContent = `Error: ${message}`;
      this.status.style.color = "#ff4444";
      this.generateBtn.textContent = "Generate";
      this.generateBtn.disabled = false;
      this.generateBtn.style.display = "block";
    }
  }

  private async handleStartMesh(): Promise<void> {
    const description = this.meshPromptInput.value.trim();
    if (!description) return;

    this.startMeshBtn.disabled = true;
    this.startMeshBtn.textContent = "Starting...";

    try {
      await this.onStartMesh?.(description);
      this.startMeshBtn.style.display = "none";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Mesh generation failed";
      this.status.textContent = `Error: ${message}`;
      this.status.style.color = "#ff4444";
      this.startMeshBtn.textContent = "Generate 3D Model";
      this.startMeshBtn.disabled = false;
    }
  }

  private async handleSave(): Promise<void> {
    if (!this.currentAppearance) return;

    this.saveBtn.disabled = true;
    this.saveBtn.textContent = "Saving...";

    try {
      const avatarDefinition = {
        avatarIndex: 0,
        customAppearance: this.currentAppearance,
        meshyTaskId: this.currentMeshyTaskId,
      };
      await this.onSave?.(avatarDefinition, this.currentMeshDescription || undefined, this.currentMeshyTaskId || undefined);
      this.status.textContent = "Avatar saved!";
      this.status.style.color = "#44ff88";
      // Reset to initial state
      this.saveBtn.style.display = "none";
      this.meshPromptArea.style.display = "none";
      this.meshProgress.style.display = "none";
      this.generateBtn.style.display = "block";
      this.currentThumbnailUrl = null;
      // Refresh gallery
      this.loadHistory();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      this.status.textContent = `Error: ${message}`;
      this.status.style.color = "#ff4444";
    } finally {
      this.saveBtn.textContent = "Save Avatar";
      this.saveBtn.disabled = false;
    }
  }
}
