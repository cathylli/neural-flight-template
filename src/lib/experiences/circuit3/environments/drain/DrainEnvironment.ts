import * as THREE from "three";
import { createGradientSky } from "$lib/three/gradient-sky";
import { CHUNK_SIZE } from "../types";
import type {
	ChunkContent,
	Environment,
	EnvironmentBuildParams,
} from "../types";

// ── Drain Environment ────────────────────────────────────────────────────────
//
// L6 — a vast grid floor with large square holes and particles that drain
// downward through them, giving the impression of water pouring into a pit.

const CELL = 8;
const GRID = 15; // 15 × 15 tiles per chunk → 120 units
const GAP = 0.35;
const HOLE_CLUSTER = 3; // holes appear in 3×3 clusters
const HOLE_CHANCE = 0.28;
const DRAIN_COUNT = 30; // particles per hole
const DRAIN_DEPTH = 80;
const FLOW_COUNT = 120; // surface particles per chunk

// ── Heat (rising red particles) ──────────────────────────────────────────────

const HEAT_CHANCE = 0.2; // 20% of holes get heat instead of drain
const HEAT_COUNT = 40; // particles per heat hole
const HEAT_RISE_DEPTH = 150;

// ── Deterministic hash ───────────────────────────────────────────────────────

function hash21(x: number, y: number, salt: number): number {
	let h =
		Math.imul(x | 0, 0x27d4eb2d) ^
		Math.imul(y | 0, 0x165667b1) ^
		Math.imul(salt | 0, 0x85ebca77);
	h ^= h >>> 15;
	h = Math.imul(h, 0x2c1b3c6d);
	h ^= h >>> 12;
	return (h >>> 0) / 4294967296;
}

function isHole(cx: number, cz: number, gx: number, gz: number): boolean {
	const bx = Math.floor(gx / HOLE_CLUSTER);
	const bz = Math.floor(gz / HOLE_CLUSTER);
	return hash21(cx * 100 + bx, cz * 100 + bz, 42) < HOLE_CHANCE;
}

// ── Drain shader ─────────────────────────────────────────────────────────────

const drainVS = /* glsl */ `
attribute float aOff;
uniform float uTime;
varying float vAlpha;
void main() {
  vec3 p = position;
  float t = fract(uTime * 0.18 + aOff);
  p.y -= t * ${DRAIN_DEPTH.toFixed(0)}.0;
  vAlpha = (1.0 - t) * 0.85;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(2.0, 5.5 - length(mv.xyz) * 0.008);
}
`;

const drainFS = /* glsl */ `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5) discard;
  float soft = 1.0 - smoothstep(0.15, 0.5, d);
  gl_FragColor = vec4(0.0, 0.45, 1.0, soft * vAlpha);
}
`;

// ── Surface flow shader (particles drifting across the floor) ────────────────

const flowVS = /* glsl */ `
attribute float aOff;
attribute float aPhase;
uniform float uTime;
varying float vAlpha;
void main() {
  vec3 p = position;
  float t = uTime * 0.5 + aOff * 20.0;
  p.x += sin(t + aPhase) * 1.2;
  p.z += cos(t * 0.7 + aPhase * 1.3) * 1.2;
  vAlpha = 0.4 + 0.3 * sin(t * 2.0 + aPhase);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.5, 3.5 - length(mv.xyz) * 0.006);
}
`;

const flowFS = /* glsl */ `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5) discard;
  float soft = 1.0 - smoothstep(0.1, 0.5, d);
  gl_FragColor = vec4(0.0, 0.6, 0.9, soft * vAlpha);
}
`;

// ── Heat shader (red particles rising upward) ───────────────────────────────

const heatVS = /* glsl */ `
attribute float aOff;
uniform float uTime;
varying float vAlpha;
void main() {
  vec3 p = position;
  float t = fract(uTime * 0.2 + aOff);
  p.y += t * ${HEAT_RISE_DEPTH.toFixed(0)}.0;
  vAlpha = (1.0 - t) * 0.9;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(2.0, 6.0 - length(mv.xyz) * 0.008);
}
`;

const heatFS = /* glsl */ `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5) discard;
  float soft = 1.0 - smoothstep(0.15, 0.5, d);
  gl_FragColor = vec4(1.0, 0.3, 0.0, soft * vAlpha);
}
`;

// ── Shared resources (owned by environment, shared across chunks) ─────────────

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

// ── Server model ──────────────────────────────────────────────────────────────

const SERVER_COLOR = 0x0088ff;
const SERVER_SPACING = 12; // grid spacing across entire chunk
const SERVER_SIZE = 4;

