import { StreetScene } from "./scene/StreetScene.js";
import { StreetGeometry } from "./scene/StreetGeometry.js";
import { PlotRenderer } from "./scene/PlotRenderer.js";
import { AvatarManager } from "./avatar/AvatarManager.js";
import { InputManager } from "./input/InputManager.js";
import { CameraController } from "./camera/CameraController.js";
import { NetworkManager } from "./network/NetworkManager.js";
import { ChatUI } from "./ui/ChatUI.js";
import { CreationPanel } from "./ui/CreationPanel.js";
import { getDefaultSpawnPoint } from "@the-street/shared";
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
  const cameraController = new CameraController(streetScene.camera);
  const inputManager = new InputManager(streetScene.renderer.domElement);

  // UI
  const chatUI = new ChatUI();
  const creationPanel = new CreationPanel();

  // Build button (B key)
  document.addEventListener("keydown", (e) => {
    if (
      e.key.toLowerCase() === "b" &&
      document.activeElement?.tagName !== "INPUT" &&
      document.activeElement?.tagName !== "TEXTAREA"
    ) {
      creationPanel.toggle();
    }
  });

  // Local player state
  const spawn = getDefaultSpawnPoint();
  let localPosition = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
  let localRotation = 0;
  let sendTimer = 0;

  // Network
  const wsUrl =
    import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:2567`;

  const network = new NetworkManager(wsUrl, {
    onWorldSnapshot(players, _plots) {
      for (const p of players) {
        avatarManager.addPlayer(p);
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
    onObjectPlaced(_objectId, _plotUUID, _objectDefinition) {
      // TODO: render placed object
    },
    onObjectRemoved(_objectId) {
      // TODO: remove object from scene
    },
    onObjectStateChange(_objectId, _stateData) {
      // TODO: update object state
    },
  });

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
  creationPanel.onGenerate = async (description) => {
    const apiUrl =
      import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`;
    const res = await fetch(`${apiUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userDescription: description,
        plotUUID: "preview",
        plotContext: {
          existingObjects: [],
          remainingRenderBudget: 500_000,
          plotBounds: { width: 20, depth: 30, height: 40 },
        },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Generation failed" }));
      throw new Error(err.error || "Generation failed");
    }
    // Object generated — server will broadcast placement
  };

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
        // Transform movement by camera yaw
        const angle = localRotation;
        const dx =
          (moveVec.x * Math.cos(angle) - moveVec.z * Math.sin(angle)) *
          speed *
          dt;
        const dz =
          (moveVec.x * Math.sin(angle) + moveVec.z * Math.cos(angle)) *
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

    // Update systems
    avatarManager.update(dt);
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
    "Click to look around | WASD to move | Shift to run | Enter to chat | B to build";
  document.body.appendChild(info);

  streetScene.start();
}

init().catch(console.error);
