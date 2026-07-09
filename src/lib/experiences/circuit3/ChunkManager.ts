import * as THREE from "three";
import type { StationSpawnPolicy } from "./stations";
import type {
  ChunkContent,
  Environment,
  EnvironmentBuildParams,
} from "./environments/types";
import { CHUNK_SIZE, RENDER_RADIUS } from "./environments/types";

// Re-exported so existing importers (scene.ts) keep a single import site.
export { CHUNK_SIZE };

// ── ChunkManager ─────────────────────────────────────────────────────────────
//
// Generic, environment-agnostic streaming driver. It keeps a 3×3 window of
// chunks around the player, ticks their growth animation and drives station
// placement — but it delegates *what a chunk is* to the active Environment (see
// environments/types.ts). Swap the environment (setEnvironment) and the whole
// world is rebuilt from a different look; the manager code is untouched.

/** Env-agnostic generation knobs, driven by the level / settings panel. */
export interface ChunkGenParams {
  buildingDensity: number;
  traceComplexity: number;
  /** Current level — passed through to the environment (e.g. terrain amplitude). */
  terrainLevel: number;
  /** Particles per chunk (network environment). */
  particleCount?: number;
  /** Max distance for particle connections (network environment). */
  connectionDistance?: number;
  /** Particle drift speed (network environment). */
  driftSpeed?: number;
}

export class ChunkManager {
  private readonly scene: THREE.Scene;
  private environment: Environment;
  private params: ChunkGenParams;
  private activeChunks = new Map<string, ChunkContent>();
  private lastPlayerCX = Infinity;
  private lastPlayerCZ = Infinity;
  /** Called once per newly generated chunk. Suppressed during rebuilds. */
  private onChunkGenerated?: () => void;
  /**
   * Skip the generation callback while (re)populating chunks that weren't
   * "flown" to — the initial spawn ring, a rebuild and an environment swap.
   * Starts true so the chunks present at spawn don't pre-satisfy the level
   * threshold.
   */
  private suppressChunkCount = true;
  /** Drives unique per-level station spawning. */
  private stationPolicy?: StationSpawnPolicy;

  constructor(
    scene: THREE.Scene,
    environment: Environment,
    params: ChunkGenParams,
    onChunkGenerated?: () => void,
    stationPolicy?: StationSpawnPolicy,
  ) {
    this.scene = scene;
    this.environment = environment;
    this.params = { ...params };
    this.onChunkGenerated = onChunkGenerated;
    this.stationPolicy = stationPolicy;
  }

  update(playerPos: THREE.Vector3, elapsed: number): void {
    const playerCX = Math.floor(playerPos.x / CHUNK_SIZE + 0.5);
    const playerCZ = Math.floor(playerPos.z / CHUNK_SIZE + 0.5);

    // Only recalculate active set when the player crosses a chunk boundary
    if (playerCX !== this.lastPlayerCX || playerCZ !== this.lastPlayerCZ) {
      this.lastPlayerCX = playerCX;
      this.lastPlayerCZ = playerCZ;
      this.reconcileChunks(playerCX, playerCZ, elapsed);
    }

    // Always animate chunk growth
    for (const chunk of this.activeChunks.values()) {
      chunk.update(elapsed);
    }
  }

  private reconcileChunks(pcx: number, pcz: number, elapsed: number): void {
    const desired = new Set<string>();
    for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
      for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
        desired.add(`${pcx + dx},${pcz + dz}`);
      }
    }

    // Remove out-of-range chunks
    for (const [key, chunk] of this.activeChunks) {
      if (!desired.has(key)) {
        this.scene.remove(chunk.group);
        chunk.dispose();
        this.activeChunks.delete(key);
        const [cx, cz] = key.split(",").map(Number);
        this.stationPolicy?.onChunkUnloaded(cx, cz);
      }
    }

    // Spawn new chunks
    for (const key of desired) {
      if (this.activeChunks.has(key)) continue;
      const [cx, cz] = key.split(",").map(Number);
      const stationWeight =
        this.stationPolicy?.stationWeightFor(cx, cz, pcx, pcz) ?? 0;
      const buildParams: EnvironmentBuildParams = {
        ...this.params,
        stationWeight,
      };
      const chunk = this.environment.buildChunk(cx, cz, buildParams, elapsed);
      this.scene.add(chunk.group);
      this.activeChunks.set(key, chunk);
      // Report a placed station before the next chunk is built, so the policy
      // can flip its spawn flag and keep the station unique even across chunks
      // created in the same batch.
      if (chunk.stationSlot) {
        this.stationPolicy?.reportStationPlaced(chunk.stationSlot, cx, cz);
      }
      // Count genuinely-explored chunks only — repopulation after a rebuild or
      // an environment swap regenerates the same positions and must not inflate
      // the level-progression counter.
      if (!this.suppressChunkCount) this.onChunkGenerated?.();
    }

    // First reconcile after a rebuild / swap is done — resume counting.
    this.suppressChunkCount = false;
  }

  /**
   * Swap the active environment (e.g. on a level change) and force a full
   * regeneration so the new world's chunks replace the old ones. Optionally
   * updates the generation params in the same step.
   */
  setEnvironment(
    environment: Environment,
    params: Partial<ChunkGenParams> = {},
  ): void {
    Object.assign(this.params, params);
    this.environment = environment;
    this.forceRegen();
  }

  /** Regenerate every chunk with the current environment and new params. */
  rebuild(newParams: Partial<ChunkGenParams>, _elapsed: number): void {
    Object.assign(this.params, newParams);
    this.forceRegen();
  }

  /** Drop all chunks and arm the next update() to repopulate from scratch. */
  private forceRegen(): void {
    for (const [key, chunk] of this.activeChunks) {
      this.scene.remove(chunk.group);
      chunk.dispose();
      this.activeChunks.delete(key);
    }
    this.lastPlayerCX = Infinity; // forces reconcileChunks on next update
    this.lastPlayerCZ = Infinity;
    // The forced reconcile re-spawns the same chunk positions — don't let that
    // repopulation count toward level progression.
    this.suppressChunkCount = true;
  }

  /**
   * Collision surface world-Y from the *active* environment at (x, z), or null
   * if it has no terrain. Routed through here so flight collision keeps
   * following the current world across an environment swap.
   */
  terrainHeightAt(x: number, z: number, terrainLevel: number): number | null {
    return this.environment.terrainHeightAt?.(x, z, terrainLevel) ?? null;
  }

  updateNeonColor(color: THREE.Color): void {
    this.environment.updateNeonColor(color);
  }

  updateBuildingOpacity(opacity: number): void {
    this.environment.updateBuildingOpacity(opacity);
  }

  /**
   * Dispose all live chunk geometry. Environment materials are owned by the
   * EnvironmentRegistry (they may be shared across a swap), so they are disposed
   * there, not here.
   */
  dispose(): void {
    for (const chunk of this.activeChunks.values()) {
      this.scene.remove(chunk.group);
      chunk.dispose();
    }
    this.activeChunks.clear();
  }
}
