import * as THREE from "three";

const SHADOW_FRUSTUM = 60; // half-size of the shadow camera frustum around player

export class StreetScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  clock: THREE.Clock;

  /** Directional light whose shadow follows the player */
  private sunLight: THREE.DirectionalLight;

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

    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    document.body.appendChild(this.renderer.domElement);

    // Lighting — bright enough to see avatar detail
    const ambient = new THREE.AmbientLight(0xccccdd, 2.0);
    this.scene.add(ambient);

    // Main directional light — shadow frustum follows player each frame
    this.sunLight = new THREE.DirectionalLight(0xccccff, 2.5);
    this.sunLight.position.set(50, 200, 50);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 300;
    this.sunLight.shadow.camera.left = -SHADOW_FRUSTUM;
    this.sunLight.shadow.camera.right = SHADOW_FRUSTUM;
    this.sunLight.shadow.camera.top = SHADOW_FRUSTUM;
    this.sunLight.shadow.camera.bottom = -SHADOW_FRUSTUM;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

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

  /** Move the shadow frustum to center on the player */
  updateShadowTarget(playerPos: THREE.Vector3): void {
    this.sunLight.target.position.set(playerPos.x, 0, playerPos.z);
    this.sunLight.position.set(playerPos.x + 50, 200, playerPos.z + 50);
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
