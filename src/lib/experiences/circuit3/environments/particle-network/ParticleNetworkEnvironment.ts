import * as THREE from "three";
import { CHUNK_HEIGHT, CHUNK_SIZE } from "../types";
import type {
	ChunkContent,
	Environment,
	EnvironmentBuildParams,
} from "../types";

// ── Particle Network Environment (L7) ────────────────────────────────────────
//
// Deterministic particle clusters generated per global grid cell — same
// approach as NeuralEnvironment. Each cell spawns a small cluster of white
// particles connected by lines (drawrange style). Because generation is
// purely a function of integer cell coordinates, neighbouring chunks agree
// on shared borders and the network is seamless across chunk boundaries.
//
// Volumetric: streams vertically so the player flies through an infinite
// cloud of interconnected clusters in every direction.
//
// Performance: all clusters in a chunk are merged into a single Points +
// LineSegments object (2 draw calls per chunk instead of ~54).

const CELL_SIZE = 50; // spacing of the global cluster grid
const PARTICLES_PER_CLUSTER = 3;
const MAX_LINES_PER_CLUSTER = PARTICLES_PER_CLUSTER; // 3 particles → 3 possible edges
const CONN_DIST = 32;
const CLUSTER_SPEED = 4;
const CLUSTER_DRIFT = 35; // how far particles wander from cell center
const VERTICAL_RADIUS = 1;
const GROW_DURATION = 0.8;

// ── Deterministic hashing ───────────────────────────────────────────────────

function hashCell(x: number, y: number, z: number, salt: number): number {
	let h =
		Math.imul(x | 0, 0x27d4eb2d) ^
		Math.imul(y | 0, 0x165667b1) ^
		Math.imul(z | 0, 0x1b873593) ^
		Math.imul(salt | 0, 0x85ebca77);
	h ^= h >>> 15;
	h = Math.imul(h, 0x2c1b3c6d);
	h ^= h >>> 12;
	h = Math.imul(h, 0x297a2d39);
	h ^= h >>> 15;
	return h >>> 0;
}

function unit(h: number): number {
	return h / 4294967296;
}

/** Which chunk index (along one axis) owns global cell `g`. */
function ownerChunk(g: number, axisChunkSize: number): number {
	return Math.round((g * CELL_SIZE) / axisChunkSize);
}

// ── Per-cell deterministic particle data ─────────────────────────────────────

interface CellData {
	/** Cell center in chunk-local space. */
	lx: number;
	ly: number;
	lz: number;
	/** Pre-computed local-space offsets from cell center. */
	ox: Float32Array;
	oy: Float32Array;
	oz: Float32Array;
	/** Pre-computed velocities. */
	vx: Float32Array;
	vy: Float32Array;
	vz: Float32Array;
	/** Pre-computed per-particle RGB colors (3 floats per particle). */
	r: Float32Array;
	g: Float32Array;
	b: Float32Array;
}

function cellData(gx: number, gy: number, gz: number): CellData {
	const lx = gx * CELL_SIZE;
	const ly = gy * CELL_SIZE;
	const lz = gz * CELL_SIZE;
	const n = PARTICLES_PER_CLUSTER;
	const ox = new Float32Array(n);
	const oy = new Float32Array(n);
	const oz = new Float32Array(n);
	const vx = new Float32Array(n);
	const vy = new Float32Array(n);
	const vz = new Float32Array(n);
	const r = new Float32Array(n);
	const g = new Float32Array(n);
	const b = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		ox[i] = (unit(hashCell(gx, gy, gz, i * 3 + 100)) - 0.5) * CLUSTER_DRIFT;
		oy[i] = (unit(hashCell(gx, gy, gz, i * 3 + 200)) - 0.5) * CLUSTER_DRIFT;
		oz[i] = (unit(hashCell(gx, gy, gz, i * 3 + 300)) - 0.5) * CLUSTER_DRIFT;
		vx[i] = (unit(hashCell(gx, gy, gz, i * 3 + 400)) - 0.5) * 2;
		vy[i] = (unit(hashCell(gx, gy, gz, i * 3 + 500)) - 0.5) * 2;
		vz[i] = (unit(hashCell(gx, gy, gz, i * 3 + 600)) - 0.5) * 2;
		const isGreen = unit(hashCell(gx, gy, gz, i + 700)) < 0.4;
		if (isGreen) {
			r[i] = 0.0;
			g[i] = 1.0;
			b[i] = 0.3;
		} else {
			r[i] = 1.0;
			g[i] = 1.0;
			b[i] = 1.0;
		}
	}
	return { lx, ly, lz, ox, oy, oz, vx, vy, vz, r, g, b };
}

