import * as THREE from "three";
import { CHUNK_SIZE } from "../types";
import type {
	ChunkContent,
	Environment,
	EnvironmentBuildParams,
} from "../types";

const CHUNK_HEIGHT = 120;
const CHUNK_HALF = CHUNK_SIZE / 2;
const HEIGHT_HALF = CHUNK_HEIGHT / 2;
const MAX_PARTICLES_PER_CHUNK = 200;

interface ParticleData {
	vx: number;
	vy: number;
	vz: number;
}

function generateParticles(
	count: number,
): { particlesData: ParticleData[]; positions: Float32Array } {
	const particlesData: ParticleData[] = [];
	const positions = new Float32Array(MAX_PARTICLES_PER_CHUNK * 3);

	for (let i = 0; i < MAX_PARTICLES_PER_CHUNK; i++) {
		positions[i * 3] = (Math.random() - 0.5) * CHUNK_SIZE;
		positions[i * 3 + 1] = (Math.random() - 0.5) * CHUNK_HEIGHT;
		positions[i * 3 + 2] = (Math.random() - 0.5) * CHUNK_SIZE;
		if (i < count) {
			particlesData.push({
				vx: -1 + Math.random() * 2,
				vy: -1 + Math.random() * 2,
				vz: -1 + Math.random() * 2,
			});
		}
	}

	return { particlesData, positions };
}

class NetworkChunk implements ChunkContent {
	readonly group = new THREE.Group();
	readonly stationSlot: THREE.Vector3 | null;
	private readonly particlesData: ParticleData[];
	private readonly positions: Float32Array;
	private readonly linePositions: Float32Array;
	private readonly lineColors: Float32Array;
	private readonly particleGeo: THREE.BufferGeometry;
	private readonly lineGeo: THREE.BufferGeometry;
	private readonly particleCount: number;
	private readonly connectionDistance: number;
	private readonly driftSpeed: number;
	private readonly half: number;
	private readonly heightHalf: number;
	private lastElapsed = 0;

	constructor(
		cx: number,
		cz: number,
		params: EnvironmentBuildParams,
		_spawnTime: number,
	) {
		this.group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);

		const particleCount = params.particleCount ?? 100;
		const connectionDistance = params.connectionDistance ?? 60;
		const driftSpeed = params.driftSpeed ?? 12;
		this.particleCount = particleCount;
		this.connectionDistance = connectionDistance;
		this.driftSpeed = driftSpeed;
		this.half = CHUNK_HALF;
		this.heightHalf = HEIGHT_HALF;

		const { particlesData, positions } = generateParticles(particleCount);
		this.particlesData = particlesData;
		this.positions = positions;

		this.particleGeo = new THREE.BufferGeometry();
		this.particleGeo.setDrawRange(0, particleCount);
		this.particleGeo.setAttribute(
			"position",
			new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
		);

		const particleMat = new THREE.PointsMaterial({
			color: 0x00ffcc,
			size: 2.5,
			blending: THREE.AdditiveBlending,
			transparent: true,
			opacity: 0.9,
			depthWrite: false,
		});
		const points = new THREE.Points(this.particleGeo, particleMat);
		points.frustumCulled = false;
		this.group.add(points);

		const maxLines = MAX_PARTICLES_PER_CHUNK * MAX_PARTICLES_PER_CHUNK;
		this.linePositions = new Float32Array(maxLines * 3);
		this.lineColors = new Float32Array(maxLines * 3);

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

		const lineMat = new THREE.LineBasicMaterial({
			vertexColors: true,
			blending: THREE.AdditiveBlending,
			transparent: true,
			opacity: 0.6,
			depthWrite: false,
		});
		const lines = new THREE.LineSegments(this.lineGeo, lineMat);
		lines.frustumCulled = false;
		this.group.add(lines);

		this.stationSlot = params.stationWeight > 0
			? new THREE.Vector3(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE)
			: null;
	}

	update(elapsed: number): void {
		const delta = this.lastElapsed === 0 ? 0.016 : elapsed - this.lastElapsed;
		this.lastElapsed = elapsed;
		if (delta <= 0) return;

		const connDistSq = this.connectionDistance * this.connectionDistance;
		let vertexpos = 0;
		let colorpos = 0;
		let numConnected = 0;

		for (let i = 0; i < this.particleCount; i++) {
			const d = this.particlesData[i];
			this.positions[i * 3] += d.vx * delta * this.driftSpeed;
			this.positions[i * 3 + 1] += d.vy * delta * this.driftSpeed;
			this.positions[i * 3 + 2] += d.vz * delta * this.driftSpeed;

			if (this.positions[i * 3] < -this.half || this.positions[i * 3] > this.half) d.vx = -d.vx;
			if (this.positions[i * 3 + 1] < -this.heightHalf || this.positions[i * 3 + 1] > this.heightHalf) d.vy = -d.vy;
			if (this.positions[i * 3 + 2] < -this.half || this.positions[i * 3 + 2] > this.half) d.vz = -d.vz;
		}

		for (let i = 0; i < this.particleCount; i++) {
			for (let j = i + 1; j < this.particleCount; j++) {
				const dx = this.positions[i * 3] - this.positions[j * 3];
				const dy = this.positions[i * 3 + 1] - this.positions[j * 3 + 1];
				const dz = this.positions[i * 3 + 2] - this.positions[j * 3 + 2];
				const distSq = dx * dx + dy * dy + dz * dz;

				if (distSq < connDistSq) {
					const dist = Math.sqrt(distSq);
					const alpha = 1.0 - dist / this.connectionDistance;

					this.linePositions[vertexpos] = this.positions[i * 3];
					this.linePositions[vertexpos + 1] = this.positions[i * 3 + 1];
					this.linePositions[vertexpos + 2] = this.positions[i * 3 + 2];
					this.linePositions[vertexpos + 3] = this.positions[j * 3];
					this.linePositions[vertexpos + 4] = this.positions[j * 3 + 1];
					this.linePositions[vertexpos + 5] = this.positions[j * 3 + 2];

					this.lineColors[colorpos] = alpha;
					this.lineColors[colorpos + 1] = alpha;
					this.lineColors[colorpos + 2] = alpha;
					this.lineColors[colorpos + 3] = alpha;
					this.lineColors[colorpos + 4] = alpha;
					this.lineColors[colorpos + 5] = alpha;

					vertexpos += 6;
					colorpos += 6;
					numConnected++;
				}
			}
		}

		this.lineGeo.setDrawRange(0, numConnected * 2);
		this.lineGeo.attributes.position.needsUpdate = true;
		this.lineGeo.attributes.color.needsUpdate = true;
		this.particleGeo.attributes.position.needsUpdate = true;
	}

	dispose(): void {
		this.particleGeo.dispose();
		this.lineGeo.dispose();
		for (const child of this.group.children) {
			if (child instanceof THREE.Points || child instanceof THREE.LineSegments) {
				if (child.material instanceof THREE.Material) child.material.dispose();
			}
		}
		this.group.clear();
	}
}

export class NetworkEnvironment implements Environment {
	buildChunk(
		cx: number,
		cz: number,
		params: EnvironmentBuildParams,
		spawnTime: number,
	): ChunkContent {
		return new NetworkChunk(cx, cz, params, spawnTime);
	}

	updateNeonColor(_color: THREE.Color): void {
		// No shared neon materials to recolor.
	}

	updateBuildingOpacity(_opacity: number): void {
		// No buildings to fade.
	}

	terrainHeightAt(_x: number, _z: number, _terrainLevel: number): number | null {
		return null;
	}

	dispose(): void {
		// No shared materials to free.
	}
}
