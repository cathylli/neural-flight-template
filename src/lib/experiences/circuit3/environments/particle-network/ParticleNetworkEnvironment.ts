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

const CELL_SIZE = 50; // spacing of the global cluster grid
const PARTICLES_PER_CLUSTER = 3;
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

// ── Per-cell deterministic particle positions ───────────────────────────────

interface CellCluster {
	worldX: number;
	worldY: number;
	worldZ: number;
	/** Pre-computed local-space positions (relative to cell center). */
	localPositions: Float32Array;
	/** Pre-computed velocities. */
	velocities: Float32Array;
	/** Pre-computed per-particle RGB colors (3 floats per particle). */
	colors: Float32Array;
}

function cellCluster(gx: number, gy: number, gz: number): CellCluster {
	const worldX = gx * CELL_SIZE;
	const worldY = gy * CELL_SIZE;
	const worldZ = gz * CELL_SIZE;
	const localPositions = new Float32Array(PARTICLES_PER_CLUSTER * 3);
	const velocities = new Float32Array(PARTICLES_PER_CLUSTER * 3);
	const colors = new Float32Array(PARTICLES_PER_CLUSTER * 3);
	for (let i = 0; i < PARTICLES_PER_CLUSTER; i++) {
		const jitterX = (unit(hashCell(gx, gy, gz, i * 3 + 100)) - 0.5) * CLUSTER_DRIFT;
		const jitterY = (unit(hashCell(gx, gy, gz, i * 3 + 200)) - 0.5) * CLUSTER_DRIFT;
		const jitterZ = (unit(hashCell(gx, gy, gz, i * 3 + 300)) - 0.5) * CLUSTER_DRIFT;
		localPositions[i * 3] = jitterX;
		localPositions[i * 3 + 1] = jitterY;
		localPositions[i * 3 + 2] = jitterZ;
		velocities[i * 3] = (unit(hashCell(gx, gy, gz, i * 3 + 400)) - 0.5) * 2;
		velocities[i * 3 + 1] = (unit(hashCell(gx, gy, gz, i * 3 + 500)) - 0.5) * 2;
		velocities[i * 3 + 2] = (unit(hashCell(gx, gy, gz, i * 3 + 600)) - 0.5) * 2;
		// ~40% green, ~60% white — deterministic per particle
		const green = unit(hashCell(gx, gy, gz, i + 700)) < 0.4;
		if (green) {
			colors[i * 3] = 0.0;
			colors[i * 3 + 1] = 1.0;
			colors[i * 3 + 2] = 0.3;
		} else {
			colors[i * 3] = 1.0;
			colors[i * 3 + 1] = 1.0;
			colors[i * 3 + 2] = 1.0;
		}
	}
	return { worldX, worldY, worldZ, localPositions, velocities, colors };
}

// ── Chunk ──────────────────────────────────────────────────────────────────

class ParticleNetworkChunk implements ChunkContent {
	readonly group = new THREE.Group();
	readonly stationSlot: THREE.Vector3 | null;

	private readonly clusters: {
		cellCluster: CellCluster;
		/** Live positions (mutated per frame). */
		positions: Float32Array;
		pointCol: Float32Array;
		linePos: Float32Array;
		lineCol: Float32Array;
		pointGeo: THREE.BufferGeometry;
		lineGeo: THREE.BufferGeometry;
		pointMat: THREE.PointsMaterial;
		lineMat: THREE.LineBasicMaterial;
		/** Local-space origin (chunk offset). */
		ox: number;
		oy: number;
		oz: number;
	}[] = [];

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

		// Determine which global cells this chunk owns
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

					const cc = cellCluster(gx, gy, gz);

				// Live positions start at the deterministic local positions
				const positions = new Float32Array(cc.localPositions);
				const pointCol = new Float32Array(cc.colors);

				const pointGeo = new THREE.BufferGeometry();
				pointGeo.setDrawRange(0, PARTICLES_PER_CLUSTER);
				pointGeo.setAttribute(
					"position",
					new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
				);
				pointGeo.setAttribute(
					"color",
					new THREE.BufferAttribute(pointCol, 3),
				);

				const pointMat = new THREE.PointsMaterial({
					size: 2.5,
					blending: THREE.AdditiveBlending,
					transparent: true,
					opacity: 0.9,
					depthWrite: false,
					vertexColors: true,
				});
					const points = new THREE.Points(pointGeo, pointMat);
					points.frustumCulled = false;
					this.group.add(points);

					const maxLines = PARTICLES_PER_CLUSTER * PARTICLES_PER_CLUSTER;
					const linePos = new Float32Array(maxLines * 3);
					const lineCol = new Float32Array(maxLines * 3);

