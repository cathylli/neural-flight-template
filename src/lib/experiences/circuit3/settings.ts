import * as THREE from "three";
import type { ExperienceState } from "../types";
import type { WFCState } from "./scene";

export function applySettings(
  id:     string,
  value:  number | boolean | string,
  state:  ExperienceState,
  _scene: THREE.Scene,
): void {
  const s = state as WFCState;

  switch (id) {
    case "moveSpeed":
      s.moveSpeed = value as number;
      break;

    // WFC structural changes → force full chunk regeneration
    case "gridSize":
      s.gridSize = value as number;
      s._needsRebuild = true;
      break;
    case "cellSize":
      s.cellSize = value as number;
      s._needsRebuild = true;
      break;
    case "buildingDensity":
      s.buildingDensity = value as number;
      s._needsRebuild = true;
      break;
    case "traceComplexity":
      s.traceComplexity = value as number;
      s._needsRebuild = true;
      break;
    case "regenerate":
      if (value === true) s._needsRebuild = true;
      break;

    // Visual — live update, no full rebuild needed
    case "neonColor": {
      s.neonColor = value as string;
      s.chunkManager.updateNeonColor(new THREE.Color(value as string));
      break;
    }
    case "buildingOpacity":
      s.chunkManager.updateBuildingOpacity(value as number);
      break;

    case "animateData":
      s.animateData = value as boolean;
      break;

    default:
      break;
  }
}