// ── Chunk ──────────────────────────────────────────────────────────────────

class ParticleNetworkChunk implements ChunkContent {
	readonly group = new THREE.Group();
	readonly stationSlot: THREE.Vector3 | null;

	private readonly cells: CellData[];
	private readonly livePositions: Float32Array;
	private readonly pointColors: Float32Array;
	private readonly linePositions: Float32Array;
	private readonly lineColors: Float32Array;
	private pointGeo: THREE.BufferGeometry;
	private lineGeo: THREE.BufferGeometry;
	private pointMat: THREE.PointsMaterial;
	private lineMat: THREE.LineBasicMaterial;
	private totalLines = 0;
	private readonly spawnTime: number;
	private grown = false;

	constructor(
		cx: number,
		cy: number,
		cz: number,
		params: EnvironmentBuildParams,
		spawnTime: number,
	) {
		this.spawnTime = spawnTime;
		const ox = cx * CHUNK_SIZE;
		const oy = cy * CHUNK_HEIGHT;
		const oz = cz * CHUNK_SIZE;
		this.group.position.set(ox, oy, oz);

		// Collect cells owned by this chunk
		this.cells = [];
		const cell = CELL_SIZE;
		const gxLo = Math.floor(((cx - 0.5) * CHUNK_SIZE) / cell) - 1;
		const gxHi = Math.ceil(((cx + 0.5) * CHUNK_SIZE) / cell) + 1;
		const gyLo = Math.floor(((cy - 0.5) * CHUNK_HEIGHT) / cell) - 1;
		const gyHi = Math.ceil(((cy + 0.5) * CHUNK_HEIGHT) / cell) + 1;
		const gzLo = Math.floor(((cz - 0.5) * CHUNK_SIZE) / cell) - 1;
		const gzHi = Math.ceil(((cz + 0.5) * CHUNK_SIZE) / cell) + 1;

		for (let gx = gxLo; gx <= gxHi; gx++) {
			if (ownerChunk(gx, CHUNK_SIZE) !== cx) continue;
			for (let gy = gyLo; gy <= gyHi; gy++) {
				if (ownerChunk(gy, CHUNK_HEIGHT) !== cy) continue;
				for (let gz = gzLo; gz <= gzHi; gz++) {
					if (ownerChunk(gz, CHUNK_SIZE) !== cz) continue;
					this.cells.push(cellData(gx, gy, gz));
				}
			}
		}

		const numCells = this.cells.length;
		const numParticles = numCells * PARTICLES_PER_CLUSTER;
		const maxLineVertices = numCells * MAX_LINES_PER_CLUSTER * 2;

		// ── Merged Points buffer (1 draw call for all particles) ──
		this.livePositions = new Float32Array(numParticles * 3);
		this.pointColors = new Float32Array(numParticles * 3);
		for (let c = 0; c < numCells; c++) {
			const cc = this.cells[c];
			const base = c * PARTICLES_PER_CLUSTER;
			for (let i = 0; i < PARTICLES_PER_CLUSTER; i++) {
				const idx = (base + i) * 3;
				this.livePositions[idx] = cc.lx + cc.ox[i];
				this.livePositions[idx + 1] = cc.ly + cc.oy[i];
				this.livePositions[idx + 2] = cc.lz + cc.oz[i];
				this.pointColors[idx] = cc.r[i];
				this.pointColors[idx + 1] = cc.g[i];
				this.pointColors[idx + 2] = cc.b[i];
			}
		}

		this.pointGeo = new THREE.BufferGeometry();
		this.pointGeo.setAttribute(
			"position",
			new THREE.BufferAttribute(this.livePositions, 3).setUsage(THREE.DynamicDrawUsage),
		);
		this.pointGeo.setAttribute(
			"color",
			new THREE.BufferAttribute(this.pointColors, 3),
		);
		this.pointGeo.setDrawRange(0, numParticles);

		// Bounding sphere covers entire chunk volume for frustum culling
		this.pointGeo.boundingSphere = new THREE.Sphere(
			new THREE.Vector3(CHUNK_SIZE / 2, CHUNK_HEIGHT / 2, CHUNK_SIZE / 2),
			Math.sqrt(CHUNK_SIZE * CHUNK_SIZE + CHUNK_HEIGHT * CHUNK_HEIGHT + CHUNK_SIZE * CHUNK_SIZE) / 2,
		);

		this.pointMat = new THREE.PointsMaterial({
			size: 2.5,
			blending: THREE.AdditiveBlending,
			transparent: true,
			opacity: 0.9,
			depthWrite: false,
			vertexColors: true,
		});
		const points = new THREE.Points(this.pointGeo, this.pointMat);
		this.group.add(points);

		// ── Merged LineSegments buffer (1 draw call for all connections) ──
		this.linePositions = new Float32Array(maxLineVertices * 3);
		this.lineColors = new Float32Array(maxLineVertices * 3);

		this.lineGeo = new THREE.BufferGeometry();
		this.lineGeo.setAttribute(
			"position",
			new THREE.BufferAttribute(this.linePositions, 3).setUsage(THREE.DynamicDrawUsage),
		);
		this.lineGeo.setAttribute(
			"color",
			new THREE.BufferAttribute(this.lineColors, 3).setUsage(THREE.DynamicDrawUsage),
		);
		this.lineGeo.setDrawRange(0, 0);
		this.lineGeo.boundingSphere = this.pointGeo.boundingSphere;

		this.lineMat = new THREE.LineBasicMaterial({
			vertexColors: true,
			blending: THREE.AdditiveBlending,
			transparent: true,
			opacity: 0.5,
			depthWrite: false,
		});
		const lines = new THREE.LineSegments(this.lineGeo, this.lineMat);
		this.group.add(lines);

		// Station at chunk centre
		this.stationSlot =
			params.stationWeight > 0
				? new THREE.Vector3(ox, oy, oz)
				: null;
	}

