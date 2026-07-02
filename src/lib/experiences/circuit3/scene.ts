import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { FlightPlayer } from "$lib/three/player";
import { CAMERA, FLIGHT } from "$lib/config/flight";
import { ChunkManager, CHUNK_SIZE } from "./ChunkManager";
import { LevelState } from "./levelState";
import { StationManager } from "./stations";
import { EnvironmentRegistry } from "./environments/registry";

// ── State ──────────────────────────────────────────────────────────────────

export interface WFCState extends ExperienceState {
  camera:          THREE.PerspectiveCamera;
  player:          FlightPlayer;
  chunkManager:    ChunkManager;
  environments:    EnvironmentRegistry;
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
  // Black overlay fade used to hide the environment swap on a level change.
  fadeMesh:        THREE.Mesh;
  fadeMaterial:    THREE.MeshBasicMaterial;
  fade:            number;            // 0 = clear, 1 = fully black
  fadeTarget:      number;            // where the fade is heading
  pendingSwapLevel: number | null;    // level to swap the environment to at full black
  // Legacy fields kept so manifest parameter defaults still compile
  gridSize:        number;
  cellSize:        number;
  _needsRebuild?:  boolean;
}

/** Duration (seconds) of the neon color cross-fade on a level change. */
const COLOR_TRANSITION_SECONDS = 2.5;
/** Duration (seconds) of one direction of the black fade (out, then in). */
const FADE_SECONDS = 0.4;

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

/**
 * Advance the black transition overlay. When a level change is pending and the
 * screen reaches full black, swap the environment (which rebuilds the whole
 * world) and start fading back in — so the player never sees the old world
 * disappear or the new one pop into place.
 */
function updateFade(s: WFCState, delta: number): void {
  const step = delta / FADE_SECONDS;
  if (s.fade < s.fadeTarget) s.fade = Math.min(s.fadeTarget, s.fade + step);
  else if (s.fade > s.fadeTarget) s.fade = Math.max(s.fadeTarget, s.fade - step);

  if (s.pendingSwapLevel !== null && s.fade >= 1) {
    const level = s.pendingSwapLevel;
    s.pendingSwapLevel = null;
    // Swap to this level's environment (its own tiles / materials / look) and
    // force a full regeneration behind the black screen.
    const env = s.environments.forLevel(level, new THREE.Color(s.neonColor));
    s.chunkManager.setEnvironment(env, {
      buildingDensity: s.buildingDensity,
      traceComplexity: s.traceComplexity,
      terrainLevel:    s.terrainLevel,
    });
    s.fadeTarget = 0; // reveal the freshly built world
  }

  s.fadeMaterial.opacity = s.fade;
  s.fadeMesh.visible = s.fade > 0.001;
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
  // Keep the player above the world instead of flying through the floor/hills.
  // FlightPlayer clamps the rig to `heightSampler(x,z) + minClearance`; the
  // sampler is injected below (once chunkManager + state exist). Clearance is
  // small to match this experience's low-altitude scale (spawn y = 3).
  player.minClearance = 1.5;
  ctx.scene.add(player.rig);

  // Black fade overlay: a small unlit quad parented to the camera, always
  // filling the view. Its opacity is animated in tick() to hide the environment
  // swap on a level change. depthTest off + high renderOrder → drawn over
  // everything; sits just beyond the near plane so it's never clipped.
  const fadeMaterial = new THREE.MeshBasicMaterial({
    color:       0x000000,
    transparent: true,
    opacity:     0,
    depthTest:   false,
    depthWrite:  false,
  });
  const fadeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMaterial);
  fadeMesh.position.z = -0.2;
  fadeMesh.renderOrder = 999;
  fadeMesh.frustumCulled = false;
  fadeMesh.visible = false;
  player.camera.add(fadeMesh);

  // Level progression — tracks chunks flown + stations visited, advances
  // the world through its three narrative levels.
  const levelState = new LevelState();

  // Stations — unique per-level anchors with trigger volumes. Entering a
  // station's trigger marks it visited, which feeds the progression rule.
  const stationManager = new StationManager(ctx.scene);
  stationManager.onVisit = (level) => levelState.markStationVisited(level);

  // Environments — one per level, cached (see registry.ts). Level 0 uses the
  // circuit environment; the manager swaps the active one on a level change.
  const environments = new EnvironmentRegistry();
  const environment = environments.forLevel(0, new THREE.Color(neonColorStr));

  // Chunk manager — generic streaming driver around the player. Every newly
  // explored chunk feeds the level-progression counter, and the station manager
  // decides if/where each chunk hosts its level's station.
  const chunkManager = new ChunkManager(
    ctx.scene,
    environment,
    {
      buildingDensity,
      traceComplexity,
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
    environments,
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
    fadeMesh,
    fadeMaterial,
    fade:            0,
    fadeTarget:      0,
    pendingSwapLevel: null,
    gridSize:        20,
    cellSize:        4,
  };

  // Flight collision surface: the higher of the ground plane and the active
  // environment's terrain hills at the current level. Routed through the chunk
  // manager so it always follows whichever environment is live after a swap.
  player.heightSampler = (x, z) => {
    const terrainY = chunkManager.terrainHeightAt(x, z, state.terrainLevel) ?? -Infinity;
    return Math.max(ground.position.y, terrainY);
  };

  // On a level change, fade to black and swap the environment at the darkest
  // point (see updateFade in tick). The swap replaces the whole world with the
  // new level's environment — new tiles / materials / look — not just tweaked
  // parameters.
  levelState.onLevelChange((snap) => {
    state.buildingDensity = snap.tileSet.buildingDensity;
    state.traceComplexity = snap.tileSet.traceComplexity;
    state.neonColor       = snap.tileSet.neonColor;
    state.terrainLevel    = snap.currentLevel;
    // Begin the fade-out; the actual environment swap happens at full black.
    state.pendingSwapLevel = snap.currentLevel;
    state.fadeTarget       = 1;
    // Cross-fade the neon color over time as well.
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

  // Drive the black fade + perform the environment swap at full black.
  updateFade(s, ctx.delta);

  // Handle rebuild triggered by the settings panel (structural WFC changes).
  // Level changes go through the fade/swap path above instead.
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

  // Station trigger volumes + per-frame station animation
  s.stationManager.update(playerPos, s.elapsed);

  // Keep the ground centered under the player so it always covers the view
  s.ground.position.x = playerPos.x;
  s.ground.position.z = playerPos.z;

  return { state: s };
}

// ── Lifecycle: dispose() ───────────────────────────────────────────────────

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
  const s = state as WFCState;

  s.chunkManager.dispose();
  s.environments.dispose();
  s.stationManager.dispose();

  s.fadeMesh.removeFromParent();
  s.fadeMesh.geometry.dispose();
  s.fadeMaterial.dispose();

  s.ground.geometry.dispose();
  if (s.ground.material instanceof THREE.Material) s.ground.material.dispose();
  scene.remove(s.ground);
}
