import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { FlightPlayer } from "$lib/three/player";
import { CAMERA, FLIGHT } from "$lib/config/flight";
import { ChunkManager, CHUNK_SIZE } from "./ChunkManager";
import { LevelState } from "./levelState";
import { StationManager } from "./stations";
import { EnvironmentRegistry } from "./environments/registry";
import type { Environment } from "./environments/types";
import { FirewallEnvironment } from "./environments/firewall/FirewallEnvironment";
import { StartSequence } from "./start-sequence";
import { EndSequence } from "./end-sequence";

const DOME_PARTICLE_COUNT = 120;

// ── State ──────────────────────────────────────────────────────────────────

export interface WFCState extends ExperienceState {
  camera: THREE.PerspectiveCamera;
  player: FlightPlayer;
  chunkManager: ChunkManager;
  environments: EnvironmentRegistry;
  levelState: LevelState;
  stationManager: StationManager;
  ground: THREE.Mesh;
  ambientLight: THREE.AmbientLight;
  dirLight: THREE.DirectionalLight;
  elapsed: number;
  // Settings exposed for applySettings / manifest
  moveSpeed: number;
  buildingDensity: number;
  traceComplexity: number;
  neonColor: string;
  terrainLevel: number; // current level → drives terrain amplitude
  animateData: boolean;
  // Neon color cross-fade (smooth transition between levels)
  colorCurrent: THREE.Color;
  colorFrom: THREE.Color;
  colorTo: THREE.Color;
  colorProgress: number;
  // Black overlay fade used to hide the environment swap on a level change.
  fadeMesh: THREE.Mesh;
  fadeMaterial: THREE.MeshBasicMaterial;
  fade: number;
  fadeTarget: number;
  pendingSwapLevel: number | null;
  currentEnvironment: Environment;
  /** Scene reference for dynamically adding/removing objects. */
  scene: THREE.Scene;
  // Network (L1) settings
  particleCount: number;
  connectionDistance: number;
  driftSpeed: number;
  // Test cube (L0)
  testCube: THREE.Mesh | null;
  testCubeEdges: THREE.LineSegments | null;
  testCubeExploded: boolean;
  testCubeExplodeTime: number;
  testCubeFadeStart: number;
  testCubeFlyFrom: THREE.Vector3;
  testCubeFlyTo: THREE.Vector3;
  testCubeFlyDuration: number;
  testCubeTarget: THREE.Vector3;
  gameStartTime: number;
  routerSeen: boolean;
  testParticles: {
    meshes: THREE.Mesh[];
    velocities: THREE.Vector3[];
    lifetimes: Float32Array;
    maxLifetimes: Float32Array;
    blinkPhases: Float32Array;
  };
  domeTarget: THREE.Vector3;
  domeSeen: boolean;
  domeSpawned: boolean;
  domeGatherProgress: number;
  domeSpawnTime: number;
  domeParticles: {
    meshes: THREE.Mesh[];
    velocities: THREE.Vector3[];
    lifetimes: Float32Array;
    maxLifetimes: Float32Array;
    blinkPhases: Float32Array;
  };
  // Legacy fields kept so manifest parameter defaults still compile
  gridSize: number;
  cellSize: number;
  _needsRebuild?: boolean;
  /** Set once when the L3 dome exit fires, so it only triggers once. */
  _domeExitTriggered: boolean;
  /** Timer for L2 time-based transition. */
  _l2Timer: number;
  /** Pending teleport position (applied when fade is complete) */
  _pendingTeleport: THREE.Vector3 | null;
  /** End sequence state */
  endSequence: EndSequence | null;
  endSequenceStarted: boolean;
  /** Intro fade in progress (swap level 0 = intro, no env swap needed) */
  introFadeDone: boolean;
  // Audio
  audioListener: THREE.AudioListener;
  bgAudios: THREE.Audio<AudioNode>[];
  currentBgAudio: number;
  /** Outgoing track index during a cross-fade (-1 = none). */
  bgPrevAudio: number;
  bgFadeProgress: number;
  bgFadeDuration: number;
  narrationAudios: THREE.Audio<AudioNode>[];
  currentNarration: number;
  // Intro sequence
  introDone: boolean;
  startSequence: StartSequence;
}

/** Duration (seconds) of the neon color cross-fade on a level change. */
const COLOR_TRANSITION_SECONDS = 2.5;
/** Duration (seconds) of one direction of the black fade (out, then in). */
const FADE_SECONDS = 1.2;
/** Peak volume of a background music track (kept quiet under the narration). */
const BG_MAX_VOLUME = 0.15;
/**
 * When a ground-based level swaps in, the player is snapped down to this height
 * above the surface — but only if they arrive higher than GROUND_ENTRY_MAX.
 * A volumetric level (neural net / fiber tunnel) lets the player gain unlimited
 * altitude and the flight clamp is a floor only, so without this the tunnel
 * altitude carries into the flat level and strands the player far above ground.
 */
