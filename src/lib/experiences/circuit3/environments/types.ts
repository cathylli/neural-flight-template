import * as THREE from "three";

// ── Environment abstraction ─────────────────────────────────────────────────
//
// An Environment is "what a chunk of the world looks like and how it is
// generated". The ChunkManager is a generic driver: it streams chunks in/out
// around the player, animates their growth and drives station placement, but it
// knows *nothing* about tiles, WFC, materials or terrain — all of that lives
// behind this interface.
//
// This is what lets every level look completely different: swap the active
// Environment (see ChunkManager.setEnvironment) and the whole world is rebuilt
// from a different tile vocabulary / mesh builder / material set. The generation
// algorithm itself (2D WFC, 3D Model Synthesis, …) is an internal detail of the
// concrete Environment — the manager only ever receives an opaque ChunkContent
// back, so the data shape (2D grid vs 3D volume) never leaks into the core.

/**
 * World-space footprint (units) of one chunk. Every Environment must agree on
 * this so chunk boundaries line up seamlessly across an environment swap. The
 * circuit environment's tile grid must match it (CHUNK_GRID × CELL = 30 × 4).
 */
export const CHUNK_SIZE = 120;

/**
 * Vertical extent (units) of one chunk *layer*, used only when an Environment
 * opts into vertical streaming (see `Environment.verticalRadius`). Kept equal to
 * CHUNK_SIZE so a chunk is a cube and layers stack seamlessly in Y just like
 * chunks tile in X/Z. Environments that don't stream vertically never see more
 * than the `cy = 0` layer, so this constant is irrelevant to them.
 */
export const CHUNK_HEIGHT = CHUNK_SIZE;

/** Chunk render radius around the player (2 → a 5×5 = 25 chunk window). */
export const RENDER_RADIUS = 2;

/**
 * A single generated chunk, opaque to the ChunkManager. The manager only adds
 * `group` to the scene, ticks `update` for growth animation, reads `stationSlot`
 * to place the level's station, and calls `dispose` when the chunk streams out.
 */
export interface ChunkContent {
	/** Root object the manager adds to / removes from the scene. */
	readonly group: THREE.Group;
	/**
	 * World position where this chunk offers a valid station anchor, or null if
	 * it hosts none. Reported in *world* coordinates (not grid cells) so the
	 * placement stays generic across 2D and 3D environments — only the
	 * environment knows what "a valid spot" means in its own world.
	 */
	readonly stationSlot: THREE.Vector3 | null;
	/** Per-frame animation hook (growth, data panels, …). `elapsed` in seconds, `delta` frame time. */
	update(elapsed: number, delta?: number): void;
	/** Free all geometries this chunk owns (shared materials belong to the env). */
	dispose(): void;
}

/**
 * Generation parameters handed to an Environment for one chunk. The first three
 * are environment-agnostic knobs driven by the level; `stationWeight` comes from
 * the station policy (0 = this chunk must not host a station).
 */
export interface EnvironmentBuildParams {
	buildingDensity: number;
	traceComplexity: number;
	/** Current level — drives e.g. terrain amplitude in the circuit environment. */
	terrainLevel: number;
	/** Station-tile weight from the policy; 0 = no station in this chunk. */
	stationWeight: number;
	/** Particles per chunk (network environment). */
	particleCount?: number;
	/** Max distance for particle connections (network environment). */
	connectionDistance?: number;
	/** Particle drift speed (network environment). */
	driftSpeed?: number;
}

/**
 * One visual "world". A concrete environment owns its shared materials and knows
 * how to build a chunk at a given chunk-grid coordinate. Instances are created
 * per level by the registry (see registry.ts) and swapped in on a level change.
 */
export interface Environment {
	/**
	 * How many chunk *layers* above and below the player this environment wants
	 * streamed in Y (0 → only the ground layer `cy = 0`, the default and the
	 * behaviour every ground-based environment relies on). A value ≥ 1 turns the
	 * world into a true 3D volume the player can fly up/down through indefinitely;
	 * the ChunkManager reads this to size its vertical streaming window. Only the
	 * `cy = 0` layer participates in station placement and level progression, so a
	 * vertical environment stacks purely-visual layers on top of the ground one.
	 */
	readonly verticalRadius?: number;
	/** Override the default chunk render radius for this environment. */
	readonly renderRadius?: number;
	/**
	 * Build the chunk at chunk-grid coordinate (cx, cy, cz). `cy` is always 0
	 * unless this environment set `verticalRadius > 0`; ground-based environments
	 * ignore it and place everything at world-Y 0. `spawnTime` is the scene clock
	 * at spawn, used to drive the growth animation.
	 */
	buildChunk(
		cx: number,
		cy: number,
		cz: number,
		params: EnvironmentBuildParams,
		spawnTime: number,
	): ChunkContent;
	/** Live-update the neon accent color (drives the level cross-fade). */
	updateNeonColor(color: THREE.Color): void;
	/** Live-update building opacity (settings panel). */
	updateBuildingOpacity(opacity: number): void;
	/**
	 * Collision surface world-Y at (x, z) for the player's flight clamp, or null
	 * if this environment has no terrain to collide with (the scene then falls
	 * back to just its ground plane). Keeps flight collision following whatever
	 * world is currently active after an environment swap.
	 */
	terrainHeightAt?(x: number, z: number, terrainLevel: number): number | null;
	/** Called once after construction with the THREE.Scene for global visuals. */
	init?(scene: THREE.Scene): void;
	/** Per-frame animation hook (dome pulse, beacon glow, etc). */
	tick?(delta: number, playerPos?: THREE.Vector3): void;
	/** Free the shared materials this environment owns. */
	dispose(): void;
}
