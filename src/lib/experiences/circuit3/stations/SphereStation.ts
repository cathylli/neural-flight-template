import * as THREE from "three";
import { buildBeacon } from "./beacon";
import type { StationContext, StationVisual } from "./types";

// ── SphereStation ────────────────────────────────────────────────────────────
//
// A green glowing sphere with a wireframe overlay — used as the L1 station
// trigger inside the neural routing network. Solid green mesh that matches the
// packet cubes and the green data-room aesthetic.

const SPHERE_RADIUS = 40;
const SPHERE_SEGMENTS = 24;
const BOB_AMPLITUDE = 2;
const BOB_SPEED = 1.2;

const GREEN = new THREE.Color(0x00ff66);

export class SphereStation implements StationVisual {
  static readonly TRIGGER_RADIUS = 60;
  readonly object = new THREE.Group();
  private readonly sphereMat: THREE.MeshStandardMaterial;
  private readonly wireMat: THREE.LineBasicMaterial;
  private readonly baseY: number;

  constructor(ctx: StationContext) {
    const beacon = buildBeacon(ctx);
    this.object.add(beacon.object);

    // Solid green sphere.
    this.sphereMat = new THREE.MeshStandardMaterial({
      color: GREEN,
      emissive: GREEN,
      emissiveIntensity: 0.5,
      metalness: 0.3,
      roughness: 0.4,
    });
    const sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, SPHERE_SEGMENTS, SPHERE_SEGMENTS);
    const sphere = new THREE.Mesh(sphereGeo, this.sphereMat);
    this.object.add(sphere);

    // Wireframe overlay.
    this.wireMat = new THREE.LineBasicMaterial({
      color: GREEN,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const wireGeo = new THREE.WireframeGeometry(sphereGeo);
    const wireframe = new THREE.LineSegments(wireGeo, this.wireMat);
    this.object.add(wireframe);

    // Position at the station's world location.
    this.baseY = ctx.position.y + SPHERE_RADIUS;
    this.object.position.set(ctx.position.x, this.baseY, ctx.position.z);
  }

  update(elapsed: number): void {
    this.object.position.y =
      this.baseY + Math.sin(elapsed * BOB_SPEED) * BOB_AMPLITUDE;
    const flicker =
      0.25 + 0.1 * Math.sin(elapsed * 3.0) + 0.05 * Math.sin(elapsed * 7.0);
    this.wireMat.opacity = flicker;
  }

  dispose(): void {
    this.object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
      if (child instanceof THREE.LineSegments) child.geometry.dispose();
    });
    this.sphereMat.dispose();
    this.wireMat.dispose();
  }
}
