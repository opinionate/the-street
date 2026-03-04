import * as THREE from "three";
import { V1_CONFIG, type WorldConfig } from "@the-street/shared";

export class StreetGeometry {
  mesh: THREE.Group;

  constructor(config: WorldConfig = V1_CONFIG) {
    this.mesh = new THREE.Group();
    this.mesh.name = "StreetGeometry";

    // The street is a flat ring. Inner radius = ring radius minus plot depth minus street width.
    // Outer radius = ring radius minus plot depth.
    const outerRadius = config.ringRadius - config.plotDepth / 2;
    const innerRadius = outerRadius - config.streetWidth;

    // Street surface
    const streetGeo = new THREE.RingGeometry(innerRadius, outerRadius, 128);
    streetGeo.rotateX(-Math.PI / 2); // lay flat on XZ plane
    const streetMat = new THREE.MeshStandardMaterial({
      color: 0x555555,
      roughness: 0.9,
      metalness: 0.0,
    });
    const streetMesh = new THREE.Mesh(streetGeo, streetMat);
    streetMesh.receiveShadow = true;
    streetMesh.name = "Street";
    this.mesh.add(streetMesh);

    // Ground plane (inside the ring — the center area)
    const groundGeo = new THREE.CircleGeometry(innerRadius, 128);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x4a7c3f,
      roughness: 1.0,
      metalness: 0.0,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.receiveShadow = true;
    groundMesh.position.y = -0.01; // slightly below street
    groundMesh.name = "CenterGround";
    this.mesh.add(groundMesh);

    // Outer ground (beyond the plots)
    const outerGroundGeo = new THREE.RingGeometry(
      config.ringRadius + config.plotDepth / 2,
      config.ringRadius + config.plotDepth / 2 + 200,
      128
    );
    outerGroundGeo.rotateX(-Math.PI / 2);
    const outerGroundMesh = new THREE.Mesh(outerGroundGeo, groundMat.clone());
    outerGroundMesh.receiveShadow = true;
    outerGroundMesh.position.y = -0.01;
    outerGroundMesh.name = "OuterGround";
    this.mesh.add(outerGroundMesh);
  }
}
