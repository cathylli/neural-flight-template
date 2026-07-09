import * as THREE from "three";
import { buildBeacon } from "./beacon";
import type { StationContext, StationVisual } from "./types";

// ── BeaconStation ─────────────────────────────────────────────────────────────
//
// A minimal station visual — just the shared beacon (beam + core + ground ring)
// without any extra geometry. Used for levels where the station is purely a
// navigation target (e.g. the void transition room where a separate cube entity
// provides the visual spectacle, not the station itself).

export class BeaconStation implements StationVisual {
  readonly object: THREE.Group;
  private readonly disposeBeacon: () => void;

  constructor(ctx: StationContext) {
    const beacon = buildBeacon(ctx);
    this.object = beacon.object;
    this.disposeBeacon = beacon.dispose;
  }

  update(_elapsed: number): void {
    // No extra animation needed.
  }

  dispose(): void {
    this.disposeBeacon();
  }
}
