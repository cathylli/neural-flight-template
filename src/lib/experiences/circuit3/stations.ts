import * as THREE from "three";
import { LEVEL_TILE_SETS } from "$lib/config/flight";
import { CHUNK_SIZE } from "./ChunkManager";

// ── Station Spawning & Triggers ──────────────────────────────────────────
//
// Each level owns exactly one "station" — a unique narrative anchor that
// spawns once and stays put. The mechanism is generic, so every level uses
// the same code path:
//
//   1. While a level's station is unspawned, the WFC tile set for newly
//      generated chunks includes the STATION tile (see ChunkManager).
//   2. The first eligible chunk that places it reports the world position
//      here; the spawn flag flips so no further chunk can place another.
//   3. A persistent beacon + spherical trigger volume is created at that
//      position. Beacons are scene-owned, so they survive chunk unload/reload.
//   4. When the player enters the trigger volume, markStationVisited fires
//      (driving the level-progression rule in levelState / #1).

/** Chebyshev chunk distance the station must keep from where its level began. */
const MIN_STATION_CHUNK_DIST = 2;
/** WFC weight of the STATION tile while a level's station is still unspawned. */
export const STATION_TILE_WEIGHT = 8;
/** Radius (world units) of the spherical trigger volume around a station. */
const TRIGGER_RADIUS = 16;
/** Height of the visual beacon beam. */
const BEACON_HEIGHT = 60;

/** Minimal contract the ChunkManager needs to drive station spawning. */
export interface StationSpawnPolicy {
  /** WFC weight for the STATION tile in the chunk at (cx, cz). 0 = excluded. */
  stationWeightFor(cx: number, cz: number): number;
  /** Report that a chunk placed the station at the given world position. */
  reportStationPlaced(worldPos: THREE.Vector3): void;
}

interface StationTrigger {
  level: number;
  center: THREE.Vector3;
  radiusSq: number;
  visited: boolean;
}

interface StationBeacon {
  group: THREE.Group;
  materials: THREE.Material[];
}

export class StationManager implements StationSpawnPolicy {
  private readonly scene: THREE.Scene;
  private currentLevel = 0;
  private levelStartChunk = { cx: 0, cz: 0 };
  private readonly spawned: boolean[];
  private readonly triggers: StationTrigger[] = [];
  private readonly beacons = new Map<number, StationBeacon>();

  /** Fired when the player enters a station's trigger volume (once per station). */
  onVisit?: (level: number) => void;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.spawned = new Array(LEVEL_TILE_SETS.length).fill(false);
  }

  // ── StationSpawnPolicy ────────────────────────────────────────────────────

  stationWeightFor(cx: number, cz: number): number {
    const level = this.currentLevel;
    if (level < 0 || level >= this.spawned.length) return 0;
    if (this.spawned[level]) return 0;
    const dist = Math.max(
      Math.abs(cx - this.levelStartChunk.cx),
      Math.abs(cz - this.levelStartChunk.cz),
    );
    if (dist < MIN_STATION_CHUNK_DIST) return 0;
    return STATION_TILE_WEIGHT;
  }

  reportStationPlaced(worldPos: THREE.Vector3): void {
    const level = this.currentLevel;
    if (level < 0 || level >= this.spawned.length) return;
    if (this.spawned[level]) return; // already placed — ignore extras
    this.spawned[level] = true;
    this.spawnBeacon(level, worldPos);
    this.triggers.push({
      level,
      center: worldPos.clone(),
      radiusSq: TRIGGER_RADIUS * TRIGGER_RADIUS,
      visited: false,
    });
  }

  // ── Driven by the scene ───────────────────────────────────────────────────

  /**
   * Switch to a new level. `playerChunk` becomes the origin for the new
   * level's spawn-distance gate, so the next station appears a couple of
   * chunks ahead of where the level began.
   */
  setLevel(level: number, playerChunk: { cx: number; cz: number }): void {
    this.currentLevel = level;
    this.levelStartChunk = { cx: playerChunk.cx, cz: playerChunk.cz };
  }

  /** Proximity check — fires onVisit when the player enters a trigger volume. */
  update(playerPos: THREE.Vector3): void {
    for (const t of this.triggers) {
      if (t.visited) continue;
      if (playerPos.distanceToSquared(t.center) <= t.radiusSq) {
        t.visited = true;
        this.onVisit?.(t.level);
      }
    }
  }

  // ── Visuals ───────────────────────────────────────────────────────────────

  private spawnBeacon(level: number, pos: THREE.Vector3): void {
    const color = new THREE.Color(LEVEL_TILE_SETS[level].neonColor);
    const group = new THREE.Group();
    const materials: THREE.Material[] = [];

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
    this.beacons.set(level, { group, materials });
  }

  dispose(): void {
    for (const beacon of this.beacons.values()) {
      beacon.group.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
      for (const mat of beacon.materials) mat.dispose();
      this.scene.remove(beacon.group);
    }
    this.beacons.clear();
    this.triggers.length = 0;
  }
}

/** World chunk coordinate for a world position (matches ChunkManager rounding). */
export function worldToChunk(pos: THREE.Vector3): { cx: number; cz: number } {
  return {
    cx: Math.floor(pos.x / CHUNK_SIZE + 0.5),
    cz: Math.floor(pos.z / CHUNK_SIZE + 0.5),
  };
}
