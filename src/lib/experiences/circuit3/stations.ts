import * as THREE from "three";
import { LEVEL_TILE_SETS } from "$lib/config/flight";

// ── Station Spawning & Triggers ──────────────────────────────────────────
//
// Each level owns one "station" — a unique narrative anchor. The mechanism is
// generic, so every level uses the same code path:
//
//   1. While a level's station is NOT YET VISITED and none is currently
//      placed, the WFC tile set for newly generated chunks includes the
//      STATION tile (see ChunkManager).
//   2. The first eligible chunk that places it reports the world position
//      here; a beacon + spherical trigger volume is created and that one
//      station becomes "active" (no further chunk can place another).
//   3. If the player flies off and the active station's chunk unloads before
//      it is visited, the station despawns and becomes eligible to spawn
//      again — in a chunk ahead of the player. So an unvisited station can
//      never become unreachable.
//   4. Entering the trigger volume marks the station VISITED (permanent) and
//      fires markStationVisited (driving the level-progression rule / #1).
//      A visited station's beacon stays as a landmark and never respawns.
//
// Visiting and the chunk-count threshold (levelState / #1) are fully
// independent — either may be satisfied first.

/**
 * Minimum Chebyshev chunk distance the station keeps from the player's current
 * chunk. 1 = "any neighbouring chunk, but never the player's own" — so the
 * station spawns ~1 chunk away (reachable, never on top of the player) and,
 * since freshly generated chunks are always exactly 1 away, it can always
 * respawn ahead once an unvisited one unloads.
 */
const MIN_STATION_CHUNK_DIST = 1;
/** WFC weight of the STATION tile while a level's station is still unspawned. */
export const STATION_TILE_WEIGHT = 8;
/** Radius (world units) of the spherical trigger volume around a station. */
const TRIGGER_RADIUS = 16;
/** Height of the visual beacon beam. */
const BEACON_HEIGHT = 60;
/** Edge length of the placeholder test cube at each station. */
const TEST_CUBE_SIZE = 20;
/** Distinct test colors per station so they're easy to tell apart. */
const STATION_TEST_COLORS = ["#ff3344", "#33ff88", "#3388ff", "#ffdd33"];

/** Minimal contract the ChunkManager needs to drive station spawning. */
export interface StationSpawnPolicy {
  /**
   * WFC weight for the STATION tile in the chunk at (cx, cz), given the
   * player's current chunk (pcx, pcz). 0 = excluded.
   */
  stationWeightFor(cx: number, cz: number, pcx: number, pcz: number): number;
  /** Report that the chunk at (cx, cz) placed the station at `worldPos`. */
  reportStationPlaced(worldPos: THREE.Vector3, cx: number, cz: number): void;
  /** Notify that the chunk at (cx, cz) was unloaded. */
  onChunkUnloaded(cx: number, cz: number): void;
}

interface StationBeacon {
  group: THREE.Group;
  materials: THREE.Material[];
}

/** The single station currently placed in the world (for the active level). */
interface ActiveStation {
  level: number;
  cx: number;
  cz: number;
  center: THREE.Vector3;
  radiusSq: number;
  beacon: StationBeacon;
}

export class StationManager implements StationSpawnPolicy {
  private readonly scene: THREE.Scene;
  private currentLevel = 0;
  /** Permanent once the player has entered a level's station trigger. */
  private readonly visited: boolean[];
  /** The currently-placed, not-yet-visited station (at most one). */
  private active: ActiveStation | null = null;
  /** Every live beacon, for disposal (active + visited landmarks). */
  private readonly beacons: StationBeacon[] = [];

