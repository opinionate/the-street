/**
 * Admin tool: upload a Mixamo FBX file to use as the default avatar
 * for all players who haven't customized their avatar.
 *
 * Converts FBX → GLB in the browser and uploads to the server.
 */
import { convertFbxCharacterToGlb } from "../avatar/animation-converter.js";

export class DefaultModelUploader {
  private container: HTMLDivElement;
  private logEl: HTMLDivElement;
  private fileInput: HTMLInputElement;
  private uploadBtn: HTMLButtonElement;
  private apiUrl: string;
  private getAuthToken: () => Promise<string>;

  /** Called after the default model is uploaded so the caller can reload avatars */
  onModelUploaded: (() => void) | null = null;

  constructor(apiUrl: string, getAuthToken: () => Promise<string>) {
    this.apiUrl = apiUrl;
    this.getAuthToken = getAuthToken;

    this.container = document.createElement("div");
    this.container.style.cssText = `
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    `;

    const label = document.createElement("div");
    label.style.cssText = "font-size: 12px; color: rgba(255, 255, 255, 0.5); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;";
    label.textContent = "Default Avatar Model";
    this.container.appendChild(label);

    const desc = document.createElement("div");
    desc.style.cssText = "font-size: 11px; color: rgba(255, 255, 255, 0.3); margin-bottom: 10px;";
    desc.textContent = "Upload a Mixamo FBX character to replace the procedural capsule avatar. This will be used for all players without a custom avatar.";
    this.container.appendChild(desc);

    // File input
    const fileRow = document.createElement("div");
    fileRow.style.cssText = "display: flex; gap: 8px; margin-bottom: 8px; align-items: center;";

    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = ".fbx";
    this.fileInput.style.cssText = "flex: 1; font-size: 11px; color: rgba(255,255,255,0.6);";
    fileRow.appendChild(this.fileInput);
    this.container.appendChild(fileRow);

    this.uploadBtn = document.createElement("button");
    this.uploadBtn.textContent = "Convert & Upload Default Model";
    this.uploadBtn.style.cssText = `
      background: rgba(68, 200, 68, 0.2);
      border: 1px solid rgba(68, 200, 68, 0.4);
      border-radius: 4px;
      color: #44cc44;
      font-size: 12px;
      padding: 6px 16px;
      cursor: pointer;
      width: 100%;
    `;
    this.uploadBtn.addEventListener("click", () => this.handleUpload());
    this.container.appendChild(this.uploadBtn);

    this.logEl = document.createElement("div");
    this.logEl.style.cssText = `
      margin-top: 8px;
      max-height: 150px;
      overflow-y: auto;
      font-size: 11px;
      font-family: monospace;
      color: rgba(255, 255, 255, 0.5);
    `;
    this.container.appendChild(this.logEl);
  }

  get element(): HTMLDivElement {
    return this.container;
  }

  private log(msg: string, color = "rgba(255, 255, 255, 0.5)"): void {
    const line = document.createElement("div");
    line.style.cssText = `color: ${color}; padding: 1px 0;`;
    line.textContent = msg;
    this.logEl.appendChild(line);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private async handleUpload(): Promise<void> {
    const file = this.fileInput.files?.[0];
    if (!file) {
      this.log("No file selected", "#ffaa00");
      return;
    }

    this.uploadBtn.disabled = true;
    this.uploadBtn.textContent = "Converting...";
    this.logEl.innerHTML = "";

    try {
      this.log(`Loading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`);

      // Convert FBX → GLB in the browser
      this.log("Converting FBX to GLB (this may take a moment)...");
      const glbBuffer = await convertFbxCharacterToGlb(file);
      this.log(`GLB conversion complete: ${(glbBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`, "#44ff44");

      // Upload to server
      this.log("Uploading to server...");
      const token = await this.getAuthToken();
      const res = await fetch(`${this.apiUrl}/api/avatar/default-model`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          Authorization: `Bearer ${token}`,
        },
        body: glbBuffer,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        this.log(`Upload failed: ${err.error}`, "#ff4444");
        return;
      }

      this.log("Default model uploaded successfully!", "#44ff44");
      this.log("Reload the page or reconnect to see it applied.", "#44ff44");
      this.onModelUploaded?.();
    } catch (err) {
      this.log(`ERROR: ${err instanceof Error ? err.message : err}`, "#ff4444");
    } finally {
      this.uploadBtn.disabled = false;
      this.uploadBtn.textContent = "Convert & Upload Default Model";
    }
  }
}
