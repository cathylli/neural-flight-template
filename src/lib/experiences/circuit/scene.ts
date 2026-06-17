import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { FlightPlayer } from "$lib/three/player";
import { CircuitWorld } from "./world";
import { manifest } from "./manifest";
import { GridExplosionLogic } from "./browser.ts";
import { StartSequence } from "./start-sequence";
import { DirectionArrows } from "./direction-arrows";

export interface CircuitState extends ExperienceState {
  world: CircuitWorld;
  player: FlightPlayer;
  gridExplosion: GridExplosionLogic;
  audioListener: THREE.AudioListener;
  backgroundAudio: THREE.Audio;
  explosionSound: THREE.PositionalAudio;
  explosionPlayed: boolean;
  startSequence: StartSequence;
  introDone: boolean;
  targetCube: THREE.Mesh;
  directionArrows: DirectionArrows;
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
  const initialColor = "#0037ff";
  const world = new CircuitWorld(
    ctx.scene,
    player.rig.position,
    initialColor,
    initialDensity,
  );

  // GridExplosionLogic: Flottes Punktraster, das sich auf Wunsch zu einer
  // geordneten Matrix formiert (oder wieder in die Streuung zurückfällt).
  const gridExplosion = new GridExplosionLogic({
    gridSize: 100,
    spacing: 0.6,
    dotRadius: 0.2,
    scatterPower: 80,
    dispersionZ: 35,
    blobRadius: 18,
    color: initialColor,
  });

  // Mesh vor den Spieler setzen, sodass es im Vorbeiflug sichtbar wird.
  const explosionMesh = gridExplosion.getMesh();
  const cubeMesh = gridExplosion.getCubeMesh();

  const gridPos = new THREE.Vector3(0, 30, -200);

  if (explosionMesh) {
    explosionMesh.position.copy(gridPos);
    explosionMesh.frustumCulled = false;
    ctx.scene.add(explosionMesh);
  }

  if (cubeMesh) {
    cubeMesh.position.copy(gridPos);
    cubeMesh.frustumCulled = false;
    ctx.scene.add(cubeMesh);
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
        "/experiences/circuit/Sound/background.mp3",
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
      "Background audio not loaded — place static/experiences/circuit/Sound/background.mp3",
    );
  }

  // ── Explosion Sound (PositionalAudio on grid mesh) ──
  const explosionSound = new THREE.PositionalAudio(audioListener);
  const explosionAudioLoader = new THREE.AudioLoader();
  try {
    const explosionBuffer = await new Promise<AudioBuffer>(
      (resolve, reject) => {
        explosionAudioLoader.load(
          "/experiences/circuit/Sound/explosion.mp3",
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
      "Explosion sound not loaded — place static/experiences/circuit/Sound/explosion.mp3",
    );
  }

  // ── Start Sequence ──
  const startSequence = new StartSequence();
  player.camera.add(startSequence.group);
  startSequence.start();

  // ── Target Cube ──
  // Ein einfacher Würfel als stationäres Zielobjekt, auf das der Pfeil zeigt.
  const targetCube = new THREE.Mesh(
    new THREE.BoxGeometry(3, 3, 3),
    new THREE.MeshBasicMaterial({ color: 0xff3366 }),
  );
  targetCube.position.set(10, 8, -20);
  ctx.scene.add(targetCube);

  // ── Direction Arrow ──
  // Der Pfeil wird neben dem Spieler positioniert und im tick() jeden Frame
  // auf den Würfel ausgerichtet. `create()` ist async, weil das glTF-Modell
  // erst zur Laufzeit geladen werden muss.
  const directionArrows = await DirectionArrows.create(0xa30505);
  directionArrows.group.position.set(0, 8, -10);
  ctx.scene.add(directionArrows.group);

  return {
    world,
    player,
    camera: player.camera,
    gridExplosion,
    audioListener,
    backgroundAudio,
    explosionSound,
    explosionPlayed: false,
    startSequence,
    introDone: false,
    targetCube,
    directionArrows,
  };
}

export function tick(
  state: ExperienceState,
  ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
  const s = state as CircuitState;

  // ── Start Sequence ──
  if (!s.introDone) {
    s.startSequence.update(ctx.elapsed);
    if (s.startSequence.done) {
      s.introDone = true;
      s.startSequence.group.removeFromParent();
      s.startSequence.dispose();
    }
    return { state: s };
  }

  // Spieler-Physik basierend auf der Frametime (delta) berechnen
  s.player.tick(ctx.delta);

  // Übergibt die aktuelle Position des Spielers an das Chunk-Management
  s.world.update(s.player.rig.position, ctx.delta);

  // Pfeil auf den Zielwürfel ausrichten
  s.directionArrows.pointAt(s.targetCube);

  // GridExplosion: Partikel sind gebündelt und fliegen explosionsartig
  // auseinander, sobald sich der Spieler dem Grid nähert.
  const explosionProgress = computeExplosionProgress(s);
  s.gridExplosion.update(explosionProgress, ctx.delta);

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

  if (s.startSequence) {
    s.startSequence.group.removeFromParent();
    s.startSequence.dispose();
  }
  s.backgroundAudio.stop();
  s.explosionSound.stop();
  if (s.explosionSound.parent) {
    s.explosionSound.parent.remove(s.explosionSound);
  }
  s.audioListener.remove();

  s.world.dispose();
  scene.remove(s.player.rig);

  // Target Cube entfernen
  scene.remove(s.targetCube);
  s.targetCube.geometry.dispose();
  if (Array.isArray(s.targetCube.material)) {
    s.targetCube.material.forEach((mat) => mat.dispose());
  } else {
    s.targetCube.material.dispose();
  }

  // Direction Arrow entfernen
  scene.remove(s.directionArrows.group);
  s.directionArrows.dispose();

  // Cube-Mesh entfernen
  const cubeMesh = s.gridExplosion.getCubeMesh();
  if (cubeMesh) {
    scene.remove(cubeMesh);
    cubeMesh.geometry.dispose();
    if (Array.isArray(cubeMesh.material)) {
      cubeMesh.material.forEach((mat) => mat.dispose());
    } else {
      cubeMesh.material.dispose();
    }
  }

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
