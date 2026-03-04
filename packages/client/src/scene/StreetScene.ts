import * as THREE from "three";

export class StreetScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  clock: THREE.Clock;

  private updateCallbacks: Array<(dt: number) => void> = [];

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050508); // void black
    this.scene.fog = new THREE.Fog(0x050508, 150, 400);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 10, 30);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(this.renderer.domElement);

    // Lighting — bright enough to see avatar detail
    const ambient = new THREE.AmbientLight(0xccccdd, 2.0);
    this.scene.add(ambient);

    // Main directional light (warm-white, bright)
    const moon = new THREE.DirectionalLight(0xccccff, 2.5);
    moon.position.set(50, 200, 50);
    moon.castShadow = true;
    moon.shadow.mapSize.width = 2048;
    moon.shadow.mapSize.height = 2048;
    moon.shadow.camera.near = 0.5;
    moon.shadow.camera.far = 500;
    moon.shadow.camera.left = -250;
    moon.shadow.camera.right = 250;
    moon.shadow.camera.top = 250;
    moon.shadow.camera.bottom = -250;
    this.scene.add(moon);

    // Warm fill light from opposite side
    const fill = new THREE.DirectionalLight(0xddccaa, 1.2);
    fill.position.set(-80, 100, -60);
    this.scene.add(fill);

    // Hemisphere light — sky/ground ambient
    const neonUp = new THREE.HemisphereLight(0x8899cc, 0x554466, 0.8);
    this.scene.add(neonUp);

    this.clock = new THREE.Clock();

    window.addEventListener("resize", this.onResize.bind(this));
  }

  onUpdate(cb: (dt: number) => void): void {
    this.updateCallbacks.push(cb);
  }

  start(): void {
    const animate = () => {
      requestAnimationFrame(animate);
      const dt = this.clock.getDelta();
      for (const cb of this.updateCallbacks) {
        cb(dt);
      }
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
