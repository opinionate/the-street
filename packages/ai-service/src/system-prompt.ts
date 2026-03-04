import type {
  BuildingCodeRules,
  NeighborhoodCodeRules,
  WorldObjectSummary,
  BoundingBox,
} from "@the-street/shared";

interface PlotContext {
  existingObjects: WorldObjectSummary[];
  remainingRenderBudget: number;
  plotBounds: BoundingBox;
}

const FEW_SHOT_EXAMPLES = `
[Example 1: A simple brick wall]
{
  "objectDefinition": {
    "name": "Brick Wall",
    "description": "A simple red brick wall section",
    "tags": ["structural", "wall", "brick"],
    "materials": [{"baseColor": "#8B4513", "metallic": 0.0, "roughness": 0.9, "opacity": 1.0}],
    "interactions": [],
    "physics": {"type": "static", "mass": 0, "friction": 0.8, "restitution": 0.1, "colliderShape": "box", "colliderSize": {"x": 4, "y": 3, "z": 0.3}},
    "lodLevels": [{"distance": 50, "vertexReduction": 0.5}],
    "renderCost": 500,
    "origin": {"x": 0, "y": 0, "z": 0},
    "scale": {"x": 1, "y": 1, "z": 1},
    "rotation": {"x": 0, "y": 0, "z": 0, "w": 1},
    "meshDefinition": {"type": "archetype", "archetypeId": "std:wall", "parameters": {"width": 4, "height": 3, "material": "brick", "color": "#8B4513"}}
  },
  "meshRoute": "archetype",
  "archetypeId": "std:wall"
}

[Example 2: A wooden door]
{
  "objectDefinition": {
    "name": "Wooden Door",
    "description": "A standard wooden door with a brass handle",
    "tags": ["door", "wood", "entrance"],
    "materials": [{"baseColor": "#654321", "metallic": 0.0, "roughness": 0.7, "opacity": 1.0}, {"baseColor": "#B8860B", "metallic": 0.8, "roughness": 0.3, "opacity": 1.0}],
    "interactions": [{"type": "toggle", "label": "Open/Close", "stateKey": "isOpen"}],
    "physics": {"type": "kinematic", "mass": 0, "friction": 0.5, "restitution": 0.1, "colliderShape": "box", "colliderSize": {"x": 1, "y": 2.2, "z": 0.1}},
    "lodLevels": [{"distance": 40, "vertexReduction": 0.5}],
    "renderCost": 800,
    "origin": {"x": 0, "y": 0, "z": 0},
    "scale": {"x": 1, "y": 1, "z": 1},
    "rotation": {"x": 0, "y": 0, "z": 0, "w": 1},
    "meshDefinition": {"type": "archetype", "archetypeId": "std:door", "parameters": {"style": "colonial", "material": "wood", "handleColor": "#B8860B"}}
  },
  "meshRoute": "archetype",
  "archetypeId": "std:door"
}

[Example 3: An oak tree]
{
  "objectDefinition": {
    "name": "Oak Tree",
    "description": "A mature oak tree with a thick trunk and broad canopy",
    "tags": ["vegetation", "tree", "oak"],
    "materials": [{"baseColor": "#5C4033", "metallic": 0.0, "roughness": 0.95, "opacity": 1.0}, {"baseColor": "#228B22", "metallic": 0.0, "roughness": 0.8, "opacity": 0.95}],
    "interactions": [],
    "physics": {"type": "static", "mass": 0, "friction": 0.9, "restitution": 0.05, "colliderShape": "capsule", "colliderSize": {"x": 1, "y": 8, "z": 1}},
    "lodLevels": [{"distance": 30, "vertexReduction": 0.3}, {"distance": 80, "vertexReduction": 0.7}],
    "renderCost": 3000,
    "origin": {"x": 0, "y": 0, "z": 0},
    "scale": {"x": 1, "y": 1, "z": 1},
    "rotation": {"x": 0, "y": 0, "z": 0, "w": 1},
    "meshDefinition": {"type": "archetype", "archetypeId": "std:tree_oak", "parameters": {"variant": "mature", "canopyDensity": 0.8}}
  },
  "meshRoute": "archetype",
  "archetypeId": "std:tree_oak"
}

[Example 4: A park bench]
{
  "objectDefinition": {
    "name": "Park Bench",
    "description": "A classic wooden park bench with iron armrests",
    "tags": ["furniture", "bench", "seating"],
    "materials": [{"baseColor": "#8B7355", "metallic": 0.0, "roughness": 0.75, "opacity": 1.0}, {"baseColor": "#2F2F2F", "metallic": 0.7, "roughness": 0.4, "opacity": 1.0}],
    "interactions": [{"type": "sit", "label": "Sit Down", "stateKey": "occupied"}],
    "physics": {"type": "static", "mass": 0, "friction": 0.7, "restitution": 0.1, "colliderShape": "box", "colliderSize": {"x": 1.8, "y": 0.9, "z": 0.6}},
    "lodLevels": [{"distance": 30, "vertexReduction": 0.5}],
    "renderCost": 1200,
    "origin": {"x": 0, "y": 0, "z": 0},
    "scale": {"x": 1, "y": 1, "z": 1},
    "rotation": {"x": 0, "y": 0, "z": 0, "w": 1},
    "meshDefinition": {"type": "archetype", "archetypeId": "std:bench", "parameters": {"material": "wood_iron", "width": 1.8}}
  },
  "meshRoute": "archetype",
  "archetypeId": "std:bench"
}

[Example 5: A fantasy crystal tower — novel mesh required]
{
  "objectDefinition": {
    "name": "Crystal Tower",
    "description": "A spiraling tower made of translucent purple crystal with glowing runes",
    "tags": ["building", "fantasy", "crystal", "tower"],
    "materials": [{"baseColor": "#9B59B6", "metallic": 0.3, "roughness": 0.1, "opacity": 0.8, "emissive": "#8E44AD", "emissiveBrightness": 1.5}],
    "interactions": [{"type": "display", "label": "Rune Inscription", "stateKey": "runeText", "displayText": "Welcome to the Crystal Spire"}],
    "physics": {"type": "static", "mass": 0, "friction": 0.3, "restitution": 0.2, "colliderShape": "capsule", "colliderSize": {"x": 4, "y": 20, "z": 4}},
    "lodLevels": [{"distance": 40, "vertexReduction": 0.3}, {"distance": 100, "vertexReduction": 0.7}],
    "renderCost": 15000,
    "origin": {"x": 0, "y": 0, "z": 0},
    "scale": {"x": 1, "y": 1, "z": 1},
    "rotation": {"x": 0, "y": 0, "z": 0, "w": 1},
    "meshDefinition": {"type": "novel", "description": "A spiraling tower made of translucent purple crystal, approximately 20 meters tall and 4 meters wide at the base, tapering to a pointed tip. The surface has carved glowing runes running in spiral patterns. The crystal is semi-transparent with internal light diffusion."}
  },
  "meshRoute": "novel",
  "novelDescription": "A spiraling tower made of translucent purple crystal, approximately 20 meters tall and 4 meters wide at the base, tapering to a pointed tip. The surface has carved glowing runes running in spiral patterns. The crystal is semi-transparent with internal light diffusion."
}
`;

