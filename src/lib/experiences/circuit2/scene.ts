import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { FlightPlayer } from "$lib/three/player";
import { MotherboardManager } from "./MotherboardManager";

// ── State ──────────────────────────────────────────────────────
export interface CircuitState2 extends ExperienceState {
  motherboard: MotherboardManager;
  player: FlightPlayer;
  camera: THREE.PerspectiveCamera;
  moveSpeed: number;
  rotationEnabled: boolean;
}

// ── Helpers ────────────────────────────────────────────────────

// ── Lifecycle: setup() ─────────────────────────────────────────

export async function setup(ctx: SetupContext): Promise<CircuitState2> {
  // Light
  const sun = ctx.scene.children.find(
    (c): c is THREE.DirectionalLight => c instanceof THREE.DirectionalLight,
  );
  if (sun) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -150;
    sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150;
    sun.shadow.camera.bottom = -150;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 500;
  }

  // Player
  const player = new FlightPlayer({
    spawnPosition: { x: 0, y: 5, z: 20 },
    baseSpeed: 10,
  });
  // Disable terrain clamping for circuit2 since we don't have a heightmap
  player.minClearance = -1;
  ctx.scene.add(player.rig);

  // Motherboard Manager (Infinite WFC Grid)
  const motherboard = new MotherboardManager(ctx.scene, {
    viewRadius: 4, // Balanciert Sichtweite und Performance
    traceDensity: 0.7,
    buildingDensity: 0.2,
  });

  return {
    motherboard,
    player,
    camera: player.camera,
    moveSpeed: 3,
    rotationEnabled: true,
  };
}

// ── Lifecycle: tick() ──────────────────────────────────────────

export function tick(
  state: ExperienceState,
  ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
  const s = state as CircuitState2;

  s.player.tick(ctx.delta);
  s.motherboard.update(s.player.rig.position);

  return { state: s };
}

// ── Lifecycle: dispose() ───────────────────────────────────────

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
  const s = state as CircuitState2;

  scene.remove(s.player.rig);
  s.motherboard.dispose();
}
