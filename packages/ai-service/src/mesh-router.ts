import type { GenerationResult } from "@the-street/shared";

export interface ArchetypeRoute {
  type: "archetype";
  archetypeId: string;
  parameters: Record<string, unknown>;
}

export interface NovelRoute {
  type: "novel";
  description: string;
}

export type MeshRoute = ArchetypeRoute | NovelRoute;

export function routeMesh(result: GenerationResult): MeshRoute {
  if (result.meshRoute === "archetype" && result.archetypeId) {
    const params =
      result.objectDefinition.meshDefinition.type === "archetype"
        ? result.objectDefinition.meshDefinition.parameters
        : {};
    return {
      type: "archetype",
      archetypeId: result.archetypeId,
      parameters: params,
    };
  }

  const description =
    result.novelDescription ||
    (result.objectDefinition.meshDefinition.type === "novel"
      ? result.objectDefinition.meshDefinition.description
      : result.objectDefinition.description);

  return {
    type: "novel",
    description,
  };
}
