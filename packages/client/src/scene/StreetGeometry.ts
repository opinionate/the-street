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

    // Faux reflective layer — subtle glossy surface instead of expensive real-time Reflector
    const fakeReflectorGeo = new THREE.RingGeometry(innerRadius, outerRadius, 128);
    fakeReflectorGeo.rotateX(-Math.PI / 2);
    const fakeReflectorMat = new THREE.MeshStandardMaterial({
      color: 0x101018,
      roughness: 0.15,
      metalness: 0.9,
    });
    const fakeReflector = new THREE.Mesh(fakeReflectorGeo, fakeReflectorMat);
    fakeReflector.position.y = -0.005;
    fakeReflector.name = "StreetReflector";
    this.mesh.add(fakeReflector);

    // Street surface — wet asphalt with clearcoat for rain-slick sheen
    const streetGeo = new THREE.RingGeometry(innerRadius, outerRadius, 128);
    streetGeo.rotateX(-Math.PI / 2);
    const streetMat = new THREE.MeshPhysicalMaterial({
      color: 0x12121c,
      roughness: 0.35,
      metalness: 0.1,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      emissive: 0x06060e,
      emissiveIntensity: 0.2,
      transparent: true,
      opacity: 0.7, // let reflector show through
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
      color: 0x556677,
      roughness: 0.4,
      metalness: 0.7,
    });

    for (let i = 0; i < lampCount; i++) {
      const angle = (i / lampCount) * Math.PI * 2;
      const lx = Math.cos(angle) * innerRadius;
      const lz = Math.sin(angle) * innerRadius;

      const lampGroup = new THREE.Group();
      lampGroup.position.set(lx, 0, lz);

      // Point arm toward street center (inward)
      const toCenter = Math.atan2(-lz, -lx);

      // Pole
      const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 5.5, 6);
      const pole = new THREE.Mesh(poleGeo, lampPoleMat);
      pole.position.y = 2.75;
      pole.castShadow = true;
      lampGroup.add(pole);

      // Arm extending over street
      const armGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.5, 4);
      const arm = new THREE.Mesh(armGeo, lampPoleMat);
      arm.rotation.z = Math.PI / 2;
      arm.rotation.y = -toCenter;
      arm.position.y = 5.5;
      arm.position.x = Math.cos(toCenter) * 1.25;
      arm.position.z = Math.sin(toCenter) * 1.25;
      lampGroup.add(arm);

      // Lamp housing (visible fixture)
      const housingGeo = new THREE.CylinderGeometry(0.15, 0.3, 0.25, 8);
      const housingMat = new THREE.MeshStandardMaterial({
        color: 0x334455,
        roughness: 0.3,
        metalness: 0.8,
      });
      const housing = new THREE.Mesh(housingGeo, housingMat);
      housing.position.y = 5.35;
      housing.position.x = Math.cos(toCenter) * 2.5;
      housing.position.z = Math.sin(toCenter) * 2.5;
      lampGroup.add(housing);

      // Lamp bulb (emissive glow)
      const bulbGeo = new THREE.SphereGeometry(0.15, 8, 8);
      const bulbMat = new THREE.MeshStandardMaterial({
        color: 0xffcc66,
        emissive: 0xffaa33,
        emissiveIntensity: 3.0,
        roughness: 0.1,
        metalness: 0.0,
      });
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.y = 5.2;
      bulb.position.x = Math.cos(toCenter) * 2.5;
      bulb.position.z = Math.sin(toCenter) * 2.5;
      lampGroup.add(bulb);

      this.mesh.add(lampGroup);
    }
  }
}
