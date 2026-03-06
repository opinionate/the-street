import { Clerk } from "@clerk/clerk-js";
import type { UserRole } from "@the-street/shared";

/**
 * Manages Clerk authentication session on the client.
 * Provides token retrieval for API calls and WebSocket auth.
 */
export class AuthManager {
  private clerk: Clerk;
  private _role: UserRole = "user";

  onSignIn: (() => void) | null = null;
  onSignOut: (() => void) | null = null;

  constructor(publishableKey: string) {
    this.clerk = new Clerk(publishableKey);
  }

  async init(): Promise<void> {
    await this.clerk.load();
  }

  get isSignedIn(): boolean {
    return !!this.clerk.session;
  }

  get displayName(): string {
    return (
      this.clerk.user?.fullName ||
      this.clerk.user?.firstName ||
      "Player"
    );
  }

  get role(): UserRole {
    return this._role;
  }

  set role(r: UserRole) {
    this._role = r;
  }

  async getToken(): Promise<string | null> {
    if (!this.clerk.session) return null;
    return this.clerk.session.getToken();
  }

  /**
   * Mount the Clerk sign-in UI into a container element.
   * Themed to match the game's dark aesthetic.
   */
  mountSignIn(container: HTMLDivElement): void {
    this.clerk.mountSignIn(container, {
      appearance: {
        variables: {
          colorPrimary: "#00aacc",
          colorBackground: "#0a0a0f",
          colorText: "#ffffff",
          colorTextSecondary: "rgba(255,255,255,0.6)",
          colorInputBackground: "rgba(255,255,255,0.1)",
          colorInputText: "#ffffff",
          borderRadius: "8px",
        },
      },
    });
  }

  unmountSignIn(container: HTMLDivElement): void {
    this.clerk.unmountSignIn(container);
  }

  async signOut(): Promise<void> {
    await this.clerk.signOut();
    this.onSignOut?.();
  }

  /**
   * Listen for auth state changes (sign in, sign out, session updates).
   */
  addListener(callback: (event: unknown) => void): void {
    this.clerk.addListener(callback);
  }
}
