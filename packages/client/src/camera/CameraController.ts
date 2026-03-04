import * as THREE from "three";

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3();
  private distance = 14;
  private damping = 5;
  private yaw = 0; // horizontal rotation
  private pitch = 0.4; // vertical angle (radians, 0 = level, positive = looking down)

  private static MIN_PITCH = -0.3; // look up limit
  private static MAX_PITCH = 1.2; // look down limit
  private static MIN_DISTANCE = 4;
  private static MAX_DISTANCE = 40;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  /** Apply mouse rotation delta */
  applyMouseDelta(dx: number, dy: number): void {
    this.yaw -= dx * 0.003;
    this.pitch += dy * 0.003;
    this.pitch = Math.max(
      CameraController.MIN_PITCH,
      Math.min(CameraController.MAX_PITCH, this.pitch)
    );
  }

  /** Update camera to follow target position */
  update(targetPos: THREE.Vector3, dt: number): void {
    this.target.copy(targetPos);

    // Compute camera offset from pitch + yaw
    const horizontalDist = this.distance * Math.cos(this.pitch);
    const verticalDist = this.distance * Math.sin(this.pitch);

    const offsetX = horizontalDist * Math.sin(this.yaw);
    const offsetZ = horizontalDist * Math.cos(this.yaw);
    const offsetY = verticalDist + 2; // +2 base height above avatar feet

    const desiredPos = new THREE.Vector3(
      this.target.x + offsetX,
      this.target.y + offsetY,
      this.target.z + offsetZ
    );

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
