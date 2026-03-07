import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { WorldObject, PBRMaterial } from "@the-street/shared";

/**
 * Converts WorldObject definitions into Three.js meshes.
 * Archetypes get recognizable procedural geometry.
 * Novel meshes get a multi-material composite placeholder.
 */
export class ObjectRenderer {
  private objectMeshes = new Map<string, THREE.Group>();
  private novelPlaceholders: THREE.Group[] = []; // for shimmer animation
  private progressSprites = new Map<string, { sprite: THREE.Sprite; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }>();
  private scene: THREE.Scene;
  private gltfLoader = new GLTFLoader();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Replace a placeholder with a loaded GLB model.
   *  Set applyMaterials=true for models that lack proper textures. */
  async loadGLB(objectId: string, glbUrl: string, applyMaterials = true): Promise<void> {
    const existing = this.objectMeshes.get(objectId);
    if (!existing) return;

    // Save position before replacing
    const pos = existing.position.clone();
    const rot = existing.rotation.clone();
    const objectName = existing.userData.objectName || objectId;
    const colliderSize = existing.userData.colliderSize;
    const pbrMaterials: PBRMaterial[] = existing.userData.materials || [];

    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        glbUrl,
        (gltf) => {
          // Clear progress indicator
          this.clearProgress(objectId);

          // Remove placeholder children but keep the group
          while (existing.children.length > 0) {
            const child = existing.children[0];
            existing.remove(child);
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose();
              if (Array.isArray(child.material)) {
                child.material.forEach((m) => m.dispose());
              } else if (child.material) {
                child.material.dispose();
              }
            }
          }

          // Remove from novel placeholders (stop animation)
          this.novelPlaceholders = this.novelPlaceholders.filter(
            (g) => g !== existing
          );

          // Add the loaded model
          const model = gltf.scene;

          // Apply AI-generated PBR materials to model meshes
          let meshIndex = 0;
          model.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;

              if (applyMaterials && pbrMaterials.length > 0) {
                // Cycle through AI materials for each mesh part
                const pbr = pbrMaterials[meshIndex % pbrMaterials.length];
                child.material = this.buildMaterial(pbr);
                meshIndex++;
              }
            }
          });

          // Scale model to match the intended collider size
          const box = new THREE.Box3().setFromObject(model);
          const modelSize = box.getSize(new THREE.Vector3());
          if (colliderSize && modelSize.x > 0 && modelSize.y > 0 && modelSize.z > 0) {
            const scaleX = colliderSize.x / modelSize.x;
            const scaleY = colliderSize.y / modelSize.y;
            const scaleZ = colliderSize.z / modelSize.z;
            // Use uniform scale based on the best fit
            const uniformScale = Math.min(scaleX, scaleY, scaleZ) * 1.2;
            model.scale.multiplyScalar(uniformScale);
          }

          // Center at ground level
          const newBox = new THREE.Box3().setFromObject(model);
          const center = newBox.getCenter(new THREE.Vector3());
          model.position.y -= newBox.min.y; // sit on ground
          model.position.x -= center.x;
          model.position.z -= center.z;

          existing.add(model);

          // Restore position
          existing.position.copy(pos);
          existing.rotation.copy(rot);

          // Re-add a label with the actual object name
          const label = this.createLabel(objectName);
          const finalBox = new THREE.Box3().setFromObject(model);
          const modelHeight = finalBox.max.y - finalBox.min.y;
          label.position.y = modelHeight + 0.5;
          existing.add(label);

          console.log(`Loaded GLB for ${objectId} ("${objectName}")`);
          resolve();
        },
        undefined,
        (error) => {
          console.error(`Failed to load GLB for ${objectId}:`, error);
          reject(error);
        }
      );
    });
  }


  /** Update the progress indicator on a novel placeholder */
  setProgress(objectId: string, pct: number, status?: string): void {
    const group = this.objectMeshes.get(objectId);
    if (!group) return;

    let entry = this.progressSprites.get(objectId);
    if (!entry) {
      // Create on first call
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const texture = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(2, 2, 1);
      sprite.name = "progress_sprite";

      // Position above the object
      const height = group.userData.colliderHeight ?? 2.5;
      sprite.position.y = height + 1.5;
      group.add(sprite);

      entry = { sprite, canvas, texture };
      this.progressSprites.set(objectId, entry);
    }

    // Draw the progress ring
    this.drawProgressRing(entry.canvas, pct, status);
    entry.texture.needsUpdate = true;
  }

  /** Remove progress indicator */
  clearProgress(objectId: string): void {
    const entry = this.progressSprites.get(objectId);
    if (entry) {
      entry.sprite.parent?.remove(entry.sprite);
      entry.texture.dispose();
      entry.sprite.material.dispose();
      this.progressSprites.delete(objectId);
    }
  }

  private drawProgressRing(canvas: HTMLCanvasElement, pct: number, status?: string): void {
    const ctx = canvas.getContext("2d")!;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = 80;
    const lineWidth = 12;

    ctx.clearRect(0, 0, w, h);

    // Background circle
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // Progress arc
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + (Math.PI * 2 * pct) / 100;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = pct < 100 ? "#ffaa00" : "#44ff88";
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.stroke();

    // Percentage text
    ctx.fillStyle = "white";
    ctx.font = "bold 48px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(pct)}%`, cx, cy);

    // Status text below
    if (status) {
      ctx.font = "20px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.fillText(status, cx, cy + radius + 24, w - 20);
    }
  }

  /** Render a WorldObject into the scene at a given world position */
  renderObject(
    objectId: string,
    obj: WorldObject,
    worldPosition?: { x: number; y: number; z: number }
  ): THREE.Group {
    this.removeObject(objectId);

    const group = new THREE.Group();
    group.name = `obj_${objectId}`;

    // Store object metadata for later use (GLB loading, labels)
    group.userData.objectName = obj.name;
    group.userData.colliderSize = obj.physics.colliderSize;
    group.userData.materials = obj.materials;

    if (obj.meshDefinition.type === "novel") {
      this.buildNovelPlaceholder(group, obj);
    } else {
      this.buildArchetypeMesh(group, obj);
    }

    // Apply object transform
    group.position.set(obj.origin.x, obj.origin.y, obj.origin.z);
    group.scale.set(obj.scale.x, obj.scale.y, obj.scale.z);
    group.quaternion.set(
      obj.rotation.x,
      obj.rotation.y,
      obj.rotation.z,
      obj.rotation.w
    );

    // World position override
    if (worldPosition) {
      group.position.set(
        worldPosition.x + obj.origin.x,
        obj.origin.y,
        worldPosition.z + obj.origin.z
      );
    }

    // Floating name label
    const label = this.createLabel(obj.name);
    const height = obj.physics.colliderSize.y || 1;
    label.position.y = height + 0.5;
    group.add(label);

    this.scene.add(group);
    this.objectMeshes.set(objectId, group);

    return group;
  }

  removeObject(objectId: string): void {
    const existing = this.objectMeshes.get(objectId);
    if (existing) {
      this.clearProgress(objectId);
      this.scene.remove(existing);
      this.novelPlaceholders = this.novelPlaceholders.filter((g) => g !== existing);
      existing.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      this.objectMeshes.delete(objectId);
    }
  }

  /** Get all object groups for raycasting */
  getObjectGroups(): Map<string, THREE.Group> {
    return this.objectMeshes;
  }

  /** Call each frame to animate novel placeholders */
  update(time: number): void {
    for (const group of this.novelPlaceholders) {
      // Gentle hover bob
      const base = group.userData.baseY ?? 0;
      group.position.y = base + Math.sin(time * 2) * 0.1;
      // Slow rotation
      group.rotation.y += 0.002;
    }
  }

  // ─── Novel mesh placeholder ──────────────────────────────────

  private buildNovelPlaceholder(group: THREE.Group, obj: WorldObject): void {
    const size = obj.physics.colliderSize;
    const mats = obj.materials;

    // Main body — use the collider shape but with layered materials
    const bodyHeight = size.y;
    const bodyWidth = size.x;
    const bodyDepth = size.z;

    // Primary body shape based on collider
    const { colliderShape } = obj.physics;
    let bodyGeo: THREE.BufferGeometry;

    if (colliderShape === "capsule") {
      // Elongate along the longest horizontal axis for more interesting shapes
      const radius = Math.min(bodyWidth, bodyDepth) / 2;
      const cylinderHeight = Math.max(0, bodyHeight - radius * 2);
      bodyGeo = new THREE.CapsuleGeometry(radius, cylinderHeight, 8, 16);
      // If wider than tall, rotate to lay on side
      if (bodyWidth > bodyHeight * 1.3) {
        bodyGeo.rotateZ(Math.PI / 2);
      }
    } else if (colliderShape === "sphere") {
      bodyGeo = new THREE.SphereGeometry(
        Math.max(bodyWidth, bodyHeight, bodyDepth) / 2,
        16,
        12
      );
    } else {
      bodyGeo = new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyDepth);
    }

    const primaryMat = this.buildMaterial(mats[0]);
    primaryMat.transparent = true;
    primaryMat.opacity = Math.max(primaryMat.opacity * 0.85, 0.5);
    const body = new THREE.Mesh(bodyGeo, primaryMat);
    body.position.y = bodyHeight / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Secondary material accent strips (horizontal bands)
    if (mats.length >= 2) {
      const bandCount = Math.min(mats.length - 1, 3);
      for (let i = 0; i < bandCount; i++) {
        const bandMat = this.buildMaterial(mats[i + 1]);
        const bandHeight = bodyHeight * 0.12;
        const bandY = bodyHeight * (0.3 + i * 0.25);
        const bandGeo = new THREE.BoxGeometry(
          bodyWidth * 1.02,
          bandHeight,
          bodyDepth * 1.02
        );
        const band = new THREE.Mesh(bandGeo, bandMat);
        band.position.y = bandY;
        group.add(band);
      }
    }

    // Glowing wireframe outline
    const wireGeo = new THREE.EdgesGeometry(bodyGeo);
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x66bbff,
      opacity: 0.4,
      transparent: true,
    });
    const wire = new THREE.LineSegments(wireGeo, wireMat);
    wire.position.y = bodyHeight / 2;
    group.add(wire);

    // Store collider height for progress sprite positioning
    group.userData.colliderHeight = bodyHeight;

    // Ground ring / base
    const ringGeo = new THREE.RingGeometry(
      Math.max(bodyWidth, bodyDepth) * 0.5,
      Math.max(bodyWidth, bodyDepth) * 0.55,
      32
    );
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x66bbff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.02;
    group.add(ring);

    group.userData.baseY = 0;
    this.novelPlaceholders.push(group);
  }

  // ─── Archetype mesh builder ──────────────────────────────────

  private buildArchetypeMesh(group: THREE.Group, obj: WorldObject): void {
    if (obj.meshDefinition.type !== "archetype") return;
    const id = obj.meshDefinition.archetypeId;
    const size = obj.physics.colliderSize;

    // Trees
    if (id.startsWith("std:tree")) {
      this.buildTree(group, obj, size);
      return;
    }

    // Bushes / vegetation
    if (id === "std:bush" || id === "std:grass_patch" || id === "std:flower_bed") {
      this.buildVegetation(group, obj, size);
      return;
    }

    // Lamps / lights
    if (id.includes("light") || id.includes("lamp") || id.includes("lantern")) {
      this.buildLight(group, obj, size);
      return;
    }

    // Doors
    if (id.includes("door")) {
      this.buildDoor(group, obj, size);
      return;
    }

    // Chairs / benches (seating)
    if (id === "std:chair" || id === "std:bench" || id === "std:couch") {
      this.buildSeating(group, obj, size);
      return;
    }

    // Tables / desks / counters
    if (id === "std:table" || id === "std:desk" || id === "std:counter") {
      this.buildTable(group, obj, size);
      return;
    }

    // Default: colored box with wireframe
    this.buildDefaultBox(group, obj, size);
  }

  private buildTree(
    group: THREE.Group,
    obj: WorldObject,
    size: { x: number; y: number; z: number }
  ): void {
    // Trunk
    const trunkRadius = Math.max(size.x, size.z) * 0.12;
    const trunkHeight = size.y * 0.55;
    const trunkGeo = new THREE.CylinderGeometry(
      trunkRadius * 0.7,
      trunkRadius,
      trunkHeight,
      8
    );
    const trunkMat = new THREE.MeshStandardMaterial({
      color: obj.materials[0]?.baseColor || "#5C4033",
      roughness: 0.95,
    });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = trunkHeight / 2;
    trunk.castShadow = true;
    group.add(trunk);

    // Canopy
    const isPine = obj.meshDefinition.type === "archetype" &&
      obj.meshDefinition.archetypeId.includes("pine");
    const canopyColor = obj.materials[1]?.baseColor || "#228B22";
    const canopyMat = new THREE.MeshStandardMaterial({
      color: canopyColor,
      roughness: 0.8,
    });

    if (isPine) {
      // Cone canopy for pine
      const coneGeo = new THREE.ConeGeometry(size.x * 0.6, size.y * 0.55, 8);
      const cone = new THREE.Mesh(coneGeo, canopyMat);
      cone.position.y = trunkHeight + size.y * 0.55 / 2 - 0.3;
      cone.castShadow = true;
      group.add(cone);
    } else {
      // Sphere canopy for deciduous
      const canopyGeo = new THREE.SphereGeometry(
        Math.max(size.x, size.z) * 0.55,
        12,
        8
      );
      const canopy = new THREE.Mesh(canopyGeo, canopyMat);
      canopy.position.y = trunkHeight + Math.max(size.x, size.z) * 0.2;
      canopy.castShadow = true;
      group.add(canopy);
    }
  }

  private buildVegetation(
    group: THREE.Group,
    obj: WorldObject,
    size: { x: number; y: number; z: number }
  ): void {
    const color = obj.materials[0]?.baseColor || "#228B22";
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });

    // Cluster of spheres
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const r = size.y * (0.25 + Math.random() * 0.2);
      const geo = new THREE.SphereGeometry(r, 8, 6);
      const sphere = new THREE.Mesh(geo, mat);
      sphere.position.set(
        (Math.random() - 0.5) * size.x * 0.6,
        r * 0.7,
        (Math.random() - 0.5) * size.z * 0.6
      );
      sphere.castShadow = true;
      group.add(sphere);
    }
  }

  private buildLight(
    group: THREE.Group,
    obj: WorldObject,
    size: { x: number; y: number; z: number }
  ): void {
    // Pole
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.08, size.y * 0.85, 6);
    const poleMat = new THREE.MeshStandardMaterial({
      color: obj.materials[0]?.baseColor || "#333333",
      metalness: 0.6,
      roughness: 0.4,
    });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = size.y * 0.85 / 2;
    pole.castShadow = true;
    group.add(pole);

    // Light fixture
    const fixtureGeo = new THREE.SphereGeometry(size.x * 0.3, 8, 6);
    const emissiveColor = obj.materials[0]?.emissive || "#FFD700";
    const fixtureMat = new THREE.MeshStandardMaterial({
      color: emissiveColor,
      emissive: emissiveColor,
      emissiveIntensity: 1.5,
    });
    const fixture = new THREE.Mesh(fixtureGeo, fixtureMat);
    fixture.position.y = size.y * 0.85;
    group.add(fixture);

    // Actual point light
    const light = new THREE.PointLight(new THREE.Color(emissiveColor), 1, 15);
    light.position.y = size.y * 0.85;
    group.add(light);
  }

  private buildDoor(
    group: THREE.Group,
    obj: WorldObject,
    size: { x: number; y: number; z: number }
  ): void {
    // Door panel
    const doorGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const doorMat = this.buildMaterial(obj.materials[0]);
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.y = size.y / 2;
    door.castShadow = true;
    group.add(door);

    // Frame
    const frameGeo = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(size.x * 1.05, size.y * 1.02, size.z * 0.5)
    );
    const frameMat = new THREE.LineBasicMaterial({
      color: obj.materials[1]?.baseColor || "#8B7355",
    });
    const frame = new THREE.LineSegments(frameGeo, frameMat);
    frame.position.y = size.y / 2;
    group.add(frame);

    // Handle
    const handleGeo = new THREE.SphereGeometry(0.06, 6, 4);
    const handleMat = new THREE.MeshStandardMaterial({
      color: obj.materials[1]?.baseColor || "#B8860B",
      metalness: 0.8,
      roughness: 0.3,
    });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.set(size.x * 0.35, size.y * 0.45, size.z * 0.5 + 0.03);
    group.add(handle);
  }

  private buildSeating(
    group: THREE.Group,
    obj: WorldObject,
    size: { x: number; y: number; z: number }
  ): void {
    const mat = this.buildMaterial(obj.materials[0]);

    // Seat
    const seatThickness = size.y * 0.1;
    const seatHeight = size.y * 0.45;
    const seatGeo = new THREE.BoxGeometry(size.x, seatThickness, size.z);
    const seat = new THREE.Mesh(seatGeo, mat);
    seat.position.y = seatHeight;
    seat.castShadow = true;
    group.add(seat);

    // Back rest
    const backGeo = new THREE.BoxGeometry(size.x, size.y * 0.45, seatThickness);
    const back = new THREE.Mesh(backGeo, mat);
    back.position.set(0, seatHeight + size.y * 0.225, -size.z / 2 + seatThickness / 2);
    back.castShadow = true;
    group.add(back);

    // Legs (4 corners)
    const legMat = obj.materials[1]
      ? this.buildMaterial(obj.materials[1])
      : mat;
    const legGeo = new THREE.CylinderGeometry(0.04, 0.04, seatHeight, 4);
    const offsets = [
      [-size.x * 0.4, -size.z * 0.35],
      [size.x * 0.4, -size.z * 0.35],
      [-size.x * 0.4, size.z * 0.35],
      [size.x * 0.4, size.z * 0.35],
    ];
    for (const [lx, lz] of offsets) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(lx, seatHeight / 2, lz);
      group.add(leg);
    }
  }

  private buildTable(
    group: THREE.Group,
    obj: WorldObject,
    size: { x: number; y: number; z: number }
  ): void {
    const mat = this.buildMaterial(obj.materials[0]);

    // Tabletop
    const topThickness = size.y * 0.08;
    const topGeo = new THREE.BoxGeometry(size.x, topThickness, size.z);
    const top = new THREE.Mesh(topGeo, mat);
    top.position.y = size.y - topThickness / 2;
    top.castShadow = true;
    top.receiveShadow = true;
    group.add(top);

    // Legs
    const legHeight = size.y - topThickness;
    const legGeo = new THREE.CylinderGeometry(0.04, 0.04, legHeight, 4);
    const offsets = [
      [-size.x * 0.4, -size.z * 0.4],
      [size.x * 0.4, -size.z * 0.4],
      [-size.x * 0.4, size.z * 0.4],
      [size.x * 0.4, size.z * 0.4],
    ];
    for (const [lx, lz] of offsets) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(lx, legHeight / 2, lz);
      group.add(leg);
    }
  }

  private buildDefaultBox(
    group: THREE.Group,
    obj: WorldObject,
    size: { x: number; y: number; z: number }
  ): void {
    const mat = this.buildMaterial(obj.materials[0]);
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = size.y / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Wireframe
    const wireGeo = new THREE.EdgesGeometry(geo);
    const wireMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      opacity: 0.15,
      transparent: true,
    });
    const wire = new THREE.LineSegments(wireGeo, wireMat);
    wire.position.y = size.y / 2;
    group.add(wire);

    // Apply secondary material as accent band
    if (obj.materials.length >= 2) {
      const accentMat = this.buildMaterial(obj.materials[1]);
      const bandGeo = new THREE.BoxGeometry(
        size.x * 1.01,
        size.y * 0.1,
        size.z * 1.01
      );
      const band = new THREE.Mesh(bandGeo, accentMat);
      band.position.y = size.y * 0.75;
      group.add(band);
    }
  }

  // ─── Utilities ───────────────────────────────────────────────

  private buildMaterial(pbr?: PBRMaterial): THREE.MeshStandardMaterial {
    if (!pbr) {
      return new THREE.MeshStandardMaterial({ color: 0x888888 });
    }

    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(pbr.baseColor),
      metalness: pbr.metallic,
      roughness: pbr.roughness,
      transparent: pbr.opacity < 1,
      opacity: pbr.opacity,
    });

    if (pbr.emissive) {
      mat.emissive = new THREE.Color(pbr.emissive);
      mat.emissiveIntensity = pbr.emissiveBrightness ?? 1;
    }

    return mat;
  }

  private createLabel(text: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    // Dynamic width based on text length
    const fontSize = 22;
    const font = `bold ${fontSize}px 'Courier New', monospace`;
    ctx.font = font;
    const textWidth = ctx.measureText(text).width;
    const hPad = 24;
    const canvasWidth = Math.ceil(textWidth + hPad * 2);
    const canvasHeight = 40;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Background
    ctx.fillStyle = "rgba(5, 5, 15, 0.7)";
    ctx.beginPath();
    ctx.roundRect(1, 1, canvasWidth - 2, canvasHeight - 2, 3);
    ctx.fill();

    // Accent border
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(1, 1, canvasWidth - 2, canvasHeight - 2, 3);
    ctx.stroke();

    // Text
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(255, 255, 255, 0.3)";
    ctx.shadowBlur = 4;
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    const aspect = canvasWidth / canvasHeight;
    const spriteHeight = 0.25;
    sprite.scale.set(spriteHeight * aspect, spriteHeight, 1);
    return sprite;
  }
}