	update(elapsed: number, delta: number): void {
		const dt = Math.min(delta, 0.05); // clamp to avoid spiral of death

		// Growth fade
		if (!this.grown) {
			const t = Math.min((elapsed - this.spawnTime) / GROW_DURATION, 1);
			const eased = 1 - (1 - t) ** 3;
			this.pointMat.opacity = 0.9 * eased;
			this.lineMat.opacity = 0.5 * eased;
			if (t >= 1) this.grown = true;
		}

		const connDistSq = CONN_DIST * CONN_DIST;
		const numCells = this.cells.length;
		const PPC = PARTICLES_PER_CLUSTER;

		// ── Update particle positions ──
		for (let c = 0; c < numCells; c++) {
			const cc = this.cells[c];
			const base = c * PPC;
			for (let i = 0; i < PPC; i++) {
				const pIdx = (base + i) * 3;
				this.livePositions[pIdx] += cc.vx[i] * dt * CLUSTER_SPEED;
				this.livePositions[pIdx + 1] += cc.vy[i] * dt * CLUSTER_SPEED;
				this.livePositions[pIdx + 2] += cc.vz[i] * dt * CLUSTER_SPEED;

				// Wrap around cell center
				if (Math.abs(this.livePositions[pIdx]) > CLUSTER_DRIFT) {
					this.livePositions[pIdx] = (Math.random() - 0.5) * CLUSTER_DRIFT * 0.5;
				}
				if (Math.abs(this.livePositions[pIdx + 1]) > CLUSTER_DRIFT) {
					this.livePositions[pIdx + 1] = (Math.random() - 0.5) * CLUSTER_DRIFT * 0.5;
				}
				if (Math.abs(this.livePositions[pIdx + 2]) > CLUSTER_DRIFT) {
					this.livePositions[pIdx + 2] = (Math.random() - 0.5) * CLUSTER_DRIFT * 0.5;
				}
			}
		}

		// ── Build line connections ──
		let lineVertexPos = 0;
		let lineColorPos = 0;
		for (let c = 0; c < numCells; c++) {
			const base = c * PPC;
			for (let i = 0; i < PPC; i++) {
				for (let j = i + 1; j < PPC; j++) {
					const aIdx = (base + i) * 3;
					const bIdx = (base + j) * 3;
					const dx = this.livePositions[aIdx] - this.livePositions[bIdx];
					const dy = this.livePositions[aIdx + 1] - this.livePositions[bIdx + 1];
					const dz = this.livePositions[aIdx + 2] - this.livePositions[bIdx + 2];
					const distSq = dx * dx + dy * dy + dz * dz;

					if (distSq < connDistSq) {
						const dist = Math.sqrt(distSq);
						const alpha = 1.0 - dist / CONN_DIST;

						this.linePositions[lineVertexPos] = this.livePositions[aIdx];
						this.linePositions[lineVertexPos + 1] = this.livePositions[aIdx + 1];
						this.linePositions[lineVertexPos + 2] = this.livePositions[aIdx + 2];
						this.linePositions[lineVertexPos + 3] = this.livePositions[bIdx];
						this.linePositions[lineVertexPos + 4] = this.livePositions[bIdx + 1];
						this.linePositions[lineVertexPos + 5] = this.livePositions[bIdx + 2];

						this.lineColors[lineColorPos] = alpha;
						this.lineColors[lineColorPos + 1] = alpha;
						this.lineColors[lineColorPos + 2] = alpha;
						this.lineColors[lineColorPos + 3] = alpha;
						this.lineColors[lineColorPos + 4] = alpha;
						this.lineColors[lineColorPos + 5] = alpha;

						lineVertexPos += 6;
						lineColorPos += 6;
					}
				}
			}
		}

		this.totalLines = lineVertexPos / 6;
		this.lineGeo.setDrawRange(0, this.totalLines * 2);
		this.pointGeo.attributes.position.needsUpdate = true;
		if (this.totalLines > 0) {
			this.lineGeo.attributes.position.needsUpdate = true;
			this.lineGeo.attributes.color.needsUpdate = true;
		}
	}

	dispose(): void {
		this.pointGeo.dispose();
		this.lineGeo.dispose();
		this.pointMat.dispose();
		this.lineMat.dispose();
		this.group.clear();
	}
}

export class ParticleNetworkEnvironment implements Environment {
	readonly verticalRadius = VERTICAL_RADIUS;
	readonly renderRadius = 3;

	buildChunk(
		cx: number,
		cy: number,
		cz: number,
		params: EnvironmentBuildParams,
		spawnTime: number,
	): ChunkContent {
		return new ParticleNetworkChunk(cx, cy, cz, params, spawnTime);
	}

	updateNeonColor(): void {}
	updateBuildingOpacity(): void {}

	terrainHeightAt(): number | null {
		return null;
	}

	init(scene: THREE.Scene): void {
		scene.background = null;

		if (scene.fog instanceof THREE.Fog) {
			scene.fog.color.set(0x888888);
			scene.fog.near = 30;
			scene.fog.far = 250;
		} else if (scene.fog) {
			scene.fog.color.set(0x888888);
		}
	}

	dispose(): void {}
}
