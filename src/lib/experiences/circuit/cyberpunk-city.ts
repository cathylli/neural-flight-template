import * as THREE from "three";

// ── Performance Constants ──
const MAX_BUILDINGS = 50; // Maximum buildings per chunk
const BUILDING_GRID_SIZE = 8; // Grid spacing for buildings
const GROWTH_SPEED = 2.0; // Animation speed multiplier
const CHUNK_SIZE = 200; // Match circuit world chunk size
const VIEW_DISTANCE = 2; // Chunks to render around player

// ── Building Variation ──
const BUILDING_CONFIG = {
  BASE_WIDTH: 4,
  BASE_DEPTH: 4,
  MIN_HEIGHT: 8,
  MAX_HEIGHT: 40,
  HEIGHT_VARIATION: 0.7, // How much height varies
  SCALE_VARIATION: 0.3, // How much X/Z scale varies
} as const;

// ── Neon Colors ──
const NEON_COLORS = [
  new THREE.Color(0x00ffff), // Cyan
  new THREE.Color(0xff00ff), // Magenta
  new THREE.Color(0x00ff00), // Neon Green
  new THREE.Color(0xff0080), // Hot Pink
  new THREE.Color(0x8000ff), // Electric Purple
] as const;

// ── Static Station Interface ──
interface StaticStation {
  x: number;
  z: number;
  radius: number;
}

// ── Building Instance Data ──
interface BuildingInstance {
  matrix: THREE.Matrix4;
  targetScaleY: number;
  currentScaleY: number;
  isGrowing: boolean;
  growthPhase: number;
  neonColor: THREE.Color;
}

