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
  animateData:     boolean;
  // Legacy fields kept so manifest parameter defaults still compile
  gridSize:        number;
  cellSize:        number;
  _needsRebuild?:  boolean;
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
    baseSpeed:     FLIGHT.BASE_SPEED,
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
    { buildingDensity, traceComplexity, neonColor: neonColorStr },
    () => levelState.notifyChunkGenerated(),
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
    animateData:     true,
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
    state._needsRebuild   = true;
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

  // Handle rebuild triggered by settings panel
  if (s._needsRebuild) {
    s._needsRebuild = false;
    s.chunkManager.rebuild(
      {
        buildingDensity: s.buildingDensity,
        traceComplexity: s.traceComplexity,
        neonColor:       s.neonColor,
      },
      s.elapsed,
    );
  }

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
