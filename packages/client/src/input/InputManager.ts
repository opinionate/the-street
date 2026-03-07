export interface InputState {
  forward: boolean;
  backward: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  strafeLeft: boolean;
  strafeRight: boolean;
  sprint: boolean;
  jump: boolean;
  chat: boolean;
  menu: boolean;
  mouseX: number;
  mouseY: number;
  leftMouseDown: boolean;
  rightMouseDown: boolean;
}

export class InputManager {
  state: InputState;
  private keys: Set<string> = new Set();
  private canvas: HTMLCanvasElement;
  private pointerLocked = false;

  onChatToggle: (() => void) | null = null;
  onSlashCommand: (() => void) | null = null;
  onZoom: ((delta: number) => void) | null = null;
  onTabTarget: ((reverse: boolean) => void) | null = null;
  onLeftClick: ((screenX: number, screenY: number) => void) | null = null;

  /** Check if UI is blocking mouse input (set by the host app) */
  isUIBlocking: (() => boolean) | null = null;

  private leftDownPos: { x: number; y: number } | null = null;
  private leftDownTime = 0;
  private static readonly DRAG_THRESHOLD = 5; // pixels
  private static readonly CLICK_MAX_MS = 300;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.state = {
      forward: false,
      backward: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
      strafeRight: false,
      sprint: false,
      jump: false,
      chat: false,
      menu: false,
      mouseX: 0,
      mouseY: 0,
      leftMouseDown: false,
      rightMouseDown: false,
    };

    document.addEventListener("keydown", this.onKeyDown.bind(this));
    document.addEventListener("keyup", this.onKeyUp.bind(this));
    document.addEventListener("mousemove", this.onMouseMove.bind(this));
    document.addEventListener("wheel", this.onWheel.bind(this), { passive: false });
    document.addEventListener("pointerlockchange", this.onPointerLockChange.bind(this));

    // Right-click: enter pointer lock to capture mouse for character rotation
    canvas.addEventListener("mousedown", this.onMouseDown.bind(this));
    document.addEventListener("mouseup", this.onMouseUp.bind(this));

