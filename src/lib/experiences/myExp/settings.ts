import * as THREE from "three";
import type { ExperienceState } from "../types";
import type { DataSpaceState } from "./scene";

// ── Settings ───────────────────────────────────────────────────

export function applySettings(
  id: string,
  value: number | boolean | string,
  state: ExperienceState,
  _scene: THREE.Scene,
): void {
  const s = state as DataSpaceState;

  switch (id) {
    case "moveSpeed":
      s.player.baseSpeed = value as number;
      break;

    case "haze-density":
    case "enduser-density":
    case "ai-density":
      s.world.applySettings(id, value);
      break;

    default:
      break;
  }
}
