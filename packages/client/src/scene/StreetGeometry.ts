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

    // Street surface — dark asphalt with subtle sheen
    const streetGeo = new THREE.RingGeometry(innerRadius, outerRadius, 128);
    streetGeo.rotateX(-Math.PI / 2); // lay flat on XZ plane
    const streetMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a24,
      roughness: 0.7,
      metalness: 0.2,
      emissive: 0x0a0a14,
      emissiveIntensity: 0.3,
    });
    const streetMesh = new THREE.Mesh(streetGeo, streetMat);
    streetMesh.receiveShadow = true;
    streetMesh.name = "Street";
    this.mesh.add(streetMesh);

    // Neon edge-lines along street (inner + outer)
    const edgeInner = new THREE.RingGeometry(innerRadius - 0.15, innerRadius, 128);
    edgeInner.rotateX(-Math.PI / 2);
    const neonMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, opacity: 0.6, transparent: true });
    const edgeInnerMesh = new THREE.Mesh(edgeInner, neonMat);
    edgeInnerMesh.position.y = 0.02;
    this.mesh.add(edgeInnerMesh);

    const edgeOuter = new THREE.RingGeometry(outerRadius, outerRadius + 0.15, 128);
    edgeOuter.rotateX(-Math.PI / 2);
    const edgeOuterMesh = new THREE.Mesh(edgeOuter, neonMat.clone());
    edgeOuterMesh.position.y = 0.02;
    this.mesh.add(edgeOuterMesh);

    // Ground plane (inside the ring — void floor)
    const groundGeo = new THREE.CircleGeometry(innerRadius, 128);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x080810,
      roughness: 0.95,
      metalness: 0.1,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.receiveShadow = true;
    groundMesh.position.y = -0.01; // slightly below street
    groundMesh.name = "CenterGround";
    this.mesh.add(groundMesh);

    // Outer ground (beyond the plots — fading into void)
    const outerGroundGeo = new THREE.RingGeometry(
      config.ringRadius + config.plotDepth / 2,
      config.ringRadius + config.plotDepth / 2 + 200,
      128
    );
    outerGroundGeo.rotateX(-Math.PI / 2);
    const outerGroundMat = new THREE.MeshStandardMaterial({
      color: 0x060610,
      roughness: 1.0,
      metalness: 0.0,
    });
    const outerGroundMesh = new THREE.Mesh(outerGroundGeo, outerGroundMat);
    outerGroundMesh.receiveShadow = true;
    outerGroundMesh.position.y = -0.01;
    outerGroundMesh.name = "OuterGround";
    this.mesh.add(outerGroundMesh);

    // Street lamps along the inner edge of the road
    const lampCount = Math.floor(config.plotCount / 2); // one lamp every 2 plots
    const streetMidRadius = (innerRadius + outerRadius) / 2;
    const lampPoleMat = new THREE.MeshStandardMaterial({
      color: 0x222233,
      roughness: 0.5,
      metalness: 0.6,
    });

    for (let i = 0; i < lampCount; i++) {
      const angle = (i / lampCount) * Math.PI * 2;
      const lx = Math.cos(angle) * innerRadius;
      const lz = Math.sin(angle) * innerRadius;

      const lampGroup = new THREE.Group();
      lampGroup.position.set(lx, 0, lz);

      // Pole
      const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 5, 6);
      const pole = new THREE.Mesh(poleGeo, lampPoleMat);
      pole.position.y = 2.5;
      pole.castShadow = true;
      lampGroup.add(pole);

      // Arm extending over street
      const armGeo = new THREE.CylinderGeometry(0.04, 0.04, 2, 4);
      const arm = new THREE.Mesh(armGeo, lampPoleMat);
      arm.rotation.z = Math.PI / 2;
      // Point arm toward street center (inward)
      const toCenter = Math.atan2(-lz, -lx);
      arm.rotation.y = -toCenter;
      arm.position.y = 5;
      arm.position.x = Math.cos(toCenter) * 1;
      arm.position.z = Math.sin(toCenter) * 1;
      lampGroup.add(arm);

      // Lamp head (emissive glow)
      const headGeo = new THREE.SphereGeometry(0.2, 8, 8);
      const headMat = new THREE.MeshStandardMaterial({
        color: 0xff8800,
        emissive: 0xff6600,
        emissiveIntensity: 2.0,
        roughness: 0.3,
        metalness: 0.0,
      });
      const lampHead = new THREE.Mesh(headGeo, headMat);
      lampHead.position.y = 5;
      lampHead.position.x = Math.cos(toCenter) * 2;
      lampHead.position.z = Math.sin(toCenter) * 2;
      lampGroup.add(lampHead);

      // Point light for actual illumination
      const light = new THREE.PointLight(0xff8844, 0.8, 25, 2);
      light.position.copy(lampHead.position);
      light.position.y -= 0.3;
      light.castShadow = false; // too many shadow-casting lights is expensive
      lampGroup.add(light);

      this.mesh.add(lampGroup);
    }
  }
}
