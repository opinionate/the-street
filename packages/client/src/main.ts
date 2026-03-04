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

async function init() {
  // Scene
  const streetScene = new StreetScene();
  const streetGeo = new StreetGeometry();
  streetScene.scene.add(streetGeo.mesh);

  const plotRenderer = new PlotRenderer();
  streetScene.scene.add(plotRenderer.plotGroup);

  const avatarManager = new AvatarManager(streetScene.scene);
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

  // Network
  const wsUrl =
    import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:2567`;

  const network = new NetworkManager(wsUrl, {
    onWorldSnapshot(yourUserId, players, plots, daemons) {
      avatarManager.localPlayerId = yourUserId;
      for (const p of players) {
        avatarManager.addPlayer(p);
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
      chatUI.addMessage(senderId, senderName, content);
      avatarManager.showChatBubble(senderId, senderName, content);
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
      avatarPanel.setGenerationResult(result.appearance, result.meshyTaskId || null);
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  };

  avatarPanel.onSave = async (avatarDefinition) => {
    const res = await fetch(`${apiUrl}/api/avatar/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarDefinition }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Save failed" }));
      throw new Error(err.error || "Save failed");
    }
    // Notify server so it broadcasts the update to all clients
    network.sendAvatarUpdate(avatarDefinition);
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
      avatarManager.setLocalMoving(
        inputManager.isMoving(),
        inputManager.state.sprint
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
      avatarManager.setLocalMoving(false, false);
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
