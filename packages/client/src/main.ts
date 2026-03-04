import { StreetScene } from "./scene/StreetScene.js";
import { StreetGeometry } from "./scene/StreetGeometry.js";
import { PlotRenderer } from "./scene/PlotRenderer.js";
import { ObjectRenderer } from "./scene/ObjectRenderer.js";
import { AvatarManager } from "./avatar/AvatarManager.js";
import { DaemonRenderer } from "./avatar/DaemonRenderer.js";
import { InputManager } from "./input/InputManager.js";
import { CameraController } from "./camera/CameraController.js";
import { NetworkManager } from "./network/NetworkManager.js";
import { ChatUI } from "./ui/ChatUI.js";
import { TargetingSystem } from "./ui/TargetingSystem.js";
import { CreationPanel } from "./ui/CreationPanel.js";
import { GalleryPanel } from "./ui/GalleryPanel.js";
import { AvatarPanel } from "./ui/AvatarPanel.js";
import { DaemonPanel } from "./ui/DaemonPanel.js";
import { DaemonChatUI } from "./ui/DaemonChatUI.js";
import { getDefaultSpawnPoint, getAllPlotPositions } from "@the-street/shared";
import type { WorldObject, PlotSnapshot, DaemonState } from "@the-street/shared";
import * as THREE from "three";

const WALK_SPEED = 5;
const RUN_SPEED = 12;
const SEND_RATE = 1 / 20; // 20Hz position updates to server
const JUMP_VELOCITY = 6;
const GRAVITY = -15;
const ACCEL = 12;   // ~0.1s to full walk speed
const DECEL = 8;    // ~0.15s slide on release
const TURN_SPEED = 14;

