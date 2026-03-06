import type { UserRole } from "@the-street/shared";

interface AdminUser {
  id: string;
  clerk_id: string;
  display_name: string;
  role: UserRole;
  created_at: string;
  last_seen_at: string | null;
}

/**
 * Admin dashboard panel for managing users and roles.
 * Only visible to super_admin users. Toggled with F9.
 */
export class AdminPanel {
  private container: HTMLDivElement;
  private userList: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private visible = false;

  onLoadUsers: (() => Promise<AdminUser[]>) | null = null;
  onSetRole: ((userId: string, role: UserRole) => Promise<void>) | null = null;

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "admin-panel";
    this.container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 620px;
      max-height: 80vh;
      background: rgba(10, 10, 15, 0.95);
      border: 1px solid rgba(255, 68, 68, 0.4);
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
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: space-between;
    `;
    const title = document.createElement("div");
    title.innerHTML = '<span style="color:#ff4444;font-weight:bold">ADMIN</span> Dashboard';
    title.style.cssText = "font-size: 16px; font-weight: bold;";
    header.appendChild(title);

    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "Refresh";
    refreshBtn.style.cssText = `
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px; color: rgba(255, 255, 255, 0.7);
      font-size: 12px; padding: 4px 12px; cursor: pointer;
      margin-right: 8px;
    `;
    refreshBtn.addEventListener("click", () => this.loadUsers());

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "\u00D7";
    closeBtn.style.cssText = `
      background: none; border: none;
      color: rgba(255, 255, 255, 0.6);
      font-size: 22px; cursor: pointer; padding: 0 4px;
    `;
    closeBtn.addEventListener("click", () => this.hide());

    const btnGroup = document.createElement("div");
    btnGroup.style.cssText = "display:flex;align-items:center;gap:4px;";
    btnGroup.appendChild(refreshBtn);
    btnGroup.appendChild(closeBtn);
    header.appendChild(btnGroup);
    this.container.appendChild(header);

    // User list area
    this.userList = document.createElement("div");
    this.userList.style.cssText = `
      padding: 12px 20px;
      overflow-y: auto;
      max-height: calc(80vh - 100px);
    `;
    this.container.appendChild(this.userList);

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

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.container.style.display = "block";
    this.loadUsers();
  }

  hide(): void {
    this.visible = false;
    this.container.style.display = "none";
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  private async loadUsers(): Promise<void> {
    if (!this.onLoadUsers) return;
    this.statusEl.textContent = "Loading users...";
    try {
      const users = await this.onLoadUsers();
      this.renderUserList(users);
      this.statusEl.textContent = `${users.length} user${users.length !== 1 ? "s" : ""}`;
    } catch (err) {
      this.statusEl.textContent = `Error: ${err instanceof Error ? err.message : "Failed to load"}`;
    }
  }

  /** Append a custom section element to the admin panel */
  appendSection(element: HTMLElement): void {
    this.container.insertBefore(element, this.statusEl);
  }

  private renderUserList(users: AdminUser[]): void {
    this.userList.innerHTML = "";

    if (users.length === 0) {
      this.userList.innerHTML = '<div style="color:rgba(255,255,255,0.4);text-align:center;padding:20px">No users found</div>';
      return;
    }

    // Header row
    const headerRow = document.createElement("div");
    headerRow.style.cssText = `
      display: grid;
      grid-template-columns: 1fr 120px 140px;
      gap: 8px;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 11px;
      color: rgba(255, 255, 255, 0.4);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    headerRow.innerHTML = "<span>User</span><span>Role</span><span>Last Seen</span>";
    this.userList.appendChild(headerRow);

    for (const user of users) {
      const row = document.createElement("div");
      row.style.cssText = `
        display: grid;
        grid-template-columns: 1fr 120px 140px;
        gap: 8px;
        padding: 8px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        align-items: center;
        font-size: 13px;
      `;

      // Name cell
      const nameCell = document.createElement("div");
      nameCell.style.cssText = "overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
      nameCell.textContent = user.display_name;
      nameCell.title = `ID: ${user.id}\nClerk: ${user.clerk_id}`;

      // Role cell — dropdown
      const roleCell = document.createElement("div");
      const select = document.createElement("select");
      select.style.cssText = `
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid ${user.role === "super_admin" ? "rgba(255, 68, 68, 0.4)" : "rgba(255, 255, 255, 0.15)"};
        border-radius: 4px;
        color: ${user.role === "super_admin" ? "#ff6666" : "rgba(255, 255, 255, 0.7)"};
        font-size: 12px;
        padding: 3px 6px;
        cursor: pointer;
        width: 110px;
      `;
      const optUser = document.createElement("option");
      optUser.value = "user";
      optUser.textContent = "User";
      const optAdmin = document.createElement("option");
      optAdmin.value = "super_admin";
      optAdmin.textContent = "Super Admin";
      select.appendChild(optUser);
      select.appendChild(optAdmin);
      select.value = user.role;

      select.addEventListener("change", async () => {
        const newRole = select.value as UserRole;
        if (this.onSetRole) {
          try {
            await this.onSetRole(user.id, newRole);
            select.style.borderColor = newRole === "super_admin" ? "rgba(255, 68, 68, 0.4)" : "rgba(255, 255, 255, 0.15)";
            select.style.color = newRole === "super_admin" ? "#ff6666" : "rgba(255, 255, 255, 0.7)";
          } catch {
            select.value = user.role; // revert on failure
          }
        }
      });
      roleCell.appendChild(select);

      // Last seen cell
      const seenCell = document.createElement("div");
      seenCell.style.cssText = "color: rgba(255, 255, 255, 0.4); font-size: 11px;";
      seenCell.textContent = user.last_seen_at
        ? new Date(user.last_seen_at).toLocaleDateString()
        : "Never";

      row.appendChild(nameCell);
      row.appendChild(roleCell);
      row.appendChild(seenCell);
      this.userList.appendChild(row);
    }
  }
}
