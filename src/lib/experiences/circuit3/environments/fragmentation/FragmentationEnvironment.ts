import * as THREE from "three";
import { CHUNK_SIZE } from "../types";
import type {
	ChunkContent,
	Environment,
	EnvironmentBuildParams,
} from "../types";

const PARTICLES_PER_CUBE = 120;
const CUBE_SIZE = 28;
const EXPLOSION_DELAY = 1.2;
const GROW_DURATION = 0.6;
const PARTICLE_LIFETIME = 3.5;
const HOME_SPEED = 18;
const HOME_SPREAD = 0.6;

const CUBE_COLOR = 0xff6600;
const CUBE_GEO = new THREE.BoxGeometry(1, 1, 1);

class FragmentationChunk implements ChunkContent {
	readonly group = new THREE.Group();
	readonly stationSlot: THREE.Vector3 | null;
	private readonly targetPos: THREE.Vector3;

	private readonly cubeMesh: THREE.Mesh;
	private readonly cubeEdges: THREE.LineSegments;
	private readonly triggerTime: number;
	private exploded = false;
	private readonly spawnTime: number;

	private readonly particlePositions: Float32Array;
	private readonly particleColors: Float32Array;
	private readonly particleStartColors: Float32Array;
	private readonly particleVelocities: THREE.Vector3[];
	private readonly particleLifetimes: Float32Array;
	private readonly particleMaxLifetimes: Float32Array;
	private readonly particleGeo: THREE.BufferGeometry;
	private readonly particleMat: THREE.PointsMaterial;
	private readonly particlePoints: THREE.Points;

	private lastElapsed = 0;

	constructor(
		cx: number,
		cz: number,
		params: EnvironmentBuildParams,
		spawnTime: number,
		targetPos: THREE.Vector3,
	) {
		this.spawnTime = spawnTime;
		this.targetPos = targetPos;
		this.group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);

		const rng = seedRng(cx, cz);

		// ── Single big cube ─────────────────────────────────────────────
		const x = (rng() - 0.5) * CHUNK_SIZE * 0.7;
		const z = (rng() - 0.5) * CHUNK_SIZE * 0.7;
		const y = CUBE_SIZE / 2 + rng() * 15;

		const mat = new THREE.MeshBasicMaterial({
			color: CUBE_COLOR,
			transparent: true,
			opacity: 0.2,
		});
		this.cubeMesh = new THREE.Mesh(CUBE_GEO, mat);
		this.cubeMesh.position.set(x, y, z);
		this.cubeMesh.scale.set(0.001, 0.001, 0.001);
		this.group.add(this.cubeMesh);

		const edgeMat = new THREE.LineBasicMaterial({
			color: CUBE_COLOR,
			transparent: true,
			opacity: 0.9,
		});
		this.cubeEdges = new THREE.LineSegments(
			new THREE.EdgesGeometry(CUBE_GEO),
			edgeMat,
		);
		this.cubeEdges.position.copy(this.cubeMesh.position);
		this.cubeEdges.scale.copy(this.cubeMesh.scale);
		this.group.add(this.cubeEdges);

		this.triggerTime = spawnTime + EXPLOSION_DELAY + rng() * 2.0;

		// ── Particle buffer ─────────────────────────────────────────────
		this.particlePositions = new Float32Array(PARTICLES_PER_CUBE * 3);
		this.particleColors = new Float32Array(PARTICLES_PER_CUBE * 3);
		this.particleStartColors = new Float32Array(PARTICLES_PER_CUBE * 3);
		this.particleVelocities = [];
		this.particleLifetimes = new Float32Array(PARTICLES_PER_CUBE);
		this.particleMaxLifetimes = new Float32Array(PARTICLES_PER_CUBE);

		for (let i = 0; i < PARTICLES_PER_CUBE; i++) {
			this.particlePositions[i * 3] = 0;
			this.particlePositions[i * 3 + 1] = -9999;
			this.particlePositions[i * 3 + 2] = 0;
			this.particleColors[i * 3] = 0;
			this.particleColors[i * 3 + 1] = 0;
			this.particleColors[i * 3 + 2] = 0;
			this.particleStartColors[i * 3] = 0;
			this.particleStartColors[i * 3 + 1] = 0;
			this.particleStartColors[i * 3 + 2] = 0;
			this.particleVelocities.push(new THREE.Vector3(0, 0, 0));
			this.particleLifetimes[i] = 0;
			this.particleMaxLifetimes[i] = 1;
		}

		this.particleGeo = new THREE.BufferGeometry();
		this.particleGeo.setAttribute(
			"position",
			new THREE.BufferAttribute(this.particlePositions, 3).setUsage(THREE.DynamicDrawUsage),
		);
		this.particleGeo.setAttribute(
			"color",
			new THREE.BufferAttribute(this.particleColors, 3).setUsage(THREE.DynamicDrawUsage),
		);
		this.particleGeo.setDrawRange(0, 0);

		this.particleMat = new THREE.PointsMaterial({
			size: 1.5,
			blending: THREE.AdditiveBlending,
			transparent: true,
			opacity: 0.9,
			depthWrite: false,
			vertexColors: true,
		});
		this.particlePoints = new THREE.Points(this.particleGeo, this.particleMat);
		this.particlePoints.frustumCulled = false;
		this.group.add(this.particlePoints);

