import { StreetScene } from "./scene/StreetScene.js";
import { StreetGeometry } from "./scene/StreetGeometry.js";
import { PlotRenderer } from "./scene/PlotRenderer.js";
import { ObjectRenderer } from "./scene/ObjectRenderer.js";
import { AvatarManager } from "./avatar/AvatarManager.js";
import { InputManager } from "./input/InputManager.js";
import { CameraController } from "./camera/CameraController.js";
import { NetworkManager } from "./network/NetworkManager.js";
import { ChatUI } from "./ui/ChatUI.js";
import { CreationPanel } from "./ui/CreationPanel.js";
import { GalleryPanel } from "./ui/GalleryPanel.js";
import { getDefaultSpawnPoint } from "@the-street/shared";
import type { WorldObject, PlotSnapshot } from "@the-street/shared";
import * as THREE from "three";

const WALK_SPEED = 5;
const RUN_SPEED = 12;
const SEND_RATE = 1 / 20; // 20Hz position updates to server

async function init() {
  // Scene
  const streetScene = new StreetScene();
  const streetGeo = new StreetGeometry();
  streetScene.scene.add(streetGeo.mesh);

  const plotRenderer = new PlotRenderer();
  streetScene.scene.add(plotRenderer.plotGroup);

  const avatarManager = new AvatarManager(streetScene.scene);
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

  // Build button (B key) / Gallery (G key)
  document.addEventListener("keydown", (e) => {
    if (
      document.activeElement?.tagName === "INPUT" ||
      document.activeElement?.tagName === "TEXTAREA"
    ) return;

    if (e.key.toLowerCase() === "b") {
      creationPanel.toggle();
    } else if (e.key.toLowerCase() === "g") {
      galleryPanel.toggle();
    }
  });

  // Local player state
  const spawn = getDefaultSpawnPoint();
  let localPosition = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
  let localRotation = 0;
  let sendTimer = 0;
  let elapsedTime = 0;

  // Network
  const wsUrl =
    import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:2567`;

  const network = new NetworkManager(wsUrl, {
    onWorldSnapshot(players, plots) {
      for (const p of players) {
        avatarManager.addPlayer(p);
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
    },
    onPlayerJoin(player) {
      avatarManager.addPlayer(player);
    },
    onPlayerLeave(userId) {
      avatarManager.removePlayer(userId);
    },
    onPlayerMove(userId, position, rotation) {
      avatarManager.updatePlayerPosition(userId, position, rotation);
    },
    onChat(senderId, senderName, content, _position) {
      chatUI.addMessage(senderId, senderName, content);
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
  });

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
  };

  // Creation panel wiring
  const apiUrl =
    import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`;

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
    const sessionId = network.getSessionId();
    if (sessionId) {
      avatarManager.localPlayerId = sessionId;
      avatarManager.addPlayer({
        userId: sessionId,
        displayName: "You",
        avatarDefinition: { avatarIndex: 0 },
        position: spawn,
        rotation: 0,
        velocity: { x: 0, y: 0, z: 0 },
      });
    }
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
  }

  // Find which plot (if any) contains the given position
  function findPlotAtPosition(pos: THREE.Vector3): string | null {
    for (const plot of plotSnapshots) {
      const p = plot.placement;
      const dx = pos.x - p.position.x;
      const dz = pos.z - p.position.z;
      if (
        Math.abs(dx) <= p.bounds.width / 2 &&
        Math.abs(dz) <= p.bounds.depth / 2
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
      localRotation = cameraController.getYaw();

      const moveVec = inputManager.getMovementVector();
      const speed = inputManager.state.sprint ? RUN_SPEED : WALK_SPEED;

      if (moveVec.x !== 0 || moveVec.z !== 0) {
        // Transform movement by camera yaw (camera-relative controls)
        const angle = localRotation;
        const dx =
          (moveVec.x * Math.cos(angle) + moveVec.z * Math.sin(angle)) *
          speed *
          dt;
        const dz =
          (-moveVec.x * Math.sin(angle) + moveVec.z * Math.cos(angle)) *
          speed *
          dt;

        localPosition.x += dx;
        localPosition.z += dz;
      }

      avatarManager.setLocalPlayerPosition(
        { x: localPosition.x, y: localPosition.y, z: localPosition.z },
        localRotation
      );

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
    }

    // Update systems
    elapsedTime += dt;
    avatarManager.update(dt);
    objectRenderer.update(elapsedTime);
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
    "Click to look around | WASD to move | Shift to run | Enter to chat | B to build | G for gallery";
  document.body.appendChild(info);

  streetScene.start();
}

init().catch(console.error);