  /** Fired when the player enters a station's trigger volume (once per station). */
  onVisit?: (level: number) => void;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.visited = new Array(LEVEL_TILE_SETS.length).fill(false);
  }

  // ── StationSpawnPolicy ────────────────────────────────────────────────────

  stationWeightFor(cx: number, cz: number, pcx: number, pcz: number): number {
    const level = this.currentLevel;
    if (level < 0 || level >= this.visited.length) return 0;
    if (this.visited[level]) return 0; // already visited — never respawn
    if (this.active) return 0;          // one active station at a time
    const dist = Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz));
    if (dist < MIN_STATION_CHUNK_DIST) return 0;
    return STATION_TILE_WEIGHT;
  }

  reportStationPlaced(worldPos: THREE.Vector3, cx: number, cz: number): void {
    const level = this.currentLevel;
    if (level < 0 || level >= this.visited.length) return;
    if (this.visited[level] || this.active) return; // ignore extras
    this.active = {
      level,
      cx,
      cz,
      center: worldPos.clone(),
      radiusSq: TRIGGER_RADIUS * TRIGGER_RADIUS,
      beacon: this.spawnBeacon(level, worldPos),
    };
  }

  /**
   * The active station's chunk unloaded. If it wasn't visited, despawn it so
   * it can spawn again ahead of the player — an unvisited station never
   * becomes unreachable.
   */
  onChunkUnloaded(cx: number, cz: number): void {
    if (this.active && this.active.cx === cx && this.active.cz === cz) {
      this.removeBeacon(this.active.beacon);
      this.active = null;
    }
  }

  // ── Driven by the scene ───────────────────────────────────────────────────

  /** Switch to a new level — its (unvisited) station becomes eligible to spawn. */
  setLevel(level: number): void {
    this.currentLevel = level;
  }

  /** Proximity check — fires onVisit when the player enters the trigger volume. */
  update(playerPos: THREE.Vector3): void {
    if (!this.active) return;
    if (playerPos.distanceToSquared(this.active.center) <= this.active.radiusSq) {
      const level = this.active.level;
      this.visited[level] = true;
      // Keep the beacon as a visited landmark; just stop tracking it as active.
      this.active = null;
      this.onVisit?.(level);
    }
  }

  // ── Visuals ───────────────────────────────────────────────────────────────

  private spawnBeacon(level: number, pos: THREE.Vector3): StationBeacon {
    const color = new THREE.Color(LEVEL_TILE_SETS[level].neonColor);
    const group = new THREE.Group();
    const materials: THREE.Material[] = [];

    // Placeholder test cube — one big colored cube per station so each
    // station is easy to spot and tell apart while testing.
    const cubeColor = new THREE.Color(
      STATION_TEST_COLORS[level % STATION_TEST_COLORS.length],
    );
    const cubeMat = new THREE.MeshStandardMaterial({
      color: cubeColor,
      emissive: cubeColor,
      emissiveIntensity: 0.6,
      metalness: 0.3,
      roughness: 0.4,
    });
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(TEST_CUBE_SIZE, TEST_CUBE_SIZE, TEST_CUBE_SIZE),
      cubeMat,
    );
    cube.position.set(pos.x, TEST_CUBE_SIZE / 2, pos.z);
    group.add(cube);
    materials.push(cubeMat);

    // Vertical light beam — visible from a distance so the player can fly to it
    const beamMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5, 2.5, BEACON_HEIGHT, 20, 1, true),
      beamMat,
    );
    beam.position.set(pos.x, BEACON_HEIGHT / 2, pos.z);
    group.add(beam);
    materials.push(beamMat);

    // Bright core pillar
    const coreMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, BEACON_HEIGHT, 12),
      coreMat,
    );
    core.position.set(pos.x, BEACON_HEIGHT / 2, pos.z);
    group.add(core);
    materials.push(coreMat);

    // Ground ring marking the trigger footprint
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(TRIGGER_RADIUS - 1.5, TRIGGER_RADIUS, 48),
      ringMat,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.1, pos.z);
    group.add(ring);
    materials.push(ringMat);

    this.scene.add(group);
    const beacon: StationBeacon = { group, materials };
    this.beacons.push(beacon);
    return beacon;
  }

  private removeBeacon(beacon: StationBeacon): void {
    beacon.group.traverse((child) => {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    });
    for (const mat of beacon.materials) mat.dispose();
    this.scene.remove(beacon.group);
    const i = this.beacons.indexOf(beacon);
    if (i !== -1) this.beacons.splice(i, 1);
  }

  dispose(): void {
    // Copy first — removeBeacon mutates the array.
    for (const beacon of [...this.beacons]) this.removeBeacon(beacon);
    this.active = null;
  }
}
