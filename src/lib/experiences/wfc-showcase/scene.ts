import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { FlightPlayer } from "$lib/three/player";
import { CAMERA } from "$lib/config/flight";
import { ChunkManager, CHUNK_SIZE } from "../circuit3/ChunkManager";
import type { Environment } from "../circuit3/environments/types";
import {
	COLOR_TRANSITION_SECONDS,
	CYCLE_SECONDS,
	FADE_SECONDS,
	TUTORIAL_DURATION,
	TUTORIAL_SPEED,
	VARIATIONS,
	type WFCVariation,
} from "./config";
import { WFCtutorial } from "./tutorial";

// ── State ──────────────────────────────────────────────────────────────────

export interface WFCState extends ExperienceState {
  camera: THREE.PerspectiveCamera;
  player: FlightPlayer;
  chunkManager: ChunkManager;
  ground: THREE.Mesh;
  ambientLight: THREE.AmbientLight;
  dirLight: THREE.DirectionalLight;
  elapsed: number;
  scene: THREE.Scene;
  // Current variation
  currentVariationIndex: number;
  currentVariation: WFCVariation;
  // Environment instances (one per variation, cached)
  environments: Map<number, Environment>;
  currentEnvironment: Environment;
  // Neon color cross-fade
  colorCurrent: THREE.Color;
  colorFrom: THREE.Color;
  colorTo: THREE.Color;
  colorProgress: number;
  // Fade overlay
  fadeMesh: THREE.Mesh;
  fadeMaterial: THREE.MeshBasicMaterial;
  fade: number;
  fadeTarget: number;
  pendingVariationIndex: number | null;
  // Cycle timer
  cycleTimer: number;
  // Settings bridge
  _needsRebuild?: boolean;
  // Scene defaults to restore on swap (some envs modify background/fog)
  savedBackground: THREE.Color | null;
  savedFogColor: THREE.Color | null;
	savedFogNear: number;
	savedFogFar: number;
	// Tutorial overlay
	tutorial: WFCtutorial;
	tutorialDone: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getOrCreateEnvironment(
  environments: Map<number, Environment>,
  index: number,
): Environment {
  let env = environments.get(index);
  if (!env) {
    env = VARIATIONS[index].factory();
    environments.set(index, env);
  }
  return env;
}

function startColorTransition(s: WFCState, target: THREE.Color): void {
  s.colorFrom.copy(s.colorCurrent);
  s.colorTo.copy(target);
  s.colorProgress = 0;
}

function updateColorTransition(s: WFCState, delta: number): void {
  if (s.colorProgress >= 1) return;
  s.colorProgress = Math.min(
    1,
    s.colorProgress + delta / COLOR_TRANSITION_SECONDS,
  );
  const t = s.colorProgress;
  const eased = t * t * (3 - 2 * t);
  s.colorCurrent.copy(s.colorFrom).lerpHSL(s.colorTo, eased);
  s.chunkManager.updateNeonColor(s.colorCurrent);
}

/**
 * Restore scene.background and fog to the saved defaults, then let the new
 * environment's init() override them if it wants to.
 */
function restoreSceneDefaults(s: WFCState): void {
  if (s.savedBackground) {
    s.scene.background = s.savedBackground;
  }
  if (s.scene.fog instanceof THREE.Fog) {
    if (s.savedFogColor) s.scene.fog.color.copy(s.savedFogColor);
    s.scene.fog.near = s.savedFogNear;
    s.scene.fog.far = s.savedFogFar;
  }
}

/**
 * Advance the black fade overlay. When a cycle swap is pending and the screen
 * reaches full black, swap the environment and start fading back in.
 */
function updateFade(s: WFCState, delta: number): void {
  const step = delta / FADE_SECONDS;
  if (s.fade < s.fadeTarget) s.fade = Math.min(s.fadeTarget, s.fade + step);
  else if (s.fade > s.fadeTarget)
    s.fade = Math.max(s.fadeTarget, s.fade - step);

  if (s.pendingVariationIndex !== null && s.fade >= 1) {
    const idx = s.pendingVariationIndex;
    s.pendingVariationIndex = null;

    const env = getOrCreateEnvironment(s.environments, idx);
    const v = VARIATIONS[idx];
    const isVolumetric = (env.verticalRadius ?? 0) > 0;

    // Restore scene defaults before the new environment's init() may modify them
    restoreSceneDefaults(s);

    // Call init() for environments that need it (scene-level setup)
    env.init?.(s.scene);

    s.currentEnvironment = env;
    s.currentVariationIndex = idx;
    s.currentVariation = v;
    s.player.baseSpeed = v.flightSpeed;

    // Hide ground for volumetric environments (player flies through 3D space)
    s.ground.visible = !isVolumetric;

    s.chunkManager.setEnvironment(env, {
      buildingDensity: v.buildingDensity,
      traceComplexity: v.traceComplexity,
      terrainLevel: 0,
    });

    s.fadeTarget = 0; // reveal
  }

  s.fadeMaterial.opacity = s.fade;
  s.fadeMesh.visible = s.fade > 0.001;
}

// ── Lifecycle: setup() ─────────────────────────────────────────────────────

export async function setup(ctx: SetupContext): Promise<WFCState> {
  const firstVariation = VARIATIONS[0];

  // Ground plane
  const groundSize = CHUNK_SIZE * 8;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshStandardMaterial({
      color: 0x0d0510,
      metalness: 0.95,
      roughness: 0.3,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.6;
  ground.receiveShadow = true;
  ctx.scene.add(ground);

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.2);
  ctx.scene.add(ambient);
  const dir = new THREE.DirectionalLight(0x4444ff, 0.3);
  dir.position.set(0, 100, 0);
  ctx.scene.add(dir);

  // Player — spawned higher for a better overview
  const player = new FlightPlayer({
    fov: CAMERA.FOV,
    near: CAMERA.NEAR,
    far: CAMERA.FAR,
    spawnPosition: { x: 0, y: 35, z: 0 },
    baseSpeed: firstVariation.flightSpeed,
    terrainSlowdown: 0.4,
  });
  player.minClearance = 1.5;
  ctx.scene.add(player.rig);

  // Black fade overlay (camera-parented, always fills the view)
  const fadeMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  const fadeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMaterial);
  fadeMesh.position.z = -0.2;
  fadeMesh.renderOrder = 999;
  fadeMesh.frustumCulled = false;
  fadeMesh.visible = false;
  player.camera.add(fadeMesh);

  // Save scene defaults (some environments modify background/fog in init())
  const savedBackground =
    ctx.scene.background instanceof THREE.Color
      ? ctx.scene.background.clone()
      : null;
  const savedFogColor =
    ctx.scene.fog instanceof THREE.Fog ? ctx.scene.fog.color.clone() : null;
  const savedFogNear =
    ctx.scene.fog instanceof THREE.Fog ? ctx.scene.fog.near : 50;
  const savedFogFar =
    ctx.scene.fog instanceof THREE.Fog ? ctx.scene.fog.far : 300;

  // First environment
  const environments = new Map<number, Environment>();
  const environment = getOrCreateEnvironment(environments, 0);
  environment.init?.(ctx.scene);

  // Chunk manager — radius 1 so chunks appear close to the player
  // and the growth animation is clearly visible
  const chunkManager = new ChunkManager(
    ctx.scene,
    environment,
    {
      buildingDensity: firstVariation.buildingDensity,
      traceComplexity: firstVariation.traceComplexity,
      terrainLevel: 0,
    },
    undefined, // no level-progression callback
    undefined, // no station policy
    1, // renderRadius — small so chunks build in front of the player
  );

	const isVolumetric = (environment.verticalRadius ?? 0) > 0;
	if (isVolumetric) ground.visible = false;

	// Tutorial overlay — shows WFC visualization for the first variation
	const tutorial = new WFCtutorial(TUTORIAL_DURATION);
	tutorial.mount();
	// Start with reduced speed during tutorial
	player.baseSpeed = TUTORIAL_SPEED;

	const state: WFCState = {
		player,
		camera: player.camera,
		chunkManager,
		ground,
		ambientLight: ambient,
		dirLight: dir,
		scene: ctx.scene,
		elapsed: 0,
		currentVariationIndex: 0,
		currentVariation: firstVariation,
		environments,
		currentEnvironment: environment,
		colorCurrent: new THREE.Color(firstVariation.neonColor),
		colorFrom: new THREE.Color(firstVariation.neonColor),
		colorTo: new THREE.Color(firstVariation.neonColor),
		colorProgress: 1,
		fadeMesh,
		fadeMaterial,
		fade: 0,
		fadeTarget: 0,
		pendingVariationIndex: null,
		cycleTimer: 0,
		savedBackground,
		savedFogColor,
		savedFogNear,
		savedFogFar,
		tutorial,
		tutorialDone: false,
	};

  // Flight collision surface
  player.heightSampler = (x, z) => {
    const terrainY = chunkManager.terrainHeightAt(x, z, 0) ?? -Infinity;
    const floorY = chunkManager.hasGroundFloor()
      ? ground.position.y
      : -Infinity;
    return Math.max(floorY, terrainY);
  };

  return state;
}

// ── Lifecycle: tick() ──────────────────────────────────────────────────────

export function tick(
  state: ExperienceState,
  ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
  const s = state as WFCState;
  s.elapsed += ctx.delta;

	// Player physics
	s.player.tick(ctx.delta);

	// Per-frame environment animation (dome pulse, shader uniforms, etc.)
	s.currentEnvironment.tick?.(ctx.delta, s.player.rig.position);

	// Tutorial overlay update — runs for the entire experience
	s.tutorial.update(ctx.delta, s.elapsed);
	// After the full tutorial finishes, start the cycle timer
	// so the first environment swap happens after just a few seconds
	if (s.tutorial.fullFinished && !s.tutorialDone) {
		s.tutorialDone = true;
		s.player.baseSpeed = s.currentVariation.flightSpeed;
		s.cycleTimer = CYCLE_SECONDS - 5; // first swap in 5s
	}

  // Fade overlay
  updateFade(s, ctx.delta);

  // Neon color cross-fade
  updateColorTransition(s, ctx.delta);

  // Rebuild triggered by settings panel
  if (s._needsRebuild) {
    s._needsRebuild = false;
    s.chunkManager.rebuild(
      {
        buildingDensity: s.currentVariation.buildingDensity,
        traceComplexity: s.currentVariation.traceComplexity,
        terrainLevel: 0,
      },
      s.elapsed,
    );
  }

  // Chunk streaming
  const playerPos = s.player.rig.position;
  s.chunkManager.update(playerPos, s.elapsed);

	// ── Auto-cycle timer (only after full tutorial is done) ────────
	if (s.tutorialDone && s.fadeTarget === 0 && s.pendingVariationIndex === null) {
		s.cycleTimer += ctx.delta;
		if (s.cycleTimer >= CYCLE_SECONDS) {
			s.cycleTimer = 0;
			const nextIdx = (s.currentVariationIndex + 1) % VARIATIONS.length;
			s.pendingVariationIndex = nextIdx;
			s.fadeTarget = 1;
			startColorTransition(s, new THREE.Color(VARIATIONS[nextIdx].neonColor));
		}
	}

  // Keep ground centered under the player
  if (s.ground.visible) {
    s.ground.position.x = playerPos.x;
    s.ground.position.z = playerPos.z;
  }

  return { state: s };
}

// ── Lifecycle: dispose() ───────────────────────────────────────────────────

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
  const s = state as WFCState;

	s.chunkManager.dispose();

	// Dispose tutorial overlay
	s.tutorial.dispose();

	// Dispose all cached environment instances
  for (const env of s.environments.values()) {
    env.dispose();
  }
  s.environments.clear();

  scene.remove(s.ambientLight);
  scene.remove(s.dirLight);

  s.fadeMesh.removeFromParent();
  s.fadeMesh.geometry.dispose();
  s.fadeMaterial.dispose();

  s.ground.geometry.dispose();
  if (s.ground.material instanceof THREE.Material) s.ground.material.dispose();
  scene.remove(s.ground);
}
