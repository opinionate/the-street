import type { AuthManager } from "../auth/AuthManager.js";

/**
 * Full-screen login overlay matching the game's dark theme.
 * Mounts Clerk's SignIn component and waits for authentication.
 */
export class LoginUI {
  private overlay: HTMLDivElement;
  private signInContainer: HTMLDivElement;
  private authManager: AuthManager;

  onAuthenticated: (() => void) | null = null;

  constructor(authManager: AuthManager) {
    this.authManager = authManager;

    // Full-screen overlay
    this.overlay = document.createElement("div");
    this.overlay.id = "login-overlay";
    this.overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 10000;
      background: rgba(5, 5, 10, 0.97);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: system-ui, sans-serif;
    `;

    // Title
    const title = document.createElement("h1");
    title.textContent = "The Street";
    title.style.cssText = `
      color: #00ffff;
      font-size: 36px;
      font-weight: bold;
      margin: 0 0 8px 0;
      letter-spacing: 2px;
    `;
    this.overlay.appendChild(title);

    // Subtitle
    const subtitle = document.createElement("div");
    subtitle.textContent = "A multiplayer virtual world";
    subtitle.style.cssText = `
      color: rgba(255, 255, 255, 0.4);
      font-size: 14px;
      margin-bottom: 32px;
    `;
    this.overlay.appendChild(subtitle);

    // Clerk sign-in mount point
    this.signInContainer = document.createElement("div");
    this.signInContainer.id = "clerk-sign-in";
    this.overlay.appendChild(this.signInContainer);

    document.body.appendChild(this.overlay);
  }

  show(): void {
    this.overlay.style.display = "flex";
    this.authManager.mountSignIn(this.signInContainer);

    // Listen for auth state changes
    this.authManager.addListener(() => {
      if (this.authManager.isSignedIn) {
        this.hide();
        this.onAuthenticated?.();
      }
    });
  }

  hide(): void {
    this.overlay.style.display = "none";
    this.authManager.unmountSignIn(this.signInContainer);
  }

  destroy(): void {
    this.overlay.remove();
  }
}
