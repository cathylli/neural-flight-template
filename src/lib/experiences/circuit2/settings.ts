import * as THREE from "three";
import type { ExperienceState } from "../types";
import type { CircuitState2 } from "./scene";

// ── Settings ───────────────────────────────────────────────────
// Wird aufgerufen wenn ein Parameter sich ändert (Sidebar Slider, Node Editor Signal).
// Jeder case matched eine Parameter-ID aus manifest.ts.
//
// Pattern:
//   Einfache Werte → State-Property setzen (wird in tick() gelesen)
//   Visuelle Änderungen → Material/Fog/Licht direkt updaten
//   Strukturelle Änderungen → Objekte neu generieren (rebuild)

export function applySettings(
  id: string,
  value: number | boolean | string,
  state: ExperienceState,
  scene: THREE.Scene,
): void {
  const s = state as CircuitState2;

  switch (id) {
    // ── moveSpeed ──────────────────────────────────
    // Einfachster Fall: Wert im State speichern.
    // updatePlayer() liest s.moveSpeed jeden Frame.
    case "moveSpeed":
      s.moveSpeed = value as number;
      break;

    // ── rotationEnabled ────────────────────────────
    // Boolean Toggle: tick() prüft diesen Wert.
    case "rotationEnabled":
      s.rotationEnabled = value as boolean;
      break;

    default:
      break;
  }
}