const GROUND_ENTRY_HEIGHT = 12;
/** Above this height over the surface, a ground-level entry triggers the snap. */
const GROUND_ENTRY_MAX = 40;

/** Begin fading the neon color toward `target` from whatever is shown now. */
function startColorTransition(s: WFCState, target: THREE.Color): void {
  s.colorFrom.copy(s.colorCurrent);
  s.colorTo.copy(target);
  s.colorProgress = 0;
}

/** Cross-fade background audio to a new level track. */
function startBgAudio(s: WFCState, level: number): void {
  if (s.currentBgAudio === level) return;

  // A previous cross-fade may still be running. We can only fade one pair at a
  // time, so hard-stop that leftover outgoing track before starting the new one.
  if (s.bgPrevAudio >= 0 && s.bgPrevAudio !== level) {
    const stale = s.bgAudios[s.bgPrevAudio];
    if (stale && stale.isPlaying) stale.stop();
  }

  // The current track becomes the outgoing one — keep it PLAYING so the fade
  // below can take it down to silence instead of a hard cut.
  s.bgPrevAudio = s.currentBgAudio;

  // Start the incoming track at silence (unless it's already the one fading out,
  // in which case let it keep its current volume and just reverse direction).
  const next = s.bgAudios[level];
  if (next && !next.isPlaying) {
    next.setVolume(0);
    next.play();
  }

  // Begin the cross-fade: incoming 0→1, outgoing 1→0 (see updateBgFade).
  s.bgFadeProgress = 0;
  s.currentBgAudio = level;
}

/** Start narration for a level (stop/start). */
function startNarration(s: WFCState, level: number): void {
  if (s.currentNarration === level) return;
  // Stop previous
  if (s.currentNarration >= 0) {
    const prev = s.narrationAudios[s.currentNarration];
    if (prev && prev.isPlaying) prev.stop();
  }
  // Start new
  s.currentNarration = level;
  const next = s.narrationAudios[level];
  if (next) next.play();
}

/** Advance the background audio cross-fade each frame. */
function updateBgFade(s: WFCState, delta: number): void {
  if (s.bgFadeProgress >= 1) {
    // Fade already finished — make sure the outgoing track is fully stopped and
    // released so it doesn't linger silently in the mix.
    if (s.bgPrevAudio >= 0) {
      const prev = s.bgAudios[s.bgPrevAudio];
      if (prev && prev.isPlaying) prev.stop();
      s.bgPrevAudio = -1;
    }
    return;
  }
  s.bgFadeProgress = Math.min(
    1,
    s.bgFadeProgress + delta / s.bgFadeDuration,
  );
  const t = s.bgFadeProgress;
  const eased = t * t * (3 - 2 * t); // smoothstep

  // Incoming track fades up to full volume …
  const current = s.bgAudios[s.currentBgAudio];
  if (current && current.isPlaying) current.setVolume(eased * BG_MAX_VOLUME);

  // … while the outgoing track fades down at the same time (true cross-fade).
  if (s.bgPrevAudio >= 0) {
    const prev = s.bgAudios[s.bgPrevAudio];
    if (prev && prev.isPlaying) prev.setVolume((1 - eased) * BG_MAX_VOLUME);
  }
}

/** Advance the neon color cross-fade and push the result to the materials. */
function updateColorTransition(s: WFCState, delta: number): void {
  if (s.colorProgress >= 1) return;
  s.colorProgress = Math.min(
    1,
    s.colorProgress + delta / COLOR_TRANSITION_SECONDS,
  );
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
  else if (s.fade > s.fadeTarget)
    s.fade = Math.max(s.fadeTarget, s.fade - step);

  if (s.pendingSwapLevel !== null && s.fade >= 1) {
    const level = s.pendingSwapLevel;
    s.pendingSwapLevel = null;

    // Intro fade: remove canvas and start audio (no environment swap needed)
    if (!s.introFadeDone) {
      s.introFadeDone = true;
      if (s.startSequence) {
        s.startSequence.group.removeFromParent();
        s.startSequence.dispose();
      }
      startBgAudio(s, 0);
      startNarration(s, 0);
    } else {
      // Level transition: swap environment
      s.currentEnvironment.dispose?.();
      const env = s.environments.forLevel(level, new THREE.Color(s.neonColor));
      env.init?.(s.scene);
      s.currentEnvironment = env;
      s.chunkManager.setEnvironment(env, {
        buildingDensity: s.buildingDensity,
        traceComplexity: s.traceComplexity,
        terrainLevel: s.terrainLevel,
        particleCount: s.particleCount,
        connectionDistance: s.connectionDistance,
        driftSpeed: s.driftSpeed,
      });
    }

    s.fadeTarget = 0; // reveal

    // Apply pending teleport while screen is still black. An explicit teleport
    // (e.g. the L4 dome center) sets the position outright and wins.
    if (s._pendingTeleport) {
      s.player.rig.position.copy(s._pendingTeleport);
      s._pendingTeleport = null;
    } else if (s.chunkManager.hasGroundFloor()) {
      // Otherwise, if the new level is ground-based, catch the case where the
      // player carried altitude out of a volumetric level (see GROUND_ENTRY_*):
      // snap them back down to a sane cruising height if they arrive far above
      // the ground. Done while the screen is black so the drop is unseen.
      const p = s.player.rig.position;
      const floor = s.player.heightSampler?.(p.x, p.z) ?? 0;
      if (p.y > floor + GROUND_ENTRY_MAX) {
        p.y = floor + GROUND_ENTRY_HEIGHT;
      }
    }
  }

  s.fadeMaterial.opacity = s.fade;
  s.fadeMesh.visible = s.fade > 0.001;
}