async function init() {
  // Scene
  const streetScene = new StreetScene();
  const streetGeo = new StreetGeometry();
  streetScene.scene.add(streetGeo.mesh);

  const plotRenderer = new PlotRenderer();
  streetScene.scene.add(plotRenderer.plotGroup);

  const avatarManager = new AvatarManager(streetScene.scene);
  avatarManager.apiUrl = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`;
  const daemonRenderer = new DaemonRenderer(streetScene.scene);
  const objectRenderer = new ObjectRenderer(streetScene.scene);
  const cameraController = new CameraController(streetScene.camera);
  const inputManager = new InputManager(streetScene.renderer.domElement);

  // Track generated objects
  let objectCounter = 0;

  // Plot tracking
  let currentPlotUuid: string | null = null;
  let plotSnapshots: PlotSnapshot[] = [];

  // UI
  const chatUI = new ChatUI();
  const creationPanel = new CreationPanel();
  const galleryPanel = new GalleryPanel(
    import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`,
  );
  const avatarPanel = new AvatarPanel();
  const daemonPanel = new DaemonPanel();
  const daemonChatUI = new DaemonChatUI();
  const targetingSystem = new TargetingSystem(streetScene.scene, avatarManager, daemonRenderer);

  // Build button (B key) / Gallery (G key)
  document.addEventListener("keydown", (e) => {
    if (
      document.activeElement?.tagName === "INPUT" ||
      document.activeElement?.tagName === "TEXTAREA"
    ) return;

    if (e.key === "Escape") {
      targetingSystem.deselect();
    } else if (e.key.toLowerCase() === "b") {
      creationPanel.toggle();
    } else if (e.key.toLowerCase() === "g") {
      galleryPanel.toggle();
    } else if (e.key.toLowerCase() === "v") {
      avatarPanel.toggle();
    } else if (e.key.toLowerCase() === "n") {
      daemonPanel.toggle();
    }
  });

  // Local player state
  const spawn = getDefaultSpawnPoint();
  let localPosition = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
  let localRotation = 0;
  let sendTimer = 0;
  let elapsedTime = 0;
  let verticalVelocity = 0;
  let isGrounded = true;
  let velocityX = 0;
  let velocityZ = 0;
  let wasJumping = false;
  let landingTimer = 0;

  // Network
  const wsUrl =
    import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:2567`;

  const network = new NetworkManager(wsUrl, {
    onWorldSnapshot(yourUserId, players, plots, daemons) {
      avatarManager.localPlayerId = yourUserId;
      for (const p of players) {
        avatarManager.addPlayer(p);
      }
      avatarManager.hideLocalNameLabel();
      for (const p of players) {
        // Load custom avatar mesh if available
        if (p.avatarDefinition.meshyTaskId) {
          avatarManager.loadCustomAvatar(
            p.userId,
            `${import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`}/api/avatar/mesh/${p.avatarDefinition.meshyTaskId}/model`,
          );
        }
      }
      // Store plot data for tracking and rendering
      plotSnapshots = plots;
      // Load existing world objects from plots
      for (const plot of plots) {
        for (let i = 0; i < plot.objects.length; i++) {
          const obj = plot.objects[i];
          const id = `plot_${plot.uuid}_${i}`;
          objectRenderer.renderObject(id, obj, {
            x: plot.placement.position.x,
            y: 0,
            z: plot.placement.position.z,
          });
        }
      }
      // Spawn daemons from snapshot
      if (daemons) {
        for (const daemon of daemons) {
          daemonRenderer.spawnDaemon(daemon);
        }
      }
    },
    onPlayerJoin(player) {
      avatarManager.addPlayer(player);
      if (player.avatarDefinition.meshyTaskId) {
        avatarManager.loadCustomAvatar(
          player.userId,
          `${import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`}/api/avatar/mesh/${player.avatarDefinition.meshyTaskId}/model`,
        );
      }
    },
    onPlayerLeave(userId) {
      avatarManager.removePlayer(userId);
    },
    onPlayerMove(userId, position, rotation) {
      avatarManager.updatePlayerPosition(userId, position, rotation);
    },
    onChat(senderId, senderName, content, _position) {
      // Parse /me emotes from other players
      const isEmote = content.startsWith("/me ");
      const displayContent = isEmote ? content.slice(4) : content;
      const msgType = isEmote ? "player-emote" as const : "player" as const;
      chatUI.addMessage(senderId, senderName, displayContent, msgType);
      // Don't double-show bubble for own messages (already shown on send)
      if (senderId !== avatarManager.localPlayerId) {
        avatarManager.showChatBubble(senderId, senderName, displayContent);
      }
    },
    onObjectPlaced(objectId, plotUUID, objectDefinition) {
      const plot = plotSnapshots.find(p => p.uuid === plotUUID);
      const worldPos = plot ? {
        x: plot.placement.position.x,
        y: 0,
        z: plot.placement.position.z,
      } : undefined;
      objectRenderer.renderObject(objectId, objectDefinition as WorldObject, worldPos);
    },
    onObjectRemoved(objectId) {
      objectRenderer.removeObject(objectId);
    },
    onObjectStateChange(_objectId, _stateData) {
      // TODO: update object state
    },
    onPlayerAvatarUpdate(userId, avatarDefinition) {
      avatarManager.updatePlayerAvatar(userId, avatarDefinition, apiUrl);
    },
    onDaemonSpawn(daemon) {
      daemonRenderer.spawnDaemon(daemon);
    },
    onDaemonDespawn(daemonId) {
      daemonRenderer.despawnDaemon(daemonId);
    },
    onDaemonMove(daemonId, position, rotation, action) {
      daemonRenderer.moveDaemon(daemonId, position, rotation, action);
    },
    onDaemonChat(daemonId, daemonName, content, _targetUserId, targetDaemonId) {
      daemonRenderer.showDaemonChat(daemonId, daemonName, content, targetDaemonId);
      chatUI.addMessage(daemonId, daemonName, content, "daemon-chat");
    },
    onDaemonEmote(daemonId, emote, mood) {
      daemonRenderer.showDaemonEmote(daemonId, emote, mood);
      const name = daemonRenderer.getDaemonName(daemonId) || "NPC";
      chatUI.addMessage(daemonId, name, emote, "daemon-emote");
    },
    onDaemonThought(daemonId, thought) {
      daemonRenderer.showDaemonThought(daemonId, thought);
      const name = daemonRenderer.getDaemonName(daemonId) || "NPC";
      chatUI.addMessage(daemonId, name, thought, "daemon-thought");
    },
  });

  // Click-to-interact with daemons via raycasting
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  streetScene.renderer.domElement.addEventListener("click", () => {
    if (!inputManager.isPointerLocked()) return;
    if (daemonChatUI.isVisible()) return;

    // Screen center for pointer-locked clicks
    pointer.set(0, 0);
    raycaster.setFromCamera(pointer, streetScene.camera);

    // Check daemon meshes
    const nearbyDaemonIds = daemonRenderer.getDaemonsNear(localPosition, 10);
    for (const daemonId of nearbyDaemonIds) {
      const daemonGroup = streetScene.scene.getObjectByName(`daemon_${daemonId}`);
      if (!daemonGroup) continue;

      const intersects = raycaster.intersectObject(daemonGroup, true);
      if (intersects.length > 0) {
        const name = daemonRenderer.getDaemonName(daemonId) || "NPC";
        daemonChatUI.show(daemonId, name);
        // Exit pointer lock so player can type
        document.exitPointerLock();
        break;
      }
    }
  });

  // Daemon chat send handler
  daemonChatUI.onSendMessage = (daemonId, message) => {
    network.sendDaemonInteract(daemonId, message || undefined);
  };

  // Tab targeting
  inputManager.onTabTarget = (reverse) => {
    if (reverse) {
      targetingSystem.cyclePrevious();
    } else {
      targetingSystem.cycleNext();
    }
  };

  // Zoom wiring
  inputManager.onZoom = (delta) => {
    cameraController.applyZoom(delta);
  };

  // Chat wiring
  inputManager.onChatToggle = () => {
    if (!chatUI.isVisible()) {
      chatUI.toggle();
    }
  };
  chatUI.onSendMessage = (content) => {
    network.sendChat(content);
    // In offline mode (no server), show message locally since no echo will arrive
    if (!network.getSessionId()) {
      const myId = avatarManager.localPlayerId || "local";
      chatUI.addMessage(myId, "You", content, "player");
      avatarManager.showChatBubble(myId, "You", content);
    }
  };
  chatUI.onEmote = (verb) => {
    const myId = avatarManager.localPlayerId || "local";
    const emoteText = `${verb}.`;
    // Show locally as an emote
    chatUI.addMessage(myId, "You", emoteText, "player-emote");
    avatarManager.showChatBubble(myId, "You", emoteText);
    // Broadcast to other players
    network.sendChat(`/me ${emoteText}`);
  };

  // Creation panel wiring
  const apiUrl =
    import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`;

  // Avatar panel wiring
  avatarPanel.onGenerate = async (description) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch(`${apiUrl}/api/avatar/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ description }),
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Generation failed" }));
        throw new Error(err.error || "Generation failed");
      }
      const result = await res.json();
      avatarPanel.setGenerationResult(result.appearance, result.meshDescription);
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  };

  avatarPanel.onStartMesh = async (description) => {
    const res = await fetch(`${apiUrl}/api/generate/mesh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, poseMode: "a-pose" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Mesh generation failed" }));
      throw new Error(err.error || "Mesh generation failed");
    }
    const { taskId } = await res.json();
    avatarPanel.setMeshyTaskId(taskId);
    pollAvatarMesh(taskId);
  };

  /** Poll Meshy avatar mesh: preview → refine → rig → load */
  async function pollAvatarMesh(previewTaskId: string): Promise<void> {
    const POLL_MS = 3000;
    const MAX_POLLS = 80; // generous for the full pipeline
    const localId = avatarManager.localPlayerId || "local";

    // ── Stage 1: Preview (0-25%) ──
    avatarPanel.setMeshProgress(0, "Generating 3D model...");

    const previewDone = await pollStage(
      `${apiUrl}/api/avatar/mesh/${previewTaskId}`,
      (pct) => avatarPanel.setMeshProgress(Math.round(pct * 0.25), "Generating 3D model..."),
      MAX_POLLS,
    );

    if (!previewDone) {
      avatarPanel.setMeshProgress(0, "3D model generation failed");
      return;
    }

    // ── Stage 2: Refine (25-55%) ──
    avatarPanel.setMeshProgress(25, "Adding textures...");

    let refineTaskId: string;
    try {
      const refineRes = await fetch(`${apiUrl}/api/generate/mesh/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewTaskId }),
      });
      if (!refineRes.ok) {
        // Refine failed to start — fall back to rigging the preview
        console.warn("Refine start failed, rigging preview model");
        await rigOrFallback(previewTaskId, localId, 25);
        return;
      }
      ({ taskId: refineTaskId } = await refineRes.json());
    } catch {
      await rigOrFallback(previewTaskId, localId, 25);
      return;
    }

    // Update the panel's meshyTaskId to the refined one (for save)
    avatarPanel.setMeshyTaskId(refineTaskId);

    const refineDone = await pollStage(
      `${apiUrl}/api/avatar/mesh/${refineTaskId}`,
      (pct) => avatarPanel.setMeshProgress(25 + Math.round(pct * 0.30), "Adding textures..."),
      MAX_POLLS,
    );

    if (!refineDone) {
      // Refine failed — fall back to rigging the preview
      console.warn("Refine failed, rigging preview model");
      await rigOrFallback(previewTaskId, localId, 55);
      return;
    }

    // Grab thumbnail URL from the completed refine task
    try {
      const thumbRes = await fetch(`${apiUrl}/api/avatar/mesh/${refineTaskId}`);
      if (thumbRes.ok) {
        const thumbData = await thumbRes.json();
        if (thumbData.thumbnailUrl) {
          avatarPanel.setThumbnailUrl(thumbData.thumbnailUrl);
        }
      }
    } catch {
      // Non-critical — thumbnail is optional
    }

    // ── Stage 3: Rig the refined model (55-95%) ──
    await rigOrFallback(refineTaskId, localId, 55);
  }

  /** Generic stage poller. Calls progressCb(0-100) and returns true on SUCCEEDED. */
  async function pollStage(
    url: string,
    progressCb: (pct: number) => void,
    maxPolls: number,
  ): Promise<boolean> {
    const POLL_MS = 3000;
    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const status = await res.json();
        if (status.status === "SUCCEEDED") return true;
        if (status.status === "FAILED") return false;
        progressCb(status.progress || 0);
      } catch {
        // network error, keep polling
      }
    }
    return false; // timed out
  }

  /** Rig a completed mesh task, or fall back to static model on failure. */
  async function rigOrFallback(meshTaskId: string, localId: string, baseProgress: number): Promise<void> {
    const MAX_POLLS = 60;

    try {
      avatarPanel.setMeshProgress(baseProgress, "Rigging character...");

      const rigRes = await fetch(`${apiUrl}/api/avatar/rig`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meshTaskId }),
      });

      if (rigRes.ok) {
        const { rigTaskId } = await rigRes.json();

        const rigDone = await pollStage(
          `${apiUrl}/api/avatar/rig/${rigTaskId}`,
          (pct) => avatarPanel.setMeshProgress(
            baseProgress + Math.round(pct * ((95 - baseProgress) / 100)),
            "Rigging character...",
          ),
          MAX_POLLS,
        );

        if (rigDone) {
          const riggedModelUrl = `${apiUrl}/api/avatar/rig/${rigTaskId}/model`;
          await avatarManager.loadRiggedAvatar(localId, riggedModelUrl);
          avatarPanel.setMeshComplete();
          avatarPanel.refreshPreview();
          return;
        }
      }
    } catch (err) {
      console.warn("Rigging error:", err);
    }

    // Fallback: load static (unrigged) model
    console.warn("Rigging failed, loading static model");
    await avatarManager.loadCustomAvatar(localId, `${apiUrl}/api/avatar/mesh/${meshTaskId}/model`);
    avatarPanel.setMeshComplete();
    avatarPanel.refreshPreview();
  }

  avatarPanel.onSave = async (avatarDefinition, meshDescription, meshyTaskId) => {
    const thumbnailUrl = avatarPanel.getThumbnailUrl() || undefined;
    const res = await fetch(`${apiUrl}/api/avatar/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarDefinition, meshDescription, meshyTaskId, thumbnailUrl }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Save failed" }));
      throw new Error(err.error || "Save failed");
    }
    // Don't re-load the model — it's already loaded from the generation pipeline.
    // Re-loading via updatePlayerAvatar would replace a rigged model with static.
    // Just broadcast so other clients pick up the change.
    network.sendAvatarUpdate(avatarDefinition);
  };

  avatarPanel.onLoadHistory = async () => {
    const res = await fetch(`${apiUrl}/api/avatar/history`);
    if (!res.ok) throw new Error("Failed to load history");
    const data = await res.json();
    return data.history;
  };

  avatarPanel.onSelectHistoryItem = async (avatarDefinition) => {
    const def = avatarDefinition as any;
    const localId = avatarManager.localPlayerId || "local";

    // Load the saved avatar's mesh if it has one
    if (def.meshyTaskId) {
      const modelUrl = `${apiUrl}/api/avatar/mesh/${def.meshyTaskId}/model`;
      await avatarManager.loadRiggedAvatar(localId, modelUrl);
    }

    // Apply appearance colors (skip re-loading the mesh — already loaded above)
    if (def.customAppearance) {
      avatarManager.applyAppearance(localId, def.customAppearance);
    }
    // Broadcast to other players
    network.sendAvatarUpdate(avatarDefinition);

    // Update the 3D preview
    avatarPanel.refreshPreview();
  };

  avatarPanel.onDeleteHistoryItem = async (id) => {
    const res = await fetch(`${apiUrl}/api/avatar/history/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Delete failed" }));
      throw new Error(err.error || "Delete failed");
    }
  };

  avatarPanel.onGetPreviewModel = () => {
    const localId = avatarManager.localPlayerId || "local";
    return avatarManager.getPreviewModel(localId);
  };

  // Daemon panel wiring
  daemonPanel.onGenerate = async (description) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch(`${apiUrl}/api/daemons/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ description }),
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Generation failed" }));
        throw new Error(err.error || "Generation failed");
      }
      const result = await res.json();
      daemonPanel.setGenerationResult(result.definition);
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  };

  daemonPanel.onCreate = async (definition) => {
    const plotUuid = daemonPanel.getPlotUuid();
    if (!plotUuid) throw new Error("Not on a plot");

    const fullDefinition = {
      ...(definition as object),
      plotUuid,
      position: { x: localPosition.x, y: 0, z: localPosition.z },
      rotation: localRotation,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(`${apiUrl}/api/daemons/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ definition: fullDefinition }),
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Creation failed" }));
        throw new Error(err.error || "Creation failed");
      }
      const result = await res.json();

      // Spawn the daemon locally so it's visible immediately
      const def = fullDefinition as any;
      daemonRenderer.spawnDaemon({
        daemonId: result.id,
        definition: def,
        currentPosition: def.position || { x: localPosition.x, y: 0, z: localPosition.z },
        currentRotation: def.rotation || localRotation,
        currentAction: "idle",
      });

      // Reload daemon list for this plot
      loadPlotDaemons(plotUuid);
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  };

  daemonPanel.onDelete = async (daemonId) => {
    const res = await fetch(`${apiUrl}/api/daemons/${daemonId}`, {
      method: "DELETE",
    });
    if (!res.ok) return;
    const plotUuid = daemonPanel.getPlotUuid();
    if (plotUuid) loadPlotDaemons(plotUuid);
  };

  daemonPanel.onRecall = (daemonId) => {
    network.sendDaemonRecall(daemonId);
  };

  daemonPanel.onToggleRoam = (daemonId, enabled) => {
    network.sendDaemonToggleRoam(daemonId, enabled);
  };

  daemonPanel.onFetchActivity = async (daemonId) => {
    try {
      const res = await fetch(`${apiUrl}/api/daemons/${daemonId}/activity`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.activity || [];
    } catch {
      return [];
    }
  };

  async function loadPlotDaemons(plotUuid: string) {
    try {
      const res = await fetch(`${apiUrl}/api/daemons/plot/${plotUuid}`);
      if (!res.ok) return;
      const data = await res.json();
      daemonPanel.setDaemonList(data.daemons || []);
    } catch {
      // silent
    }
  }

  creationPanel.onGenerate = async (description) => {
    const plotUuid = creationPanel.getPlotUuid();
    const plot = plotUuid ? plotSnapshots.find(p => p.uuid === plotUuid) : null;

    // Step 1: AI generates object definition
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const res = await fetch(`${apiUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        userDescription: description,
        plotUUID: plotUuid || "preview",
        plotContext: {
          existingObjects: plot?.objects.map(o => ({
            id: o.name,
            name: o.name,
            renderCost: o.renderCost,
            origin: o.origin,
            bounds: {
              width: o.physics.colliderSize.x,
              depth: o.physics.colliderSize.z,
              height: o.physics.colliderSize.y,
            },
          })) || [],
          remainingRenderBudget: 500_000,
          plotBounds: plot?.placement.bounds || { width: 20, depth: 30, height: 40 },
        },
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Generation failed" }));
      throw new Error(err.error || "Generation failed");
    }
    const result = await res.json();
    const obj = result.objectDefinition as WorldObject;

    // Step 2: Render the object
    const id = `gen_${++objectCounter}`;
    if (plot && plotUuid) {
      // Place on plot and persist to server
      objectRenderer.renderObject(id, obj, {
        x: plot.placement.position.x,
        y: 0,
        z: plot.placement.position.z,
      });
      network.sendObjectPlace(plotUuid, obj);
    } else {
      // Free-floating preview (no persistence)
      const angle = localRotation;
      const spawnPos = {
        x: localPosition.x - Math.sin(angle) * 5,
        y: 0,
        z: localPosition.z - Math.cos(angle) * 5,
      };
      objectRenderer.renderObject(id, obj, spawnPos);
    }

    // Step 3: If novel mesh, kick off Meshy generation in background
    if (result.meshRoute === "novel" && result.novelDescription) {
      startMeshGeneration(id, result.novelDescription, result.galleryId);
    }
  };

  // Gallery panel wiring
  galleryPanel.onSelect = async (item) => {
    try {
      const detailRes = await fetch(`${apiUrl}/api/gallery/${item.id}`);
      if (!detailRes.ok) return;
      const detail = await detailRes.json();
      const obj = detail.object_definition as WorldObject;

      // Place 3 units in front of player
      const angle = localRotation;
      const spawnPos = {
        x: localPosition.x - Math.sin(angle) * 3,
        y: 0,
        z: localPosition.z - Math.cos(angle) * 3,
      };

      const id = `gallery_${++objectCounter}`;
      objectRenderer.renderObject(id, obj, spawnPos);

      // If GLB is available, load it via proxy
      if (detail.glb_url) {
        await objectRenderer.loadGLB(
          id,
          `${apiUrl}/api/gallery/${item.id}/model`,
          detail.status !== "refined",
        );
      }

      galleryPanel.hide();
    } catch (err) {
      console.error("Gallery select error:", err);
    }
  };

  async function startMeshGeneration(objectId: string, description: string, galleryId?: string) {
    try {
      // ── Stage 1: Preview (fast, ~60s, geometry only) ──
      objectRenderer.setProgress(objectId, 0, "Preview...");

      const startRes = await fetch(`${apiUrl}/api/generate/mesh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });

      if (!startRes.ok) {
        objectRenderer.setProgress(objectId, 0, "Failed");
        return;
      }

      const { taskId: previewTaskId } = await startRes.json();
      const previewGlb = await pollMeshUntilDone(objectId, previewTaskId, "Preview", galleryId);
      if (!previewGlb) return;

      // Load preview model (with AI material colors)
      objectRenderer.setProgress(objectId, 100, "Loading preview...");
      await objectRenderer.loadGLB(objectId, previewGlb, true);

      // ── Stage 2: Refine (slower, ~60-90s, full PBR textures) ──
      objectRenderer.setProgress(objectId, 0, "Refining...");

      const refineRes = await fetch(`${apiUrl}/api/generate/mesh/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewTaskId }),
      });

      if (!refineRes.ok) {
        // Preview is still loaded — refine is a nice-to-have
        objectRenderer.clearProgress(objectId);
        return;
      }

      const { taskId: refineTaskId } = await refineRes.json();
      const refineGlb = await pollMeshUntilDone(objectId, refineTaskId, "Refining", galleryId);
      if (!refineGlb) return;

      // Upgrade to refined model (with Meshy's own PBR textures)
      objectRenderer.setProgress(objectId, 100, "Loading HD...");
      await objectRenderer.loadGLB(objectId, refineGlb, false);
      objectRenderer.clearProgress(objectId);
    } catch (err) {
      console.error("Mesh generation error:", err);
      objectRenderer.setProgress(objectId, 0, "Error");
    }
  }

  /** Poll a mesh task until it succeeds, fails, or times out. Returns proxy GLB URL or null. */
  async function pollMeshUntilDone(
    objectId: string,
    taskId: string,
    label: string,
    galleryId?: string,
  ): Promise<string | null> {
    const POLL_MS = 3000;
    const MAX_POLLS = 60;

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));

      const qs = galleryId ? `?galleryId=${encodeURIComponent(galleryId)}` : "";
      const pollRes = await fetch(`${apiUrl}/api/generate/mesh/${taskId}${qs}`);
      if (!pollRes.ok) continue;

      const status = await pollRes.json();

      if (status.status === "SUCCEEDED" && status.glbUrl) {
        return `${apiUrl}/api/generate/mesh/${taskId}/model`;
      }

      if (status.status === "FAILED") {
        objectRenderer.setProgress(objectId, 0, `${label} failed`);
        return null;
      }

      const pct = Math.round(status.progress || 0);
      objectRenderer.setProgress(objectId, pct, `${label}...`);
    }

    objectRenderer.setProgress(objectId, 0, "Timed out");
    return null;
  }

  // Try to connect (non-blocking — game works offline for dev)
  try {
    await network.connect();
    // localPlayerId is set by onWorldSnapshot callback using yourUserId
  } catch {
    console.warn("Could not connect to server — running in offline mode");
    // Add local avatar anyway for dev
    avatarManager.localPlayerId = "local";
    avatarManager.addPlayer({
      userId: "local",
      displayName: "You",
      avatarDefinition: { avatarIndex: 0 },
      position: spawn,
      rotation: 0,
      velocity: { x: 0, y: 0, z: 0 },
    });
    avatarManager.hideLocalNameLabel();
    // Generate local plot snapshots so building works offline
    // Use valid UUID v4 format to avoid postgres type errors if connection recovers
    const placements = getAllPlotPositions();
    plotSnapshots = placements.map((placement, i) => ({
      uuid: `00000000-0000-4000-8000-${i.toString().padStart(12, "0")}`,
      ownerId: "local",
      ownerName: "You",
      neighborhood: "dev",
      ring: 0,
      position: i,
      placement,
      objects: [],
    }));
  }

  // Find which plot (if any) contains the given position
  function findPlotAtPosition(pos: THREE.Vector3): string | null {
    for (const plot of plotSnapshots) {
      const p = plot.placement;
      const dx = pos.x - p.position.x;
      const dz = pos.z - p.position.z;
      // Rotate world-space offset into the plot's local frame
      const cos = Math.cos(-p.rotation);
      const sin = Math.sin(-p.rotation);
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      if (
        Math.abs(localX) <= p.bounds.width / 2 &&
        Math.abs(localZ) <= p.bounds.depth / 2
      ) {
        return plot.uuid;
      }
    }
    return null;
  }

  // Game loop
  streetScene.onUpdate((dt) => {
    // Input → movement
    if (inputManager.isPointerLocked() && !chatUI.isVisible()) {
      const mouse = inputManager.consumeMouse();
      cameraController.applyMouseDelta(mouse.x, mouse.y);

      // Smooth character rotation (visual facing only)
      const targetYaw = cameraController.getYaw();
      let yawDiff = targetYaw - localRotation;
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
      localRotation += yawDiff * Math.min(dt * TURN_SPEED, 1);

      // Compute target velocity from input
      const moveVec = inputManager.getMovementVector();
      let desiredSpeed = inputManager.state.sprint ? RUN_SPEED : WALK_SPEED;

      // Landing recovery: reduce max speed briefly after landing
      if (landingTimer > 0) {
        desiredSpeed *= 0.6;
        landingTimer -= dt;
        if (landingTimer < 0) landingTimer = 0;
      }

      let targetVX = 0;
      let targetVZ = 0;
      if (moveVec.x !== 0 || moveVec.z !== 0) {
        // Movement direction from camera yaw (camera-relative controls)
        const angle = targetYaw;
        targetVX = (moveVec.x * Math.cos(angle) + moveVec.z * Math.sin(angle)) * desiredSpeed;
        targetVZ = (-moveVec.x * Math.sin(angle) + moveVec.z * Math.cos(angle)) * desiredSpeed;
      }

      // Acceleration / deceleration
      const accelRate = !isGrounded ? ACCEL * 0.5 : ACCEL; // reduced air control
      if (targetVX !== 0 || targetVZ !== 0) {
        velocityX += (targetVX - velocityX) * Math.min(dt * accelRate, 1);
        velocityZ += (targetVZ - velocityZ) * Math.min(dt * accelRate, 1);
      } else {
        velocityX += (0 - velocityX) * Math.min(dt * DECEL, 1);
        velocityZ += (0 - velocityZ) * Math.min(dt * DECEL, 1);
      }

      // Apply velocity
      localPosition.x += velocityX * dt;
      localPosition.z += velocityZ * dt;

      const currentSpeed = Math.sqrt(velocityX * velocityX + velocityZ * velocityZ);

      // Edge-triggered jump
      if (inputManager.state.jump && !wasJumping && isGrounded) {
        verticalVelocity = JUMP_VELOCITY;
        isGrounded = false;
      }
      wasJumping = inputManager.state.jump;

      if (!isGrounded) {
        verticalVelocity += GRAVITY * dt;
        localPosition.y += verticalVelocity * dt;
        if (localPosition.y <= 0) {
          localPosition.y = 0;
          verticalVelocity = 0;
          isGrounded = true;
          landingTimer = 0.12;
          avatarManager.triggerLanding();
        }
      }

      avatarManager.setLocalPlayerPosition(
        { x: localPosition.x, y: localPosition.y, z: localPosition.z },
        localRotation
      );
      avatarManager.setLocalMoving(currentSpeed);

      // Send position to server at SEND_RATE
      sendTimer += dt;
      if (sendTimer >= SEND_RATE) {
        sendTimer = 0;
        network.sendMove(
          {
            x: localPosition.x,
            y: localPosition.y,
            z: localPosition.z,
          },
          localRotation
        );
      }
    } else {
      // Consume mouse to prevent accumulation
      inputManager.consumeMouse();
      avatarManager.setLocalMoving(0);
    }

    // Update current plot based on player position
    const newPlotUuid = findPlotAtPosition(localPosition);
    if (newPlotUuid !== currentPlotUuid) {
      currentPlotUuid = newPlotUuid;
      const plot = plotSnapshots.find(p => p.uuid === currentPlotUuid);
      creationPanel.setPlotInfo(
        currentPlotUuid,
        plot?.ownerName ?? null,
      );
      daemonPanel.setPlotInfo(
        currentPlotUuid,
        plot?.ownerName ?? null,
      );
      if (currentPlotUuid) {
        loadPlotDaemons(currentPlotUuid);
      }
    }

    // Update systems
    elapsedTime += dt;
    avatarManager.update(dt);
    daemonRenderer.update(dt);
    objectRenderer.update(elapsedTime);
    targetingSystem.update();
    const playerPos = avatarManager.getLocalPlayerPosition();
    if (playerPos) {
      cameraController.update(playerPos, dt);
    }
  });

  // Info overlay
  const info = document.createElement("div");
  info.style.cssText = `
    position: fixed;
    top: 10px;
    left: 10px;
    color: white;
    font-family: system-ui, sans-serif;
    font-size: 13px;
    background: rgba(0,0,0,0.5);
    padding: 8px 12px;
    border-radius: 4px;
    z-index: 50;
  `;
  info.innerHTML =
    "Click to look around | WASD to move | Shift to run | Enter to chat | Tab to target | B to build | G gallery | V avatar | N daemons";
  document.body.appendChild(info);

  // Location HUD (top right, discreet)
  const locationHud = document.createElement("div");
  locationHud.id = "location-hud";
  locationHud.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    color: rgba(255,255,255,0.7);
    font-family: system-ui, sans-serif;
    font-size: 12px;
    background: rgba(0,0,0,0.4);
    padding: 6px 10px;
    border-radius: 4px;
    z-index: 50;
    text-align: right;
    pointer-events: none;
    min-width: 120px;
  `;
  document.body.appendChild(locationHud);

  // Helper to find the nearest plot to a position and compute compass info
  function updateLocationHud(pos: THREE.Vector3): void {
    // Compute angle on the ring (atan2 of x,z gives ring angle)
    const ringAngle = Math.atan2(pos.z, pos.x);
    // Normalize to 0-360 degrees
    const degrees = ((ringAngle * 180 / Math.PI) % 360 + 360) % 360;
    // Distance from ring center
    const distFromCenter = Math.sqrt(pos.x * pos.x + pos.z * pos.z);

    // Find nearest plot
    let nearestPlot: typeof plotSnapshots[0] | null = null;
    let nearestDist = Infinity;
    for (const plot of plotSnapshots) {
      const dx = pos.x - plot.placement.position.x;
      const dz = pos.z - plot.placement.position.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < nearestDist) {
        nearestDist = d;
        nearestPlot = plot;
      }
    }

    // Are we on a plot?
    const onPlot = currentPlotUuid ? plotSnapshots.find(p => p.uuid === currentPlotUuid) : null;

    let locationText = "";
    if (onPlot) {
      locationText = `<span style="color:#88ddaa">${escapeHtml(onPlot.ownerName)}'s Plot</span>`;
    } else if (nearestPlot && nearestDist < 40) {
      locationText = `Near ${escapeHtml(nearestPlot.ownerName)}'s plot`;
    } else {
      locationText = "The Street";
    }

    // Ring position as compass bearing
    const compass = Math.round(degrees);
    locationHud.innerHTML = `${locationText}<br><span style="opacity:0.5">${compass}\u00B0 \u00B7 ${Math.round(distFromCenter)}m from center</span>`;
  }

  function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Update location HUD periodically (every 0.5s to avoid spam)
  let locationHudTimer = 0;
  // Update location HUD via second game loop callback
  streetScene.onUpdate((dt) => {
    locationHudTimer += dt;
    if (locationHudTimer >= 0.5) {
      locationHudTimer = 0;
      updateLocationHud(localPosition);
    }
  });

  streetScene.start();
}

init().catch(console.error);
