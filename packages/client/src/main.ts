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
import type { WorldObject, PlotSnapshot, DaemonDefinition } from "@the-street/shared";
import { AuthManager } from "./auth/AuthManager.js";
import { LoginUI } from "./ui/LoginUI.js";
import { AdminPanel } from "./ui/AdminPanel.js";
import { DaemonCreationPanel } from "./ui/DaemonCreationPanel.js";
import { DaemonPlacementPanel } from "./ui/DaemonPlacementPanel.js";
import { DaemonDirectoryPanel } from "./ui/DaemonDirectoryPanel.js";
import { AnimationPanel } from "./ui/AnimationPanel.js";
import { AnimationConverterTool } from "./ui/AnimationConverterTool.js";
import { DefaultModelUploader } from "./ui/DefaultModelUploader.js";
import { ActivityLogViewer } from "./ui/ActivityLogViewer.js";
import type { UserRole } from "@the-street/shared";
import * as THREE from "three";

const WALK_SPEED = 5;
const RUN_SPEED = 36;
const SEND_RATE = 1 / 20; // 20Hz position updates to server
const JUMP_VELOCITY = 6;
const GRAVITY = -15;
const JUMP_WINDUP = 0.15; // seconds of crouch animation before launching
const ACCEL = 12;   // ~0.1s to full walk speed
const DECEL = 8;    // ~0.15s slide on release
const TURN_SPEED = 3.0; // keyboard turning ~170°/s

