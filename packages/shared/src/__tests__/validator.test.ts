import { describe, it, expect } from "vitest";
import { validateWorldObject } from "../validator.js";
import { UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE } from "../building-codes.js";
import type { WorldObject, BoundingBox } from "../types.js";

function makeValidObject(overrides: Partial<WorldObject> = {}): WorldObject {
  return {
    name: "Test Object",
    description: "A test object",
    tags: ["test"],
    materials: [
      {
        baseColor: "#ff0000",
        metallic: 0.5,
        roughness: 0.5,
        opacity: 1.0,
      },
    ],
    interactions: [],
    physics: {
      type: "static",
      mass: 0,
      friction: 0.5,
      restitution: 0.3,
      colliderShape: "box",
      colliderSize: { x: 1, y: 1, z: 1 },
    },
    lodLevels: [],
    renderCost: 10,
    origin: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    meshDefinition: { type: "archetype", archetypeId: "std:cube", parameters: {} },
    ...overrides,
  };
}

const defaultBounds: BoundingBox = { width: 10, depth: 10, height: 20 };
const defaultBudget = 100;

describe("validateWorldObject", () => {
  describe("valid objects", () => {
    it("passes validation for a well-formed object", () => {
      const obj = makeValidObject();
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.valid).toBe(true);
      expect(result.errors.filter(e => e.severity === "error")).toHaveLength(0);
    });
  });

  describe("schema conformance", () => {
    it("rejects object with no name", () => {
      const obj = makeValidObject({ name: "" });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === "MISSING_NAME")).toBe(true);
    });

    it("rejects object with no materials", () => {
      const obj = makeValidObject({ materials: [] });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === "NO_MATERIALS")).toBe(true);
    });

    it("rejects object with no physics", () => {
      const obj = makeValidObject({ physics: undefined as any });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === "NO_PHYSICS")).toBe(true);
    });

    it("rejects object with no mesh definition", () => {
      const obj = makeValidObject({ meshDefinition: undefined as any });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === "NO_MESH")).toBe(true);
    });
  });

  describe("PBR compliance", () => {
    it("rejects material without baseColor", () => {
      const obj = makeValidObject({
        materials: [{ baseColor: "", metallic: 0.5, roughness: 0.5, opacity: 1.0 }],
      });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "PBR_MISSING_BASE_COLOR")).toBe(true);
    });

    it("rejects opacity below minimum", () => {
      const obj = makeValidObject({
        materials: [{ baseColor: "#ff0000", metallic: 0.5, roughness: 0.5, opacity: 0.05 }],
      });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "OPACITY_TOO_LOW")).toBe(true);
    });

    it("rejects emissive brightness exceeding max", () => {
      const obj = makeValidObject({
        materials: [{
          baseColor: "#ff0000", metallic: 0.5, roughness: 0.5, opacity: 1.0,
          emissive: "#ffffff", emissiveBrightness: 5.0,
        }],
      });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "EMISSIVE_TOO_BRIGHT")).toBe(true);
    });

    it("rejects missing metallic value", () => {
      const obj = makeValidObject({
        materials: [{ baseColor: "#ff0000", metallic: undefined as any, roughness: 0.5, opacity: 1.0 }],
      });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "PBR_MISSING_METALLIC")).toBe(true);
    });

    it("rejects missing roughness value", () => {
      const obj = makeValidObject({
        materials: [{ baseColor: "#ff0000", metallic: 0.5, roughness: undefined as any, opacity: 1.0 }],
      });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "PBR_MISSING_ROUGHNESS")).toBe(true);
    });
  });

  describe("ground plane connection", () => {
    it("rejects floating objects (origin.y > 0.01)", () => {
      const obj = makeValidObject({ origin: { x: 0, y: 1.0, z: 0 } });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "NOT_GROUNDED")).toBe(true);
    });

    it("accepts object at ground level", () => {
      const obj = makeValidObject({ origin: { x: 0, y: 0, z: 0 } });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "NOT_GROUNDED")).toBe(false);
    });

    it("accepts object slightly below ground", () => {
      const obj = makeValidObject({ origin: { x: 0, y: -0.5, z: 0 } });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "NOT_GROUNDED")).toBe(false);
    });
  });

  describe("render budget", () => {
    it("rejects object exceeding render budget", () => {
      const obj = makeValidObject({ renderCost: 200 });
      const result = validateWorldObject(
        obj, defaultBounds, 50, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === "EXCEEDS_RENDER_BUDGET")).toBe(true);
    });

    it("accepts object within budget", () => {
      const obj = makeValidObject({ renderCost: 10 });
      const result = validateWorldObject(
        obj, defaultBounds, 100, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "EXCEEDS_RENDER_BUDGET")).toBe(false);
    });
  });

  describe("physics sanity", () => {
    it("rejects dynamic object with zero mass", () => {
      const obj = makeValidObject({
        physics: {
          type: "dynamic", mass: 0, friction: 0.5, restitution: 0.3,
          colliderShape: "box", colliderSize: { x: 1, y: 1, z: 1 },
        },
      });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "INVALID_MASS")).toBe(true);
    });

    it("accepts static object with zero mass", () => {
      const obj = makeValidObject({
        physics: {
          type: "static", mass: 0, friction: 0.5, restitution: 0.3,
          colliderShape: "box", colliderSize: { x: 1, y: 1, z: 1 },
        },
      });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "INVALID_MASS")).toBe(false);
    });

    it("rejects friction out of range", () => {
      const obj = makeValidObject({
        physics: {
          type: "static", mass: 0, friction: 1.5, restitution: 0.3,
          colliderShape: "box", colliderSize: { x: 1, y: 1, z: 1 },
        },
      });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "FRICTION_OUT_OF_RANGE")).toBe(true);
    });

    it("rejects restitution out of range", () => {
      const obj = makeValidObject({
        physics: {
          type: "static", mass: 0, friction: 0.5, restitution: -0.1,
          colliderShape: "box", colliderSize: { x: 1, y: 1, z: 1 },
        },
      });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "RESTITUTION_OUT_OF_RANGE")).toBe(true);
    });
  });

  describe("collider match", () => {
    it("warns when collider volume differs significantly from scale", () => {
      const obj = makeValidObject({
        scale: { x: 1, y: 1, z: 1 },
        physics: {
          type: "static", mass: 0, friction: 0.5, restitution: 0.3,
          colliderShape: "box", colliderSize: { x: 5, y: 5, z: 5 },
        },
      });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "COLLIDER_MISMATCH")).toBe(true);
    });

    it("does not warn when collider matches scale", () => {
      const obj = makeValidObject({
        scale: { x: 1, y: 1, z: 1 },
        physics: {
          type: "static", mass: 0, friction: 0.5, restitution: 0.3,
          colliderShape: "box", colliderSize: { x: 1, y: 1, z: 1 },
        },
      });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "COLLIDER_MISMATCH")).toBe(false);
    });

    it("handles zero-volume scale safely (no division by zero)", () => {
      const obj = makeValidObject({
        scale: { x: 0, y: 0, z: 0 },
        physics: {
          type: "static", mass: 0, friction: 0.5, restitution: 0.3,
          colliderShape: "box", colliderSize: { x: 1, y: 1, z: 1 },
        },
      });
      // Should not throw
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result).toBeDefined();
    });
  });

  describe("signage limits", () => {
    it("rejects too many display interactions", () => {
      const obj = makeValidObject({
        interactions: [
          { type: "display", label: "Sign 1", stateKey: "s1", displayText: "Hello" },
          { type: "display", label: "Sign 2", stateKey: "s2", displayText: "World" },
          { type: "display", label: "Sign 3", stateKey: "s3", displayText: "Extra" },
        ],
      });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "TOO_MANY_SIGNS")).toBe(true);
    });

    it("rejects sign text exceeding max chars", () => {
      const longText = "x".repeat(200);
      const obj = makeValidObject({
        interactions: [
          { type: "display", label: "Sign", stateKey: "s1", displayText: longText },
        ],
      });
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "SIGN_TEXT_TOO_LONG")).toBe(true);
    });
  });

  describe("neighborhood constraints", () => {
    it("rejects objects exceeding height-to-width ratio", () => {
      const obj = makeValidObject({
        scale: { x: 0.1, y: 1, z: 1 },
      });
      // height/width = (1 * 20) / (0.1 * 10) = 20, exceeds max of 4.0
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "HEIGHT_RATIO_EXCEEDED")).toBe(true);
    });
  });

  describe("boundary containment", () => {
    it("warns when object width exceeds plot bounds", () => {
      const obj = makeValidObject({ scale: { x: 2, y: 1, z: 1 } });
      // objWidth = 2 * 10 = 20, plotBounds.width * 1.5 = 15
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "EXCEEDS_PLOT_WIDTH")).toBe(true);
    });

    it("rejects when object height exceeds plot max height", () => {
      const obj = makeValidObject({ scale: { x: 1, y: 1.5, z: 1 } });
      // objHeight = 1.5 * 20 = 30, exceeds plotBounds.height = 20
      const result = validateWorldObject(
        obj, defaultBounds, defaultBudget, UNIVERSAL_CODE, ORIGIN_NEIGHBORHOOD_CODE
      );
      expect(result.errors.some(e => e.code === "EXCEEDS_PLOT_HEIGHT")).toBe(true);
    });
  });
});
