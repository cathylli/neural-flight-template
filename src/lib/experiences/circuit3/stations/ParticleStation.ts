import * as THREE from "three";
import { buildBeacon } from "./beacon";
import type { StationContext, StationVisual } from "./types";

// ── ParticleStation ──────────────────────────────────────────────────────────
//
// A second, livelier station type and the reference for "geometry + particle
// system + animation": a glowing icosahedron core hovering over the shared
// beacon, wrapped in a swirling ring of particles. Everything is tinted with
// the level's neon color (ctx.neonColor) so it fits the level it spawns in.
//
// Use this as a template: build whatever objects you like into `this.object`,
// drive them from `update(elapsed)`, and free them all in `dispose()`.

/** Height the core hovers at above the board plane. */
const CORE_HEIGHT = 16;
/** Radius of the core sphere. */
const CORE_RADIUS = 7;
/** Number of particles in the swirling ring. */
const PARTICLE_COUNT = 220;
/** Average radius of the particle ring around the core. */
const RING_RADIUS = 14;
/** Vertical spread of the particle ring. */
const RING_SPREAD = 10;

export class ParticleStation implements StationVisual {
  readonly object = new THREE.Group();
  private readonly core: THREE.Mesh;
  /** Group holding the particles, rotated as a whole for the swirl. */
  private readonly swirl = new THREE.Group();
  private readonly disposers: Array<() => void> = [];

  constructor(ctx: StationContext) {
    const { position: pos, neonColor: color } = ctx;

    // Shared "find me from far away" beacon (beam + core + ring).
    const beacon = buildBeacon(ctx);
    this.object.add(beacon.object);
    this.disposers.push(beacon.dispose);

    // Glowing core — the per-station centerpiece geometry.
    const coreMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.9,
      metalness: 0.4,
      roughness: 0.3,
      flatShading: true,
    });
    const coreGeo = new THREE.IcosahedronGeometry(CORE_RADIUS, 0);
    this.core = new THREE.Mesh(coreGeo, coreMat);
    this.core.position.set(pos.x, CORE_HEIGHT, pos.z);
    this.object.add(this.core);
    this.disposers.push(() => {
      coreGeo.dispose();
      coreMat.dispose();
    });

    // Particle ring — a swirling cloud of points around the core.
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = RING_RADIUS * (0.6 + Math.random() * 0.4);
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = (Math.random() - 0.5) * RING_SPREAD;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    const particleMat = new THREE.PointsMaterial({
      color,
      size: 1.4,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    // Particle positions are local to the swirl group, which sits at the core.
    this.swirl.position.set(pos.x, CORE_HEIGHT, pos.z);
    this.swirl.add(particles);
    this.object.add(this.swirl);
    this.disposers.push(() => {
      particleGeo.dispose();
      particleMat.dispose();
    });
  }

  /** Spin the core and swirl the particle ring the other way. */
  update(elapsed: number): void {
    this.core.rotation.x = elapsed * 0.4;
    this.core.rotation.y = elapsed * 0.7;
    this.swirl.rotation.y = -elapsed * 0.5;
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
  }
}
