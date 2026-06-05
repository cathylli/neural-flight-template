import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { FlightPlayer } from "$lib/three/player";
import { CircuitWorld } from "./world";
import { manifest } from "./manifest";

export interface CircuitState extends ExperienceState {
  world: CircuitWorld;
  player: FlightPlayer;
}

export async function setup(ctx: SetupContext): Promise<CircuitState> {
  const moveSpeedParam = manifest.parameters.find((p) => p.id === "moveSpeed");
  const defaultSpeed = moveSpeedParam
    ? (moveSpeedParam.default as number)
    : 100;

  // Player initialisieren
  const player = new FlightPlayer({
    spawnPosition: { x: 0, y: 5, z: 0 },
    baseSpeed: defaultSpeed,
  });
  ctx.scene.add(player.rig);

  // Welt-Struktur mit Startwerten generieren
  const initialDensity = 150;
  const initialColor = "#00ff33";
  const world = new CircuitWorld(
    ctx.scene,
    player.rig.position,
    initialColor,
    initialDensity,
  );

  return {
    world,
    player,
    camera: player.camera,
  };
}

export function tick(
  state: ExperienceState,
  ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
  const s = state as CircuitState;

  // Spieler-Physik basierend auf der Frametime (delta) berechnen
  s.player.tick(ctx.delta);

  // Übergibt die aktuelle Position des Spielers an das Chunk-Management
  s.world.update(s.player.rig.position, ctx.delta);

  return { state: s };
}

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
  const s = state as CircuitState;

  s.world.dispose();
  scene.remove(s.player.rig);
}