					const lineGeo = new THREE.BufferGeometry();
					lineGeo.setAttribute(
						"position",
						new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage),
					);
					lineGeo.setAttribute(
						"color",
						new THREE.BufferAttribute(lineCol, 3).setUsage(THREE.DynamicDrawUsage),
					);
					lineGeo.setDrawRange(0, 0);

					const lineMat = new THREE.LineBasicMaterial({
						vertexColors: true,
						blending: THREE.AdditiveBlending,
						transparent: true,
						opacity: 0.5,
						depthWrite: false,
					});
					const lines = new THREE.LineSegments(lineGeo, lineMat);
					lines.frustumCulled = false;
					this.group.add(lines);

				this.clusters.push({
					cellCluster: cc,
					positions,
					pointCol,
					linePos,
					lineCol,
					pointGeo,
					lineGeo,
					pointMat,
					lineMat,
					ox, oy, oz,
				});
				}
			}
		}

		// Station sits at the chunk centre on this chunk's own layer (oy), so in the
		// volumetric world it appears at whatever height the player is flying, not
		// pinned to y = 0.
		this.stationSlot =
			params.stationWeight > 0
				? new THREE.Vector3(ox, oy, oz)
				: null;
	}

	update(elapsed: number): void {
		// Growth fade
		if (!this.grown) {
			const t = Math.min((elapsed - this.spawnTime) / GROW_DURATION, 1);
			const eased = 1 - (1 - t) ** 3;
			for (const cl of this.clusters) {
				cl.pointMat.opacity = 0.9 * eased;
				cl.lineMat.opacity = 0.5 * eased;
			}
			if (t >= 1) this.grown = true;
		}

		const connDistSq = CONN_DIST * CONN_DIST;

		for (const cl of this.clusters) {
			const cc = cl.cellCluster;

			// Move particles relative to their deterministic cell center
			for (let i = 0; i < PARTICLES_PER_CLUSTER; i++) {
				cl.positions[i * 3] += cc.velocities[i * 3] * 0.016 * CLUSTER_SPEED;
				cl.positions[i * 3 + 1] += cc.velocities[i * 3 + 1] * 0.016 * CLUSTER_SPEED;
				cl.positions[i * 3 + 2] += cc.velocities[i * 3 + 2] * 0.016 * CLUSTER_SPEED;

				// Wrap around cell center for infinite feel
				if (Math.abs(cl.positions[i * 3]) > CLUSTER_DRIFT) {
					cl.positions[i * 3] = (Math.random() - 0.5) * CLUSTER_DRIFT * 0.5;
				}
				if (Math.abs(cl.positions[i * 3 + 1]) > CLUSTER_DRIFT) {
					cl.positions[i * 3 + 1] = (Math.random() - 0.5) * CLUSTER_DRIFT * 0.5;
				}
				if (Math.abs(cl.positions[i * 3 + 2]) > CLUSTER_DRIFT) {
					cl.positions[i * 3 + 2] = (Math.random() - 0.5) * CLUSTER_DRIFT * 0.5;
				}
			}

			// Connect nearby particles with lines
			let vertexpos = 0;
			let colorpos = 0;
			let numConnected = 0;

			for (let i = 0; i < PARTICLES_PER_CLUSTER; i++) {
				for (let j = i + 1; j < PARTICLES_PER_CLUSTER; j++) {
					const dx = cl.positions[i * 3] - cl.positions[j * 3];
					const dy = cl.positions[i * 3 + 1] - cl.positions[j * 3 + 1];
					const dz = cl.positions[i * 3 + 2] - cl.positions[j * 3 + 2];
					const distSq = dx * dx + dy * dy + dz * dz;

					if (distSq < connDistSq) {
						const dist = Math.sqrt(distSq);
						const alpha = 1.0 - dist / CONN_DIST;

						cl.linePos[vertexpos] = cl.positions[i * 3];
						cl.linePos[vertexpos + 1] = cl.positions[i * 3 + 1];
						cl.linePos[vertexpos + 2] = cl.positions[i * 3 + 2];
						cl.linePos[vertexpos + 3] = cl.positions[j * 3];
						cl.linePos[vertexpos + 4] = cl.positions[j * 3 + 1];
						cl.linePos[vertexpos + 5] = cl.positions[j * 3 + 2];

						cl.lineCol[colorpos] = alpha;
						cl.lineCol[colorpos + 1] = alpha;
						cl.lineCol[colorpos + 2] = alpha;
						cl.lineCol[colorpos + 3] = alpha;
						cl.lineCol[colorpos + 4] = alpha;
						cl.lineCol[colorpos + 5] = alpha;

						vertexpos += 6;
						colorpos += 6;
						numConnected++;
					}
				}
			}

			cl.lineGeo.setDrawRange(0, numConnected * 2);
			cl.lineGeo.attributes.position.needsUpdate = true;
			cl.lineGeo.attributes.color.needsUpdate = true;
			cl.pointGeo.attributes.position.needsUpdate = true;
		}
	}

	dispose(): void {
		for (const cl of this.clusters) {
			cl.pointGeo.dispose();
			cl.lineGeo.dispose();
			cl.pointMat.dispose();
			cl.lineMat.dispose();
		}
		this.group.clear();
	}
}

export class ParticleNetworkEnvironment implements Environment {
	readonly verticalRadius = VERTICAL_RADIUS;

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
