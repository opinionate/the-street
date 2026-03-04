import type { PlotPlacement, Vector3 } from "./types.js";

export interface WorldConfig {
  ringRadius: number;
  plotWidth: number;
  plotDepth: number;
  plotHeight: number;
  streetWidth: number;
  plotCount: number;
  plotRenderBudget: number;
}

export const V1_CONFIG: WorldConfig = {
  ringRadius: 200,
  plotWidth: 20,
  plotDepth: 30,
  plotHeight: 40,
  streetWidth: 15,
  plotCount: 56,
  plotRenderBudget: 500_000,
};

export function getPlotPosition(
  index: number,
  config: WorldConfig = V1_CONFIG
): PlotPlacement {
  const angleStep = (2 * Math.PI) / config.plotCount;
  const angle = index * angleStep;
  const centerX = Math.cos(angle) * config.ringRadius;
  const centerZ = Math.sin(angle) * config.ringRadius;
  const facingAngle = -(angle + Math.PI / 2); // one edge aligned with street tangent, depth faces inward

  return {
    position: { x: centerX, y: 0, z: centerZ },
    rotation: facingAngle,
    bounds: {
      width: config.plotWidth,
      depth: config.plotDepth,
      height: config.plotHeight,
    },
  };
}

/** Get all plot placements for a ring */
export function getAllPlotPositions(
  config: WorldConfig = V1_CONFIG
): PlotPlacement[] {
  return Array.from({ length: config.plotCount }, (_, i) =>
    getPlotPosition(i, config)
  );
}

/** Get a position on the street (walkable ring) at a given angle */
export function getStreetPosition(
  angle: number,
  config: WorldConfig = V1_CONFIG
): Vector3 {
  const streetRadius = config.ringRadius - config.plotDepth / 2 - config.streetWidth / 2;
  return {
    x: Math.cos(angle) * streetRadius,
    y: 0,
    z: Math.sin(angle) * streetRadius,
  };
}

/** Default spawn point — center of the street at position 0 */
export function getDefaultSpawnPoint(
  config: WorldConfig = V1_CONFIG
): Vector3 {
  return getStreetPosition(0, config);
}

/** Chat radius in world units */
export const CHAT_RADIUS = 30;

/** Chat message display duration in seconds */
export const CHAT_DISPLAY_DURATION = 8;

/** Max concurrent players in the room */
export const MAX_CLIENTS = 100;

/** Server tick rate in Hz */
export const TICK_RATE = 20;

/** Position save interval in seconds */
export const POSITION_SAVE_INTERVAL = 30;
