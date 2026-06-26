import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { FlightPlayer } from "$lib/three/player";
import { CAMERA, FLIGHT } from "$lib/config/flight";
import { ChunkManager, CHUNK_SIZE } from "./ChunkManager";
import { LevelState } from "./levelState";
import { StationManager } from "./stations";

// ── State ──────────────────────────────────────────────────────────────────

export interface WFCState extends ExperienceState {
  camera:          THREE.PerspectiveCamera;
  player:          FlightPlayer;
  chunkManager:    ChunkManager;
  levelState:      LevelState;
  stationManager:  StationManager;
  ground:          THREE.Mesh;
  elapsed:         number;
  // Settings exposed for applySettings / manifest
  moveSpeed:       number;
  buildingDensity: number;
  traceComplexity: number;
  neonColor:       string;
  terrainLevel:    number; // current level → drives terrain amplitude
  animateData:     boolean;
  // Neon color cross-fade (smooth transition between levels)
  colorCurrent:    THREE.Color; // color currently shown on the materials
  colorFrom:       THREE.Color; // color at the start of the active transition
  colorTo:         THREE.Color; // color we're fading toward
  colorProgress:   number;      // 0 → 1, reaches 1 when the fade is done
  // Legacy fields kept so manifest parameter defaults still compile
  gridSize:        number;
  cellSize:        number;
  _needsRebuild?:  boolean;
}

/** Duration (seconds) of the neon color cross-fade on a level change. */
const COLOR_TRANSITION_SECONDS = 2.5;

/** Begin fading the neon color toward `target` from whatever is shown now. */
function startColorTransition(s: WFCState, target: THREE.Color): void {
  s.colorFrom.copy(s.colorCurrent);
  s.colorTo.copy(target);
  s.colorProgress = 0;
}

/** Advance the neon color cross-fade and push the result to the materials. */
function updateColorTransition(s: WFCState, delta: number): void {
  if (s.colorProgress >= 1) return;
  s.colorProgress = Math.min(1, s.colorProgress + delta / COLOR_TRANSITION_SECONDS);
  const t = s.colorProgress;
  const eased = t * t * (3 - 2 * t); // smoothstep
  // HSL lerp sweeps through the hue wheel — nicer than a muddy RGB blend.
  s.colorCurrent.copy(s.colorFrom).lerpHSL(s.colorTo, eased);
  s.chunkManager.updateNeonColor(s.colorCurrent);
}

// ── Lifecycle: setup() ─────────────────────────────────────────────────────

