import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { PlayerState, Vector3 as Vec3, AvatarDefinition, AvatarAppearance } from "@the-street/shared";
import { CHAT_DISPLAY_DURATION } from "@the-street/shared";

const ACCENT_COLORS = [0x00ffff, 0xff00ff, 0x39ff14, 0xff6600, 0xaa44ff, 0xffff00];

interface ChatBubble {
  sprite: THREE.Sprite;
  createdAt: number;
  duration: number;
}

interface LimbRefs {
  body: THREE.Group;
  // Upper body
  chest: THREE.Mesh;
  neck: THREE.Mesh;
  head: THREE.Group;
  // Arms: upper + lower for elbow bend
  leftShoulderPivot: THREE.Group;
  leftElbowPivot: THREE.Group;
  rightShoulderPivot: THREE.Group;
  rightElbowPivot: THREE.Group;
  // Legs: upper + lower for knee bend
  leftHipPivot: THREE.Group;
  leftKneePivot: THREE.Group;
  rightHipPivot: THREE.Group;
  rightKneePivot: THREE.Group;
  // Feet
  leftBoot: THREE.Mesh;
  rightBoot: THREE.Mesh;
  // Coat tails
  coatTailLeft: THREE.Mesh;
  coatTailRight: THREE.Mesh;
}

interface MaterialRefs {
  coat: THREE.MeshPhysicalMaterial;
  skin: THREE.MeshPhysicalMaterial;
  hair: THREE.MeshStandardMaterial;
  glasses: THREE.MeshStandardMaterial;
  glassesGlow: THREE.PointLight;
  pants: THREE.MeshStandardMaterial;
  boots: THREE.MeshStandardMaterial;
}

interface CustomModelData {
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: {
    walk?: THREE.AnimationAction;
    run?: THREE.AnimationAction;
  };
  currentAction: "idle" | "walk" | "run";
  baseY: number; // model's resting y position (after centering)
}

interface AvatarInstance {
  group: THREE.Group;
  limbs: LimbRefs;
  materials: MaterialRefs;
  targetPosition: THREE.Vector3;
  prevPosition: THREE.Vector3;
  targetRotation: number;
  currentRotation: number;
  animPhase: number;
  breathPhase: number;
  speed: number; // smoothed speed for animation blending
  prevSpeed: number; // previous frame speed for accel/decel lean
  landingSquash: number; // 0-1, decays after landing
  stoppingPhaseTarget: number | null; // stride completion target
  chatBubbles: ChatBubble[];
  customModel: CustomModelData | null;
}

export class AvatarManager {
  private avatars: Map<string, AvatarInstance> = new Map();
  private scene: THREE.Scene;
  private gltfLoader = new GLTFLoader();
  private cachedAnimClips: { walk?: THREE.AnimationClip; run?: THREE.AnimationClip } = {};
  private animClipsLoading: Promise<void> | null = null;
  localPlayerId: string | null = null;
  apiUrl: string = "";

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Ensure shared walk/run animation clips are loaded (from server cache). */
  private ensureAnimClips(): Promise<void> {
    if (this.cachedAnimClips.walk) return Promise.resolve();
    if (this.animClipsLoading) return this.animClipsLoading;

    this.animClipsLoading = (async () => {
      for (const type of ["walk", "run"] as const) {
        try {
          const url = `${this.apiUrl}/api/avatar/animations/${type}`;
          const gltf = await new Promise<any>((resolve, reject) => {
            this.gltfLoader.load(url, resolve, undefined, reject);
          });
          if (gltf.animations.length > 0) {
            this.cachedAnimClips[type] = gltf.animations[0];
          }
        } catch {
          // Not cached on server yet — will be available after first rig
        }
      }
    })();

    return this.animClipsLoading;
  }

  /** Load a custom GLB avatar model (static, no animations), replacing the procedural mesh */
  async loadCustomAvatar(userId: string, glbUrl: string): Promise<void> {
    const avatar = this.avatars.get(userId);
    if (!avatar) return;

    try {
      const gltf = await new Promise<any>((resolve, reject) => {
        this.gltfLoader.load(glbUrl, resolve, undefined, reject);
      });

      const model = gltf.scene as THREE.Group;

      // Scale model to avatar height (~1.8m)
      const box = new THREE.Box3().setFromObject(model);
      const height = box.max.y - box.min.y;
      if (height > 0) {
        const scale = 1.8 / height;
        model.scale.setScalar(scale);
      }

      // Center the model
      const centeredBox = new THREE.Box3().setFromObject(model);
      model.position.y = -centeredBox.min.y;
      model.rotation.y = Math.PI;

      this.swapToCustomModel(avatar, model);
      // Store as customModel so getPreviewModel can find it + idle breathing works
      const mixer = new THREE.AnimationMixer(model);
      avatar.customModel = { model, mixer, actions: {}, currentAction: "idle", baseY: model.position.y };
      (avatar as any).isCustomModel = true;
    } catch (err) {
      console.error(`Failed to load custom avatar for ${userId}:`, err);
    }
  }

