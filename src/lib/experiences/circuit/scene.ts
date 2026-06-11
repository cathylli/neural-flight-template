import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { FlightPlayer } from "$lib/three/player";
import { CircuitWorld } from "./world";
import { manifest } from "./manifest";
import { GridExplosionLogic } from "./browser.ts";
import { SpatialAudio } from "$lib/three/spatial-audio";
import { AUDIO } from "$lib/config/flight";

export interface CircuitState extends ExperienceState {
  world: CircuitWorld;
  player: FlightPlayer;
  gridExplosion: GridExplosionLogic;
  audio: SpatialAudio;
  engineSound: THREE.PositionalAudio;
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

  // Spatial Audio
  const audio = new SpatialAudio(player.camera);
  audio.initXR(ctx.renderer);
  audio.createAmbientDrone(player.rig);
  const engineSound = audio.createEngineSound(player.rig);
  audio.createBackgroundMusic("/experiences/circuit/background.mp3", 0.4);

  // Welt-Struktur mit Startwerten generieren
  const initialDensity = 150;
  const initialColor = "#00ff33";
  const world = new CircuitWorld(
    ctx.scene,
    player.rig.position,
    initialColor,
    initialDensity,
  );

  // GridExplosionLogic: Flottes Punktraster, das sich auf Wunsch zu einer
  // geordneten Matrix formiert (oder wieder in die Streuung zurückfällt).
  const gridExplosion = new GridExplosionLogic({
    gridSize: 24,
    spacing: 1.2,
    dotRadius: 0.18,
    scatterPower: 40,
    dispersionZ: 18,
    color: initialColor,
  });

  // Mesh vor den Spieler setzen, sodass es im Vorbeiflug sichtbar wird.
  const explosionMesh = gridExplosion.getMesh();
  if (explosionMesh) {
    // Ein paar Meter vor dem Spawn, auf Spielerhöhe (Spawn-y = 5).
    explosionMesh.position.set(0, 5, -100);
    // Billboarding deaktivieren: Punkte sollen Teil der Welt sein,
    // nicht an der Kamera kleben.
    explosionMesh.frustumCulled = false;
    ctx.scene.add(explosionMesh);
  }

  return {
    world,
    player,
    camera: player.camera,
    gridExplosion,
    audio,
    engineSound,
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

  // Engine sound pitch folgt der Geschwindigkeit
  const speedRatio = s.player.velocity / s.player.baseSpeed;
  const rate = THREE.MathUtils.lerp(
    AUDIO.ENGINE.minRate,
    AUDIO.ENGINE.maxRate,
    Math.min(1, speedRatio / 2),
  );
  s.engineSound.setPlaybackRate(rate);

  // GridExplosion: Partikel sind gebündelt und fliegen explosionsartig
  // auseinander, sobald sich der Spieler dem Grid nähert.
  const explosionProgress = computeExplosionProgress(s);
  s.gridExplosion.update(explosionProgress);

  return { state: s };
}

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
  const s = state as CircuitState;

  s.audio.dispose();
  s.world.dispose();
  scene.remove(s.player.rig);

  const explosionMesh = s.gridExplosion.getMesh();
  if (explosionMesh) {
    scene.remove(explosionMesh);
  }
  // Verbleibende Geometrien und Materialien freigeben.
  const mesh = s.gridExplosion.getMesh();
  if (mesh) {
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((mat) => mat.dispose());
    } else {
      material.dispose();
    }
  }
}

/**
 * Übersetzt die Spielerposition in einen Fortschrittswert für die
 * GridExplosionLogic: `0` = Partikel gebündelt (keine Annäherung),
 * `1` = Partikel vollständig explodiert.
 *
 * Sobald der Spieler sich innerhalb des Aktivierungsradius befindet,
 * wächst der Fortschritt mit sinkender Distanz – nahe Spieler lösen
 * die Explosion aus, weit entfernte Spieler lassen die Partikel
 * gebündelt am Zentrum verharren.
 */
function computeExplosionProgress(s: CircuitState): number {
  const explosionMesh = s.gridExplosion.getMesh();
  if (!explosionMesh) return 0;

  const playerPos = s.player.rig.position;
  const gridCenter = explosionMesh.position;

  const distance = playerPos.distanceTo(gridCenter);
  const activationRadius = 35;
  const fullRadius = 8;

  if (distance >= activationRadius) {
    // Spieler ist weit weg → Partikel bleiben gebündelt.
    return 0;
  }

  if (distance <= fullRadius) {
    // Spieler ist nah dran → Partikel vollständig explodiert.
    return 1;
  }

  // Linearer Übergang zwischen gebündelt (außen) und explodiert (innen).
  const range = activationRadius - fullRadius;
  const normalized = (activationRadius - distance) / range;
  return THREE.MathUtils.clamp(normalized, 0, 1);
}
