import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { FlightPlayer } from "$lib/three/player";
import { DataSpaceWorld } from "./world";

// ── State ──────────────────────────────────────────────────────

export interface DataSpaceState extends ExperienceState {
  player: FlightPlayer;
  world: DataSpaceWorld;
  camera: THREE.PerspectiveCamera;
  elapsed: number;
}

// ── Lifecycle: setup() ─────────────────────────────────────────

export async function setup(ctx: SetupContext): Promise<DataSpaceState> {
  // 1. Player
  const player = new FlightPlayer({
    spawnPosition: { x: 0, y: 0, z: 0 },
    baseSpeed: 30,
  });
  ctx.scene.add(player.rig);

  // Add Lights (Standard materials require light to be visible)
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  ctx.scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(50, 100, 50);
  ctx.scene.add(sun);

  // Initialize Fog as FogExp2 for the "Cyber-Smog" effect required by world.ts
  ctx.scene.fog = new THREE.FogExp2(0x0a0a1a, 0.005);

  // 2. Procedural World
  const world = new DataSpaceWorld(ctx.scene, player.rig.position);

  return {
    player,
    world,
    camera: player.camera,
    elapsed: 0,
  };
}

// ── Lifecycle: tick() ──────────────────────────────────────────

export function tick(
  state: ExperienceState,
  ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
  const s = state as DataSpaceState;
  const delta = ctx.delta;
  s.elapsed += delta;

  // Update physics
  s.player.tick(delta);

  // Update procedural world chunks around player position
  s.world.update(s.player.rig.position);

  return { state: s };
}

// ── Lifecycle: dispose() ───────────────────────────────────────

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
  const s = state as DataSpaceState;

  // Cleanup procedural world resources (geometries, materials, and chunks)
  s.world.dispose();
  // Remove player rig from the scene
  scene.remove(s.player.rig);
}
