import * as THREE from "three";
import {
  getAllPlotPositions,
  V1_CONFIG,
  type WorldConfig,
  type PlotPlacement,
} from "@the-street/shared";

export class PlotRenderer {
  plotGroup: THREE.Group;
  private plotMeshes: Map<number, THREE.Group> = new Map();

  constructor(config: WorldConfig = V1_CONFIG) {
    this.plotGroup = new THREE.Group();
    this.plotGroup.name = "Plots";

    const placements = getAllPlotPositions(config);

    for (let i = 0; i < placements.length; i++) {
      const plot = this.createPlotBoundary(i, placements[i]);
      this.plotGroup.add(plot);
      this.plotMeshes.set(i, plot);
    }
  }

  private createPlotBoundary(
    index: number,
    placement: PlotPlacement
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = `Plot_${index}`;

    const { width, depth, height } = placement.bounds;

    // Wireframe boundary box
    const boxGeo = new THREE.BoxGeometry(width, height, depth);
    const edges = new THREE.EdgesGeometry(boxGeo);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x4488ff,
      opacity: 0.3,
      transparent: true,
    });
    const wireframe = new THREE.LineSegments(edges, lineMat);
    wireframe.position.y = height / 2; // bottom at ground
    group.add(wireframe);

    // Floor pad
    const padGeo = new THREE.PlaneGeometry(width, depth);
    padGeo.rotateX(-Math.PI / 2);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.8,
      metalness: 0.1,
      opacity: 0.4,
      transparent: true,
    });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.receiveShadow = true;
    pad.position.y = 0.01;
    group.add(pad);

    // Position and rotate the plot
    group.position.set(
      placement.position.x,
      placement.position.y,
      placement.position.z
    );
    group.rotation.y = placement.rotation;

    return group;
  }

  /** Add a placeholder box while an object is being generated */
  createPlaceholder(
    plotIndex: number,
    name: string,
    width: number,
    height: number,
    depth: number
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(width, height, depth);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4488ff,
      opacity: 0.3,
      transparent: true,
      emissive: 0x4488ff,
      emissiveIntensity: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = height / 2;
    mesh.name = `placeholder_${name}`;
    mesh.userData.isPlaceholder = true;

    const plot = this.plotMeshes.get(plotIndex);
    if (plot) {
      plot.add(mesh);
    }

    return mesh;
  }

  /** Remove a placeholder and replace with actual geometry */
  replacePlaceholder(plotIndex: number, name: string, object: THREE.Object3D): void {
    const plot = this.plotMeshes.get(plotIndex);
    if (!plot) return;

    const placeholder = plot.getObjectByName(`placeholder_${name}`);
    if (placeholder) {
      plot.remove(placeholder);
    }
    plot.add(object);
  }
}
