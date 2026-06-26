// ── Circuit3 Level Progression Config ──────────────────────────────────────
//
// circuit3-specific configuration for the Data Room's level progression.
// Kept local to the experience (not in the global flight config) since these
// values only describe how this experience generates and advances its world.
//
// The Data Room is a continuous journey across three narrative levels:
//   0 — clean abstract data room
//   1 — router network (terrain starts mixing in)
//   2 — AI server farm / "brain" (industrial, resource-heavy)
//
// A level only advances once BOTH conditions are met for the current level:
//   (a) chunksGenerated >= LEVEL_THRESHOLDS[currentLevel]   ("enough chunks flown")
//   (b) stationVisited[currentLevel] === true               ("station was visited")

/** Chunks that must be generated before each level can advance. Index = current level. */
export const LEVEL_THRESHOLDS: number[] = [8, 18, 30];

/** Per-level generation parameters fed to the ChunkManager on a level change. */
export interface LevelTileSet {
	/** Density of building tiles (0-1). */
	buildingDensity: number;
	/** Complexity of the circuit traces (0-1). */
	traceComplexity: number;
	/** Neon accent color (CSS hex). */
	neonColor: string;
}

export const LEVEL_TILE_SETS: LevelTileSet[] = [
	// L0 — clean data room
	{ buildingDensity: 0.3, traceComplexity: 0.6, neonColor: "#00ff66" },
	// L1 — router network
	{ buildingDensity: 0.3, traceComplexity: 0.6, neonColor: "#33aaff" },
	// L2 — server farm / brain
	{ buildingDensity: 0.5, traceComplexity: 0.6, neonColor: "#ff22bd" },
];

// ── Terrain Overlay (#3a) ────────────────────────────────────────────────────
//
// A continuous heightfield mesh sits *over* the circuit board (Platine). It
// oscillates around the board plane (y = 0): hills rise above it and hide the
// board, valleys dip just below it and let the neon traces shimmer through.
// The board / WFC generation is untouched — this is a purely additive layer.
//
// The amplitude grows with the current level, not with how far the player has
// flown: the world stays clean & flat in level 0 (the abstract data room) and
// steps up a notch on each level change, drifting toward an increasingly
// industrial, resource-heavy landscape. Distance is only folded in on the final
// level, where the terrain is allowed to keep growing as the player flies on.

/**
 * Base heightfield amplitude (world units) per level. Index = level.
 *   L0 → 0   : flat, nothing breaks through the visibility ramp → clean grid.
 *   L1, L2…  : each level a notch higher.
 * Add/extend entries if more levels are introduced (see LEVEL_TILE_SETS).
 */
const TERRAIN_LEVEL_AMPLITUDE: number[] = [0, 10, 25];

/** On the final level only, extra amplitude added per chunk of distance flown. */
const TERRAIN_FINAL_DISTANCE_GAIN = 2.5;
/** Cap on that final-level distance contribution (world units). */
const TERRAIN_FINAL_DISTANCE_MAX = 50;

/**
 * Heightfield amplitude (world units) for the given level. `chunkDistance`
 * (distance from the origin in chunks, continuous so the surface stays seamless
 * across chunk boundaries) only matters on the final level, where the terrain
 * keeps building up the further the player flies.
 */
export function getTerrainAmplitude(level: number, chunkDistance: number): number {
	const last = TERRAIN_LEVEL_AMPLITUDE.length - 1;
	const lvl = Math.min(Math.max(level, 0), last);
	let amp = TERRAIN_LEVEL_AMPLITUDE[lvl];
	if (lvl === last) {
		amp += Math.min(
			Math.max(chunkDistance, 0) * TERRAIN_FINAL_DISTANCE_GAIN,
			TERRAIN_FINAL_DISTANCE_MAX,
		);
	}
	return amp;
}
