import * as THREE from "three";
import { LEVEL_THRESHOLDS, LEVEL_TILE_SETS } from "../config";
import { FlyingParticles } from "./FlyingParticles";
import { createStationVisual } from "./registry";
import type { StationVisual } from "./types";

// ── Station Spawning & Triggers ──────────────────────────────────────────
//
// Each level owns one "station" — a unique narrative anchor. The mechanism is
// generic, so every level uses the same code path:
//
//   1. While a level's station is NOT YET VISITED and none is currently
//      placed, the WFC tile set for newly generated chunks includes the
//      STATION tile (see ChunkManager).
//   2. The first eligible chunk that places it reports the world position
//      here; a visual + spherical trigger volume is created and that one
//      station becomes "active" (no further chunk can place another).
//   3. If the player flies off and the active station's chunk unloads before
//      it is visited, the station despawns and becomes eligible to spawn
//      again — in a chunk ahead of the player. So an unvisited station can
//      never become unreachable.
//   4. Entering the trigger volume marks the station VISITED (permanent) and
//      fires markStationVisited (driving the level-progression rule / #1).
//      A visited station stays until the player flies off and its chunk
//      unloads — then it disappears with the chunk and never respawns.
//
// The station can only spawn once the level's chunk threshold has been flown
// (the spawn delay below equals LEVEL_THRESHOLDS[level]), so visiting always
// happens *after* the chunk threshold is met — the player flies on, the station
// appears ahead, then they reach it and the level advances.
//
// What a station *looks like* and how it *animates* lives in stations/ — each
// level's station is a StationVisual built by the registry (see registry.ts).
// This manager only owns the generic spawn/trigger/level logic.

/**
 * Minimum Chebyshev chunk distance the station keeps from the player's current
 * chunk. 1 = "any neighbouring chunk, but never the player's own" — so the
 * station spawns ~1 chunk away (reachable, never on top of the player) and,
 * since freshly generated chunks are always exactly 1 away, it can always
 * respawn ahead once an unvisited one unloads.
 */
const MIN_STATION_CHUNK_DIST = 1;
/**
 * How many genuinely-explored chunks must be flown after entering a level before
 * that level's station is allowed to spawn. This is taken per-level from
 * LEVEL_THRESHOLDS[level], so it matches the chunk count the level needs to
 * advance — the player always cruises a bit before the next station pops up
 * ahead of them (and never right next to them during the post-switch rebuild).
 */
function stationSpawnDelayForLevel(level: number): number {
  return LEVEL_THRESHOLDS[level] ?? 0;
}
/** WFC weight of the STATION tile while a level's station is still unspawned. */
export const STATION_TILE_WEIGHT = 8;
/** Radius (world units) of the spherical trigger volume around a station. */
const TRIGGER_RADIUS = 16;
/** Height of the visual beacon beam. */
const BEACON_HEIGHT = 60;

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

/** The single station currently placed in the world (for the active level). */
interface ActiveStation {
  level: number;
  cx: number;
  cz: number;
  center: THREE.Vector3;
  radiusSq: number;
  visual: StationVisual;
}

export class StationManager implements StationSpawnPolicy {
  private readonly scene: THREE.Scene;
  private currentLevel = 0;
  /** Permanent once the player has entered a level's station trigger. */
  private readonly visited: boolean[];
  /** The currently-placed, not-yet-visited station (at most one). */
  private active: ActiveStation | null = null;
  /**
   * Chunks still to be explored before the current level's station may spawn.
   * Set on every level change (see setLevel) and counted down by
   * notifyChunkExplored. While > 0, stationWeightFor stays at 0.
   */
  private spawnDelayRemaining = 0;
  /**
   * Stations that have been visited but whose chunk is still loaded. They are
   * removed once that chunk unloads (the player flew away) and never respawn.
   */
  private readonly visitedStations: ActiveStation[] = [];
  /** Every live visual, for per-frame animation and disposal. */
  private readonly visuals: StationVisual[] = [];
  /**
   * Particle swarms that continue to exist after their station was destroyed.
   * They drift/flat and eventually fly toward the next level's station.
   */
  private readonly transit: FlyingParticles[] = [];
  /** Persistent scene group holding transit particles (survives chunk rebuilds). */
  private readonly transitGroup = new THREE.Group();

