export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  interact: boolean;
  chat: boolean;
  menu: boolean;
  mouseX: number;
  mouseY: number;
}

export class InputManager {
  state: InputState;
  private keys: Set<string> = new Set();
  private canvas: HTMLCanvasElement;
  private pointerLocked = false;

  onChatToggle: (() => void) | null = null;
  onInteract: (() => void) | null = null;
  onZoom: ((delta: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.state = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      interact: false,
      chat: false,
      menu: false,
      mouseX: 0,
      mouseY: 0,
    };

    document.addEventListener("keydown", this.onKeyDown.bind(this));
    document.addEventListener("keyup", this.onKeyUp.bind(this));
    document.addEventListener("mousemove", this.onMouseMove.bind(this));
    document.addEventListener("wheel", this.onWheel.bind(this), { passive: false });
    canvas.addEventListener("click", this.requestPointerLock.bind(this));
    document.addEventListener("pointerlockchange", this.onPointerLockChange.bind(this));
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Don't capture keys when text inputs are focused
    const tag = (document.activeElement as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      if (e.key === "Escape") {
        (document.activeElement as HTMLElement).blur();
      }
      return;
    }

    this.keys.add(e.key.toLowerCase());
    this.updateState();

    if (e.key === "Enter") {
      e.preventDefault();
      this.onChatToggle?.();
    }
    if (e.key.toLowerCase() === "e") {
      this.onInteract?.();
    }
    if (e.key === "Escape" && this.pointerLocked) {
      document.exitPointerLock();
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
  }

  private onWheel(e: WheelEvent): void {
    if (this.pointerLocked) {
      e.preventDefault();
      this.onZoom?.(e.deltaY);
    }
  }

  consumeMouse(): { x: number; y: number } {
    const x = this.state.mouseX;
    const y = this.state.mouseY;
    this.state.mouseX = 0;
    this.state.mouseY = 0;
    return { x, y };
  }

  private requestPointerLock(): void {
    this.canvas.requestPointerLock();
  }

  private onPointerLockChange(): void {
    this.pointerLocked = document.pointerLockElement === this.canvas;
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  private updateState(): void {
    this.state.forward = this.keys.has("w");
    this.state.backward = this.keys.has("s");
    this.state.left = this.keys.has("a");
    this.state.right = this.keys.has("d");
    this.state.sprint = this.keys.has("shift");
  }

  /** Get movement vector in local space (-1 to 1 on each axis) */
  getMovementVector(): { x: number; z: number } {
    let x = 0;
    let z = 0;
    if (this.state.forward) z -= 1;
    if (this.state.backward) z += 1;
    if (this.state.left) x -= 1;
    if (this.state.right) x += 1;

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
      this.state.left ||
      this.state.right
    );
  }
}
