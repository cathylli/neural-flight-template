import * as THREE from "three";

// ── Constants ──
const MAX_VERTS = 120_000; // Increased for more towers
const CHUNK_SIZE = 200;
const GRID_CELLS = 8;
const CELL_SIZE = CHUNK_SIZE / GRID_CELLS;
const VIEW_RADIUS = 2;
const DENSITY = 0.08;
const SEED = 7;

const MIN_HEIGHT = 20;
const MAX_HEIGHT = 150;
const MIN_WIDTH = 2;
const MAX_WIDTH = 12;

const EDGE_PAIRS = [
  [0, 1],
  [1, 3],
  [3, 2],
  [2, 0], // Bottom
  [4, 5],
  [5, 7],
  [7, 6],
  [6, 4], // Top
  [0, 4],
  [1, 5],
  [3, 7],
  [2, 6], // Verticals
];

// ── Types ──
interface BuildingDef {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
}

interface ChunkData {
  buildings: BuildingDef[];
  birthTime: number;
}

// ── Utility ──
function seededRandom(s: number): number {
  const x = Math.sin(s) * 10000;
  return x - Math.floor(x);
}

// ── Manager ──
export class GlowingTowersManager {
  private scene: THREE.Scene;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private lines: THREE.LineSegments;
  private chunks: Map<string, ChunkData> = new Map();
  private lastCX: number = NaN;
  private lastCZ: number = NaN;
  private dirty: boolean = true;
  private globalTime: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // 1. Prepare Buffer Geometry
    const positions = new Float32Array(MAX_VERTS * 3);
    const finalY = new Float32Array(MAX_VERTS);
    const birthTimes = new Float32Array(MAX_VERTS).fill(99999);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    this.geometry.setAttribute("aFinalY", new THREE.BufferAttribute(finalY, 1));
    this.geometry.setAttribute(
      "aBirthTime",
      new THREE.BufferAttribute(birthTimes, 1),
    );