// Blue wireframe cube for server racks (replaces GLB model for performance)
const serverGeo = new THREE.BoxGeometry(SERVER_SIZE, SERVER_SIZE * 2, SERVER_SIZE);
const serverWireMat = new THREE.MeshBasicMaterial({
	color: SERVER_COLOR,
	wireframe: true,
	transparent: true,
	opacity: 0.8,
});

// ── Chunk ────────────────────────────────────────────────────────────────────

const GROWTH_DURATION = 1.2; // seconds for chunk to grow in
const MAX_TILES = GRID * GRID; // maximum tile instances per chunk

const _tileMatrix = new THREE.Matrix4();
const _tilePosition = new THREE.Vector3();
const _tileQuaternion = new THREE.Quaternion();
const _tileScale = new THREE.Vector3(1, 1, 1);
const _tileEuler = new THREE.Euler(-Math.PI / 2, 0, 0);

class DrainChunk implements ChunkContent {
	readonly group = new THREE.Group();
	readonly stationSlot: THREE.Vector3 | null;

	private tileInstancedMesh: THREE.InstancedMesh;
	private wireInstancedMesh: THREE.InstancedMesh;
	private tileCount = 0;
	private serverInstancedMesh: THREE.InstancedMesh | null = null;
	private serverCount = 0;
	private readonly spawnTime: number;
	private grown = false;
	private readonly cx: number;
	private readonly cz: number;
	private readonly liveChunks: Set<DrainChunk>;

