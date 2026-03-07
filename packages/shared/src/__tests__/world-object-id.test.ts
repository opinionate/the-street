import { describe, it, expect } from "vitest";
import type { WorldObject } from "../types.js";

describe("WorldObject", () => {
  it("accepts an optional id field for DB-persisted objects", () => {
    const obj: WorldObject = {
      id: "ab1220ef-82d4-4feb-85d0-6d96aac6860d",
      name: "Test Object",
      description: "A test",
      tags: [],
      materials: [],
      interactions: [],
      physics: { type: "static", colliderSize: { x: 1, y: 1, z: 1 } },
      lodLevels: [],
      renderCost: 1,
      origin: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      meshDefinition: { type: "archetype", archetypeId: "cube", parameters: {} },
    };

    expect(obj.id).toBe("ab1220ef-82d4-4feb-85d0-6d96aac6860d");
  });

  it("works without id field for new objects", () => {
    const obj: WorldObject = {
      name: "New Object",
      description: "Not yet saved",
      tags: [],
      materials: [],
      interactions: [],
      physics: { type: "static", colliderSize: { x: 1, y: 1, z: 1 } },
      lodLevels: [],
      renderCost: 1,
      origin: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      meshDefinition: { type: "archetype", archetypeId: "cube", parameters: {} },
    };

    expect(obj.id).toBeUndefined();
  });
});