    // Prevent context menu on right-click
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private onMouseDown(e: MouseEvent): void {
    // Don't capture mouse when UI panels are blocking
    if (this.isUIBlocking?.()) return;

    if (e.button === 0) {
      // Left-click: defer pointer lock — distinguish click from drag
      this.state.leftMouseDown = true;
      this.leftDownPos = { x: e.clientX, y: e.clientY };
      this.leftDownTime = performance.now();
      // Don't request pointer lock yet; wait for drag detection
    } else if (e.button === 2) {
      // Right-click → pointer lock for character turning
      e.preventDefault();
      this.state.rightMouseDown = true;
      this.updateState(); // A/D switch to strafe while right mouse held
      this.canvas.requestPointerLock();
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button === 0) {
      const wasClick = this.leftDownPos !== null && !this.pointerLocked;
      const elapsed = performance.now() - this.leftDownTime;
      this.state.leftMouseDown = false;
      this.leftDownPos = null;

      if (wasClick && elapsed < InputManager.CLICK_MAX_MS) {
        // Short click without drag — fire selection callback
        this.onLeftClick?.(e.clientX, e.clientY);
      }

      // Exit pointer lock if we were dragging
      if (!this.state.rightMouseDown && this.pointerLocked) {
        document.exitPointerLock();
      }
    } else if (e.button === 2) {
      this.state.rightMouseDown = false;
      this.updateState(); // A/D revert to turn on release
      // Only exit pointer lock if left mouse isn't also held
      if (!this.state.leftMouseDown && this.pointerLocked) {
        document.exitPointerLock();
      }
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Don't capture keys when text inputs are focused (except Tab for targeting)
    const tag = (document.activeElement as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      if (e.key === "Tab") {
        e.preventDefault();
        this.onTabTarget?.(e.shiftKey);
      } else if (e.key === "Escape") {
        (document.activeElement as HTMLElement).blur();
      }
      return;
    }

    // "/" opens chat with slash pre-filled for commands
    if (e.key === "/") {
      e.preventDefault();
      this.onSlashCommand?.();
      return;
    }

    this.keys.add(e.key.toLowerCase());
    this.updateState();

    if (e.key === "Enter") {
      e.preventDefault();
      this.onChatToggle?.();
    }
    if (e.key === "Tab") {
      e.preventDefault();
      this.onTabTarget?.(e.shiftKey);
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.key.toLowerCase());
    this.updateState();
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.pointerLocked) {
      this.state.mouseX += e.movementX;
      this.state.mouseY += e.movementY;
    }

    // Left mouse held but not yet locked — check if user is dragging
    if (this.state.leftMouseDown && !this.pointerLocked && this.leftDownPos) {
      const dx = e.clientX - this.leftDownPos.x;
      const dy = e.clientY - this.leftDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > InputManager.DRAG_THRESHOLD) {
        this.leftDownPos = null; // consumed — it's a drag, not a click
        this.canvas.requestPointerLock();
      }
    }
  }

  private onWheel(e: WheelEvent): void {
    // Don't intercept scroll when UI panels are open
    if (this.isUIBlocking?.()) return;
    // Let scrollable UI elements (chat, panels) handle their own scroll
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("#chat-ui, .panel-scrollable")) return;
    e.preventDefault();
    this.onZoom?.(e.deltaY);
  }

  consumeMouse(): { x: number; y: number } {
    const x = this.state.mouseX;
    const y = this.state.mouseY;
    this.state.mouseX = 0;
    this.state.mouseY = 0;
    return { x, y };
  }

  private onPointerLockChange(): void {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    // If pointer lock was lost externally (e.g. Escape), clear mouse states
    if (!this.pointerLocked) {
      this.state.leftMouseDown = false;
      this.state.rightMouseDown = false;
    }
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  /** Returns true when the user is left-click dragging (camera orbit active) */
  isLeftMouseDragging(): boolean {
    return this.state.leftMouseDown && this.pointerLocked;
  }

  /** Returns true when the user is right-click dragging (mouse turning active) */
  isRightMouseDragging(): boolean {
    return this.state.rightMouseDown && this.pointerLocked;
  }

  /** Returns true when both mouse buttons are held (walk forward) */
  isBothMouseDown(): boolean {
    return this.state.leftMouseDown && this.state.rightMouseDown;
  }

  private updateState(): void {
    this.state.forward = this.keys.has("w");
    this.state.backward = this.keys.has("s");
    // Right mouse held: A/D strafe instead of turn (WoW-style)
    const aKey = this.keys.has("a");
    const dKey = this.keys.has("d");
    if (this.state.rightMouseDown) {
      this.state.turnLeft = false;
      this.state.turnRight = false;
      this.state.strafeLeft = this.keys.has("q") || aKey;
      this.state.strafeRight = this.keys.has("e") || dKey;
    } else {
      this.state.turnLeft = aKey;
      this.state.turnRight = dKey;
      this.state.strafeLeft = this.keys.has("q");
      this.state.strafeRight = this.keys.has("e");
    }
    this.state.sprint = this.keys.has("shift");
    this.state.jump = this.keys.has(" ");
  }

  /** Get movement vector in local space (-1 to 1 on each axis).
   *  z: forward/backward (W/S), x: strafe (Q/E) */
  getMovementVector(): { x: number; z: number } {
    let x = 0;
    let z = 0;
    if (this.state.forward) z += 1;
    if (this.state.backward) z -= 1;
    if (this.state.strafeLeft) x += 1;
    if (this.state.strafeRight) x -= 1;

    // Normalize diagonal movement
    const len = Math.sqrt(x * x + z * z);
    if (len > 0) {
      x /= len;
      z /= len;
    }

    return { x, z };
  }

  isMoving(): boolean {
    return (
      this.state.forward ||
      this.state.backward ||
      this.state.strafeLeft ||
      this.state.strafeRight
    );
  }

  isTurning(): boolean {
    return this.state.turnLeft || this.state.turnRight;
  }
}
