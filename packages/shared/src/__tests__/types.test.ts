import { describe, it, expect } from "vitest";
import type {
  Vector3,
  SavedPosition,
  AvatarDefinition,
  AvatarAppearance,
  DaemonDefinition,
  DaemonState,
  DaemonMood,
  DaemonAction,
  WorldObject,
  InteractionType,
  PhysicsType,
  PlotSnapshot,
  PlayerState,
} from "../types.js";

describe("Type shape validation", () => {
  describe("Vector3", () => {
    it("has x, y, z number fields", () => {
      const v: Vector3 = { x: 1, y: 2, z: 3 };
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
      expect(v.z).toBe(3);
    });
  });

  describe("SavedPosition", () => {
    it("extends Vector3 with rotation", () => {
      const sp: SavedPosition = { x: 1, y: 2, z: 3, rotation: 1.5 };
      expect(sp.rotation).toBe(1.5);
      expect(sp.x).toBe(1);
    });
  });

  describe("AvatarDefinition", () => {
    it("requires avatarIndex", () => {
      const def: AvatarDefinition = { avatarIndex: 3 };
      expect(def.avatarIndex).toBe(3);
    });

    it("supports optional fields", () => {
      const def: AvatarDefinition = {
        avatarIndex: 0,
        customAppearance: {
          bodyType: "default",
          skinTone: "#f5c6a5",
          hairStyle: "short",
          hairColor: "#333333",
          outfit: "t-shirt and jeans",
          outfitColors: ["#0066cc", "#333333"],
          accessories: [],
          accentColor: "#00ff00",
        },
      };
      expect(def.customAppearance?.bodyType).toBe("default");
    });
  });

  describe("DaemonDefinition", () => {
    it("requires all mandatory fields", () => {
      const daemon: DaemonDefinition = {
        name: "Test Daemon",
        description: "A test daemon",
        appearance: {
          bodyType: "slim",
          skinTone: "#cc9966",
          hairStyle: "long",
          hairColor: "#000000",
          outfit: "robe",
          outfitColors: ["#9900cc"],
          accessories: ["staff"],
          accentColor: "#ff00ff",
        },
        behavior: {
          type: "greeter",
          interactionRadius: 5,
        },
        personality: {
          traits: ["friendly"],
          backstory: "A friendly guide",
          speechStyle: "casual",
          interests: ["helping"],
          quirks: [],
        },
        plotUuid: "plot-1",
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
      };
      expect(daemon.name).toBe("Test Daemon");
      expect(daemon.behavior.type).toBe("greeter");
    });
  });

  describe("DaemonMood values", () => {
    it("covers all expected moods", () => {
      const moods: DaemonMood[] = ["happy", "neutral", "bored", "excited", "annoyed", "curious"];
      expect(moods).toHaveLength(6);
    });
  });

  describe("DaemonAction values", () => {
    it("covers all expected actions", () => {
      const actions: DaemonAction[] = ["idle", "walking", "talking", "waving", "thinking", "laughing", "emoting"];
      expect(actions).toHaveLength(7);
    });
  });

  describe("InteractionType values", () => {
    it("covers all expected types", () => {
      const types: InteractionType[] = ["toggle", "trigger", "container", "display", "sit"];
      expect(types).toHaveLength(5);
    });
  });

  describe("PhysicsType values", () => {
    it("covers all expected types", () => {
      const types: PhysicsType[] = ["static", "dynamic", "kinematic"];
      expect(types).toHaveLength(3);
    });
  });

  describe("PlayerState", () => {
    it("has all required fields", () => {
      const player: PlayerState = {
        userId: "user-1",
        displayName: "Alice",
        avatarDefinition: { avatarIndex: 0 },
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
        velocity: { x: 0, y: 0, z: 0 },
      };
      expect(player.userId).toBe("user-1");
      expect(player.displayName).toBe("Alice");
    });
  });
});
