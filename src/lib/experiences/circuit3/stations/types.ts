import * as THREE from "three";
import type { FlyingParticles } from "./FlyingParticles";

// ── Station Visuals — the per-station contract ───────────────────────────────
//
// The StationManager owns the generic spawn/trigger/level logic; it does NOT
// know what a station looks like. Each station type instead implements
// StationVisual: it builds its own geometry, optionally animates per frame, and
// cleans up after itself. New station types are just new classes implementing
// this interface (see CubeStation) wired into the registry (see registry.ts).

/**
 * Everything a station factory is handed when its station is placed in the
 * world. Lets a visual match the level's color and the trigger footprint
 * without reaching back into the manager.
 */
export interface StationContext {
  /** Level index this station belongs to. */
  level: number;
  /** World position where the chunk placed the station (board plane, y ≈ 0). */
  position: THREE.Vector3;
  /** The level's neon accent color. */
  neonColor: THREE.Color;
  /** Radius (world units) of the trigger volume, so visuals can match it. */
  triggerRadius: number;
  /** Height of the shared beacon beam. */
  beaconHeight: number;
}

/**
 * The minimal contract the StationManager needs about one station's
 * appearance: hang it in the scene, optionally update it each frame, dispose it.
 */
export interface StationVisual {
  /** Root object the manager adds to / removes from the scene. */
  readonly object: THREE.Object3D;
  /** Per-frame animation hook. `elapsed` is the scene clock in seconds. */
  update?(elapsed: number): void;
  /**
   * Called when the player enters this station's trigger volume.
   * The visual may return a FlyingParticles swarm that continues to exist
   * beyond the station's lifetime — the StationManager takes ownership
   * and will eventually fly them toward the next level's station.
   * Return null if no particle effect is desired.
   */
  onVisit?(): FlyingParticles | null;
  /** Free all geometries / materials this visual owns. */
  dispose(): void;
}

/** Builds the visual for a station, given its placement context. */
export type StationFactory = (ctx: StationContext) => StationVisual;
