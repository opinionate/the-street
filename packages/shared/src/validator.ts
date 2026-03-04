import type {
  WorldObject,
  BoundingBox,
  BuildingCodeRules,
  NeighborhoodCodeRules,
  ValidationResult,
  ValidationError,
} from "./types.js";

export function validateWorldObject(
  obj: WorldObject,
  plotBounds: BoundingBox,
  remainingBudget: number,
  universalCode: BuildingCodeRules,
  neighborhoodCode: NeighborhoodCodeRules
): ValidationResult {
  const errors: ValidationError[] = [];

  // 1. Schema conformance — check required fields
  if (!obj.name) {
    errors.push({
      code: "MISSING_NAME",
      field: "name",
      message: "Object must have a name",
      severity: "error",
    });
  }

  if (!obj.materials || obj.materials.length === 0) {
    errors.push({
      code: "NO_MATERIALS",
      field: "materials",
      message: "Object must have at least one material",
      severity: "error",
    });
  }

  if (!obj.physics) {
    errors.push({
      code: "NO_PHYSICS",
      field: "physics",
      message: "Object must have a physics profile",
      severity: "error",
    });
  }

  if (!obj.meshDefinition) {
    errors.push({
      code: "NO_MESH",
      field: "meshDefinition",
      message: "Object must have a mesh definition",
      severity: "error",
    });
  }

  // 2. PBR compliance
  if (universalCode.materials.requirePBR && obj.materials) {
    for (let i = 0; i < obj.materials.length; i++) {
      const mat = obj.materials[i];
      if (!mat.baseColor) {
        errors.push({
          code: "PBR_MISSING_BASE_COLOR",
          field: `materials[${i}].baseColor`,
          message: "Material must have a baseColor",
          severity: "error",
        });
      }
      if (mat.metallic === undefined || mat.metallic === null) {
        errors.push({
          code: "PBR_MISSING_METALLIC",
          field: `materials[${i}].metallic`,
          message: "Material must specify metallic value",
          severity: "error",
        });
      }
      if (mat.roughness === undefined || mat.roughness === null) {
        errors.push({
          code: "PBR_MISSING_ROUGHNESS",
          field: `materials[${i}].roughness`,
          message: "Material must specify roughness value",
          severity: "error",
        });
      }

      // Opacity minimum
      if (mat.opacity < universalCode.materials.minOpacity) {
        errors.push({
          code: "OPACITY_TOO_LOW",
          field: `materials[${i}].opacity`,
          message: `Opacity ${mat.opacity} is below minimum ${universalCode.materials.minOpacity}`,
          severity: "error",
        });
      }

      // Emissive limits
      if (
        mat.emissiveBrightness !== undefined &&
        mat.emissiveBrightness > universalCode.materials.maxEmissiveBrightness
      ) {
        errors.push({
          code: "EMISSIVE_TOO_BRIGHT",
          field: `materials[${i}].emissiveBrightness`,
          message: `Emissive brightness ${mat.emissiveBrightness} exceeds max ${universalCode.materials.maxEmissiveBrightness}`,
          severity: "error",
        });
      }
    }
  }

  // 3. Ground plane connection
  if (universalCode.geometry.requireGroundConnection) {
    const minY = obj.origin.y;
    if (minY > 0.01) {
      errors.push({
        code: "NOT_GROUNDED",
        field: "origin.y",
        message: `Object origin y=${minY} must be at or below ground plane (tolerance 0.01)`,
        severity: "error",
      });
    }
  }

  // 4. Boundary containment
  if (universalCode.placement.mustFitWithinPlotBounds) {
    const objWidth = (obj.scale?.x ?? 1) * plotBounds.width;
    const objDepth = (obj.scale?.z ?? 1) * plotBounds.depth;
    const objHeight = (obj.scale?.y ?? 1) * plotBounds.height;

    // Simple bounding check — object dimensions shouldn't exceed plot
    if (objWidth > plotBounds.width * 1.5) {
      errors.push({
        code: "EXCEEDS_PLOT_WIDTH",
        field: "scale.x",
        message: "Object width exceeds plot bounds",
        severity: "warning",
      });
    }
    if (objDepth > plotBounds.depth * 1.5) {
      errors.push({
        code: "EXCEEDS_PLOT_DEPTH",
        field: "scale.z",
        message: "Object depth exceeds plot bounds",
        severity: "warning",
      });
    }
    if (objHeight > plotBounds.height) {
      errors.push({
        code: "EXCEEDS_PLOT_HEIGHT",
        field: "scale.y",
        message: `Object height exceeds plot max height ${plotBounds.height}`,
        severity: "error",
      });
    }
  }

  // 5. Collider match
  if (universalCode.geometry.requireColliderMatch && obj.physics) {
    const colliderVol =
      obj.physics.colliderSize.x *
      obj.physics.colliderSize.y *
      obj.physics.colliderSize.z;
    const scaleVol = obj.scale.x * obj.scale.y * obj.scale.z;
    const tolerance = universalCode.geometry.colliderVolumeTolerance;

    if (scaleVol > 0 && Math.abs(colliderVol / scaleVol - 1) > tolerance) {
      errors.push({
        code: "COLLIDER_MISMATCH",
        field: "physics.colliderSize",
        message: `Collider volume differs from visual geometry by more than ${tolerance * 100}%`,
        severity: "warning",
      });
    }
  }

  // 8. Render budget
  if (obj.renderCost > remainingBudget) {
    errors.push({
      code: "EXCEEDS_RENDER_BUDGET",
      field: "renderCost",
      message: `Render cost ${obj.renderCost} exceeds remaining budget ${remainingBudget}`,
      severity: "error",
    });
  }

  // 11. Physics sanity
  if (obj.physics) {
    if (obj.physics.type !== "static" && obj.physics.mass <= 0) {
      errors.push({
        code: "INVALID_MASS",
        field: "physics.mass",
        message: "Non-static objects must have mass > 0",
        severity: "error",
      });
    }
    if (obj.physics.friction < 0 || obj.physics.friction > 1) {
      errors.push({
        code: "FRICTION_OUT_OF_RANGE",
        field: "physics.friction",
        message: "Friction must be between 0 and 1",
        severity: "error",
      });
    }
    if (obj.physics.restitution < 0 || obj.physics.restitution > 1) {
      errors.push({
        code: "RESTITUTION_OUT_OF_RANGE",
        field: "physics.restitution",
        message: "Restitution must be between 0 and 1",
        severity: "error",
      });
    }
  }

  // 12. Signage limits
  if (obj.interactions) {
    const displayInteractions = obj.interactions.filter(
      (i) => i.type === "display"
    );
    if (displayInteractions.length > universalCode.signage.maxSignsPerObject) {
      errors.push({
        code: "TOO_MANY_SIGNS",
        field: "interactions",
        message: `${displayInteractions.length} display interactions exceed max ${universalCode.signage.maxSignsPerObject}`,
        severity: "error",
      });
    }
    for (const interaction of displayInteractions) {
      if (
        interaction.displayText &&
        interaction.displayText.length > universalCode.signage.maxCharsPerSign
      ) {
        errors.push({
          code: "SIGN_TEXT_TOO_LONG",
          field: `interactions.${interaction.stateKey}.displayText`,
          message: `Sign text ${interaction.displayText.length} chars exceeds max ${universalCode.signage.maxCharsPerSign}`,
          severity: "error",
        });
      }
    }
  }

  // 13. Neighborhood code
  if (neighborhoodCode.additionalConstraints.maxHeightToWidthRatio) {
    const heightToWidth =
      (obj.scale.y * plotBounds.height) / (obj.scale.x * plotBounds.width);
    if (
      heightToWidth >
      neighborhoodCode.additionalConstraints.maxHeightToWidthRatio
    ) {
      errors.push({
        code: "HEIGHT_RATIO_EXCEEDED",
        field: "scale",
        message: `Height-to-width ratio ${heightToWidth.toFixed(1)} exceeds neighborhood max ${neighborhoodCode.additionalConstraints.maxHeightToWidthRatio}`,
        severity: "error",
      });
    }
  }

  const hasErrors = errors.some((e) => e.severity === "error");
  return { valid: !hasErrors, errors };
}
