import * as THREE from "three";

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3();
  private distance = 4; // spawn zoomed in
  private damping = 5;
  private yaw = 0; // horizontal rotation
  private pitch = 0.3; // vertical angle (radians, 0 = level, positive = looking down)

  private static MIN_PITCH = 0.0; // allow nearly level view
  private static MAX_PITCH = 1.2; // look down limit
  private static MIN_DISTANCE = 2;
  private static MAX_DISTANCE = 40;
  private _lastDt = 1 / 60;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  /** Apply mouse rotation delta (pitch only — yaw follows character via setYaw) */
  applyMouseDelta(dx: number, dy: number): void {
    this.yaw -= dx * 0.003;
    this.pitch += dy * 0.003;
    this.pitch = Math.max(
      CameraController.MIN_PITCH,
      Math.min(CameraController.MAX_PITCH, this.pitch)
    );
  }

  /** Smoothly follow a target yaw (used to follow character rotation) */
  setYaw(yaw: number): void {
    // Shortest-path interpolation
    let diff = yaw - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(this._lastDt * this.damping, 1);
  }

  /** Snap camera yaw instantly (no interpolation) */
  snapYaw(yaw: number): void {
    this.yaw = yaw;
  }

  /** Update camera to follow target position */
  update(targetPos: THREE.Vector3, dt: number): void {
    this._lastDt = dt;
    this.target.copy(targetPos);

    // Compute camera offset from pitch + yaw
    const horizontalDist = this.distance * Math.cos(this.pitch);
    const verticalDist = this.distance * Math.sin(this.pitch);

    const offsetX = horizontalDist * Math.sin(this.yaw);
    const offsetZ = horizontalDist * Math.cos(this.yaw);
    // Base height scales with distance: close-up = shoulder height, far = higher overview
    const baseHeight = 1.2 + (this.distance - CameraController.MIN_DISTANCE) * 0.06;
    const offsetY = verticalDist + baseHeight;

    const desiredPos = new THREE.Vector3(
      this.target.x + offsetX,
      this.target.y + offsetY,
      this.target.z + offsetZ
    );

    // Clamp camera just above ground
    desiredPos.y = Math.max(desiredPos.y, 0.3);

    // Smooth follow
    this.camera.position.lerp(desiredPos, Math.min(dt * this.damping, 1));
    this.camera.lookAt(
      this.target.x,
      this.target.y + 1.5,
      this.target.z
    );
  }

  /** Apply scroll wheel zoom */
  applyZoom(delta: number): void {
    this.distance += delta * 0.01;
    this.distance = Math.max(
      CameraController.MIN_DISTANCE,
      Math.min(CameraController.MAX_DISTANCE, this.distance)
    );
  }

  getYaw(): number {
    return this.yaw;
  }
}