	constructor(
		cx: number,
		cz: number,
		params: EnvironmentBuildParams,
		floorMat: THREE.MeshStandardMaterial,
		wireframeMat: THREE.MeshBasicMaterial,
		floorGeo: THREE.PlaneGeometry,
		drainMat: THREE.ShaderMaterial,
		flowMat: THREE.ShaderMaterial,
		heatMat: THREE.ShaderMaterial,
		_spawnTime: number,
		liveChunks: Set<DrainChunk>,
	) {
		const ox = cx * CHUNK_SIZE;
		const oz = cz * CHUNK_SIZE;
		this.group.position.set(ox, 0, oz);
		this.spawnTime = _spawnTime;
		this.cx = cx;
		this.cz = cz;
		this.liveChunks = liveChunks;
		liveChunks.add(this);

		this.group.scale.set(1, 0.001, 1);

		const half = GRID / 2;
		const cellWorld = CELL;
		const holeCentres: THREE.Vector3[] = [];

		// ── InstancedMesh for floor tiles (1 draw call instead of ~162) ──
		this.tileInstancedMesh = new THREE.InstancedMesh(floorGeo, floorMat, MAX_TILES);
		this.tileInstancedMesh.frustumCulled = false;
		this.group.add(this.tileInstancedMesh);

		this.wireInstancedMesh = new THREE.InstancedMesh(floorGeo, wireframeMat, MAX_TILES);
		this.wireInstancedMesh.frustumCulled = false;
		this.wireInstancedMesh.position.y = 0.01;
		this.group.add(this.wireInstancedMesh);

		// Build floor grid — holes get zero-scale matrix to hide them
		_tileEuler.set(-Math.PI / 2, 0, 0);
		_tileQuaternion.setFromEuler(_tileEuler);
		const _holeScale = new THREE.Vector3(0, 0, 0);
		for (let gx = 0; gx < GRID; gx++) {
			for (let gz = 0; gz < GRID; gz++) {
				const isH = isHole(cx, cz, gx, gz);
				_tilePosition.set(
					(gx - half + 0.5) * cellWorld,
					0,
					(gz - half + 0.5) * cellWorld,
				);
				if (isH) {
					// Hidden — zero scale
					_tileMatrix.compose(_tilePosition, _tileQuaternion, _holeScale);
					holeCentres.push(_tilePosition.clone());
				} else {
					_tileMatrix.compose(_tilePosition, _tileQuaternion, _tileScale);
				}
				this.tileInstancedMesh.setMatrixAt(this.tileCount, _tileMatrix);
				this.wireInstancedMesh.setMatrixAt(this.tileCount, _tileMatrix);
				this.tileCount++;
			}
		}
		this.tileInstancedMesh.count = this.tileCount;
		this.tileInstancedMesh.instanceMatrix.needsUpdate = true;
		this.wireInstancedMesh.count = this.tileCount;
		this.wireInstancedMesh.instanceMatrix.needsUpdate = true;

		// ── Drain particles (fall through holes) + Heat (rise from holes) ──
		if (holeCentres.length > 0) {
			const drainHoles: THREE.Vector3[] = [];
			const heatHoles: THREE.Vector3[] = [];
			for (const h of holeCentres) {
				if (Math.random() < HEAT_CHANCE) {
					heatHoles.push(h);
				} else {
					drainHoles.push(h);
				}
			}

			if (drainHoles.length > 0) {
				const total = drainHoles.length * DRAIN_COUNT;
				const pos = new Float32Array(total * 3);
				const off = new Float32Array(total);
				let idx = 0;
				for (const h of drainHoles) {
					for (let i = 0; i < DRAIN_COUNT; i++) {
						pos[idx * 3] = h.x + (Math.random() - 0.5) * (CELL - GAP);
						pos[idx * 3 + 1] = 0.5;
						pos[idx * 3 + 2] = h.z + (Math.random() - 0.5) * (CELL - GAP);
						off[idx] = Math.random();
						idx++;
					}
				}
				const geo = new THREE.BufferGeometry();
				geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
				geo.setAttribute("aOff", new THREE.BufferAttribute(off, 1));
				const pts = new THREE.Points(geo, drainMat);
				pts.frustumCulled = false;
				this.group.add(pts);
			}

			if (heatHoles.length > 0) {
				const total = heatHoles.length * HEAT_COUNT;
				const pos = new Float32Array(total * 3);
				const off = new Float32Array(total);
				let idx = 0;
				for (const h of heatHoles) {
					for (let i = 0; i < HEAT_COUNT; i++) {
						pos[idx * 3] = h.x + (Math.random() - 0.5) * (CELL - GAP);
						pos[idx * 3 + 1] = 0.5;
						pos[idx * 3 + 2] = h.z + (Math.random() - 0.5) * (CELL - GAP);
						off[idx] = Math.random();
						idx++;
					}
				}
				const geo = new THREE.BufferGeometry();
				geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
				geo.setAttribute("aOff", new THREE.BufferAttribute(off, 1));
				const pts = new THREE.Points(geo, heatMat);
				pts.frustumCulled = false;
				this.group.add(pts);
			}
		}

		// ── Surface flow particles ────────────────────────────────────────
		{
			const pos = new Float32Array(FLOW_COUNT * 3);
			const off = new Float32Array(FLOW_COUNT);
			const phase = new Float32Array(FLOW_COUNT);
			for (let i = 0; i < FLOW_COUNT; i++) {
				pos[i * 3] = (Math.random() - 0.5) * CHUNK_SIZE;
				pos[i * 3 + 1] = 0.3;
				pos[i * 3 + 2] = (Math.random() - 0.5) * CHUNK_SIZE;
				off[i] = Math.random();
				phase[i] = Math.random() * Math.PI * 2;
			}
			const geo = new THREE.BufferGeometry();
			geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
			geo.setAttribute("aOff", new THREE.BufferAttribute(off, 1));
			geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
			const pts = new THREE.Points(geo, flowMat);
			pts.frustumCulled = false;
			this.group.add(pts);
		}

		// ── Server farm — InstancedMesh wireframe cubes ───────────────
		this.buildServerInstances();

		this.stationSlot =
			params.stationWeight > 0
				? new THREE.Vector3(ox, 0, oz)
				: null;
	}

	private buildServerInstances(): void {
		const halfChunk = (GRID * CELL) / 2;
		const positions: THREE.Vector3[] = [];
		for (let sx = -halfChunk + SERVER_SPACING / 2; sx < halfChunk; sx += SERVER_SPACING) {
			for (let sz = -halfChunk + SERVER_SPACING / 2; sz < halfChunk; sz += SERVER_SPACING) {
				const gx = Math.floor((sx + halfChunk) / CELL);
				const gz = Math.floor((sz + halfChunk) / CELL);
				if (gx >= 0 && gx < GRID && gz >= 0 && gz < GRID && isHole(this.cx, this.cz, gx, gz)) {
					continue;
				}
				positions.push(new THREE.Vector3(sx, SERVER_SIZE, sz));
			}
		}
		if (positions.length === 0) return;

		this.serverInstancedMesh = new THREE.InstancedMesh(serverGeo, serverWireMat, positions.length);
		this.serverInstancedMesh.frustumCulled = false;
		for (let i = 0; i < positions.length; i++) {
			_tilePosition.copy(positions[i]);
			_tileQuaternion.identity();
			_tileScale.set(1, 1, 1);
			_tileMatrix.compose(_tilePosition, _tileQuaternion, _tileScale);
			this.serverInstancedMesh.setMatrixAt(i, _tileMatrix);
		}
		this.serverInstancedMesh.instanceMatrix.needsUpdate = true;
		this.group.add(this.serverInstancedMesh);
		this.serverCount = positions.length;
	}