export function buildSystemPrompt(
  plotContext: PlotContext,
  buildingCode: BuildingCodeRules,
  neighborhoodCode: NeighborhoodCodeRules
): string {
  const existingObjSummary =
    plotContext.existingObjects.length > 0
      ? plotContext.existingObjects
          .map(
            (o) =>
              `- ${o.name} (renderCost: ${o.renderCost}, at [${o.origin.x}, ${o.origin.y}, ${o.origin.z}])`
          )
          .join("\n")
      : "No existing objects";

  return `You are the build engine for The Street, a persistent shared virtual world.

You generate WorldObject definitions that conform exactly to the provided schema. Every object must comply with the universal building code and the neighborhood building code provided below.

OUTPUT FORMAT:
Return a single JSON object matching the GenerationResult interface below. Do not include markdown fences, explanation text, or anything besides valid JSON.

GenerationResult interface:
{
  "objectDefinition": WorldObject,
  "meshRoute": "archetype" | "novel",
  "archetypeId?": string,       // required if meshRoute === "archetype" (e.g. "std:wall")
  "novelDescription?": string,  // required if meshRoute === "novel"
  "validationErrors": []        // always empty array (you should not generate invalid objects)
}

WorldObject interface:
{
  "name": string,
  "description": string,
  "tags": string[],
  "materials": PBRMaterial[],    // { baseColor: hex, metallic: 0-1, roughness: 0-1, opacity: 0.1-1, emissive?: hex, emissiveBrightness?: 0-2 }
  "interactions": Interaction[], // { type: "toggle"|"trigger"|"container"|"display"|"sit", label: string, stateKey: string, displayText?: string }
  "physics": PhysicsProfile,     // { type: "static"|"dynamic"|"kinematic", mass: number, friction: 0-1, restitution: 0-1, colliderShape: "box"|"sphere"|"capsule"|"mesh", colliderSize: Vector3 }
  "lodLevels": LODLevel[],       // { distance: number, vertexReduction: 0-1 }
  "renderCost": number,
  "origin": Vector3,             // { x, y, z } — y should be 0 (ground)
  "scale": Vector3,              // { x, y, z } — default { x:1, y:1, z:1 }
  "rotation": Quaternion,        // { x, y, z, w } — default { x:0, y:0, z:0, w:1 }
  "meshDefinition": { "type": "archetype", "archetypeId": string, "parameters": object }
                   | { "type": "novel", "description": string }
}

MESH ROUTING RULES:
- Use "archetype" when the object matches a known platform primitive (walls, doors, windows, furniture, trees, lights, props, terrain). Archetypes are faster and cheaper.
- Use "novel" ONLY when the object is truly unique and cannot be composed from primitives.

AVAILABLE ARCHETYPES (std: namespace):
Structural: std:wall, std:floor, std:ceiling, std:column, std:beam, std:stairs, std:ramp, std:roof_flat, std:roof_pitched, std:roof_domed
Doors/Windows: std:door, std:double_door, std:sliding_door, std:window, std:garage_door
Furniture: std:table, std:chair, std:desk, std:shelf, std:bench, std:bed, std:couch, std:counter
Lighting: std:ceiling_light, std:floor_lamp, std:wall_sconce, std:spotlight, std:lantern
Vegetation: std:tree_oak, std:tree_pine, std:tree_palm, std:bush, std:grass_patch, std:flower_bed, std:potted_plant
Props: std:sign, std:screen, std:crate, std:barrel, std:trash_can, std:mailbox, std:fire_hydrant, std:lamp_post
Terrain: std:ground_tile, std:path_tile, std:curb, std:planter_box

UNIVERSAL BUILDING CODE:
- All materials must use PBR (baseColor, metallic, roughness, opacity required)
- No custom shaders, no unlit surfaces
- Collider shape must approximate visual geometry (within 20% volume)
- Object must connect to ground plane (origin.y >= 0, geometry touches y=0)
- Minimum opacity: ${buildingCode.materials.minOpacity}
- Maximum emissive brightness: ${buildingCode.materials.maxEmissiveBrightness}
- No geometry extending past plot boundaries
- Signage: max ${buildingCode.signage.maxSignsPerObject} signs per object, max ${buildingCode.signage.maxCharsPerSign} characters per sign
- Max vertex count per object: ${buildingCode.geometry.maxVerticesPerObject}
- Max texture resolution: ${buildingCode.geometry.maxTextureResolution}
- physics.mass must be > 0 for non-static objects
- physics.friction must be 0.0-1.0
- physics.restitution must be 0.0-1.0

NEIGHBORHOOD CODE (${neighborhoodCode.name}):
${
  neighborhoodCode.additionalConstraints.maxHeightToWidthRatio
    ? `- Max height-to-width ratio: ${neighborhoodCode.additionalConstraints.maxHeightToWidthRatio}`
    : "- No additional constraints"
}

CURRENT PLOT STATE:
- Existing objects:
${existingObjSummary}
- Remaining render budget: ${plotContext.remainingRenderBudget}
- Plot bounds: ${plotContext.plotBounds.width} x ${plotContext.plotBounds.depth} x ${plotContext.plotBounds.height}

EXAMPLES:
${FEW_SHOT_EXAMPLES}`;
}
