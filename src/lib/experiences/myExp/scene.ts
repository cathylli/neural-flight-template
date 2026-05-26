import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { FlightPlayer } from "$lib/three/player";
import { DataSpaceWorld } from "./world";
import { registerAllSnippets, updateTime } from "$lib/shaders";
import { createTerrainMaterial } from "../shader-demo/shaders";

// ── State ──────────────────────────────────────────────────────

export interface DataSpaceState extends ExperienceState {
  player: FlightPlayer;
  world: DataSpaceWorld;
  terrain?: { mesh: THREE.Mesh; material: THREE.ShaderMaterial };
  ambientLight: THREE.AmbientLight;
  directionalLight: THREE.DirectionalLight;
  camera: THREE.PerspectiveCamera;
  elapsed: number;
}

// ── Lifecycle: setup() ─────────────────────────────────────────

export async function setup(ctx: SetupContext): Promise<DataSpaceState> {
  registerAllSnippets();

  // 1. Player
  const player = new FlightPlayer({
    spawnPosition: { x: 0, y: 0, z: 0 },
    baseSpeed: 30,
  });
  ctx.scene.add(player.rig);

  // Initialize Fog as FogExp2 for the "Cyber-Smog" effect required by world.ts
  // Hardcoded initial values to break circular dependency with manifest.ts
  ctx.scene.fog = new THREE.FogExp2(0x0a0a1a, 0.005);

  // 2. Procedural World
  const world = new DataSpaceWorld(ctx.scene, player.rig.position);

  // 3. Shader Landscape Integration
  const terrainGeo = new THREE.PlaneGeometry(1000, 1000, 128, 128);
  terrainGeo.rotateX(-Math.PI / 2);
  
  // Initialize material and mesh
  const terrainMat = createTerrainMaterial();
  // Ensure the default height matches your manifest (0 = flat)
  terrainMat.uniforms.uTerrainHeight.value = 0;
  
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  ctx.scene.add(terrainMesh);

  // 4. Lights - Safer lookup using type strings instead of instanceof
  const ambientLight = (ctx.scene.children.find(c => (c as any).isAmbientLight) as THREE.AmbientLight) || new THREE.AmbientLight(0xffffff, 0.5);
  const directionalLight = (ctx.scene.children.find(c => (c as any).isDirectionalLight) as THREE.DirectionalLight) || new THREE.DirectionalLight(0xffffff, 0.8);

  // If they were newly created (not found), add them to the scene
  if (!ctx.scene.children.includes(ambientLight)) ctx.scene.add(ambientLight);
  if (!ctx.scene.children.includes(directionalLight)) ctx.scene.add(directionalLight);

  return {
    player,
    world,
    terrain: { mesh: terrainMesh, material: terrainMat },
    camera: player.camera,
    ambientLight,
    directionalLight,
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

  // Move shader meshes with player for "infinite" effect
  const px = s.player.rig.position.x;
  const pz = s.player.rig.position.z;

  if (s.terrain) {
    s.terrain.mesh.position.set(px, 0, pz);
    // Update Shader Uniforms
    updateTime(s.terrain.material, s.elapsed);
  }

  // Update procedural world chunks around player position
  s.world.update(s.player.rig.position, s.elapsed);

  return { state: s };
}

// ── Lifecycle: dispose() ───────────────────────────────────────

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
  const s = state as DataSpaceState;

  // Cleanup procedural world resources (geometries, materials, and chunks)
  s.world.dispose();

  // Cleanup shader terrain safely
  if (s.terrain) {
    scene.remove(s.terrain.mesh);
    s.terrain.mesh.geometry.dispose();
    s.terrain.material.dispose();
  }

  // Remove player rig from the scene
  scene.remove(s.player.rig);
}
