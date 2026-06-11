import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { FlightPlayer } from "$lib/three/player";
import { CircuitWorld } from "./world";
import { manifest } from "./manifest";
import { GridExplosionLogic } from "./browser.ts";

export interface CircuitState extends ExperienceState {
  world: CircuitWorld;
  player: FlightPlayer;
  gridExplosion: GridExplosionLogic;
  audioListener: THREE.AudioListener;
  backgroundAudio: THREE.Audio;
  explosionSound: THREE.PositionalAudio;
  explosionPlayed: boolean;
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
  player.minClearance = -9999; // flat world — no terrain clamping
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

  // GridExplosionLogic: Flottes Punktraster, das sich auf Wunsch zu einer
  // geordneten Matrix formiert (oder wieder in die Streuung zurückfällt).
  const gridExplosion = new GridExplosionLogic({
    gridSize: 50,
    spacing: 0.9,
    dotRadius: 0.2,
    scatterPower: 80,
    dispersionZ: 35,
    blobRadius: 18,
    color: initialColor,
  });

  // Mesh vor den Spieler setzen, sodass es im Vorbeiflug sichtbar wird.
  const explosionMesh = gridExplosion.getMesh();
  if (explosionMesh) {
    // Ein paar Meter vor dem Spawn, auf Spielerhöhe (Spawn-y = 5).
    explosionMesh.position.set(0, 30, -100);
    // Billboarding deaktivieren: Punkte sollen Teil der Welt sein,
    // nicht an der Kamera kleben.
    explosionMesh.frustumCulled = false;
    ctx.scene.add(explosionMesh);
  }

  // ── Background Audio ──
  // Place background.mp3 in static/experiences/circuit/
  const audioListener = new THREE.AudioListener();
  player.camera.add(audioListener);
  const backgroundAudio = new THREE.Audio(audioListener);
  const audioLoader = new THREE.AudioLoader();
  try {
    const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
      audioLoader.load(
        "/experiences/circuit/background.mp3",
        resolve,
        undefined,
        reject,
      );
    });
    backgroundAudio.setBuffer(buffer);
    backgroundAudio.setLoop(true);
    backgroundAudio.setVolume(0.5);
    backgroundAudio.play();
  } catch {
    console.warn(
      "Background audio not loaded — place static/experiences/circuit/background.mp3",
    );
  }

  // ── Explosion Sound (PositionalAudio on grid mesh) ──
  const explosionSound = new THREE.PositionalAudio(audioListener);
  const explosionAudioLoader = new THREE.AudioLoader();
  try {
    const explosionBuffer = await new Promise<AudioBuffer>(
      (resolve, reject) => {
        explosionAudioLoader.load(
          "/experiences/circuit/explosion.mp3",
          resolve,
          undefined,
          reject,
        );
      },
    );
    explosionSound.setBuffer(explosionBuffer);
    explosionSound.setRefDistance(30);
    explosionSound.setVolume(1);
    if (explosionMesh) {
      explosionMesh.add(explosionSound);
    }
  } catch {
    console.warn(
      "Explosion sound not loaded — place static/experiences/circuit/explosion.mp3",
    );
  }

  return {
    world,
    player,
    camera: player.camera,
    gridExplosion,
    audioListener,
    backgroundAudio,
    explosionSound,
    explosionPlayed: false,
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

  // GridExplosion: Partikel sind gebündelt und fliegen explosionsartig
  // auseinander, sobald sich der Spieler dem Grid nähert.
  const explosionProgress = computeExplosionProgress(s);
  s.gridExplosion.update(explosionProgress);

  // Explosions-Sound einmalig abspielen, sobald die Partikel aufplatzen
  if (explosionProgress > 0.2 && !s.explosionPlayed) {
    s.explosionSound.play();
    s.explosionPlayed = true;
  } else if (explosionProgress === 0) {
    s.explosionPlayed = false; // Reset für nächste Annäherung
  }

  return { state: s };
}

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
  const s = state as CircuitState;

  s.backgroundAudio.stop();
  s.explosionSound.stop();
  if (s.explosionSound.parent) {
    s.explosionSound.parent.remove(s.explosionSound);
  }
  s.audioListener.remove();

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
  const activationRadius = 60;
  const fullRadius = 20;

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