  /** Fired when the player enters a station's trigger volume (once per station). */
  onVisit?: (level: number) => void;
  /** Fired when a new station is placed in the world (after spawn delay). */
  onStationPlaced?: (position: THREE.Vector3, level: number) => void;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.scene.add(this.transitGroup);
    this.visited = new Array(LEVEL_TILE_SETS.length).fill(false);
    // Level 0 never goes through setLevel, so seed its spawn delay here — the
    // very first station should also only appear after the player has flown on.
    this.spawnDelayRemaining = stationSpawnDelayForLevel(0);
  }

  // ── StationSpawnPolicy ────────────────────────────────────────────────────

  stationWeightFor(cx: number, cz: number, pcx: number, pcz: number): number {
    const level = this.currentLevel;
    if (level < 0 || level >= this.visited.length) return 0;
    if (this.visited[level]) return 0; // already visited — never respawn
    if (this.active) return 0;          // one active station at a time
    if (this.spawnDelayRemaining > 0) return 0; // fly on a bit after a level change
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
      visual: this.spawnVisual(level, worldPos),
    };
    this.onStationPlaced?.(worldPos, level);
  }

  /**
   * A chunk unloaded.
   *  - If it hosted the active (unvisited) station, despawn it so it can spawn
   *    again ahead of the player — an unvisited station never becomes
   *    unreachable.
   *  - If it hosted an already-visited station, remove it for good (it vanishes
   *    together with its chunk and won't respawn, since the level stays visited).
   */
  onChunkUnloaded(cx: number, cz: number): void {
    if (this.active && this.active.cx === cx && this.active.cz === cz) {
      this.removeVisual(this.active.visual);
      this.active = null;
    }
    for (let i = this.visitedStations.length - 1; i >= 0; i--) {
      const st = this.visitedStations[i];
      if (st.cx === cx && st.cz === cz) {
        this.removeVisual(st.visual);
        this.visitedStations.splice(i, 1);
      }
    }
  }

  // ── Driven by the scene ───────────────────────────────────────────────────

  /** Switch to a new level — its (unvisited) station becomes eligible to spawn. */
  setLevel(level: number): void {
    this.currentLevel = level;
    // Hold the new station back until the player has flown this level's chunk
    // threshold — same number that gates the level advance (LEVEL_THRESHOLDS).
    this.spawnDelayRemaining = stationSpawnDelayForLevel(level);
  }

  /**
   * Report that one genuinely-explored chunk was generated (drives the
   * post-level-change spawn delay). Call this from the same place that feeds
   * the level-progression counter, so rebuild repopulation doesn't count.
   */
  notifyChunkExplored(): void {
    if (this.spawnDelayRemaining > 0) this.spawnDelayRemaining--;
  }

  /**
   * Per-frame update: animate every live station, run the proximity check —
   * firing onVisit when the player enters the active trigger volume — and tick
   * any transit particles that are flying between stations.
   */
  update(playerPos: THREE.Vector3, elapsed: number, delta: number): void {
    for (const visual of this.visuals) visual.update?.(elapsed);

    if (this.active && playerPos.distanceToSquared(this.active.center) <= this.active.radiusSq) {
      const visited = this.active;

      // Trigger the visual's shatter effect and take ownership of particles
      const particles = visited.visual.onVisit?.() ?? null;
      if (particles) {
        visited.visual.object.remove(particles.group);
        this.transitGroup.add(particles.group);
        this.transit.push(particles);
      }

      this.visited[visited.level] = true;
      // Keep the visual around until its chunk unloads, then it disappears.
      this.visitedStations.push(visited);
      this.active = null;
      this.onVisit?.(visited.level);
    }

    // Tick transit particles (exploding → floating debris)
    for (const p of this.transit) p.update(delta);
  }

  // ── Visuals ───────────────────────────────────────────────────────────────

  private spawnVisual(level: number, pos: THREE.Vector3): StationVisual {
    const visual = createStationVisual({
      level,
      position: pos,
      neonColor: new THREE.Color(LEVEL_TILE_SETS[level].neonColor),
      triggerRadius: TRIGGER_RADIUS,
      beaconHeight: BEACON_HEIGHT,
    });
    this.scene.add(visual.object);
    this.visuals.push(visual);
    return visual;
  }

  private removeVisual(visual: StationVisual): void {
    this.scene.remove(visual.object);
    visual.dispose();
    const i = this.visuals.indexOf(visual);
    if (i !== -1) this.visuals.splice(i, 1);
  }

  dispose(): void {
    // Copy first — removeVisual mutates the array.
    for (const visual of [...this.visuals]) this.removeVisual(visual);
    this.active = null;
    this.visitedStations.length = 0;

    // Clean up transit particles
    for (const p of this.transit) {
      this.transitGroup.remove(p.group);
      p.dispose();
    }
    this.transit.length = 0;
    this.scene.remove(this.transitGroup);
  }
}
