import * as THREE from "three";
import { buildBeacon } from "./beacon";
import type { StationContext, StationVisual } from "./types";

// ── CubeStation ──────────────────────────────────────────────────────────────
//
// The original placeholder station: a big colored cube on top of the shared
// beacon, one distinct color per level so stations are easy to tell apart while
// testing. Serves as the reference implementation of StationVisual — copy this
// for new station types (other geometry, other update() animation).

/** Edge length of the placeholder cube. */
const CUBE_SIZE = 20;
/** Distinct test colors per station so they're easy to tell apart. */
const TEST_COLORS = ["#ff3344", "#33ff88", "#3388ff", "#ffdd33"];

export class CubeStation implements StationVisual {
  readonly object = new THREE.Group();
  private readonly cube: THREE.Mesh;
  /** Base height of the cube, so update() can bob around it. */
  private readonly baseY: number;
  /** Functions that free everything this visual created. */
  private readonly disposers: Array<() => void> = [];

  constructor(ctx: StationContext) {
    // Shared "find me from far away" beacon (beam + core + ring).
    const beacon = buildBeacon(ctx);
    this.object.add(beacon.object);
    this.disposers.push(beacon.dispose);

    // Per-station geometry: the colored cube.
    const cubeColor = new THREE.Color(
      TEST_COLORS[ctx.level % TEST_COLORS.length],
    );
    const cubeMat = new THREE.MeshStandardMaterial({
      color: cubeColor,
      emissive: cubeColor,
      emissiveIntensity: 0.6,
      metalness: 0.3,
      roughness: 0.4,
    });
    const cubeGeo = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
    this.cube = new THREE.Mesh(cubeGeo, cubeMat);
    this.cube.position.set(ctx.position.x, CUBE_SIZE / 2, ctx.position.z);
    this.object.add(this.cube);
    this.disposers.push(() => {
      cubeGeo.dispose();
      cubeMat.dispose();
    });

    // Remember the base height so update() can bob around it.
    this.baseY = this.cube.position.y;
  }

  /** Gentle idle animation — demonstrates the per-frame hook. */
  update(elapsed: number): void {
    this.cube.rotation.y = elapsed * 0.6;
    this.cube.position.y = this.baseY + Math.sin(elapsed * 1.5) * 2;
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
  }
}