// ── Lifecycle: setup() ─────────────────────────────────────────────────────

export async function setup(ctx: SetupContext): Promise<WFCState> {
  const neonColorStr = "#00ff66";
  const buildingDensity = 0.3;
  const traceComplexity = 0.6;

  // Large dark ground plane — fog hides the edge so size just needs to
  // cover the render radius plus a margin
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
  // Sit just below the terrain overlay's shallow troughs so the two opaque
  // dark surfaces don't z-fight where the heightfield dips through y = 0.
  ground.position.y = -0.6;
  ground.receiveShadow = true;
  ctx.scene.add(ground);

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.2);
  ctx.scene.add(ambient);
  const dir = new THREE.DirectionalLight(0x4444ff, 0.3);
  dir.position.set(0, 100, 0);
  ctx.scene.add(dir);

  // Test cube at fixed world position
  const testCubeMat = new THREE.MeshStandardMaterial({
    color: 0x00ff66,
    emissive: 0x00ff66,
    emissiveIntensity: 0.4,
    metalness: 0.6,
    roughness: 0.2,
  });
  const testCube = new THREE.Mesh(
    new THREE.BoxGeometry(14, 14, 14),
    testCubeMat,
  );
  testCube.position.set(15, 5, 30);
  ctx.scene.add(testCube);

  const testCubeEdgeMat = new THREE.LineBasicMaterial({
    color: 0x00ff66,
    transparent: true,
    opacity: 0.9,
  });
  const testCubeEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(14, 14, 14)),
    testCubeEdgeMat,
  );
  testCubeEdges.position.copy(testCube.position);
  ctx.scene.add(testCubeEdges);

  // Pre-allocate particle cubes for test cube explosion
  const PARTICLE_COUNT = 120;
  const testParticleVelocities: THREE.Vector3[] = [];
  const testParticleLifetimes = new Float32Array(PARTICLE_COUNT);
  const testParticleMaxLifetimes = new Float32Array(PARTICLE_COUNT);
  const testParticleMeshes: THREE.Mesh[] = [];
  const testParticleBlinkPhases = new Float32Array(PARTICLE_COUNT);
  const particleCubeMat = new THREE.MeshStandardMaterial({
    color: 0x00ff66,
    emissive: 0x00ff66,
    emissiveIntensity: 1,
  });
  const particleCubeGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    testParticleVelocities.push(new THREE.Vector3(0, 0, 0));
    testParticleLifetimes[i] = 0;
    testParticleMaxLifetimes[i] = 1;
    testParticleBlinkPhases[i] = Math.random() * Math.PI * 2;
    const mesh = new THREE.Mesh(
      particleCubeGeo.clone(),
      particleCubeMat.clone(),
    );
    mesh.visible = false;
    ctx.scene.add(mesh);
    testParticleMeshes.push(mesh);
  }

  // Pre-allocate dome particles (L3 — white cubes flying to dome)
  const domeParticleVelocities: THREE.Vector3[] = [];
  const domeParticleLifetimes = new Float32Array(DOME_PARTICLE_COUNT);
  const domeParticleMaxLifetimes = new Float32Array(DOME_PARTICLE_COUNT);
  const domeParticleMeshes: THREE.Mesh[] = [];
  const domeParticleBlinkPhases = new Float32Array(DOME_PARTICLE_COUNT);
  const domeParticleMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 1,
  });
  const domeParticleGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  for (let i = 0; i < DOME_PARTICLE_COUNT; i++) {
    domeParticleVelocities.push(new THREE.Vector3(0, 0, 0));
    domeParticleLifetimes[i] = 0;
    domeParticleMaxLifetimes[i] = 1;
    domeParticleBlinkPhases[i] = Math.random() * Math.PI * 2;
    const mesh = new THREE.Mesh(
      domeParticleGeo.clone(),
      domeParticleMat.clone(),
    );
    mesh.visible = false;
    ctx.scene.add(mesh);
    domeParticleMeshes.push(mesh);
  }

  // Player
  const player = new FlightPlayer({
    fov: CAMERA.FOV,
    near: CAMERA.NEAR,
    far: CAMERA.FAR,
    spawnPosition: { x: 0, y: 3, z: 0 },
    // Flightspeed config -> oder einfach FLIGHT.BASE_SPEED, aber das war zu schnell, also hab ichs auf 10 gesetzt, damit man die Stationen auch mal sehen kann
    baseSpeed: 10,
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

  // ── Start Sequence ────────────────────────────────────────────────
  const startSequence = new StartSequence();
  player.camera.add(startSequence.group);
  startSequence.start();

  // ── Audio ────────────────────────────────────────────────────────────────
  const audioListener = new THREE.AudioListener();
  player.camera.add(audioListener);
  const audioLoader = new THREE.AudioLoader();

  // Background music — 1.mp3 to 7.mp3, loop, quiet, cross-fade on level change
  const bgAudios: THREE.Audio<AudioNode>[] = [];
  for (let i = 1; i <= 7; i++) {
    try {
      const buf = await new Promise<AudioBuffer>((resolve, reject) => {
        audioLoader.load(`/Audio/${i}.mp3`, resolve, undefined, reject);
      });
      const audio = new THREE.Audio(audioListener);
      audio.setBuffer(buf);
      audio.setLoop(true);
      audio.setVolume(0);
      bgAudios.push(audio);
    } catch {
      console.warn(`BG audio not loaded — place static/Audio/${i}.mp3`);
      bgAudios.push(null as unknown as THREE.Audio<AudioNode>);
    }
  }

  // Narration — 01.mp3 to 07.mp3, plays on level change, stop/start
  const narrationAudios: THREE.Audio<AudioNode>[] = [];
  for (let i = 0; i < 7; i++) {
    try {
      const buf = await new Promise<AudioBuffer>((resolve, reject) => {
        audioLoader.load(
          `/Audio/${String(i + 1).padStart(2, "0")}.mp3`,
          resolve,
          undefined,
          reject,
        );
      });
      const audio = new THREE.Audio(audioListener);
      audio.setBuffer(buf);
      audio.setLoop(false);
      audio.setVolume(0.8);
      narrationAudios.push(audio);
    } catch {
      console.warn(`Narration audio not loaded — place static/Audio/${String(i + 1).padStart(2, "0")}.mp3`);
      narrationAudios.push(null as unknown as THREE.Audio<AudioNode>);
    }
  }

  // Don't play yet — starts after intro sequence
  let currentBgAudio = -1;
  let currentNarration = -1;

  // Level progression — tracks chunks flown + stations visited, advances
  // the world through its three narrative levels.
  const levelState = new LevelState();

  // Stations — unique per-level anchors with trigger volumes. Entering a
  // station's trigger marks it visited, which feeds the progression rule.
  const stationManager = new StationManager(ctx.scene);
  stationManager.onVisit = (level) => {
    levelState.markStationVisited(level);
    // Trigger end sequence when visiting the final station (L6)
    if (level === 6 && !state.endSequenceStarted) {
      const endSeq = new EndSequence();
      endSeq.start();
      state.endSequence = endSeq;
      state.endSequenceStarted = true;
      player.camera.add(endSeq.group);
    }
  };
  stationManager.onStationPlaced = (pos, level) => {
    if (level === 0 || level === 1) {
      state.testCubeTarget.copy(pos);
      state.testCubeTarget.y += 20;
      state.routerSeen = true;
    }
    if (level === 3) {
      state.domeTarget.copy(pos);
      state.domeTarget.y += 20;
      state.domeSeen = true;
    }
  };

  // Environments — one per level, cached (see registry.ts). Level 0 uses the
  // circuit environment; the manager swaps the active one on a level change.
  const environments = new EnvironmentRegistry();
  const environment = environments.forLevel(0, new THREE.Color(neonColorStr));
  environment.init?.(ctx.scene);

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
    camera: player.camera,
    chunkManager,
    environments,
    currentEnvironment: environment,
    levelState,
    stationManager,
    ground,
    ambientLight: ambient,
    dirLight: dir,
    scene: ctx.scene,
    elapsed: 0,
    moveSpeed: 8,
    buildingDensity,
    traceComplexity,
    neonColor: neonColorStr,
    terrainLevel: levelState.currentLevel,
    animateData: true,
    colorCurrent: new THREE.Color(neonColorStr),
    colorFrom: new THREE.Color(neonColorStr),
    colorTo: new THREE.Color(neonColorStr),
    colorProgress: 1,
    fadeMesh,
    fadeMaterial,
    fade: 0,
    fadeTarget: 0,
    pendingSwapLevel: null,
    particleCount: 100,
    connectionDistance: 60,
    driftSpeed: 12,
    testCube,
    testCubeEdges,
    testCubeExploded: false,
    testCubeExplodeTime: 13,
    testCubeFadeStart: 0,
    testCubeFlyFrom: new THREE.Vector3(15, 5, 30),
    testCubeFlyTo: new THREE.Vector3(0, 20, -150),
    testCubeFlyDuration: 6,
    testCubeTarget: new THREE.Vector3(0, 20, -250),
    gameStartTime: 0,
    routerSeen: false,
    testParticles: {
      meshes: testParticleMeshes,
      velocities: testParticleVelocities,
      lifetimes: testParticleLifetimes,
      maxLifetimes: testParticleMaxLifetimes,
      blinkPhases: testParticleBlinkPhases,
    },
    domeTarget: new THREE.Vector3(0, 20, -250),
    domeSeen: false,
    domeSpawned: false,
    domeGatherProgress: 0,
    domeSpawnTime: 0,
    domeParticles: {
      meshes: domeParticleMeshes,
      velocities: domeParticleVelocities,
      lifetimes: domeParticleLifetimes,
      maxLifetimes: domeParticleMaxLifetimes,
      blinkPhases: domeParticleBlinkPhases,
    },
    gridSize: 20,
    cellSize: 4,
    _domeExitTriggered: false,
    _l2Timer: 0,
    _pendingTeleport: null,
    endSequence: null,
    endSequenceStarted: false,
    introFadeDone: false,
    audioListener,
    bgAudios,
    currentBgAudio,
    bgPrevAudio: -1,
    bgFadeProgress: 1,
    bgFadeDuration: 2.0,
    narrationAudios,
    currentNarration,
    introDone: false,
    startSequence,
  };

  // Flight collision surface: the higher of the ground plane and the active
  // environment's terrain hills at the current level. Routed through the chunk
  // manager so it always follows whichever environment is live after a swap.
  player.heightSampler = (x, z) => {
    const terrainY =
      chunkManager.terrainHeightAt(x, z, state.terrainLevel) ?? -Infinity;
    const floorY = chunkManager.hasGroundFloor() ? ground.position.y : -Infinity;
    return Math.max(floorY, terrainY);
  };

  // On a level change, fade to black and swap the environment at the darkest
  // point (see updateFade in tick). The swap replaces the whole world with the
  // new level's environment — new tiles / materials / look — not just tweaked
  // parameters.
  levelState.onLevelChange((snap) => {
    state.buildingDensity = snap.tileSet.buildingDensity;
    state.traceComplexity = snap.tileSet.traceComplexity;
    state.neonColor = snap.tileSet.neonColor;
    state.terrainLevel = snap.currentLevel;
    // Begin the fade-out; the actual environment swap happens at full opacity.
    state.pendingSwapLevel = snap.currentLevel;
    state.fadeTarget = 1;
    // Per-level transition color: L2→L3 white flash, L3→L4 red, rest black.
    const fadeColors: Record<number, number> = { 3: 0xffffff, 4: 0xff2222 };
    state.fadeMaterial.color.set(fadeColors[snap.currentLevel] ?? 0x000000);
    // Cross-fade the neon color over time as well.
    startColorTransition(state, new THREE.Color(snap.tileSet.neonColor));
    // The new level's station becomes eligible to spawn.
    stationManager.setLevel(snap.currentLevel);
    // Adjust flight speed per level.
    const speeds = [10, 10, 12, 10, 4, 8, 14]; // L2 fast through tunnel, L4 slow inside firewall, L5 moderate, L6 fast finale
    const speed = speeds[snap.currentLevel] ?? 10;
    state.player.baseSpeed = speed;
    // Reset dome particle flags when entering L3.
    if (snap.currentLevel === 3) {
      state.domeSpawned = false;
      state.domeSeen = false;
      state.domeGatherProgress = 0;
      state.domeSpawnTime = 0;
    }
    // Ground color: dark red inside the firewall, default otherwise.
    const gmat = state.ground.material as THREE.MeshStandardMaterial;
    if (snap.currentLevel === 4) {
      gmat.color.set(0x1a0505);
      // Teleport player to dome center after fade completes.
      state._pendingTeleport = new THREE.Vector3(0, 3, 0);
    } else {
      gmat.color.set(0x0d0510);
    }
    // Reset dome exit flag when leaving L4 so a restart works cleanly.
    if (snap.currentLevel !== 4) {
      state._domeExitTriggered = false;
    }
    // Hide test cube + particles when leaving L0.
    if (snap.currentLevel !== 0) {
      if (state.testCube) state.testCube.visible = false;
      if (state.testCubeEdges) state.testCubeEdges.visible = false;
      for (const mesh of state.testParticles.meshes) {
        mesh.visible = false;
      }
    }
    // Cross-fade to the new level's background music
    startBgAudio(state, snap.currentLevel);
    // Switch narration to the new level's track
    startNarration(state, snap.currentLevel);
  });

  return state;
}