		this.stationSlot = params.stationWeight > 0
			? new THREE.Vector3(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE)
			: null;
	}

	update(elapsed: number): void {
		const delta = this.lastElapsed === 0 ? 0.016 : elapsed - this.lastElapsed;
		this.lastElapsed = elapsed;
		if (delta <= 0) return;

		const age = elapsed - this.spawnTime;
		let changed = false;

		// ── Growth animation ───────────────────────────────────────────
		if (!this.exploded) {
			const growT = Math.min(age / GROW_DURATION, 1);
			const eased = 1 - (1 - growT) ** 3;
			const s = Math.max(0.001, eased * CUBE_SIZE);
			this.cubeMesh.scale.set(s, s, s);
			this.cubeEdges.scale.set(s, s, s);
			changed = true;
		}

		// ── Explosion trigger ──────────────────────────────────────────
		if (!this.exploded && elapsed >= this.triggerTime) {
			this.exploded = true;
			this.cubeMesh.visible = false;
			this.cubeEdges.visible = false;

			const pos = this.cubeMesh.position;
			const worldPos = new THREE.Vector3(
				this.group.position.x + pos.x,
				pos.y,
				this.group.position.z + pos.z,
			);
			const color = (this.cubeMesh.material as THREE.MeshBasicMaterial).color;

			for (let i = 0; i < PARTICLES_PER_CUBE; i++) {
				const dx = (Math.random() - 0.5) * CUBE_SIZE * 0.3;
				const dy = (Math.random() - 0.5) * CUBE_SIZE * 0.3;
				const dz = (Math.random() - 0.5) * CUBE_SIZE * 0.3;

				this.particlePositions[i * 3] = pos.x + dx;
				this.particlePositions[i * 3 + 1] = pos.y + dy;
				this.particlePositions[i * 3 + 2] = pos.z + dz;

				// Velocity toward station target with random spread
				const dir = new THREE.Vector3()
					.copy(this.targetPos)
					.sub(worldPos)
					.add(new THREE.Vector3(
						(Math.random() - 0.5) * HOME_SPREAD * 40,
						(Math.random() - 0.5) * HOME_SPREAD * 30,
						(Math.random() - 0.5) * HOME_SPREAD * 40,
					))
					.normalize();

				const speed = HOME_SPEED * (0.7 + Math.random() * 0.6);
				this.particleVelocities[i].copy(dir).multiplyScalar(speed);

				const brightness = 0.6 + Math.random() * 0.4;
				const pr = color.r * brightness;
				const pg = color.g * brightness;
				const pb = color.b * brightness;
				this.particleStartColors[i * 3] = pr;
				this.particleStartColors[i * 3 + 1] = pg;
				this.particleStartColors[i * 3 + 2] = pb;
				this.particleColors[i * 3] = pr;
				this.particleColors[i * 3 + 1] = pg;
				this.particleColors[i * 3 + 2] = pb;

				this.particleLifetimes[i] = PARTICLE_LIFETIME * (0.6 + Math.random() * 0.4);
				this.particleMaxLifetimes[i] = this.particleLifetimes[i];
			}

			changed = true;
		}

		// ── Update particles ───────────────────────────────────────────
		let totalAlive = 0;
		for (let i = 0; i < PARTICLES_PER_CUBE; i++) {
			const life = this.particleLifetimes[i];
			if (life <= 0) continue;

			const newLife = life - delta;
			this.particleLifetimes[i] = newLife;

			if (newLife <= 0) {
				this.particlePositions[i * 3 + 1] = -9999;
				continue;
			}

			// Apply drag so particles slow as they approach the target
			const vel = this.particleVelocities[i];
			this.particlePositions[i * 3] += vel.x * delta;
			this.particlePositions[i * 3 + 1] += vel.y * delta;
			this.particlePositions[i * 3 + 2] += vel.z * delta;
			vel.multiplyScalar(0.99);

			const t = newLife / this.particleMaxLifetimes[i];
			const fade = t < 0.15 ? t / 0.15 : 1;
			this.particleColors[i * 3] = this.particleStartColors[i * 3] * fade;
			this.particleColors[i * 3 + 1] = this.particleStartColors[i * 3 + 1] * fade;
			this.particleColors[i * 3 + 2] = this.particleStartColors[i * 3 + 2] * fade;

			totalAlive++;
			changed = true;
		}

		if (changed) {
			this.particleGeo.attributes.position.needsUpdate = true;
			this.particleGeo.attributes.color.needsUpdate = true;
			this.particleGeo.setDrawRange(0, totalAlive);
		}
	}

	dispose(): void {
		this.cubeMesh.geometry.dispose();
		if (this.cubeMesh.material instanceof THREE.Material) this.cubeMesh.material.dispose();
		this.cubeEdges.geometry.dispose();
		if (this.cubeEdges.material instanceof THREE.Material) this.cubeEdges.material.dispose();
		this.particleGeo.dispose();
		this.particleMat.dispose();
		this.group.clear();
	}
}

function seedRng(cx: number, cz: number): () => number {
	let seed = (cx * 374761393 + cz * 668265263) & 0x7fffffff;
	return () => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed / 0x7fffffff;
	};
}

export class FragmentationEnvironment implements Environment {
	readonly stationTarget = new THREE.Vector3(0, 30, 0);

	buildChunk(
		cx: number,
		_cy: number,
		cz: number,
		params: EnvironmentBuildParams,
		spawnTime: number,
	): ChunkContent {
		// Ground-based environment: no vertical streaming, so `cy` is always 0.
		return new FragmentationChunk(cx, cz, params, spawnTime, this.stationTarget);
	}

	updateNeonColor(_color: THREE.Color): void {}

	updateBuildingOpacity(_opacity: number): void {}

	terrainHeightAt(_x: number, _z: number, _terrainLevel: number): number | null {
		return null;
	}

	dispose(): void {}
}
