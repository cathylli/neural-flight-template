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
// The amplitude grows with how far the player has flown from the origin, so the
// world drifts from clean & flat (level ~1, minimal terrain) toward an
// increasingly industrial, resource-heavy landscape deeper into the journey.

/** Minimal amplitude near the origin — level 1 stays almost flat. */
const TERRAIN_MIN_AMPLITUDE = 0.3;
/** Maximal amplitude far out — dramatic hills in the server-farm region. */
const TERRAIN_MAX_AMPLITUDE = 12;
/** Distance (in chunks) over which the amplitude ramps from min → max. */
const TERRAIN_RAMP_CHUNKS = 40;

/**
 * Heightfield amplitude (world units) at a given distance from the origin,
 * measured in chunks (a continuous value, not an integer index, so the result
 * stays continuous across chunk boundaries — no seams).
 *
 * Ease-in (t²) keeps the early levels clean and lets the terrain take over
 * later in the flight.
 */
export function getTerrainAmplitude(chunkDistance: number): number {
	const t = Math.min(Math.max(chunkDistance, 0) / TERRAIN_RAMP_CHUNKS, 1);
	const eased = t * t;
	return TERRAIN_MIN_AMPLITUDE + (TERRAIN_MAX_AMPLITUDE - TERRAIN_MIN_AMPLITUDE) * eased;
}