// ── Cyberpunk Shader Material ──
// Ported from the "Cube Mesh Glow Outline" Godot shader by Turtle
// (https://godotshaders.com/shader/cube-mesh-glow-outline/).
// The Godot version inflates a unit cube via VERTEX += sign(VERTEX) * (scale-1) * 0.5
// and then uses `vs = abs(vert) - scale*0.5` to get a per-axis offset from the box
// surface, which drives both the face-fill and the edge-glow masks. We mirror the
// same math here by reading the post-instance local position (`vScaledLocal`) and
// its absolute value (`vHalfExtent`) — the corner of an instance-scaled box
// directly gives us the per-axis half extent.
function createCyberpunkMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uNeonIntensity: { value: 1.5 },
      uOutlineWidth: { value: 0.45 },
      uOutlineSharpness: { value: 0.5 },
      uGlow: { value: 3.0 },
    },
    vertexShader: `
      attribute vec3 aNeonColor;
      attribute float aGrowthPhase;

      varying vec3 vNeonColor;
      varying vec3 vScaledLocal;
      varying vec3 vHalfExtent;
      varying float vGrowthPhase;

      void main() {
        // Post-instance local position. The absolute value of any corner equals
        // the box's half-extent along that axis, which is what the outline math needs.
        vec4 transformedCorner = instanceMatrix * vec4(position, 1.0);
        vScaledLocal = transformedCorner.xyz;
        vHalfExtent = abs(transformedCorner.xyz);

        vNeonColor = aNeonColor;
        vGrowthPhase = aGrowthPhase;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformedCorner.xyz, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uNeonIntensity;
      uniform float uOutlineWidth;
      uniform float uOutlineSharpness;
      uniform float uGlow;

      varying vec3 vNeonColor;
      varying vec3 vScaledLocal;
      varying vec3 vHalfExtent;
      varying float vGrowthPhase;

      void main() {
        // Per-axis signed distance from the box face: 0 on the face,
        // negative inside the box, positive outside. Driven by the geometry's
        // own corners so it survives instancing + the growth animation.
        vec3 vs = abs(vScaledLocal) - vHalfExtent;

        float w = uOutlineWidth;
        float ws = w * uOutlineSharpness;

        // Edge glow mask: 1 right at the edge of the box, 0 in the face center.
        // Multiplying the three 2D-distance smoothsteps means the glow only
        // shows where the fragment is close to an actual cube edge in all axes.
        float edgeMask =
          (1.0 - smoothstep(ws, w, length(vs.xy))) *
          (1.0 - smoothstep(ws, w, length(vs.yz))) *
          (1.0 - smoothstep(ws, w, length(vs.xz)));

        // Subtle per-building pulse so the outlines breathe
        float pulse = 0.85 + 0.15 * sin(uTime * 2.0 + vGrowthPhase * 5.0);

        // Dark interior + bright neon edges
        vec3 interiorColor = vec3(0.01, 0.01, 0.025);
        vec3 emission = vNeonColor * edgeMask * pulse * uGlow * uNeonIntensity;

        vec3 finalColor = interiorColor + emission;

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
    transparent: false,
    side: THREE.FrontSide,
  });
}

// ── Utility Functions ──
function hash(x: number, z: number, seed: number = 0): number {
  const val = Math.sin(x * 12.9898 + z * 78.233 + seed * 137.1) * 43758.5453123;
  return val - Math.floor(val);
}

function isSpaceFree(
  x: number,
  z: number,
  staticStations: StaticStation[],
): boolean {
  for (const station of staticStations) {
    const dx = x - station.x;
    const dz = z - station.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance < station.radius) {
      return false;
    }
  }
  return true;
}

// ── Building Chunk Class ──
class CyberpunkChunk {
  worldX: number;
  worldZ: number;
  group: THREE.Group;
  instancedMesh: THREE.InstancedMesh | null = null;
  buildings: BuildingInstance[] = [];
  material: THREE.ShaderMaterial;

  constructor(worldX: number, worldZ: number, material: THREE.ShaderMaterial) {
    this.worldX = worldX;
    this.worldZ = worldZ;
    this.group = new THREE.Group();
    this.group.position.set(worldX, 0, worldZ);
    this.material = material;
  }

  generate(staticStations: StaticStation[]) {
    const geometry = new THREE.BoxGeometry(
      BUILDING_CONFIG.BASE_WIDTH,
      BUILDING_CONFIG.MIN_HEIGHT,
      BUILDING_CONFIG.BASE_DEPTH,
    );

    const buildingPositions: THREE.Vector3[] = [];

    // Generate grid-based building positions
    const halfChunk = CHUNK_SIZE / 2;
    for (let x = -halfChunk; x < halfChunk; x += BUILDING_GRID_SIZE) {
      for (let z = -halfChunk; z < halfChunk; z += BUILDING_GRID_SIZE) {
        // Use world-based coordinates for the hash to get variety between chunks
        const worldXBase = this.worldX + x;
        const worldZBase = this.worldZ + z;

        // Add some randomness to grid positions
        const offsetX =
          x +
          (hash(worldXBase, worldZBase, 1) - 0.5) * BUILDING_GRID_SIZE * 0.5;
        const offsetZ =
          z +
          (hash(worldXBase, worldZBase, 2) - 0.5) * BUILDING_GRID_SIZE * 0.5;

        const worldX = this.worldX + offsetX;
        const worldZ = this.worldZ + offsetZ;

        // Check if space is free from static stations
        if (isSpaceFree(worldX, worldZ, staticStations)) {
          // Probability check for building placement.
          // We use world coordinates to make chunks unique.
          if (hash(worldX, worldZ, 3) > 0.5) {
            buildingPositions.push(new THREE.Vector3(offsetX, 0, offsetZ));
          }
        }
      }
    }

    // Shuffle positions deterministically before truncating to ensure even distribution
    // when exceeding MAX_BUILDINGS (prevents clumping in the corner of the chunk).
    const chunkSeed = hash(this.worldX, this.worldZ, 123);
    buildingPositions.sort((a, b) => {
      return hash(a.x, a.z, chunkSeed) - hash(b.x, b.z, chunkSeed);
    });

    // Limit buildings per chunk for performance
    if (buildingPositions.length > MAX_BUILDINGS) {
      buildingPositions.length = MAX_BUILDINGS;
    }

    if (buildingPositions.length === 0) return;

    // Create instanced mesh
    this.instancedMesh = new THREE.InstancedMesh(
      geometry,
      this.material,
      buildingPositions.length,
    );

    // Prepare attribute arrays for shader
    const neonColors = new Float32Array(buildingPositions.length * 3);
    const growthPhases = new Float32Array(buildingPositions.length);

    // Generate building instances
    const dummy = new THREE.Object3D();

    for (let i = 0; i < buildingPositions.length; i++) {
      const pos = buildingPositions[i];
      const worldX = this.worldX + pos.x;
      const worldZ = this.worldZ + pos.z;

      // Procedural variation using world coordinates
      const heightVariation =
        1 + (hash(worldX, worldZ, 4) - 0.5) * BUILDING_CONFIG.HEIGHT_VARIATION;
      const scaleVariation =
        1 + (hash(worldX, worldZ, 5) - 0.5) * BUILDING_CONFIG.SCALE_VARIATION;

      const targetHeight =
        BUILDING_CONFIG.MIN_HEIGHT +
        (BUILDING_CONFIG.MAX_HEIGHT - BUILDING_CONFIG.MIN_HEIGHT) *
          heightVariation;

      // Position building
      dummy.position.set(pos.x, targetHeight / 2, pos.z);
      dummy.scale.set(
        scaleVariation,
        0.01, // Start with minimal Y scale for growth animation
        scaleVariation,
      );
      dummy.rotation.set(0, hash(worldX, worldZ, 6) * Math.PI * 2, 0);
      dummy.updateMatrix();

      // Store building data
      const building: BuildingInstance = {
        matrix: dummy.matrix.clone(),
        targetScaleY: targetHeight / BUILDING_CONFIG.MIN_HEIGHT,
        currentScaleY: 0.01,
        isGrowing: true,
        growthPhase: hash(worldX, worldZ, 7) * Math.PI * 2,
        neonColor:
          NEON_COLORS[Math.floor(hash(worldX, worldZ, 8) * NEON_COLORS.length)],
      };

      this.buildings.push(building);

      // Set initial matrix (will be updated in animate)
      this.instancedMesh.setMatrixAt(i, building.matrix);

      // Set neon color attribute
      neonColors[i * 3] = building.neonColor.r;
      neonColors[i * 3 + 1] = building.neonColor.g;
      neonColors[i * 3 + 2] = building.neonColor.b;

      // Set growth phase
      growthPhases[i] = building.growthPhase;
    }

    // Add custom attributes to geometry
    geometry.setAttribute(
      "aNeonColor",
      new THREE.InstancedBufferAttribute(neonColors, 3),
    );
    geometry.setAttribute(
      "aGrowthPhase",
      new THREE.InstancedBufferAttribute(growthPhases, 1),
    );

    this.instancedMesh.frustumCulled = false;
    this.group.add(this.instancedMesh);
  }

  // Growth animation update
  animate(delta: number): boolean {
    if (!this.instancedMesh || this.buildings.length === 0) return false;

    let hasGrowingBuildings = false;
    const dummy = new THREE.Object3D();

    for (let i = 0; i < this.buildings.length; i++) {
      const building = this.buildings[i];

      if (building.isGrowing) {
        // Lerp towards target scale
        const growthRate = delta * GROWTH_SPEED;
        building.currentScaleY = THREE.MathUtils.lerp(
          building.currentScaleY,
          building.targetScaleY,
          growthRate,
        );

        // Check if growth is complete
        if (Math.abs(building.currentScaleY - building.targetScaleY) < 0.01) {
          building.currentScaleY = building.targetScaleY;
          building.isGrowing = false;
        } else {
          hasGrowingBuildings = true;
        }

        // Update matrix with new scale
        dummy.matrix.copy(building.matrix);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
        dummy.scale.y = building.currentScaleY;
        dummy.updateMatrix();

        this.instancedMesh.setMatrixAt(i, dummy.matrix);
      }
    }

    if (hasGrowingBuildings) {
      this.instancedMesh.instanceMatrix.needsUpdate = true;
    }

    return hasGrowingBuildings;
  }

  // Trigger growth animation for buildings near player
  triggerGrowth(playerPosition: THREE.Vector3, triggerRadius: number = 100) {
    for (const building of this.buildings) {
      if (
        !building.isGrowing &&
        building.currentScaleY < building.targetScaleY
      ) {
        const dummy = new THREE.Object3D();
        dummy.matrix.copy(building.matrix);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);

        // Convert to world position
        const worldPos = dummy.position.clone().add(this.group.position);
        const distance = playerPosition.distanceTo(worldPos);

        if (distance < triggerRadius) {
          building.isGrowing = true;
        }
      }
    }
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    if (this.instancedMesh) {
      this.instancedMesh.geometry.dispose();
      this.instancedMesh.dispose();
    }
    this.group.clear();
    this.buildings = [];
  }
}

// ── Main Cyberpunk City Manager ──
export class CyberpunkCityManager {
  private scene: THREE.Scene;
  private playerPosition: THREE.Vector3;
  private lastUpdatePosition: THREE.Vector3;
  private chunks: Map<string, CyberpunkChunk> = new Map();
  private material: THREE.ShaderMaterial;
  private staticStations: StaticStation[];
  private globalTime: number = 0;

  constructor(
    scene: THREE.Scene,
    initialPosition: THREE.Vector3,
    staticStations: StaticStation[] = [],
  ) {
    this.scene = scene;
    this.playerPosition = initialPosition.clone();
    this.lastUpdatePosition = initialPosition.clone();
    this.staticStations = staticStations;
    this.material = createCyberpunkMaterial();
  }

  init() {
    this.updateChunks();
  }

  update(playerZ: number, delta: number = 0.016) {
    // Update global time for shader animations
    this.globalTime += delta;
    this.material.uniforms.uTime.value = this.globalTime;

    // Update player position (assuming movement along Z-axis primarily)
    this.playerPosition.z = playerZ;

    // Animate growing buildings
    this.chunks.forEach((chunk) => {
      chunk.animate(delta);
    });

    // Update chunks if player moved significantly
    const distanceGained = this.lastUpdatePosition.distanceTo(
      this.playerPosition,
    );
    if (distanceGained > 20) {
      this.lastUpdatePosition.copy(this.playerPosition);
      this.updateChunks();

      // Trigger growth for nearby buildings
      this.chunks.forEach((chunk) => {
        chunk.triggerGrowth(this.playerPosition, 80);
      });
    }
  }

  private getChunkKey(x: number, z: number): string {
    return `${Math.floor(x / CHUNK_SIZE)}_${Math.floor(z / CHUNK_SIZE)}`;
  }

  private updateChunks() {
    const currentChunkX = Math.floor(this.playerPosition.x / CHUNK_SIZE);
    const currentChunkZ = Math.floor(this.playerPosition.z / CHUNK_SIZE);
    const newChunks: Map<string, CyberpunkChunk> = new Map();

    // Generate chunks around player
    for (let x = -VIEW_DISTANCE; x <= VIEW_DISTANCE; x++) {
      for (let z = -VIEW_DISTANCE; z <= VIEW_DISTANCE; z++) {
        const chunkWorldX = (currentChunkX + x) * CHUNK_SIZE;
        const chunkWorldZ = (currentChunkZ + z) * CHUNK_SIZE;
        const key = this.getChunkKey(chunkWorldX, chunkWorldZ);

        let chunk = this.chunks.get(key);
        if (!chunk) {
          // Create new chunk
          chunk = new CyberpunkChunk(chunkWorldX, chunkWorldZ, this.material);
          chunk.generate(this.staticStations);
          this.scene.add(chunk.group);

          // Trigger immediate growth for nearby chunks
          const chunkCenter = new THREE.Vector3(chunkWorldX, 0, chunkWorldZ);
          if (this.playerPosition.distanceTo(chunkCenter) < CHUNK_SIZE) {
            chunk.triggerGrowth(this.playerPosition, CHUNK_SIZE);
          }
        }
        newChunks.set(key, chunk);
      }
    }

    // Dispose old chunks
    this.chunks.forEach((chunk, key) => {
      if (!newChunks.has(key)) {
        chunk.dispose(this.scene);
      }
    });

    this.chunks = newChunks;
  }

  // Add or update static stations (exclusion zones)
  setStaticStations(stations: StaticStation[]) {
    this.staticStations = stations;
    // Force chunk regeneration
    this.chunks.forEach((chunk) => chunk.dispose(this.scene));
    this.chunks.clear();
    this.updateChunks();
  }

  // Adjust neon intensity
  setNeonIntensity(intensity: number) {
    this.material.uniforms.uNeonIntensity.value = intensity;
  }

  dispose() {
    this.chunks.forEach((chunk) => chunk.dispose(this.scene));
    this.chunks.clear();
    this.material.dispose();
  }
}

// ── Export utility function for easy integration ──
export { isSpaceFree, type StaticStation };