  /** Load a rigged GLB avatar with shared walk/run animations */
  async loadRiggedAvatar(userId: string, riggedGlbUrl: string): Promise<void> {
    const avatar = this.avatars.get(userId);
    if (!avatar) return;

    try {
      // Load rigged model + shared animations in parallel
      const [gltf] = await Promise.all([
        new Promise<any>((resolve, reject) => {
          this.gltfLoader.load(riggedGlbUrl, resolve, undefined, reject);
        }),
        this.ensureAnimClips(),
      ]);

      const model = gltf.scene as THREE.Group;

      // Scale to avatar height (~1.8m)
      const box = new THREE.Box3().setFromObject(model);
      const height = box.max.y - box.min.y;
      if (height > 0) {
        const scale = 1.8 / height;
        model.scale.setScalar(scale);
      }

      // Center and rotate
      const centeredBox = new THREE.Box3().setFromObject(model);
      model.position.y = -centeredBox.min.y;
      model.rotation.y = Math.PI;

      // Create animation mixer with shared clips
      const mixer = new THREE.AnimationMixer(model);
      const actions: CustomModelData["actions"] = {};

      if (this.cachedAnimClips.walk) {
        actions.walk = mixer.clipAction(this.cachedAnimClips.walk);
        actions.walk.setLoop(THREE.LoopRepeat, Infinity);
      }
      if (this.cachedAnimClips.run) {
        actions.run = mixer.clipAction(this.cachedAnimClips.run);
        actions.run.setLoop(THREE.LoopRepeat, Infinity);
      }

      // Swap procedural body with rigged model
      this.swapToCustomModel(avatar, model);

      avatar.customModel = { model, mixer, actions, currentAction: "idle", baseY: model.position.y };
      (avatar as any).isCustomModel = true;
    } catch (err) {
      console.error(`Failed to load rigged avatar for ${userId}:`, err);
    }
  }

  /** Replace the current model (procedural or custom) with a new model, preserving sprites. */
  private swapToCustomModel(avatar: AvatarInstance, model: THREE.Group): void {
    // Identify which object is the current "body" — either procedural limbs or a previous custom model
    const currentBody = avatar.customModel?.model ?? avatar.limbs.body;

    // Preserve non-body children (name labels, chat bubbles, etc.)
    const preserveChildren: THREE.Object3D[] = [];
    for (const child of avatar.group.children) {
      if (child !== currentBody) {
        preserveChildren.push(child);
      }
    }

    // Clear the group
    while (avatar.group.children.length > 0) {
      avatar.group.remove(avatar.group.children[0]);
    }

    // Add new model + preserved children
    avatar.group.add(model);
    for (const child of preserveChildren) {
      avatar.group.add(child);
    }
  }

  /** Apply an AvatarAppearance to a player's procedural avatar materials */
  applyAppearance(userId: string, appearance: AvatarAppearance): void {
    const avatar = this.avatars.get(userId);
    if (!avatar) return;
    if ((avatar as any).isCustomModel) return; // skip for GLB models

    const { materials } = avatar;

    if (appearance.skinTone) {
      materials.skin.color.set(appearance.skinTone);
    }
    if (appearance.hairColor) {
      materials.hair.color.set(appearance.hairColor);
    }
    if (appearance.accentColor) {
      const accent = new THREE.Color(appearance.accentColor);
      materials.glasses.emissive.copy(accent);
      materials.glassesGlow.color.copy(accent);
    }
    if (appearance.outfitColors && appearance.outfitColors.length > 0) {
      materials.coat.color.set(appearance.outfitColors[0]);
      if (appearance.outfitColors.length > 1) {
        materials.pants.color.set(appearance.outfitColors[1]);
      }
      if (appearance.outfitColors.length > 2) {
        materials.boots.color.set(appearance.outfitColors[2]);
      }
    }
  }

  /** Update a player's avatar (called when server broadcasts avatar change) */
  updatePlayerAvatar(userId: string, avatarDefinition: AvatarDefinition, apiUrl: string): void {
    // Apply appearance colors to procedural avatar
    if (avatarDefinition.customAppearance) {
      this.applyAppearance(userId, avatarDefinition.customAppearance);
    }
    // Load custom GLB mesh with rigging + shared animations
    if (avatarDefinition.meshyTaskId) {
      this.loadRiggedAvatar(userId, `${apiUrl}/api/avatar/mesh/${avatarDefinition.meshyTaskId}/model`);
    }
  }

  /** Notify avatar manager of the local player's current movement speed */
  setLocalMoving(speed: number): void {
    if (!this.localPlayerId) return;
    const avatar = this.avatars.get(this.localPlayerId);
    if (!avatar) return;
    // Extra smoothing on the avatar side
    avatar.speed += (speed - avatar.speed) * 0.15;
  }

  /** Trigger landing squash animation on the local player */
  triggerLanding(): void {
    if (!this.localPlayerId) return;
    const avatar = this.avatars.get(this.localPlayerId);
    if (!avatar) return;
    avatar.landingSquash = 1;
  }