// ── Lifecycle: tick() ──────────────────────────────────────────────────────

export function tick(
  state: ExperienceState,
  ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
  const s = state as WFCState;
  s.elapsed += ctx.delta;

  // ── Start Sequence ──────────────────────────────────────────────
  if (!s.introDone) {
    s.startSequence.update(ctx.delta);
    if (s.startSequence.done) {
      s.introDone = true;
      s.gameStartTime = s.elapsed;
      // Fade to black, then reveal the game
      s.fadeTarget = 1;
      s.pendingSwapLevel = 0;
    }
    return { state: s };
  }

  // ── End Sequence ─────────────────────────────────────────────
  if (s.endSequence && !s.endSequence.done) {
    s.endSequence.update(ctx.delta);
    if (s.endSequence.done) {
      s.endSequence.group.removeFromParent();
      s.endSequence.dispose();
      s.endSequence = null;
    }
    return { state: s };
  }

  s.player.tick(ctx.delta);
  s.currentEnvironment.tick?.(ctx.delta, s.player.rig.position);

  // Drive the black fade + perform the environment swap at full black.
  updateFade(s, ctx.delta);

  // Cross-fade background audio
  updateBgFade(s, ctx.delta);

  // Handle rebuild triggered by the settings panel (structural WFC changes).
  // Level changes go through the fade/swap path below instead.
  if (s._needsRebuild) {
    s._needsRebuild = false;
    s.chunkManager.rebuild(
      {
        buildingDensity: s.buildingDensity,
        traceComplexity: s.traceComplexity,
        terrainLevel: s.terrainLevel,
        particleCount: s.particleCount,
        connectionDistance: s.connectionDistance,
        driftSpeed: s.driftSpeed,
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
  s.stationManager.update(playerPos, s.elapsed, ctx.delta);

  // ── Dome exit trigger (L4 → L5) ─────────────────────────────────
  if (
    s.terrainLevel === 4 &&
    !s._domeExitTriggered &&
    s.currentEnvironment instanceof FirewallEnvironment
  ) {
    const dist = playerPos.distanceTo(s.currentEnvironment.domeCenter);
    if (dist > s.currentEnvironment.domeRadius) {
      s._domeExitTriggered = true;
      s.levelState.forceAdvance();
    }
  }

  // ── L2 time-based trigger (30s → L3) ──────────────────────────
  if (s.terrainLevel === 2) {
    s._l2Timer += ctx.delta;
    if (s._l2Timer >= 30) {
      s._l2Timer = 0;
      s.levelState.forceAdvance();
    }
  } else {
    s._l2Timer = 0;
  }

  // ── Test cube fly-in ───────────────────────────────────────────────
  const gameTime = s.elapsed - s.gameStartTime;
  if (s.testCube && !s.testCubeExploded && gameTime < s.testCubeFlyDuration) {
    const t = gameTime / s.testCubeFlyDuration;
    const st = t * t * (3 - 2 * t);
    s.testCube.position.lerpVectors(s.testCubeFlyFrom, s.testCubeFlyTo, st);
    if (s.testCubeEdges) {
      s.testCubeEdges.position.copy(s.testCube.position);
    }
  }

  // ── Test cube rotation + fade explosion ────────────────────────────
  if (s.testCube && !s.testCubeExploded) {
    s.testCube.rotation.x += ctx.delta * 0.4;
    s.testCube.rotation.y += ctx.delta * 0.7;
    s.testCube.rotation.z += ctx.delta * 0.2;
    if (s.testCubeEdges) {
      s.testCubeEdges.rotation.copy(s.testCube.rotation);
    }

    if (gameTime >= s.testCubeExplodeTime && s.testCubeFadeStart === 0) {
      s.testCubeFadeStart = gameTime;
    }

    if (s.testCubeFadeStart > 0) {
      const t = Math.min((s.elapsed - s.testCubeFadeStart) / 0.5, 1);
      const scl = 1 - t;
      s.testCube.scale.setScalar(Math.max(scl, 0.001));
      const mat = s.testCube.material as THREE.MeshStandardMaterial;
      mat.opacity = 1 - t;
      mat.transparent = true;
      if (s.testCubeEdges) {
        s.testCubeEdges.scale.copy(s.testCube.scale);
      }
      if (t >= 1) {
        s.testCubeExploded = true;
        s.testCube.visible = false;
        if (s.testCubeEdges) s.testCubeEdges.visible = false;

        const pos = s.testCube.position;
        const p = s.testParticles;

        for (let i = 0; i < 120; i++) {
          const mesh = p.meshes[i];
          mesh.position.set(
            pos.x + (Math.random() - 0.5) * 3,
            pos.y + (Math.random() - 0.5) * 3,
            pos.z + (Math.random() - 0.5) * 3,
          );
          mesh.visible = true;
          mesh.scale.setScalar(1);

          const speed = 15 + Math.random() * 15;
          p.velocities[i].set(
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 12,
            -speed,
          );

          p.lifetimes[i] = 60 + Math.random() * 20;
          p.maxLifetimes[i] = p.lifetimes[i];
        }
      }
    }
  }

  // ── Test cube particle update ──────────────────────────────────────
  if (s.testCubeExploded && s.testParticles.meshes.length > 0) {
    const p = s.testParticles;
    const explodeTime = s.testCubeFadeStart + 0.5;
    const timeSinceExplosion = gameTime - explodeTime;
    const gatherStrength = Math.min(
      Math.max((timeSinceExplosion - 3.0) * 0.15, 0),
      1,
    );
    const tmpVec = new THREE.Vector3();
    for (let i = 0; i < 120; i++) {
      if (p.lifetimes[i] <= 0) continue;
      p.lifetimes[i] -= ctx.delta;
      if (p.lifetimes[i] <= 0) {
        p.meshes[i].visible = false;
        continue;
      }
      const vel = p.velocities[i];
      if (gatherStrength > 0) {
        const dist = p.meshes[i].position.distanceTo(s.testCubeTarget);
        if (dist > 40) {
          tmpVec.copy(s.testCubeTarget).sub(p.meshes[i].position).normalize();
          vel.add(tmpVec.multiplyScalar(gatherStrength * 3 * ctx.delta));
        } else {
          vel.multiplyScalar(0.95);
        }
      }
      p.meshes[i].position.x += vel.x * ctx.delta;
      p.meshes[i].position.y += vel.y * ctx.delta;
      p.meshes[i].position.z += vel.z * ctx.delta;
      vel.multiplyScalar(0.998);

      const t = p.lifetimes[i] / p.maxLifetimes[i];
      const scl = t < 0.15 ? t / 0.15 : 1;
      p.meshes[i].scale.setScalar(Math.max(scl, 0.01));
      p.meshes[i].rotation.x += ctx.delta * 2;
      p.meshes[i].rotation.y += ctx.delta * 3;
      const blink = 0.5 + 0.5 * Math.sin(s.elapsed * 6 + p.blinkPhases[i]);
      const mat = p.meshes[i].material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = blink;
    }

    // Respawn particles when router station is visible and all are dead
    if (s.routerSeen && s.terrainLevel === 0) {
      let allDead = true;
      for (let i = 0; i < 120; i++) {
        if (p.lifetimes[i] > 0) {
          allDead = false;
          break;
        }
      }
      if (allDead) {
        const spawnPos = s.player.rig.position.clone();
        spawnPos.z -= 30;
        const playerSpeed = s.player.baseSpeed;
        for (let i = 0; i < 120; i++) {
          const mesh = p.meshes[i];
          mesh.position.set(
            spawnPos.x + (Math.random() - 0.5) * 8,
            spawnPos.y + (Math.random() - 0.5) * 8,
            spawnPos.z + (Math.random() - 0.5) * 8,
          );
          mesh.visible = true;
          mesh.scale.setScalar(1);
          const speed = playerSpeed + 2 + Math.random() * 4;
          p.velocities[i].set(
            (Math.random() - 0.5) * 4,
            (Math.random() - 0.5) * 3,
            -speed,
          );
          p.lifetimes[i] = 90 + Math.random() * 30;
          p.maxLifetimes[i] = p.lifetimes[i];
        }
      }
    }
  }

  // ── Dome particles (L3 — white cubes flying to dome) ─────────────
  if (s.terrainLevel === 3 && s.domeParticles.meshes.length > 0) {
    const dp = s.domeParticles;

    // Spawn particles immediately when entering L3 (scatter like L0 test cube)
    if (!s.domeSpawned) {
      s.domeSpawned = true;
      s.domeSpawnTime = s.elapsed;
      const spawnPos = s.player.rig.position.clone();
      for (let i = 0; i < DOME_PARTICLE_COUNT; i++) {
        const mesh = dp.meshes[i];
        mesh.position.set(
          spawnPos.x + (Math.random() - 0.5) * 3,
          spawnPos.y + (Math.random() - 0.5) * 3,
          spawnPos.z + (Math.random() - 0.5) * 3,
        );
        mesh.visible = true;
        mesh.scale.setScalar(1);

        const speed = s.player.baseSpeed + 30 + Math.random() * 20;
        dp.velocities[i].set(
          (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 12,
          -speed,
        );

        dp.lifetimes[i] = 60 + Math.random() * 20;
        dp.maxLifetimes[i] = dp.lifetimes[i];
      }
    }

    // Gather strength — time-based with 3s delay, same as L0 test cube
    const timeSinceSpawn = s.elapsed - s.domeSpawnTime;
    const gatherStrength = Math.min(
      Math.max((timeSinceSpawn - 3.0) * 0.15, 0),
      1,
    );

    // Update dome particles
    const tmpVec = new THREE.Vector3();
    for (let i = 0; i < DOME_PARTICLE_COUNT; i++) {
      if (dp.lifetimes[i] <= 0) continue;
      dp.lifetimes[i] -= ctx.delta;
      if (dp.lifetimes[i] <= 0) {
        dp.meshes[i].visible = false;
        continue;
      }
      const vel = dp.velocities[i];
      if (gatherStrength > 0) {
        const dist = dp.meshes[i].position.distanceTo(s.domeTarget);
        if (dist > 40) {
          tmpVec.copy(s.domeTarget).sub(dp.meshes[i].position).normalize();
          vel.add(tmpVec.multiplyScalar(gatherStrength * 3 * ctx.delta));
        } else {
          vel.multiplyScalar(0.95);
        }
      }
      dp.meshes[i].position.x += vel.x * ctx.delta;
      dp.meshes[i].position.y += vel.y * ctx.delta;
      dp.meshes[i].position.z += vel.z * ctx.delta;
      vel.multiplyScalar(0.998);

      const t = dp.lifetimes[i] / dp.maxLifetimes[i];
      const scl = t < 0.15 ? t / 0.15 : 1;
      dp.meshes[i].scale.setScalar(Math.max(scl, 0.01));
      dp.meshes[i].rotation.x += ctx.delta * 2;
      dp.meshes[i].rotation.y += ctx.delta * 3;
      const blink = 0.5 + 0.5 * Math.sin(s.elapsed * 6 + dp.blinkPhases[i]);
      const mat = dp.meshes[i].material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = blink;
    }

    // Respawn when all dead and dome has been seen
    if (s.domeSeen) {
      let allDead = true;
      for (let i = 0; i < DOME_PARTICLE_COUNT; i++) {
        if (dp.lifetimes[i] > 0) {
          allDead = false;
          break;
        }
      }
      if (allDead) {
        s.domeSpawnTime = s.elapsed;
        const spawnPos = s.player.rig.position.clone();
        for (let i = 0; i < DOME_PARTICLE_COUNT; i++) {
          const mesh = dp.meshes[i];
          mesh.position.set(
            spawnPos.x + (Math.random() - 0.5) * 3,
            spawnPos.y + (Math.random() - 0.5) * 3,
            spawnPos.z + (Math.random() - 0.5) * 3,
          );
          mesh.visible = true;
          mesh.scale.setScalar(1);

          const speed = s.player.baseSpeed + 30 + Math.random() * 20;
          dp.velocities[i].set(
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 12,
            -speed,
          );

          dp.lifetimes[i] = 60 + Math.random() * 20;
          dp.maxLifetimes[i] = dp.lifetimes[i];
        }
      }
    }
  }

  // Hide dome particles when not in L3
  if (s.terrainLevel !== 3) {
    for (const mesh of s.domeParticles.meshes) {
      mesh.visible = false;
    }
  }

  // Keep the ground centered under the player so it always covers the view.
  // Hidden for volumetric environments and L5 (drain has its own floor tiles).
  s.ground.visible = s.chunkManager.hasGroundFloor() && s.terrainLevel !== 5;
  s.ground.position.x = playerPos.x;
  s.ground.position.z = playerPos.z;

  // Ground color + speed follow the L4 red→green transition.
  if (s.terrainLevel === 4 && s.currentEnvironment instanceof FirewallEnvironment) {
    const t = s.currentEnvironment.colorProgress;
    const gmat = s.ground.material as THREE.MeshStandardMaterial;
    const r = 0.10 * (1 - t) + 0.05 * t;
    const g = 0.02 * (1 - t) + 0.12 * t;
    const b = 0.02 * (1 - t) + 0.05 * t;
    gmat.color.setRGB(r, g, b);
    // Restore normal flight speed once fully green.
    if (t >= 1) s.player.baseSpeed = 10;
  }

  return { state: s };
}

// ── Lifecycle: dispose() ───────────────────────────────────────────────────

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
  const s = state as WFCState;

  // Clean up start sequence if still active
  if (!s.introDone && s.startSequence) {
    s.startSequence.group.removeFromParent();
    s.startSequence.dispose();
  }

  s.chunkManager.dispose();
  s.environments.dispose();
  s.stationManager.dispose();

  scene.remove(s.ambientLight);
  scene.remove(s.dirLight);

  s.fadeMesh.removeFromParent();
  s.fadeMesh.geometry.dispose();
  s.fadeMaterial.dispose();

  // Clean up end sequence if still active
  if (s.endSequence) {
    s.endSequence.group.removeFromParent();
    s.endSequence.dispose();
  }

  // Stop all audio
  for (const audio of s.bgAudios) {
    if (audio && audio.isPlaying) audio.stop();
  }
  for (const audio of s.narrationAudios) {
    if (audio && audio.isPlaying) audio.stop();
  }
  s.audioListener.parent?.remove(s.audioListener);

  if (s.testCube) {
    s.testCube.geometry.dispose();
    if (s.testCube.material instanceof THREE.Material)
      s.testCube.material.dispose();
    scene.remove(s.testCube);
  }
  if (s.testCubeEdges) {
    s.testCubeEdges.geometry.dispose();
    if (s.testCubeEdges.material instanceof THREE.Material)
      s.testCubeEdges.material.dispose();
    scene.remove(s.testCubeEdges);
  }
  for (const mesh of s.testParticles.meshes) {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    scene.remove(mesh);
  }
  for (const mesh of s.domeParticles.meshes) {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    scene.remove(mesh);
  }

  s.ground.geometry.dispose();
  if (s.ground.material instanceof THREE.Material) s.ground.material.dispose();
  scene.remove(s.ground);
}