export async function setup(ctx: SetupContext): Promise<WFCState> {
  const neonColorStr    = "#00ff66";
  const buildingDensity = 0.3;
  const traceComplexity = 0.6;

  // Large dark ground plane — fog hides the edge so size just needs to
  // cover the render radius plus a margin
  const groundSize = CHUNK_SIZE * 8;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshStandardMaterial({ color: 0x0D0510, metalness: 0.95, roughness: 0.3 }),
  );
  ground.rotation.x = -Math.PI / 2;
  // Sit just below the terrain overlay's shallow troughs so the two opaque
  // dark surfaces don't z-fight where the heightfield dips through y = 0.
  ground.position.y = -0.6;
  ground.receiveShadow = true;
  ctx.scene.add(ground);

  // Lights
  ctx.scene.add(new THREE.AmbientLight(0xffffff, 0.2));
  const dir = new THREE.DirectionalLight(0x4444ff, 0.3);
  dir.position.set(0, 100, 0);
  ctx.scene.add(dir);

  // Player
  const player = new FlightPlayer({
    fov:           CAMERA.FOV,
    near:          CAMERA.NEAR,
    far:           CAMERA.FAR,
    spawnPosition: { x: 0, y: 3, z: 0 },
    // Flightspeed config -> oder einfach FLIGHT.BASE_SPEED, aber das war zu schnell, also hab ichs auf 10 gesetzt, damit man die Stationen auch mal sehen kann
    baseSpeed:     10,
    terrainSlowdown: FLIGHT.TERRAIN_SLOWDOWN,
  });
  player.minClearance = -1000;
  ctx.scene.add(player.rig);

  // Level progression — tracks chunks flown + stations visited, advances
  // the world through its three narrative levels.
  const levelState = new LevelState();

  // Stations — unique per-level anchors with trigger volumes. Entering a
  // station's trigger marks it visited, which feeds the progression rule.
  const stationManager = new StationManager(ctx.scene);
  stationManager.onVisit = (level) => levelState.markStationVisited(level);

  // Chunk manager — generates the world procedurally around the player.
  // Every newly explored chunk feeds the level-progression counter, and the
  // station manager decides if/where each chunk hosts its level's station.
  const chunkManager = new ChunkManager(
    ctx.scene,
    {
      buildingDensity,
      traceComplexity,
      neonColor: neonColorStr,
      terrainLevel: levelState.currentLevel,
    },
    () => {
      levelState.notifyChunkGenerated();
      // Same signal drives the station's post-level-change spawn delay.
      stationManager.notifyChunkExplored();
    },
    stationManager,
  );

  const state: WFCState = {
    player,
    camera:          player.camera,
    chunkManager,
    levelState,
    stationManager,
    ground,
    elapsed:         0,
    moveSpeed:       8,
    buildingDensity,
    traceComplexity,
    neonColor:       neonColorStr,
    terrainLevel:    levelState.currentLevel,
    animateData:     true,
    colorCurrent:    new THREE.Color(neonColorStr),
    colorFrom:       new THREE.Color(neonColorStr),
    colorTo:         new THREE.Color(neonColorStr),
    colorProgress:   1,
    gridSize:        20,
    cellSize:        4,
  };

  // On a level change, swap in the new level's tile set and rebuild the world.
  // The rebuild is deferred to the next tick (via _needsRebuild) because this
  // listener fires synchronously from inside chunkManager.update().
  levelState.onLevelChange((snap) => {
    state.buildingDensity = snap.tileSet.buildingDensity;
    state.traceComplexity = snap.tileSet.traceComplexity;
    state.neonColor       = snap.tileSet.neonColor;
    state.terrainLevel    = snap.currentLevel;
    state._needsRebuild   = true;
    // Cross-fade the neon color over time instead of snapping it.
    startColorTransition(state, new THREE.Color(snap.tileSet.neonColor));
    // The new level's station becomes eligible to spawn.
    stationManager.setLevel(snap.currentLevel);
  });

  return state;
}

// ── Lifecycle: tick() ──────────────────────────────────────────────────────

export function tick(
  state:  ExperienceState,
  ctx:    TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
  const s = state as WFCState;
  s.elapsed += ctx.delta;

  s.player.tick(ctx.delta);

  // Handle rebuild triggered by settings panel or level change. The neon
  // color is intentionally omitted — it cross-fades separately (see below)
  // so a structural rebuild never snaps the color.
  if (s._needsRebuild) {
    s._needsRebuild = false;
    s.chunkManager.rebuild(
      {
        buildingDensity: s.buildingDensity,
        traceComplexity: s.traceComplexity,
        terrainLevel:    s.terrainLevel,
      },
      s.elapsed,
    );
  }

  // Smoothly cross-fade the neon color toward the current level's target.
  updateColorTransition(s, ctx.delta);

  // Update chunk visibility / spawn new chunks around the player
  const playerPos = s.player.rig.position;
  s.chunkManager.update(playerPos, s.elapsed);

  // Station trigger volumes — fires markStationVisited on entry
  s.stationManager.update(playerPos);

  // Keep the ground centered under the player so it always covers the view
  s.ground.position.x = playerPos.x;
  s.ground.position.z = playerPos.z;

  return { state: s };
}

// ── Lifecycle: dispose() ───────────────────────────────────────────────────

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
  const s = state as WFCState;

  s.chunkManager.dispose();
  s.stationManager.dispose();

  s.ground.geometry.dispose();
  if (s.ground.material instanceof THREE.Material) s.ground.material.dispose();
  scene.remove(s.ground);
}
