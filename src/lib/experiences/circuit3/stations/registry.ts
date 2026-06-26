import { CubeStation } from "./CubeStation";
import type { StationContext, StationFactory, StationVisual } from "./types";

// ── Station Registry ─────────────────────────────────────────────────────────
//
// Maps a level index to the station type used for that level. To give a level a
// different look/animation, write a new class implementing StationVisual (copy
// CubeStation) and swap its factory in here — nothing in the manager changes.

/** level index → factory building that level's station visual. */
const STATION_FACTORIES: StationFactory[] = [
  (ctx) => new CubeStation(ctx), // L0 — clean data room
  (ctx) => new CubeStation(ctx), // L1 — router network
  (ctx) => new CubeStation(ctx), // L2 — server farm / brain
];

/**
 * Builds the visual for the given station context. Levels beyond the table fall
 * back to the last registered factory so a new level never spawns without a
 * station.
 */
export function createStationVisual(ctx: StationContext): StationVisual {
  const factory =
    STATION_FACTORIES[ctx.level] ??
    STATION_FACTORIES[STATION_FACTORIES.length - 1];
  return factory(ctx);
}