    // 2. Prepare Shader Material
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uGrowthSpeed: { value: 0.8 },
        uNeonColor: { value: new THREE.Color(0x00ff00) },
        uNeonIntensity: { value: 2.0 },
      },
      vertexShader: `
        attribute float aFinalY;
        attribute float aBirthTime;
        uniform float uTime;
        uniform float uGrowthSpeed;

        varying float vBrightness;

        void main() {
          float age = (uTime - aBirthTime) * uGrowthSpeed;
          float growFactor = clamp(age, 0.0, 1.0);
          growFactor = growFactor * growFactor; // Quadratic ease-in

          vec3 pos = position;
          // Vertices with original y > 0 are top vertices
          if (position.y > 0.01) {
            pos.y = mix(0.0, aFinalY, growFactor);
          } else {
            pos.y = 0.0;
          }

          vBrightness = growFactor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uNeonColor;
        uniform float uNeonIntensity;
        varying float vBrightness;

        void main() {
          // Pure neon green color with brightness based on growth
          vec3 color = uNeonColor * uNeonIntensity * vBrightness;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false;
    this.scene.add(this.lines);
  }

  update(playerX: number, playerZ: number, elapsed: number) {
    this.globalTime = elapsed;
    this.material.uniforms.uTime.value = elapsed;

    const cx = Math.floor(playerX / CHUNK_SIZE);
    const cz = Math.floor(playerZ / CHUNK_SIZE);

    if (cx !== this.lastCX || cz !== this.lastCZ) {
      this.lastCX = cx;
      this.lastCZ = cz;
      this.updateChunks(cx, cz);
    }

    if (this.dirty) {
      this.rebuildBuffer();
    }
  }

  private updateChunks(cx: number, cz: number) {
    const needed = new Set<string>();
    for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
      for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
        needed.add(`${cx + dx},${cz + dz}`);
      }
    }

    // Remove old
    for (const key of this.chunks.keys()) {
      if (!needed.has(key)) {
        this.chunks.delete(key);
        this.dirty = true;
      }
    }

    // Add new
    for (const key of needed) {
      if (!this.chunks.has(key)) {
        const [ncx, ncz] = key.split(",").map(Number);
        this.chunks.set(key, this.generateChunk(ncx, ncz));
        this.dirty = true;
      }
    }
  }

  private generateChunk(cx: number, cz: number): ChunkData {
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;
    const buildings: BuildingDef[] = [];

    for (let gx = 0; gx < GRID_CELLS; gx++) {
      for (let gz = 0; gz < GRID_CELLS; gz++) {
        const cellSeed = SEED + cx * 7919 + cz * 6271 + gx * 131 + gz * 97;
        if (seededRandom(cellSeed) > DENSITY) continue;

        const width =
          MIN_WIDTH + seededRandom(cellSeed + 1) * (MAX_WIDTH - MIN_WIDTH);
        const depth =
          MIN_WIDTH + seededRandom(cellSeed + 2) * (MAX_WIDTH - MIN_WIDTH);
        const height =
          MIN_HEIGHT + seededRandom(cellSeed + 3) * (MAX_HEIGHT - MIN_HEIGHT);

        buildings.push({
          x:
            baseX +
            (gx + 0.5) * CELL_SIZE +
            (seededRandom(cellSeed + 4) - 0.5) * (CELL_SIZE - width),
          z:
            baseZ +
            (gz + 0.5) * CELL_SIZE +
            (seededRandom(cellSeed + 5) - 0.5) * (CELL_SIZE - depth),
          width,
          depth,
          height,
        });
      }
    }

    return { buildings, birthTime: this.globalTime };
  }

  private rebuildBuffer() {
    this.dirty = false;
    const posAttr = this.geometry.attributes.position;
    const finalYAttr = this.geometry.attributes.aFinalY;
    const birthTimeAttr = this.geometry.attributes.aBirthTime;

    const positions = posAttr.array as Float32Array;
    const finalY = finalYAttr.array as Float32Array;
    const birthTimes = birthTimeAttr.array as Float32Array;

    let offset = 0;

    for (const chunk of this.chunks.values()) {
      for (const b of chunk.buildings) {
        if (offset + 24 >= MAX_VERTS) break;

        const hw = b.width / 2;
        const hd = b.depth / 2;
        const corners = [
          [b.x - hw, 0, b.z - hd],
          [b.x + hw, 0, b.z - hd],
          [b.x - hw, 0, b.z + hd],
          [b.x + hw, 0, b.z + hd],
          [b.x - hw, b.height, b.z - hd],
          [b.x + hw, b.height, b.z - hd],
          [b.x - hw, b.height, b.z + hd],
          [b.x + hw, b.height, b.z + hd],
        ];

        for (const [i1, i2] of EDGE_PAIRS) {
          const v1 = corners[i1];
          const v2 = corners[i2];

          positions[offset * 3] = v1[0];
          positions[offset * 3 + 1] = v1[1];
          positions[offset * 3 + 2] = v1[2];
          finalY[offset] = v1[1];
          birthTimes[offset] = chunk.birthTime;
          offset++;

          positions[offset * 3] = v2[0];
          positions[offset * 3 + 1] = v2[1];
          positions[offset * 3 + 2] = v2[2];
          finalY[offset] = v2[1];
          birthTimes[offset] = chunk.birthTime;
          offset++;
        }
      }
      if (offset >= MAX_VERTS) break;
    }

    // Reset unused
    for (let i = offset; i < MAX_VERTS; i++) {
      positions[i * 3 + 1] = -1000;
      birthTimes[i] = 999999;
    }

    posAttr.needsUpdate = true;
    finalYAttr.needsUpdate = true;
    birthTimeAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, offset);
  }

  setNeonIntensity(intensity: number) {
    this.material.uniforms.uNeonIntensity.value = intensity;
  }

  dispose() {
    this.scene.remove(this.lines);
    this.geometry.dispose();
    this.material.dispose();
  }
}