async function init() {
  // Scene
  const streetScene = new StreetScene();
  const streetGeo = new StreetGeometry();
  streetScene.scene.add(streetGeo.mesh);

  const plotRenderer = new PlotRenderer();
  streetScene.scene.add(plotRenderer.plotGroup);

  const apiUrl = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`;

  // --- Auth ---
  let authManager: AuthManager | null = null;
  let sessionToken: string | undefined;
  let userRole: UserRole = "user";

  const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (clerkKey) {
    authManager = new AuthManager(clerkKey);
    await authManager.init();

    if (!authManager.isSignedIn) {
      const loginUI = new LoginUI(authManager);
      await new Promise<void>((resolve) => {
        loginUI.onAuthenticated = resolve;
        loginUI.show();
      });
      loginUI.destroy();
    }

    sessionToken = (await authManager.getToken()) ?? undefined;
  }

  // Helper to add auth header to all API calls
  async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers);
    if (authManager) {
      const token = await authManager.getToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(url, { ...options, headers });
  }

  const avatarManager = new AvatarManager(streetScene.scene);
  avatarManager.apiUrl = apiUrl;
  const daemonRenderer = new DaemonRenderer(streetScene.scene);
  daemonRenderer.apiUrl = apiUrl;
  const objectRenderer = new ObjectRenderer(streetScene.scene);
  const cameraController = new CameraController(streetScene.camera);
  const inputManager = new InputManager(streetScene.renderer.domElement);

  // AdminPanel created early so inputManager can reference it
  const adminPanel = new AdminPanel();
  const daemonCreationPanel = new DaemonCreationPanel();
  const daemonPlacementPanel = new DaemonPlacementPanel();

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
  galleryPanel.fetchFn = authFetch;
  const avatarPanel = new AvatarPanel();
  const daemonPanel = new DaemonPanel();
  const daemonChatUI = new DaemonChatUI();
  const daemonDirectoryPanel = new DaemonDirectoryPanel();
  const targetingSystem = new TargetingSystem(streetScene.scene, avatarManager, daemonRenderer);

  // Block mouse input from reaching the game when UI panels are open
  inputManager.isUIBlocking = () =>
    avatarPanel.isVisible() ||
    creationPanel.isVisible() ||
    galleryPanel.isVisible() ||
    daemonPanel.isVisible() ||
    adminPanel.isVisible ||
    daemonCreationPanel.isVisible() ||
    daemonPlacementPanel.isVisible() ||
    daemonChatUI.isVisible() ||
    daemonDirectoryPanel.isVisible;

  // Build button (B key) / Gallery (G key)
  // Escape handler uses capture phase so it fires before any element can stopPropagation
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      // Cancel emote if playing
      const myId = avatarManager.localPlayerId || "";
      if (avatarManager.isEmoting(myId)) {
        avatarManager.stopEmote(myId);
      } else if (daemonPlacementPanel.isVisible()) { daemonPlacementPanel.hide(); }
      else if (daemonCreationPanel.isVisible()) { daemonCreationPanel.hide(); }
      else if (avatarPanel.isVisible()) { avatarPanel.hide(); }
      else if (daemonPanel.isVisible()) { daemonPanel.hide(); }
      else if (adminPanel.isVisible) { adminPanel.hide(); }
      else if (daemonDirectoryPanel.isVisible) { daemonDirectoryPanel.hide(); }
      else if (creationPanel.isVisible()) { creationPanel.hide(); }
      else if (galleryPanel.isVisible()) { galleryPanel.hide(); }
      else { targetingSystem.deselect(); }
    }
  }, true); // capture phase

  // Other hotkeys use normal bubbling
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return; // handled above in capture
    // Skip hotkeys when typing in input fields
    if (
      document.activeElement?.tagName === "INPUT" ||
      document.activeElement?.tagName === "TEXTAREA"
    ) return;

    if (e.key.toLowerCase() === "b") {
      creationPanel.toggle();
    } else if (e.key.toLowerCase() === "g") {
      galleryPanel.toggle();
    } else if (e.key.toLowerCase() === "v") {
      avatarPanel.toggle();
    } else if (e.key === "F10") {
      e.preventDefault();
      daemonDirectoryPanel.toggle();
    } else if (e.key === "F9" && userRole === "super_admin") {
      adminPanel.toggle();
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
  let jumpWindupTimer = 0; // countdown for crouch before launch

  // Network
  const wsUrl =
    import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:2567`;

  const network = new NetworkManager(wsUrl, {
    onWorldSnapshot(yourUserId, yourRole: UserRole, players, plots, daemons) {
      avatarManager.localPlayerId = yourUserId;
      userRole = yourRole;
      if (authManager) authManager.role = yourRole;
      daemonPanel.setSuperAdmin(yourRole === "super_admin");
      for (const p of players) {
        avatarManager.addPlayer(p);
      }
      avatarManager.hideLocalNameLabel();
      for (const p of players) {
        // Load custom uploaded avatar if available
        if (p.avatarDefinition.uploadedModelId) {
          avatarManager.loadUploadedAvatar(p.userId, p.avatarDefinition.uploadedModelId);
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
      if (player.avatarDefinition.uploadedModelId) {
        avatarManager.loadUploadedAvatar(player.userId, player.avatarDefinition.uploadedModelId);
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
    onDaemonAnimatedEmote(daemonId, emoteId) {
      daemonRenderer.playDaemonEmote(daemonId, emoteId);
    },
    onDaemonThought(daemonId, thought) {
      daemonRenderer.showDaemonThought(daemonId, thought);
      const name = daemonRenderer.getDaemonName(daemonId) || "NPC";
      chatUI.addMessage(daemonId, name, thought, "daemon-thought");
    },
    onDaemonSpeechStream(daemonId, daemonName, speech, _emote, movement, addressedTo, _position) {
      // Render speech as distinct daemon speech in chat
      chatUI.addMessage(daemonId, daemonName, speech, "daemon-speech");

      // Show speech bubble on daemon
      daemonRenderer.showDaemonChat(daemonId, daemonName, speech);

      // Note: text emotes (e.g. "*waves*") are handled by the separate onDaemonEmote callback.
      // Animation triggers come through onDaemonAnimatedEmote with a valid emoteId.

      // Handle movement intent
      if (movement) {
        daemonRenderer.setDaemonMovementIntent(daemonId, movement, addressedTo);
      }
    },
    onDaemonConversationStart(daemonId, daemonName, _participantId, participantType) {
      const label = participantType === "visitor" ? "a visitor" : "another daemon";
      chatUI.addMessage(daemonId, daemonName, `started a conversation with ${label}.`, "daemon-emote");
    },
    onDaemonConversationEnd(daemonId, _sessionId, reason) {
      const name = daemonRenderer.getDaemonName(daemonId) || "NPC";
      const reasonText = reason === "ended_natural" ? "ended the conversation." : `conversation ended (${reason}).`;
      chatUI.addMessage(daemonId, name, reasonText, "daemon-emote");
    },
    onPlayerEmote(userId, emoteId) {
      avatarManager.playEmote(userId, emoteId);
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
  chatUI.onAnimatedEmote = (emoteId, verb) => {
    const myId = avatarManager.localPlayerId || "local";
    const emoteText = `${verb}.`;
    // Show in chat + bubble
    chatUI.addMessage(myId, "You", emoteText, "player-emote");
    avatarManager.showChatBubble(myId, "You", emoteText);
    // Play animation locally
    avatarManager.playEmote(myId, emoteId);
    // Broadcast emote to other players (animation) + chat text
    network.sendEmote(emoteId);
    network.sendChat(`/me ${emoteText}`);
  };

  // "/" key opens chat with slash pre-filled for command autocomplete
  inputManager.onSlashCommand = () => {
    chatUI.showWithText("/");
  };

  // Avatar panel wiring
  avatarPanel.onSave = async (avatarDefinition) => {
    const thumbnailUrl = avatarPanel.getThumbnailUrl() || undefined;
    const res = await authFetch(`${apiUrl}/api/avatar/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarDefinition, thumbnailUrl }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Save failed" }));
      throw new Error(err.error || "Save failed");
    }
    // Broadcast so other clients pick up the change.
    network.sendAvatarUpdate(avatarDefinition);
  };

  avatarPanel.onLoadHistory = async () => {
    const res = await authFetch(`${apiUrl}/api/avatar/history`);
    if (!res.ok) throw new Error("Failed to load history");
    const data = await res.json();
    return data.history;
  };

  avatarPanel.onSelectHistoryItem = async (avatarDefinition) => {
    const localId = avatarManager.localPlayerId || "local";

    // Load the saved avatar's uploaded model if available
    const historyId = avatarPanel.getSelectedHistoryId() ?? undefined;
    if (avatarDefinition.uploadedModelId) {
      await avatarManager.loadUploadedAvatar(localId, avatarDefinition.uploadedModelId, historyId);
    }

    // Apply appearance colors
    if (avatarDefinition.customAppearance) {
      avatarManager.applyAppearance(localId, avatarDefinition.customAppearance);
    }
    // Broadcast to other players
    network.sendAvatarUpdate(avatarDefinition);

    // Update the 3D preview
    avatarPanel.refreshPreview();
  };

  avatarPanel.onDeleteHistoryItem = async (id) => {
    const res = await authFetch(`${apiUrl}/api/avatar/history/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Delete failed" }));
      throw new Error(err.error || "Delete failed");
    }
  };

  avatarPanel.onGetPreviewModel = () => {
    const localId = avatarManager.localPlayerId || "local";
    return avatarManager.getPreviewModel(localId);
  };

  // Auth token helper for animation panels
  const getAuthTokenStr = async () => (await authManager?.getToken()) ?? "";

  // Animation panel for avatar
  const avatarAnimPanel = new AnimationPanel({
    entityType: "avatar",
    getEntityId: () => avatarPanel.getSelectedHistoryId(),
    apiUrl,
    getAuthToken: getAuthTokenStr,
  });
  avatarAnimPanel.onAnimationChanged = () => {
    // Reload the avatar so the new custom animation takes effect
    const localId = avatarManager.localPlayerId || "local";
    const historyId = avatarPanel.getSelectedHistoryId();
    if (!historyId) return;
    const item = avatarPanel.getSelectedHistoryItem?.();
    if (!item) return;
    const def = item.avatar_definition;
    if (def?.uploadedModelId) {
      avatarManager.loadUploadedAvatar(localId, def.uploadedModelId, historyId);
    }
  };
  avatarPanel.setAnimationPanel(avatarAnimPanel);

  // Upload Mixamo character handler
  avatarPanel.onUploadCharacter = async (file: File) => {
    avatarPanel.setStatus("Converting FBX to GLB...");
    const { convertFbxCharacterToGlb } = await import("./avatar/animation-converter.js");
    const glb = await convertFbxCharacterToGlb(file);

    avatarPanel.setStatus("Uploading character...");
    const token = await getAuthTokenStr();
    const uploadRes = await fetch(`${apiUrl}/api/avatar/upload-character`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-original-filename": file.name,
        Authorization: `Bearer ${token}`,
      },
      body: glb,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({ error: uploadRes.statusText }));
      throw new Error(err.error || "Upload failed");
    }
    const { uploadId } = await uploadRes.json();

    avatarPanel.setStatus("Loading character...");
    const localId = avatarManager.localPlayerId || "local";
    await avatarManager.loadUploadedAvatar(localId, uploadId);

    avatarPanel.setUploadedModelId(uploadId);
    avatarPanel.refreshPreview();
    avatarPanel.setStatus("Character loaded! Click Save to keep it.");
  };

  // Animation panel factory for daemons
  daemonPanel.createAnimationPanel = (daemonId: string) => {
    const panel = new AnimationPanel({
      entityType: "daemon",
      getEntityId: () => daemonId,
      apiUrl,
      getAuthToken: getAuthTokenStr,
    });
    panel.onAnimationChanged = () => {
      daemonRenderer.reloadIdleAnimation(daemonId);
    };
    return panel;
  };

  // Daemon panel wiring
  daemonPanel.onPlacementChange = (mode) => {
    if (mode === "no-plot") {
      loadGlobalDaemons();
    } else if (currentPlotUuid) {
      loadPlotDaemons(currentPlotUuid);
    }
  };

  daemonPanel.onGenerate = async (description) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await authFetch(`${apiUrl}/api/daemons/generate`, {
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
    const plotUuid = daemonPanel.getEffectivePlotUuid();

    const fullDefinition: DaemonDefinition = {
      ...definition,
      ...(plotUuid ? { plotUuid } : {}),
      position: { x: localPosition.x, y: 0, z: localPosition.z },
      rotation: localRotation,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await authFetch(`${apiUrl}/api/daemons/create`, {
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
      daemonRenderer.spawnDaemon({
        daemonId: result.id,
        definition: fullDefinition,
        currentPosition: fullDefinition.position || { x: localPosition.x, y: 0, z: localPosition.z },
        currentRotation: fullDefinition.rotation || localRotation,
        currentAction: "idle",
        mood: "neutral",
      });

      // Reload daemon list for this plot (or global daemons if no plot)
      if (plotUuid) {
        loadPlotDaemons(plotUuid);
      } else {
        loadGlobalDaemons();
      }
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  };

  daemonPanel.onDelete = async (daemonId) => {
    const res = await authFetch(`${apiUrl}/api/daemons/${daemonId}`, {
      method: "DELETE",
    });
    if (!res.ok) return;
    const effectivePlotUuid = daemonPanel.getEffectivePlotUuid();
    if (effectivePlotUuid) {
      loadPlotDaemons(effectivePlotUuid);
    } else {
      loadGlobalDaemons();
    }
  };

  daemonPanel.onRecall = (daemonId) => {
    network.sendDaemonRecall(daemonId);
  };

  daemonPanel.onToggleRoam = (daemonId, enabled) => {
    network.sendDaemonToggleRoam(daemonId, enabled);
  };

  daemonPanel.onFetchActivity = async (daemonId) => {
    try {
      const res = await authFetch(`${apiUrl}/api/daemons/${daemonId}/activity`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.activity || [];
    } catch {
      return [];
    }
  };

  // --- Daemon Directory Panel callbacks ---
  daemonDirectoryPanel.onFetchDaemons = () => {
    return daemonRenderer.getAllDaemonStates();
  };

  daemonDirectoryPanel.onTeleport = (position) => {
    localPosition.set(position.x, position.y, position.z);
    networkManager?.sendMove(position, localRotation);
  };

  daemonDirectoryPanel.onFetchEmotes = async (daemonId) => {
    const res = await fetch(`${apiUrl}/api/daemons/${daemonId}/emotes`);
    if (!res.ok) return [];
    return res.json();
  };

  daemonDirectoryPanel.onSetIdleAnimation = async (daemonId, label) => {
    await authFetch(`${apiUrl}/api/daemons/${daemonId}/idle-animation`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    // Hot-swap the idle animation on the live daemon
    daemonRenderer.reloadIdleAnimation(daemonId);
  };

  daemonDirectoryPanel.onFetchActivity = async (daemonId) => {
    try {
      const res = await authFetch(`${apiUrl}/api/daemons/${daemonId}/activity`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.activity || [];
    } catch {
      return [];
    }
  };

  daemonDirectoryPanel.onFetchDaemonDetails = async (daemonId) => {
    try {
      const res = await authFetch(`${apiUrl}/api/daemons/${daemonId}`);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  };

  daemonDirectoryPanel.onSaveDaemon = async (daemonId, definition) => {
    try {
      const res = await authFetch(`${apiUrl}/api/daemons/${daemonId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  // Animation panel factory for daemon directory detail view
  daemonDirectoryPanel.createAnimationPanel = (daemonId: string) => {
    const panel = new AnimationPanel({
      entityType: "daemon",
      getEntityId: () => daemonId,
      apiUrl,
      getAuthToken: getAuthTokenStr,
    });
    // Hot-swap animation on the live daemon after upload/delete
    panel.onAnimationChanged = () => {
      daemonRenderer.reloadIdleAnimation(daemonId);
    };
    return panel;
  };

  async function loadPlotDaemons(plotUuid: string) {
    try {
      const res = await authFetch(`${apiUrl}/api/daemons/plot/${plotUuid}`);
      if (!res.ok) return;
      const data = await res.json();
      daemonPanel.setDaemonList(data.daemons || []);
    } catch {
      // silent
    }
  }

  async function loadGlobalDaemons() {
    try {
      const res = await authFetch(`${apiUrl}/api/daemons/global`);
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
    const res = await authFetch(`${apiUrl}/api/generate`, {
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

  };

  // Gallery panel wiring
  galleryPanel.onSelect = async (item) => {
    try {
      const detailRes = await authFetch(`${apiUrl}/api/gallery/${item.id}`);
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

  // Try to connect (non-blocking — game works offline for dev)
  try {
    await network.connect(sessionToken);
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

  // --- Admin Panel ---
  adminPanel.onLoadUsers = async () => {
    const res = await authFetch(`${apiUrl}/api/admin/users`);
    if (!res.ok) throw new Error("Failed to load users");
    const data = await res.json();
    return data.users;
  };
  adminPanel.onSetRole = async (userId: string, role: UserRole) => {
    const res = await authFetch(`${apiUrl}/api/admin/users/${userId}/role`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) throw new Error("Failed to set role");
  };

  // --- Daemon Creation Panel ---
  daemonCreationPanel.onCreateDraft = async () => {
    const res = await authFetch(`${apiUrl}/api/daemons/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed" }));
      throw new Error(err.error || "Failed to create draft");
    }
    const data = await res.json();
    return { id: data.draft.id };
  };

  daemonCreationPanel.onLoadDraft = async (id: string) => {
    const res = await authFetch(`${apiUrl}/api/daemons/drafts/${id}`);
    if (!res.ok) throw new Error("Failed to load draft");
    const data = await res.json();
    const d = data.draft;
    return {
      draftId: d.id,
      characterUploadId: d.character_upload_id || undefined,
      emoteUploadIds: d.emote_upload_ids || [],
      adminPrompt: d.admin_prompt || undefined,
      expandedFields: d.expanded_fields || undefined,
      expansionStatus: d.expansion_status || "none",
      maxConversationTurns: d.max_conversation_turns ?? 10,
      maxDailyCalls: d.max_daily_calls ?? 200,
      rememberVisitors: d.remember_visitors ?? true,
      uploads: d.uploads || [],
    };
  };

  daemonCreationPanel.onUpdateDraft = async (id: string, fields: Record<string, unknown>) => {
    const res = await authFetch(`${apiUrl}/api/daemons/drafts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed" }));
      throw new Error(err.error || "Update failed");
    }
  };

  daemonCreationPanel.onUploadCharacter = async (draftId: string, file: File) => {
    const buffer = await file.arrayBuffer();
    const res = await authFetch(`${apiUrl}/api/daemons/drafts/${draftId}/upload-character`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-original-filename": file.name,
      },
      body: buffer,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Upload failed" }));
      throw new Error(err.error || "Upload failed");
    }
    return await res.json();
  };

  daemonCreationPanel.onUploadEmote = async (draftId: string, file: File, label: string) => {
    const buffer = await file.arrayBuffer();
    const res = await authFetch(`${apiUrl}/api/daemons/drafts/${draftId}/upload-emote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-original-filename": file.name,
        "x-emote-label": label,
      },
      body: buffer,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Upload failed" }));
      throw new Error(err.error || "Upload failed");
    }
    return await res.json();
  };

  daemonCreationPanel.onExpand = async (draftId: string, prompt?: string, clearedFields?: string[]) => {
    const res = await authFetch(`${apiUrl}/api/daemons/drafts/${draftId}/expand`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminPrompt: prompt, clearedFields }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Expansion failed" }));
      throw new Error(err.error || "Expansion failed");
    }
    return await res.json();
  };

  daemonCreationPanel.onFinalize = async (draftId: string) => {
    const res = await authFetch(`${apiUrl}/api/daemons/drafts/${draftId}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Finalize failed" }));
      throw new Error(err.error || "Finalize failed");
    }
    return await res.json();
  };

  daemonCreationPanel.onAbandon = async (draftId: string) => {
    const res = await authFetch(`${apiUrl}/api/daemons/drafts/${draftId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed" }));
      throw new Error(err.error || "Abandon failed");
    }
  };

  // --- Daemon Placement Panel ---
  daemonPlacementPanel.onListPlaceable = async () => {
    const res = await authFetch(`${apiUrl}/api/daemons/placeable`);
    if (!res.ok) throw new Error("Failed to list placeable daemons");
    const data = await res.json();
    return data.daemons;
  };

  daemonPlacementPanel.onListPlots = async () => {
    const res = await authFetch(`${apiUrl}/api/plots`);
    if (!res.ok) throw new Error("Failed to list plots");
    const data = await res.json();
    return data.plots.map((p: PlotSnapshot) => ({
      uuid: p.uuid,
      position: p.position,
      ownerName: p.ownerName,
      neighborhood: p.neighborhood,
      ring: p.ring,
    }));
  };

  daemonPlacementPanel.onGetPlacement = async (daemonId: string) => {
    const res = await authFetch(`${apiUrl}/api/daemons/${daemonId}/placement`);
    if (!res.ok) throw new Error("Failed to get placement");
    const data = await res.json();
    return data.placement;
  };

  daemonPlacementPanel.onSetPlacement = async (daemonId, placement) => {
    const res = await authFetch(`${apiUrl}/api/daemons/${daemonId}/placement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(placement),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed" }));
      throw new Error(err.error || "Placement failed");
    }
    const data = await res.json();
    return data.placement;
  };

  daemonPlacementPanel.onUpdatePlacement = async (daemonId, placement) => {
    const res = await authFetch(`${apiUrl}/api/daemons/${daemonId}/placement`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(placement),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed" }));
      throw new Error(err.error || "Update failed");
    }
    const data = await res.json();
    return data.placement;
  };

  daemonPlacementPanel.onActivate = async (daemonId: string) => {
    const res = await authFetch(`${apiUrl}/api/daemons/${daemonId}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed" }));
      throw new Error(err.error || "Activation failed");
    }
  };

  daemonPlacementPanel.onDeactivate = async (daemonId: string) => {
    const res = await authFetch(`${apiUrl}/api/daemons/${daemonId}/deactivate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed" }));
      throw new Error(err.error || "Deactivation failed");
    }
  };

  // Fetch role from server if not received via WebSocket yet
  if (authManager && userRole === "user") {
    try {
      const meRes = await authFetch(`${apiUrl}/api/admin/me`);
      if (meRes.ok) {
        const me = await meRes.json();
        userRole = me.role;
        authManager.role = me.role;
        daemonPanel.setSuperAdmin(me.role === "super_admin");
      }
    } catch { /* role will come from world_snapshot */ }
  }

  // Admin badge + sign out UI
  if (userRole === "super_admin") {
    const badge = document.createElement("div");
    badge.textContent = "ADMIN";
    badge.style.cssText = `
      position: fixed; top: 12px; right: 12px;
      background: rgba(255, 68, 68, 0.2);
      border: 1px solid rgba(255, 68, 68, 0.4);
      color: #ff4444; font-size: 11px; font-weight: bold;
      padding: 4px 10px; border-radius: 4px;
      font-family: system-ui, sans-serif;
      z-index: 50; cursor: pointer;
      pointer-events: auto;
    `;
    badge.addEventListener("click", () => adminPanel.toggle());
    document.body.appendChild(badge);

    // Add animation converter tool to admin panel
    (async () => {
      const token = (await authManager?.getToken()) ?? "";
      const converterTool = new AnimationConverterTool(apiUrl, token);
      converterTool.onSharedAnimsUploaded = () => {
        avatarManager.reloadSharedAnimClips();
      };
      adminPanel.appendSection(converterTool.element);

      // Default model uploader
      const defaultModelUploader = new DefaultModelUploader(apiUrl, async () => {
        return (await authManager?.getToken()) ?? "";
      });
      defaultModelUploader.onModelUploaded = () => {
        // Reload all avatars that are using the default model
        avatarManager.reloadDefaultModels();
      };
      adminPanel.appendSection(defaultModelUploader.element);

      // Activity log viewer
      const activityLogViewer = new ActivityLogViewer(apiUrl, authFetch);
      activityLogViewer.loadDaemons();
      adminPanel.appendSection(activityLogViewer.element);
    })();

    // Daemon creation button in admin panel
    const daemonCreateSection = document.createElement("div");
    daemonCreateSection.style.cssText = `
      padding: 12px 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    `;
    const daemonCreateBtn = document.createElement("button");
    daemonCreateBtn.textContent = "Create Daemon (Full Flow)";
    daemonCreateBtn.style.cssText = `
      background: rgba(255, 140, 0, 0.15);
      border: 1px solid rgba(255, 140, 0, 0.4);
      border-radius: 6px;
      color: #ff8c00;
      font-size: 13px;
      padding: 8px 16px;
      cursor: pointer;
      width: 100%;
      font-family: system-ui, sans-serif;
    `;
    daemonCreateBtn.addEventListener("click", () => {
      daemonCreationPanel.toggle();
    });
    daemonCreateSection.appendChild(daemonCreateBtn);
    adminPanel.appendSection(daemonCreateSection);

    // Daemon placement button in admin panel
    const daemonPlaceSection = document.createElement("div");
    daemonPlaceSection.style.cssText = `
      padding: 4px 20px 12px 20px;
    `;
    const daemonPlaceBtn = document.createElement("button");
    daemonPlaceBtn.textContent = "Place Daemon in World";
    daemonPlaceBtn.style.cssText = `
      background: rgba(0, 200, 120, 0.15);
      border: 1px solid rgba(0, 200, 120, 0.4);
      border-radius: 6px;
      color: #00c878;
      font-size: 13px;
      padding: 8px 16px;
      cursor: pointer;
      width: 100%;
      font-family: system-ui, sans-serif;
    `;
    daemonPlaceBtn.addEventListener("click", () => {
      daemonPlacementPanel.toggle();
    });
    daemonPlaceSection.appendChild(daemonPlaceBtn);
    adminPanel.appendSection(daemonPlaceSection);
  }

  // In dev mode (no auth), always show admin badge + tools
  if (!authManager) {
    userRole = "super_admin";
    daemonPanel.setSuperAdmin(true);
    const badge = document.createElement("div");
    badge.textContent = "ADMIN (DEV)";
    badge.style.cssText = `
      position: fixed; top: 12px; right: 12px;
      background: rgba(255, 140, 0, 0.2);
      border: 1px solid rgba(255, 140, 0, 0.4);
      color: #ffa500; font-size: 11px; font-weight: bold;
      padding: 4px 10px; border-radius: 4px;
      font-family: system-ui, sans-serif;
      z-index: 50; cursor: pointer;
      pointer-events: auto;
    `;
    badge.addEventListener("click", () => adminPanel.toggle());
    document.body.appendChild(badge);

    const converterTool = new AnimationConverterTool(apiUrl, "");
    converterTool.onSharedAnimsUploaded = () => {
      avatarManager.reloadSharedAnimClips();
    };
    adminPanel.appendSection(converterTool.element);

    // Default model uploader (dev mode — no auth needed)
    const defaultModelUploader = new DefaultModelUploader(apiUrl, async () => "");
    defaultModelUploader.onModelUploaded = () => {
      avatarManager.reloadDefaultModels();
    };
    adminPanel.appendSection(defaultModelUploader.element);

    // Activity log viewer (dev mode)
    const activityLogViewer = new ActivityLogViewer(apiUrl, authFetch);
    activityLogViewer.loadDaemons();
    adminPanel.appendSection(activityLogViewer.element);

    // Daemon creation button in admin panel (dev mode)
    const daemonCreateSectionDev = document.createElement("div");
    daemonCreateSectionDev.style.cssText = `
      padding: 12px 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    `;
    const daemonCreateBtnDev = document.createElement("button");
    daemonCreateBtnDev.textContent = "Create Daemon (Full Flow)";
    daemonCreateBtnDev.style.cssText = `
      background: rgba(255, 140, 0, 0.15);
      border: 1px solid rgba(255, 140, 0, 0.4);
      border-radius: 6px;
      color: #ff8c00;
      font-size: 13px;
      padding: 8px 16px;
      cursor: pointer;
      width: 100%;
      font-family: system-ui, sans-serif;
    `;
    daemonCreateBtnDev.addEventListener("click", () => {
      daemonCreationPanel.toggle();
    });
    daemonCreateSectionDev.appendChild(daemonCreateBtnDev);
    adminPanel.appendSection(daemonCreateSectionDev);

    // Daemon placement button in admin panel (dev mode)
    const daemonPlaceSectionDev = document.createElement("div");
    daemonPlaceSectionDev.style.cssText = `
      padding: 4px 20px 12px 20px;
    `;
    const daemonPlaceBtnDev = document.createElement("button");
    daemonPlaceBtnDev.textContent = "Place Daemon in World";
    daemonPlaceBtnDev.style.cssText = `
      background: rgba(0, 200, 120, 0.15);
      border: 1px solid rgba(0, 200, 120, 0.4);
      border-radius: 6px;
      color: #00c878;
      font-size: 13px;
      padding: 8px 16px;
      cursor: pointer;
      width: 100%;
      font-family: system-ui, sans-serif;
    `;
    daemonPlaceBtnDev.addEventListener("click", () => {
      daemonPlacementPanel.toggle();
    });
    daemonPlaceSectionDev.appendChild(daemonPlaceBtnDev);
    adminPanel.appendSection(daemonPlaceSectionDev);
  }

  if (authManager) {
    const userMenu = document.createElement("div");
    userMenu.style.cssText = `
      position: fixed; top: 12px; left: 12px;
      color: rgba(255, 255, 255, 0.6);
      font-size: 12px; font-family: system-ui, sans-serif;
      z-index: 50; display: flex; gap: 8px; align-items: center;
      pointer-events: auto;
    `;
    const nameEl = document.createElement("span");
    nameEl.textContent = authManager.displayName;
    userMenu.appendChild(nameEl);

    const signOutBtn = document.createElement("button");
    signOutBtn.textContent = "Sign Out";
    signOutBtn.style.cssText = `
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 3px; color: rgba(255, 255, 255, 0.6);
      font-size: 11px; padding: 3px 8px; cursor: pointer;
    `;
    signOutBtn.addEventListener("click", async () => {
      await authManager!.signOut();
      window.location.reload();
    });
    userMenu.appendChild(signOutBtn);
    document.body.appendChild(userMenu);
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

  // Camera orbit state: when left-click orbiting, the camera stays at the orbited
  // position until the character moves, at which point it smoothly returns behind.
  let cameraFreeOrbit = false; // true while camera is orbited away from behind-character

  // Game loop
  streetScene.onUpdate((rawDt) => {
    // Cap at 100ms to prevent teleportation when tab is backgrounded
    const dt = Math.min(rawDt, 0.1);

    // Input → movement (keyboard always active unless chat is open)
    if (!chatUI.isVisible()) {
      const mouse = inputManager.consumeMouse();

      if (inputManager.isLeftMouseDragging() && !inputManager.isRightMouseDragging()) {
        // Left-click drag → orbit camera freely (no character movement)
        cameraController.applyMouseDelta(mouse.x, mouse.y);
        cameraFreeOrbit = true;
      } else if (inputManager.isRightMouseDragging()) {
        // Right-click drag → rotate character + adjust camera pitch
        localRotation -= mouse.x * 0.003;
        cameraController.applyMouseDelta(0, mouse.y);
        cameraFreeOrbit = false; // right-click resets to behind character
      }

      // A/D keyboard turning (avatar-relative)
      if (inputManager.state.turnLeft) localRotation += TURN_SPEED * dt;
      if (inputManager.state.turnRight) localRotation -= TURN_SPEED * dt;

      // Compute target velocity from input (avatar-relative)
      const moveVec = inputManager.getMovementVector();
      // Both mouse buttons held = walk forward
      if (inputManager.isBothMouseDown()) {
        moveVec.z = Math.max(moveVec.z, 1);
      }
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
        // Movement direction from avatar facing
        const angle = localRotation;
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

      // Cancel emote on movement or turning
      if ((currentSpeed > 0.5 || inputManager.isTurning()) && avatarManager.isEmoting(avatarManager.localPlayerId || "")) {
        avatarManager.stopEmote(avatarManager.localPlayerId || "");
      }

      // Edge-triggered jump with wind-up (crouch before launch)
      if (inputManager.state.jump && !wasJumping && isGrounded && jumpWindupTimer <= 0) {
        jumpWindupTimer = JUMP_WINDUP;
        // Start jump animation immediately so crouch frames play
        avatarManager.setLocalMovementState({
          speed: currentSpeed, turning: 0, strafing: 0, jumping: true,
        });
      }
      wasJumping = inputManager.state.jump;

      // Wind-up countdown — launch when timer expires
      if (jumpWindupTimer > 0) {
        jumpWindupTimer -= dt;
        if (jumpWindupTimer <= 0) {
          jumpWindupTimer = 0;
          verticalVelocity = JUMP_VELOCITY;
          isGrounded = false;
        }
      }

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

      // Determine turning state: right-click mouse turning OR keyboard turning
      let turningState = 0;
      if (inputManager.state.turnLeft) turningState = -1;
      else if (inputManager.state.turnRight) turningState = 1;
      else if (inputManager.isRightMouseDragging() && mouse.x !== 0) {
        turningState = mouse.x > 0 ? 1 : -1;
      }

      avatarManager.setLocalMovementState({
        speed: currentSpeed,
        turning: turningState,
        strafing: inputManager.state.strafeLeft ? -1 : inputManager.state.strafeRight ? 1 : 0,
        jumping: !isGrounded || jumpWindupTimer > 0,
      });

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
      avatarManager.setLocalMovementState({ speed: 0, turning: 0, strafing: 0, jumping: false });
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
    // Camera yaw: when free-orbiting, camera stays put; when character moves, snap back behind
    if (cameraFreeOrbit) {
      // Character is moving or turning → smoothly return camera behind character
      const isMovingOrTurning = inputManager.isMoving() || inputManager.isTurning() || inputManager.isRightMouseDragging() || inputManager.isBothMouseDown();
      if (isMovingOrTurning) {
        cameraFreeOrbit = false;
      }
      // else: camera stays at current yaw (free orbit position)
    }
    if (!cameraFreeOrbit) {
      cameraController.setYaw(localRotation + Math.PI);
    }
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
    "Click to look around | W/S move | A/D turn | Q/E strafe | Shift run | Space jump | Enter chat | Tab target | B build | G gallery | V avatar | N daemons";
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
