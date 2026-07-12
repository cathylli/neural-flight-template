import { BrainStation } from "./BrainStation";
import { ComputerStation } from "./ComputerStation";
import { DomeStation } from "./DomeStation";
import { NullStation } from "./NullStation";
import { RouterStation } from "./RouterStation";
import { SphereStation } from "./SphereStation";
import type { StationContext, StationFactory, StationVisual } from "./types";

// ── Station Registry ─────────────────────────────────────────────────────────
//
// Maps a level index to the station type used for that level. To give a level a
// different look/animation, write a new class implementing StationVisual (copy
// CubeStation) and swap its factory in here — nothing in the manager changes.

/** level index → factory building that level's station visual. */
const STATION_FACTORIES: StationFactory[] = [
  (ctx) => new RouterStation(ctx),  // L0 — green mesh router
  (ctx) => new SphereStation(ctx),  // L1 — green sphere (neural routing net)
  ()   => new NullStation(),        // L2 — time-based (30s → L3)
  (ctx) => new DomeStation(ctx),   // L3 — white data room (circuit board variant) + firewall dome
  ()   => new NullStation(),        // L4 — no station (dome exit triggers the transition)
  (ctx) => new BrainStation(ctx),   // L5 — the brain → advance to particle network
  (ctx) => new ComputerStation(ctx), // L6 — final level (particle network)
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
