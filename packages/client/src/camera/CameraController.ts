import * as THREE from "three";

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3();
  private offset = new THREE.Vector3(0, 8, 12);
  private damping = 5;
  private yaw = 0; // horizontal rotation

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  /** Apply mouse rotation delta */
  applyMouseDelta(dx: number, _dy: number): void {
    this.yaw -= dx * 0.003;
  }

  /** Update camera to follow target position */
  update(targetPos: THREE.Vector3, dt: number): void {
    this.target.copy(targetPos);

    // Compute desired camera position based on yaw
    const rotatedOffset = this.offset.clone();
    rotatedOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    const desiredPos = this.target.clone().add(rotatedOffset);

    // Smooth follow
    this.camera.position.lerp(desiredPos, Math.min(dt * this.damping, 1));
    this.camera.lookAt(
      this.target.x,
      this.target.y + 2, // look slightly above the avatar's feet
      this.target.z
    );
  }

  getYaw(): number {
    return this.yaw;
  }
}