	update(elapsed: number): void {
		if (!this.grown) {
			const t = Math.min((elapsed - this.spawnTime) / GROWTH_DURATION, 1.0);
			const eased = 1.0 - (1.0 - t) ** 3;
			this.group.scale.y = Math.max(0.001, eased);
			if (t >= 1.0) this.grown = true;
		}
	}

	get hasServers(): boolean {
		return this.serverCount > 0;
	}

	addServers(_template: THREE.Group): void {
		if (this.serverCount > 0) return;
		this.buildServerInstances();
	}

	dispose(): void {
		this.liveChunks.delete(this);
		this.tileInstancedMesh.dispose();
		this.wireInstancedMesh.dispose();
		if (this.serverInstancedMesh) {
			this.serverInstancedMesh.dispose();
		}
		for (const child of this.group.children) {
			if (child instanceof THREE.Points || child instanceof THREE.LineSegments) {
				if (child.material instanceof THREE.Material) child.material.dispose();
				if (child.geometry) child.geometry.dispose();
			}
		}
		this.group.clear();
	}
}

// ── Environment ──────────────────────────────────────────────────────────────

export class DrainEnvironment implements Environment {
	private readonly floorGeo = new THREE.PlaneGeometry(CELL - GAP, CELL - GAP);
	private readonly floorMat = new THREE.MeshStandardMaterial({
		color: 0x1a1a2e,
		metalness: 0.3,
		roughness: 0.7,
	});
	private readonly wireframeMat = new THREE.MeshBasicMaterial({
		color: 0x0088ff,
		wireframe: true,
		transparent: true,
		opacity: 0.3,
	});
	private readonly drainMat = new THREE.ShaderMaterial({
		vertexShader: drainVS,
		fragmentShader: drainFS,
		uniforms: { uTime: { value: 0 } },
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
	});
	private readonly flowMat = new THREE.ShaderMaterial({
		vertexShader: flowVS,
		fragmentShader: flowFS,
		uniforms: { uTime: { value: 0 } },
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
	});
	private readonly heatMat = new THREE.ShaderMaterial({
		vertexShader: heatVS,
		fragmentShader: heatFS,
		uniforms: { uTime: { value: 0 } },
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
	});

	private sky: THREE.Mesh | null = null;
	private liveChunks = new Set<DrainChunk>();

	buildChunk(
		cx: number,
		_cy: number,
		cz: number,
		params: EnvironmentBuildParams,
		spawnTime: number,
	): ChunkContent {
		return new DrainChunk(
			cx,
			cz,
			params,
			this.floorMat,
			this.wireframeMat,
			this.floorGeo,
			this.drainMat,
			this.flowMat,
			this.heatMat,
			spawnTime,
			this.liveChunks,
		);
	}

	tick(delta: number): void {
		this.drainMat.uniforms.uTime.value += delta;
		this.flowMat.uniforms.uTime.value += delta;
		this.heatMat.uniforms.uTime.value += delta;
	}

	updateNeonColor(): void {}
	updateBuildingOpacity(): void {}

	terrainHeightAt(): number | null {
		return null;
	}

	init(scene: THREE.Scene): void {
		// No solid background - let the gradient sky show through
		scene.background = null;

		// Fog: dark reddish to blend with sky
		if (scene.fog instanceof THREE.Fog) {
			scene.fog.color.set(0x220808);
			scene.fog.near = 60;
			scene.fog.far = 350;
		} else if (scene.fog) {
			scene.fog.color.set(0x220808);
		}

		// Gradient sky dome: red at top, deep blue at bottom
		if (this.sky) {
			scene.remove(this.sky);
			this.sky.geometry.dispose();
			(this.sky.material as THREE.Material).dispose();
		}
		this.sky = createGradientSky({
			radius: 600,
			colors: [
				0xff3300, // bright hot red (zenith)
				0xcc2200, // deep red
				0x881122, // dark red-purple
				0x441133, // purple
				0x111133, // dark blue (horizon/bottom)
			],
		});
		scene.add(this.sky);
	}

	dispose(): void {
		this.floorGeo.dispose();
		this.floorMat.dispose();
		this.wireframeMat.dispose();
		this.drainMat.dispose();
		this.flowMat.dispose();
		this.heatMat.dispose();
		serverGeo.dispose();
		serverWireMat.dispose();
		if (this.sky) {
			this.sky.parent?.remove(this.sky);
			this.sky.geometry.dispose();
			(this.sky.material as THREE.Material).dispose();
			this.sky = null;
		}
	}
}
