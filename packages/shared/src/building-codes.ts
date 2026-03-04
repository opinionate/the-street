import type { BuildingCodeRules, NeighborhoodCodeRules } from "./types.js";

export const UNIVERSAL_CODE: BuildingCodeRules = {
  materials: {
    requirePBR: true,
    minOpacity: 0.1,
    maxEmissiveBrightness: 2.0,
    noCustomShaders: true,
    noUnlitSurfaces: true,
  },
  geometry: {
    requireGroundConnection: true,
    requireColliderMatch: true,
    colliderVolumeTolerance: 0.2, // 20%
    maxVerticesPerObject: 50_000,
    maxTextureResolution: 2048,
  },
  placement: {
    mustFitWithinPlotBounds: true,
    noEffectsPastBoundary: true,
  },
  signage: {
    maxSignsPerObject: 2,
    maxCharsPerSign: 128,
  },
  structural: {
    requireCoherence: true,
  },
};

export const ORIGIN_NEIGHBORHOOD_CODE: NeighborhoodCodeRules = {
  name: "origin",
  extendsUniversal: true,
  additionalConstraints: {
    maxHeightToWidthRatio: 4.0,
  },
};