  private createAvatar(colorIndex: number): { group: THREE.Group; limbs: LimbRefs; materials: MaterialRefs } {
    const group = new THREE.Group();
    const accent = ACCENT_COLORS[colorIndex % ACCENT_COLORS.length];

    // --- Materials ---
    const coatMat = new THREE.MeshPhysicalMaterial({
      color: 0x0c0c0c,
      roughness: 0.55,
      metalness: 0.05,
      clearcoat: 0.2,
      clearcoatRoughness: 0.5,
    });
    const shirtMat = new THREE.MeshStandardMaterial({
      color: 0x151515,
      roughness: 0.8,
      metalness: 0.0,
    });
    const pantsMat = new THREE.MeshStandardMaterial({
      color: 0x0e0e0e,
      roughness: 0.7,
      metalness: 0.0,
    });
    const skinMat = new THREE.MeshPhysicalMaterial({
      color: 0xc8a07a,
      roughness: 0.55,
      metalness: 0.0,
    });
    const bootMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      roughness: 0.35,
      metalness: 0.2,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      roughness: 0.05,
      metalness: 0.95,
      emissive: accent,
      emissiveIntensity: 0.7,
    });
    const hairMat = new THREE.MeshStandardMaterial({
      color: 0x0a0808,
      roughness: 0.35,
      metalness: 0.15,
    });
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0xccccdd,
      roughness: 0.1,
      metalness: 0.95,
    });
    const hiltMat = new THREE.MeshStandardMaterial({
      color: 0x2a1510,
      roughness: 0.8,
      metalness: 0.1,
    });
    const guardMat = new THREE.MeshStandardMaterial({
      color: 0xaa8833,
      roughness: 0.3,
      metalness: 0.7,
    });

    const body = new THREE.Group();
    group.add(body);

    // ===== TORSO =====
    // Chest — wider at shoulders, narrower at waist (scaled sphere)
    const chestGeo = new THREE.SphereGeometry(1, 12, 10);
    const chest = new THREE.Mesh(chestGeo, coatMat);
    chest.scale.set(0.22, 0.2, 0.12);
    chest.position.y = 1.28;
    chest.castShadow = true;
    body.add(chest);

    // Abdomen — narrower, bridging chest to hips
    const abdomenGeo = new THREE.SphereGeometry(1, 10, 8);
    const abdomen = new THREE.Mesh(abdomenGeo, coatMat);
    abdomen.scale.set(0.17, 0.12, 0.1);
    abdomen.position.y = 1.03;
    abdomen.castShadow = true;
    body.add(abdomen);

    // Hips
    const hipsGeo = new THREE.SphereGeometry(1, 10, 8);
    const hips = new THREE.Mesh(hipsGeo, coatMat);
    hips.scale.set(0.18, 0.08, 0.1);
    hips.position.y = 0.88;
    body.add(hips);

    // ===== NECK =====
    const neckGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.1, 8);
    const neck = new THREE.Mesh(neckGeo, skinMat);
    neck.position.y = 1.52;
    body.add(neck);

    // ===== HEAD =====
    const headGroup = new THREE.Group();
    headGroup.position.y = 1.65;
    body.add(headGroup);

    // Skull
    const skullGeo = new THREE.SphereGeometry(0.115, 12, 10);
    const skull = new THREE.Mesh(skullGeo, skinMat);
    skull.scale.set(1, 1.1, 1);
    skull.castShadow = true;
    headGroup.add(skull);

    // Jaw — subtle chin
    const jawGeo = new THREE.SphereGeometry(0.07, 8, 6);
    const jaw = new THREE.Mesh(jawGeo, skinMat);
    jaw.position.set(0, -0.07, -0.04);
    jaw.scale.set(1, 0.6, 0.8);
    headGroup.add(jaw);

    // Hair — slicked back
    const hairGeo = new THREE.SphereGeometry(0.12, 10, 8);
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.scale.set(1.05, 1.0, 1.15);
    hair.position.set(0, 0.02, 0.02);
    headGroup.add(hair);

    // Hair back extension
    const hairBackGeo = new THREE.SphereGeometry(0.06, 8, 6);
    const hairBack = new THREE.Mesh(hairBackGeo, hairMat);
    hairBack.scale.set(1.2, 0.6, 1);
    hairBack.position.set(0, -0.02, 0.08);
    headGroup.add(hairBack);

    // Sunglasses — narrow wraparound
    const lensGeo = new THREE.BoxGeometry(0.22, 0.04, 0.03);
    const lens = new THREE.Mesh(lensGeo, glassMat);
    lens.position.set(0, 0.01, -0.11);
    headGroup.add(lens);

    // Glasses glow
    const glowLight = new THREE.PointLight(accent, 0.4, 2.5, 2);
    glowLight.position.set(0, 0.01, -0.18);
    headGroup.add(glowLight);

    // ===== COAT DETAILS =====
    // Collar — turned up
    const collarLGeo = new THREE.BoxGeometry(0.04, 0.1, 0.08);
    const collarL = new THREE.Mesh(collarLGeo, coatMat);
    collarL.position.set(-0.1, 1.52, -0.07);
    collarL.rotation.z = -0.2;
    body.add(collarL);
    const collarR = new THREE.Mesh(collarLGeo, coatMat);
    collarR.position.set(0.1, 1.52, -0.07);
    collarR.rotation.z = 0.2;
    body.add(collarR);

    // Coat tails — two separate flaps that animate
    const tailGeo = new THREE.BoxGeometry(0.14, 0.45, 0.025);
    const coatTailLeft = new THREE.Mesh(tailGeo, coatMat);
    coatTailLeft.position.set(-0.07, 0.55, 0.1);
    coatTailLeft.castShadow = true;
    body.add(coatTailLeft);
    const coatTailRight = new THREE.Mesh(tailGeo, coatMat);
    coatTailRight.position.set(0.07, 0.55, 0.1);
    coatTailRight.castShadow = true;
    body.add(coatTailRight);

    // ===== CROSSED KATANAS =====
    for (const side of [-1, 1]) {
      const kGroup = new THREE.Group();
      kGroup.position.set(side * 0.06, 1.2, 0.14);
      kGroup.rotation.z = side * 0.3;
      kGroup.rotation.x = 0.12;

      const bladeGeo = new THREE.BoxGeometry(0.012, 0.6, 0.03);
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.y = 0.22;
      kGroup.add(blade);

      const hiltGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.16, 6);
      const hilt = new THREE.Mesh(hiltGeo, hiltMat);
      hilt.position.y = -0.1;
      kGroup.add(hilt);

      const tsubaGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.01, 8);
      const tsuba = new THREE.Mesh(tsubaGeo, guardMat);
      tsuba.position.y = -0.01;
      kGroup.add(tsuba);

      body.add(kGroup);
    }

    // ===== LEFT ARM =====
    const leftShoulderPivot = new THREE.Group();
    leftShoulderPivot.position.set(-0.24, 1.38, 0);
    body.add(leftShoulderPivot);

    // Upper arm
    const upperArmGeo = new THREE.CapsuleGeometry(0.04, 0.22, 4, 8);
    const lUpperArm = new THREE.Mesh(upperArmGeo, coatMat);
    lUpperArm.position.y = -0.15;
    lUpperArm.castShadow = true;
    leftShoulderPivot.add(lUpperArm);

    // Elbow pivot
    const leftElbowPivot = new THREE.Group();
    leftElbowPivot.position.y = -0.3;
    leftShoulderPivot.add(leftElbowPivot);

    // Forearm
    const forearmGeo = new THREE.CapsuleGeometry(0.035, 0.2, 4, 8);
    const lForearm = new THREE.Mesh(forearmGeo, coatMat);
    lForearm.position.y = -0.13;
    lForearm.castShadow = true;
    leftElbowPivot.add(lForearm);

    // Hand
    const handGeo = new THREE.SphereGeometry(0.03, 6, 6);
    const lHand = new THREE.Mesh(handGeo, skinMat);
    lHand.position.y = -0.27;
    leftElbowPivot.add(lHand);

    // ===== RIGHT ARM =====
    const rightShoulderPivot = new THREE.Group();
    rightShoulderPivot.position.set(0.24, 1.38, 0);
    body.add(rightShoulderPivot);

    const rUpperArm = new THREE.Mesh(upperArmGeo.clone(), coatMat);
    rUpperArm.position.y = -0.15;
    rUpperArm.castShadow = true;
    rightShoulderPivot.add(rUpperArm);

    const rightElbowPivot = new THREE.Group();
    rightElbowPivot.position.y = -0.3;
    rightShoulderPivot.add(rightElbowPivot);

    const rForearm = new THREE.Mesh(forearmGeo.clone(), coatMat);
    rForearm.position.y = -0.13;
    rForearm.castShadow = true;
    rightElbowPivot.add(rForearm);

    const rHand = new THREE.Mesh(handGeo.clone(), skinMat);
    rHand.position.y = -0.27;
    rightElbowPivot.add(rHand);

    // ===== LEFT LEG =====
    const leftHipPivot = new THREE.Group();
    leftHipPivot.position.set(-0.09, 0.84, 0);
    body.add(leftHipPivot);

    const thighGeo = new THREE.CapsuleGeometry(0.055, 0.28, 4, 8);
    const lThigh = new THREE.Mesh(thighGeo, pantsMat);
    lThigh.position.y = -0.2;
    lThigh.castShadow = true;
    leftHipPivot.add(lThigh);

    const leftKneePivot = new THREE.Group();
    leftKneePivot.position.y = -0.38;
    leftHipPivot.add(leftKneePivot);

    const shinGeo = new THREE.CapsuleGeometry(0.045, 0.26, 4, 8);
    const lShin = new THREE.Mesh(shinGeo, pantsMat);
    lShin.position.y = -0.17;
    lShin.castShadow = true;
    leftKneePivot.add(lShin);

    // Boot
    const bootGeo = new THREE.BoxGeometry(0.09, 0.08, 0.14);
    const lBoot = new THREE.Mesh(bootGeo, bootMat);
    lBoot.position.set(0, -0.35, -0.01);
    lBoot.castShadow = true;
    leftKneePivot.add(lBoot);

    // ===== RIGHT LEG =====
    const rightHipPivot = new THREE.Group();
    rightHipPivot.position.set(0.09, 0.84, 0);
    body.add(rightHipPivot);

    const rThigh = new THREE.Mesh(thighGeo.clone(), pantsMat);
    rThigh.position.y = -0.2;
    rThigh.castShadow = true;
    rightHipPivot.add(rThigh);

    const rightKneePivot = new THREE.Group();
    rightKneePivot.position.y = -0.38;
    rightHipPivot.add(rightKneePivot);

    const rShin = new THREE.Mesh(shinGeo.clone(), pantsMat);
    rShin.position.y = -0.17;
    rShin.castShadow = true;
    rightKneePivot.add(rShin);

    const rBoot = new THREE.Mesh(bootGeo.clone(), bootMat);
    rBoot.position.set(0, -0.35, -0.01);
    rBoot.castShadow = true;
    rightKneePivot.add(rBoot);

    return {
      group,
      limbs: {
        body,
        chest,
        neck,
        head: headGroup,
        leftShoulderPivot,
        leftElbowPivot,
        rightShoulderPivot,
        rightElbowPivot,
        leftHipPivot,
        leftKneePivot,
        rightHipPivot,
        rightKneePivot,
        leftBoot: lBoot,
        rightBoot: rBoot,
        coatTailLeft,
        coatTailRight,
      },
      materials: {
        coat: coatMat,
        skin: skinMat,
        hair: hairMat,
        glasses: glassMat,
        glassesGlow: glowLight,
        pants: pantsMat,
        boots: bootMat,
      },
    };
  }

  private createNameLabel(name: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = 256;
    canvas.height = 48;

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.beginPath();
    ctx.roundRect(0, 0, 256, 48, 8);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 128, 24, 240);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.5, 0.28, 1);
    return sprite;
  }

  addPlayer(state: PlayerState): void {
    if (this.avatars.has(state.userId)) return;

    const { group, limbs, materials } = this.createAvatar(state.avatarDefinition.avatarIndex);
    group.name = `avatar_${state.userId}`;
    group.position.set(state.position.x, state.position.y, state.position.z);
    group.rotation.y = state.rotation;

    // Name label above head (skip for local player)
    if (state.userId !== this.localPlayerId) {
      const nameSprite = this.createNameLabel(state.displayName);
      nameSprite.position.set(0, 1.95, 0);
      nameSprite.name = "nameLabel";
      group.add(nameSprite);
    }

    this.scene.add(group);

    this.avatars.set(state.userId, {
      group,
      limbs,
      materials,
      targetPosition: new THREE.Vector3(state.position.x, state.position.y, state.position.z),
      prevPosition: new THREE.Vector3(state.position.x, state.position.y, state.position.z),
      targetRotation: state.rotation,
      currentRotation: state.rotation,
      animPhase: 0,
      breathPhase: Math.random() * Math.PI * 2,
      speed: 0,
      prevSpeed: 0,
      landingSquash: 0,
      stoppingPhaseTarget: null,
      chatBubbles: [],
      customModel: null,
    });

    // Apply custom appearance if present
    if (state.avatarDefinition.customAppearance) {
      this.applyAppearance(state.userId, state.avatarDefinition.customAppearance);
    }
  }

  removePlayer(userId: string): void {
    const avatar = this.avatars.get(userId);
    if (!avatar) return;
    this.scene.remove(avatar.group);
    this.avatars.delete(userId);
  }

  updatePlayerPosition(userId: string, position: Vec3, rotation: number): void {
    const avatar = this.avatars.get(userId);
    if (!avatar) return;
    avatar.targetPosition.set(position.x, position.y, position.z);
    avatar.targetRotation = rotation;
  }

  setLocalPlayerPosition(position: Vec3, rotation: number): void {
    if (!this.localPlayerId) return;
    const avatar = this.avatars.get(this.localPlayerId);
    if (!avatar) return;
    avatar.group.position.set(position.x, position.y, position.z);
    avatar.group.rotation.y = rotation;
    avatar.targetPosition.set(position.x, position.y, position.z);
    avatar.targetRotation = rotation;
  }

  getLocalPlayerPosition(): THREE.Vector3 | null {
    if (!this.localPlayerId) return null;
    const avatar = this.avatars.get(this.localPlayerId);
    return avatar ? avatar.group.position.clone() : null;
  }

  getLocalPlayerRotation(): number {
    if (!this.localPlayerId) return 0;
    const avatar = this.avatars.get(this.localPlayerId);
    return avatar ? avatar.group.rotation.y : 0;
  }

  /** Get all player IDs (excluding local player) */
  getOtherPlayerIds(): string[] {
    return Array.from(this.avatars.keys()).filter(id => id !== this.localPlayerId);
  }

  /** Get a player's position by ID */
  getPlayerPosition(userId: string): THREE.Vector3 | null {
    const avatar = this.avatars.get(userId);
    return avatar ? avatar.group.position.clone() : null;
  }

  /** Get a player's display name */
  getPlayerName(userId: string): string | null {
    const avatar = this.avatars.get(userId);
    if (!avatar) return null;
    // Find the name label sprite and extract text (stored in group name)
    return avatar.group.name.replace("avatar_", "") || null;
  }

  /** Remove the name label from the local player (called after localPlayerId is set) */
  hideLocalNameLabel(): void {
    if (!this.localPlayerId) return;
    const avatar = this.avatars.get(this.localPlayerId);
    if (!avatar) return;
    const label = avatar.group.getObjectByName("nameLabel");
    if (label) {
      avatar.group.remove(label);
      if (label instanceof THREE.Sprite) {
        label.material.map?.dispose();
        label.material.dispose();
      }
    }
  }

  /** Get a clone of a player's current 3D model for preview rendering */
  getPreviewModel(userId: string): THREE.Group | null {
    const avatar = this.avatars.get(userId);
    if (!avatar) return null;

    if (avatar.customModel) {
      return avatar.customModel.model.clone();
    }
    // Clone the procedural limbs body
    return avatar.limbs.body.clone();
  }

  /** Show a chat bubble floating above a player's head */
  showChatBubble(userId: string, senderName: string, content: string): void {
    const avatar = this.avatars.get(userId);
    if (!avatar) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const canvasWidth = 512;
    const padding = 16;
    const maxTextWidth = canvasWidth - padding * 2;

    // Word-wrap the full message
    ctx.font = "20px system-ui, sans-serif";
    const lines = this.wrapText(ctx, content, maxTextWidth);

    const nameLineHeight = 28;
    const textLineHeight = 24;
    const topPad = 14;
    const bottomPad = 14;
    const canvasHeight = topPad + nameLineHeight + lines.length * textLineHeight + bottomPad;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Background — neutral gray
    ctx.fillStyle = "rgba(30, 30, 30, 0.85)";
    ctx.beginPath();
    ctx.roundRect(4, 4, canvasWidth - 8, canvasHeight - 8, 12);
    ctx.fill();

    // Border — subtle white
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Name
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(senderName, padding, topPad, maxTextWidth);

    // Message lines
    ctx.fillStyle = "#eeeeee";
    ctx.font = "20px system-ui, sans-serif";
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], padding, topPad + nameLineHeight + i * textLineHeight, maxTextWidth);
    }

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    const spriteHeight = (canvasHeight / canvasWidth) * 3;
    sprite.scale.set(3, spriteHeight, 1);

    // Stack above previous bubbles
    const stackOffset = avatar.chatBubbles.length * (spriteHeight + 0.1);
    sprite.position.set(0, 2.1 + stackOffset, 0);
    avatar.group.add(sprite);

    const bubble: ChatBubble = {
      sprite,
      createdAt: Date.now(),
      duration: CHAT_DISPLAY_DURATION * 1000,
    };
    avatar.chatBubbles.push(bubble);

    // Cap at 3 visible bubbles
    while (avatar.chatBubbles.length > 3) {
      const old = avatar.chatBubbles.shift()!;
      old.sprite.parent?.remove(old.sprite);
      old.sprite.material.map?.dispose();
      old.sprite.material.dispose();
    }
  }

  /** Word-wrap text into lines that fit within maxWidth */
  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? currentLine + " " + word : word;
      const width = ctx.measureText(testLine).width;
      if (width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines.length > 0 ? lines : [""];
  }

  update(dt: number): void {
    for (const [userId, avatar] of this.avatars) {
      const { limbs } = avatar;

      // --- Remote player: interpolation + speed detection ---
      if (userId !== this.localPlayerId) {
        avatar.prevPosition.copy(avatar.group.position);
        avatar.group.position.lerp(avatar.targetPosition, Math.min(dt * 10, 1));

        // Smooth rotation (shortest path)
        let rotDiff = avatar.targetRotation - avatar.currentRotation;
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
        avatar.currentRotation += rotDiff * Math.min(dt * 10, 1);
        avatar.group.rotation.y = avatar.currentRotation;

        // Measure actual movement speed
        const moved = avatar.group.position.distanceTo(avatar.prevPosition);
        const measuredSpeed = dt > 0 ? moved / dt : 0;
        avatar.speed += (measuredSpeed - avatar.speed) * Math.min(dt * 8, 1);
      }
      // Local player: speed is set externally via setLocalMoving()

      // --- Custom rigged model animation ---
      if (avatar.customModel) {
        const cm = avatar.customModel;
        const spd = avatar.speed;
        const CROSS_FADE_DURATION = 0.3;

        let targetAction: "idle" | "walk" | "run";
        if (spd > 5) {
          targetAction = "run";
        } else if (spd > 0.3) {
          targetAction = "walk";
        } else {
          targetAction = "idle";
        }

        if (targetAction !== cm.currentAction) {
          const prevActionClip = cm.currentAction === "walk" ? cm.actions.walk
            : cm.currentAction === "run" ? cm.actions.run
            : undefined;
          const nextActionClip = targetAction === "walk" ? cm.actions.walk
            : targetAction === "run" ? cm.actions.run
            : undefined;

          if (prevActionClip && nextActionClip) {
            prevActionClip.crossFadeTo(nextActionClip, CROSS_FADE_DURATION, true);
            nextActionClip.play();
          } else if (nextActionClip) {
            nextActionClip.reset().fadeIn(CROSS_FADE_DURATION).play();
          } else if (prevActionClip) {
            prevActionClip.fadeOut(CROSS_FADE_DURATION);
          }

          cm.currentAction = targetAction;
        }

        // Idle: subtle procedural breathing sway
        if (targetAction === "idle") {
          avatar.breathPhase += dt * 1.5;
          const breath = Math.sin(avatar.breathPhase);
          cm.model.position.y = cm.baseY + breath * 0.003;
          cm.model.rotation.z = Math.sin(avatar.breathPhase * 0.4) * 0.005;
        } else {
          cm.model.position.y = cm.baseY;
          cm.model.rotation.z = 0;
        }

        cm.mixer.update(dt);

        // Chat bubble cleanup still runs (below), but skip procedural limb animation
        // --- Chat bubbles: fade and cleanup ---
        const now = Date.now();
        for (let i = avatar.chatBubbles.length - 1; i >= 0; i--) {
          const bubble = avatar.chatBubbles[i];
          const age = now - bubble.createdAt;
          if (age >= bubble.duration) {
            bubble.sprite.parent?.remove(bubble.sprite);
            bubble.sprite.material.map?.dispose();
            bubble.sprite.material.dispose();
            avatar.chatBubbles.splice(i, 1);
          } else {
            const fadeStart = bubble.duration * 0.8;
            if (age > fadeStart) {
              const fadeProgress = (age - fadeStart) / (bubble.duration - fadeStart);
              bubble.sprite.material.opacity = 1 - fadeProgress;
            }
          }
        }

        continue;
      }

      // --- Animation ---
      const spd = avatar.speed;
      const isMoving = spd > 0.3;
      const moveAmt = Math.min(spd / 2, 1); // smooth 0→1 amplitude (no binary gate)
      const runBlend = Math.min(Math.max((spd - 3) / 7, 0), 1); // 0=walk, 1=run

      // Stride completion on stop
      if (!isMoving && avatar.prevSpeed >= 0.3 && avatar.stoppingPhaseTarget === null) {
        avatar.stoppingPhaseTarget = Math.round(avatar.animPhase / Math.PI) * Math.PI;
      }

      // Phase advances with speed
      if (avatar.stoppingPhaseTarget !== null) {
        avatar.animPhase += (avatar.stoppingPhaseTarget - avatar.animPhase) * Math.min(dt * 8, 1);
        if (Math.abs(avatar.animPhase - avatar.stoppingPhaseTarget) < 0.05) {
          avatar.animPhase = 0;
          avatar.stoppingPhaseTarget = null;
        }
      } else if (isMoving) {
        const phaseSpeed = 5 + runBlend * 6;
        avatar.animPhase += dt * phaseSpeed;
      } else {
        avatar.animPhase *= 1 - Math.min(dt * 6, 1);
      }

      // Accel/decel body lean delta
      const speedDelta = spd - avatar.prevSpeed;
      const leanDelta = Math.max(-0.06, Math.min(speedDelta * 0.15, 0.08));
      avatar.prevSpeed = spd;

      const p = avatar.animPhase;
      const sinP = Math.sin(p);
      const cosP = Math.cos(p);

      // -- Legs: hip swing + asymmetric knee bend --
      const hipSwing = (0.3 + runBlend * 0.4) * moveAmt;
      const kneeMax = 0.4 + runBlend * 0.6;

      // Left leg
      limbs.leftHipPivot.rotation.x = sinP * hipSwing;
      const leftSwing = Math.max(0, sinP);
      const leftStance = Math.max(0, -sinP);
      limbs.leftKneePivot.rotation.x = (leftSwing * kneeMax * 1.2 + leftStance * kneeMax * 0.15) * moveAmt;

      // Right leg (opposite phase)
      limbs.rightHipPivot.rotation.x = -sinP * hipSwing;
      const rightSwing = Math.max(0, -sinP);
      const rightStance = Math.max(0, sinP);
      limbs.rightKneePivot.rotation.x = (rightSwing * kneeMax * 1.2 + rightStance * kneeMax * 0.15) * moveAmt;

      // -- Boot/foot articulation: heel strike → toe-off --
      const leftFootPhase = -sinP;
      limbs.leftBoot.rotation.x = (leftFootPhase > 0
        ? -0.15 * leftFootPhase + 0.25 * Math.max(0, leftFootPhase - 0.5)
        : 0.1 * Math.abs(leftFootPhase)) * moveAmt;
      const rightFootPhase = sinP;
      limbs.rightBoot.rotation.x = (rightFootPhase > 0
        ? -0.15 * rightFootPhase + 0.25 * Math.max(0, rightFootPhase - 0.5)
        : 0.1 * Math.abs(rightFootPhase)) * moveAmt;

      // -- Arms: shoulder swing + elbow bend + cross-body --
      const armSwing = (0.25 + runBlend * 0.45) * moveAmt;
      const elbowBend = 0.3 + runBlend * 0.5;

      limbs.leftShoulderPivot.rotation.x = -sinP * armSwing;
      limbs.leftShoulderPivot.rotation.z = sinP * 0.04 * moveAmt; // cross-body
      limbs.leftElbowPivot.rotation.x = -(0.15 + Math.max(0, -sinP) * elbowBend * moveAmt);

      limbs.rightShoulderPivot.rotation.x = sinP * armSwing;
      limbs.rightShoulderPivot.rotation.z = -sinP * 0.04 * moveAmt; // cross-body
      limbs.rightElbowPivot.rotation.x = -(0.15 + Math.max(0, sinP) * elbowBend * moveAmt);

      // -- Pelvis yaw: hip rotates with leading leg --
      const pelvisYaw = sinP * (0.04 + runBlend * 0.04) * moveAmt;
      limbs.body.rotation.y = pelvisYaw;

      // -- Pelvis tilt (roll): tilt toward stance leg --
      const pelvisTilt = cosP * (0.025 + runBlend * 0.015) * moveAmt;
      limbs.body.rotation.z = pelvisTilt;

      // -- Lateral weight shift: body shifts toward stance foot --
      limbs.body.position.x = cosP * (0.015 + runBlend * 0.01) * moveAmt;
      limbs.body.position.y = 0; // reset before additive offsets (squash, breathing)

      // -- Shoulder counter-rotation: chest opposes pelvis --
      limbs.chest.rotation.y = -sinP * (0.12 + runBlend * 0.08) * moveAmt;

      // -- Forward lean: smooth interpolation, speed-proportional --
      const targetLeanX = -(0.03 + runBlend * 0.05) * moveAmt - leanDelta;
      limbs.body.rotation.x += (targetLeanX - limbs.body.rotation.x) * Math.min(dt * 8, 1);

      // -- Coat tails flap with movement --
      const flapTarget = moveAmt > 0.01
        ? 0.1 + Math.sin(p * 1.5) * (0.05 + runBlend * 0.15) * moveAmt
        : 0;
      limbs.coatTailLeft.rotation.x += (flapTarget - limbs.coatTailLeft.rotation.x) * Math.min(dt * 8, 1);
      const flapTargetR = moveAmt > 0.01
        ? 0.1 + Math.sin(p * 1.5 + 0.5) * (0.05 + runBlend * 0.15) * moveAmt
        : 0;
      limbs.coatTailRight.rotation.x += (flapTargetR - limbs.coatTailRight.rotation.x) * Math.min(dt * 8, 1);

      // -- Vertical bob: correct phase (highest at midstance) --
      if (isMoving && userId !== this.localPlayerId) {
        const bobAmt = 0.025 + runBlend * 0.035;
        avatar.group.position.y += (-Math.cos(p * 2) * 0.5 + 0.5) * bobAmt;
      }

      // -- Landing squash --
      if (avatar.landingSquash > 0) {
        const sq = avatar.landingSquash;
        limbs.leftKneePivot.rotation.x += 0.4 * sq;
        limbs.rightKneePivot.rotation.x += 0.4 * sq;
        limbs.body.position.y -= 0.06 * sq;
        avatar.landingSquash *= 1 - Math.min(dt * 10, 1);
        if (avatar.landingSquash < 0.01) avatar.landingSquash = 0;
      }

      // -- Idle breathing --
      avatar.breathPhase += dt * 1.5;
      const breath = Math.sin(avatar.breathPhase);
      limbs.body.position.y += breath * 0.005; // additive (after lateral shift + squash)
      limbs.chest.scale.z = 0.12 + breath * 0.003;

      // -- Head: counter pelvis motions to stabilize gaze --
      if (isMoving) {
        limbs.head.rotation.y = -pelvisYaw * 0.5;
        limbs.head.rotation.x = Math.sin(p * 2) * 0.02;
        limbs.head.rotation.z = -pelvisTilt * 0.4;
      } else {
        limbs.head.rotation.y *= 0.9;
        limbs.head.rotation.x = Math.sin(avatar.breathPhase * 0.6) * 0.012;
        limbs.head.rotation.z = Math.sin(avatar.breathPhase * 0.4) * 0.008;
      }

      // -- Chat bubbles: fade and cleanup --
      const now = Date.now();
      for (let i = avatar.chatBubbles.length - 1; i >= 0; i--) {
        const bubble = avatar.chatBubbles[i];
        const age = now - bubble.createdAt;
        if (age >= bubble.duration) {
          // Remove expired bubble
          bubble.sprite.parent?.remove(bubble.sprite);
          bubble.sprite.material.map?.dispose();
          bubble.sprite.material.dispose();
          avatar.chatBubbles.splice(i, 1);
        } else {
          // Fade out in the last 20% of duration
          const fadeStart = bubble.duration * 0.8;
          if (age > fadeStart) {
            const fadeProgress = (age - fadeStart) / (bubble.duration - fadeStart);
            bubble.sprite.material.opacity = 1 - fadeProgress;
          }
        }
      }
    }
  }
}
