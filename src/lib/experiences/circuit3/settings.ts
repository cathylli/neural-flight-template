import * as THREE from "three";
import type { ExperienceState } from "../types";
import type { WFCState } from "./scene";

// ── Settings ───────────────────────────────────────────────────
// Handles parameter changes from the Settings Sidebar and Node Editor.
// WFC structural parameters trigger a rebuild on the next tick().

export function applySettings(
  id: string,
  value: number | boolean | string,
  state: ExperienceState,
  _scene: THREE.Scene,
): void {
  const s = state as WFCState;

  switch (id) {
    // ── Movement ────────────────────────────────────
    case "moveSpeed":
      s.moveSpeed = value as number;
      break;

    // ── WFC (structural — flag rebuild) ─────────────
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
      if (value === true) {
        s._needsRebuild = true;
      }
      break;

    // ── Visual ──────────────────────────────────────
    case "neonColor": {
      s.neonColor = value as string;
      const color = new THREE.Color(value as string);

      // Update trace line materials
      for (const child of s.traceGroup.children) {
        if (
          child instanceof THREE.LineSegments ||
          child instanceof THREE.Line
        ) {
          const mat = child.material;
          if (mat instanceof THREE.LineBasicMaterial) {
            mat.color.copy(color);
          }
        }
      }

      // Update building glow edge materials
      for (const child of s.glowEdgesGroup.children) {
        if (child instanceof THREE.LineSegments) {
          const mat = child.material;
          if (mat instanceof THREE.LineBasicMaterial) {
            mat.color.copy(color);
          }
        }
      }
      break;
    }

    case "buildingOpacity": {
      const opacity = value as number;
      for (const child of s.buildingGroup.children) {
        if (child instanceof THREE.Mesh) {
          const mat = child.material;
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.opacity = opacity;
          }
        }
      }
      break;
    }

    case "animateData":
      s.animateData = value as boolean;
      break;

    default:
      break;
  }
}
