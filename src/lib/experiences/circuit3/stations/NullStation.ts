import * as THREE from "three";
import type { StationVisual } from "./types";

// ── NullStation ──────────────────────────────────────────────────────────────
//
// An invisible station — used for levels where the trigger is handled by
// something other than the station system (e.g. the L3 dome exit). The
// station manager still spawns/triggers it, but nothing is rendered.

export class NullStation implements StationVisual {
  readonly object = new THREE.Group();

  dispose(): void {
    this.object.clear();
  }
}
