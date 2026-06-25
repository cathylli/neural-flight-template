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
	{ buildingDensity: 0.5, traceComplexity: 0.85, neonColor: "#33aaff" },
	// L2 — server farm / brain
	{ buildingDensity: 0.8, traceComplexity: 1.0, neonColor: "#ff22bd" },
];
