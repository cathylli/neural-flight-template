import * as THREE from "three";
import { CHUNK_HEIGHT, CHUNK_SIZE } from "../types";
import type {
	ChunkContent,
	Environment,
	EnvironmentBuildParams,
} from "../types";

// ── Fiber Tunnel Environment (Glasfaser-Autobahn) ───────────────────────────
//
// A psychedelic tunnel of pure light — the Lichtgeschwindigkeits-Tunnel.
// After the router maze the player shoots through this fiber-optic cable at
// light speed.  Longitudinal light streaks line the cylindrical shell and shift
// through an anamorphic blue-white palette via a custom shader.  Frequent ring
// markers fly past to amplify the sense of speed.
//
// Like the NeuralEnvironment this is a true 3D volume (verticalRadius = 1):
// chunk layers stream above and below the player so the tunnel extends
// infinitely in every direction — no ground surface.

const FIBER_CONFIG = {
	tunnelInnerRadius: 12,
	tunnelOuterRadius: 45,
	streaksPerChunk: 100,
	streakLength: 70,
	streakWidth: 0.2,
	horizontalBias: 0.75,
	cubesPerChunk: 10,
	cubeSize: 1.5,
	ringRadius: 42,
	ringTubeRadius: 0.8,
	ringRadialSegments: 8,
	ringTubularSegments: 48,
	ringSpacing: 40,
};

// ── Shaders ─────────────────────────────────────────────────────────────────

const streakVertexShader = /* glsl */ `
uniform float uTime;
varying vec3 vWorldPos;

void main() {
  // Extract instance position from the matrix.
  vec3 instPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);

  // Parallax: closer streaks move faster, outer ones slower.
  float dist = length(instPos.xy);
  float speed = mix(65.0, 20.0, dist / 45.0);

  vec3 pos = position;
  // Forward flow with wrapping so streaks loop seamlessly.
  pos.z = mod(pos.z + uTime * speed, 200.0) - 40.0;
  // Subtle lateral drift for organic feel.
  pos.x += sin(uTime * 1.5 + instPos.y * 0.1) * 0.3;
  pos.y += cos(uTime * 1.2 + instPos.x * 0.1) * 0.3;

  vec4 worldPos = modelMatrix * instanceMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const streakFragmentShader = /* glsl */ `
uniform float uTime;
varying vec3 vWorldPos;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  // Fast colour cycling along the tunnel (anamorphic blue-white base).
  float hue = fract(vWorldPos.z * 0.004 + uTime * 0.45);
  vec3 color = hsv2rgb(vec3(0.58 + hue * 0.12, 0.25 + hue * 0.15, 1.0));
  // Bright pulse synced to flight.
  float pulse = 0.8 + 0.2 * sin(uTime * 3.0 + vWorldPos.z * 0.08);
  gl_FragColor = vec4(color * pulse, 0.9);
}
`;

// ── Cube shaders (green data packets flowing through the tunnel) ────────────

const cubeVertexShader = /* glsl */ `
uniform float uTime;
varying vec3 vWorldPos;

void main() {
  vec3 instPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);

  // Slightly slower than streaks for contrast.
  float dist = length(instPos.xy);
  float speed = mix(50.0, 15.0, dist / 45.0);

  vec3 pos = position;
  pos.z = mod(pos.z + uTime * speed, 200.0) - 40.0;
  pos.x += sin(uTime * 2.0 + instPos.y * 0.15) * 0.4;
  pos.y += cos(uTime * 1.8 + instPos.x * 0.15) * 0.4;

  vec4 worldPos = modelMatrix * instanceMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const cubeFragmentShader = /* glsl */ `
uniform float uTime;
varying vec3 vWorldPos;

void main() {
  float pulse = 0.7 + 0.3 * sin(uTime * 4.0 + vWorldPos.z * 0.12);
  gl_FragColor = vec4(0.0, 1.0, 0.4, 0.9 * pulse);
}
`;

// ── Chunk ───────────────────────────────────────────────────────────────────

const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3(1, 1, 1);
const _pos = new THREE.Vector3();

class FiberTunnelChunk implements ChunkContent {
	readonly group = new THREE.Group();
	readonly stationSlot: THREE.Vector3 | null;

	private streakMesh: THREE.InstancedMesh | null;
	private cubeMesh: THREE.InstancedMesh | null;
	private readonly spawnTime: number;
	private grown = false;

	constructor(
		cx: number,
		cy: number,
		cz: number,
		params: EnvironmentBuildParams,
		streakGeo: THREE.BoxGeometry,
		streakMat: THREE.ShaderMaterial,
		ringGeo: THREE.TorusGeometry,
		ringMat: THREE.MeshBasicMaterial,
		cubeGeo: THREE.BoxGeometry,
		cubeMat: THREE.ShaderMaterial,
		spawnTime: number,
	) {
		this.spawnTime = spawnTime;
		const originX = cx * CHUNK_SIZE;
		const originY = cy * CHUNK_HEIGHT;
		const originZ = cz * CHUNK_SIZE;
		this.group.position.set(originX, originY, originZ);
		this.group.scale.setScalar(0.001);

		// ── Streak positions (cylindrical shell with horizontal bias) ──
		const {
			tunnelInnerRadius,
			tunnelOuterRadius,
			streaksPerChunk,
			streakLength,
			horizontalBias,
		} = FIBER_CONFIG;

		const streakPositions: Array<{
			x: number;
			y: number;
			z: number;
			scale: number;
		}> = [];

		for (let i = 0; i < streaksPerChunk; i++) {
			const angle = Math.random() * Math.PI * 2;
			const radius =
				tunnelInnerRadius +
				Math.random() * (tunnelOuterRadius - tunnelInnerRadius);

			// Bias toward horizontal plane for anamorphic feel.
			let y: number;
			if (Math.random() < horizontalBias) {
				y = (Math.random() - 0.5) * 20;
			} else {
				y = (Math.random() - 0.5) * CHUNK_HEIGHT;
			}

			// Randomise length slightly for depth.
			const scale = 0.7 + Math.random() * 0.6;

			streakPositions.push({
				x: Math.cos(angle) * radius,
				y,
				z: Math.random() * CHUNK_SIZE - streakLength * 0.3,
				scale,
			});
		}

		// ── Instanced streak mesh ─────────────────────────────────────
		if (streakPositions.length > 0) {
			this.streakMesh = new THREE.InstancedMesh(
				streakGeo,
				streakMat,
				streakPositions.length,
			);
			this.streakMesh.frustumCulled = false;
			for (let i = 0; i < streakPositions.length; i++) {
				const p = streakPositions[i];
				_pos.set(p.x, p.y, p.z);
				_scl.set(1, 1, p.scale);
				_mat4.compose(_pos, _quat.identity(), _scl);
				this.streakMesh.setMatrixAt(i, _mat4);
			}
			this.streakMesh.instanceMatrix.needsUpdate = true;
			this.group.add(this.streakMesh);
		} else {
			this.streakMesh = null;
		}

		// ── Green data-packet cubes ─────────────────────────────────────
		const { cubesPerChunk } = FIBER_CONFIG;
		const cubePositions: Array<{ x: number; y: number; z: number }> = [];
		for (let i = 0; i < cubesPerChunk; i++) {
			const angle = Math.random() * Math.PI * 2;
			const radius =
				tunnelInnerRadius +
				Math.random() * (tunnelOuterRadius - tunnelInnerRadius);
			let y: number;
			if (Math.random() < horizontalBias) {
				y = (Math.random() - 0.5) * 20;
			} else {
				y = (Math.random() - 0.5) * CHUNK_HEIGHT;
			}
			cubePositions.push({
				x: Math.cos(angle) * radius,
				y,
				z: Math.random() * CHUNK_SIZE,
			});
		}
		if (cubePositions.length > 0) {
			this.cubeMesh = new THREE.InstancedMesh(cubeGeo, cubeMat, cubePositions.length);
			this.cubeMesh.frustumCulled = false;
			for (let i = 0; i < cubePositions.length; i++) {
				const p = cubePositions[i];
				_pos.set(p.x, p.y, p.z);
				_mat4.compose(_pos, _quat.identity(), _scl);
				this.cubeMesh.setMatrixAt(i, _mat4);
			}
			this.cubeMesh.instanceMatrix.needsUpdate = true;
			this.group.add(this.cubeMesh);
		} else {
			this.cubeMesh = null;
		}

		// ── Ring markers at regular Z intervals ───────────────────────
		const { ringRadius, ringTubeRadius, ringSpacing } = FIBER_CONFIG;
		const ringGeoScaled = new THREE.TorusGeometry(
			ringRadius,
			ringTubeRadius,
			FIBER_CONFIG.ringRadialSegments,
			FIBER_CONFIG.ringTubularSegments,
		);
		const ringsPerChunk = Math.ceil(CHUNK_SIZE / ringSpacing);
		for (let r = 0; r < ringsPerChunk; r++) {
			const z = r * ringSpacing;
			if (z > CHUNK_SIZE) break;
			const ring = new THREE.Mesh(ringGeoScaled, ringMat);
			ring.position.set(0, 0, z);
			this.group.add(ring);
		}

		// Station slot at chunk centre (tunnel centre).
		this.stationSlot =
			params.stationWeight > 0
				? new THREE.Vector3(originX, originY, originZ + CHUNK_SIZE / 2)
				: null;
	}

	update(elapsed: number): void {
		if (this.grown) return;
		const GROW_DURATION = 0.5;
		const age = elapsed - this.spawnTime;
		const t = Math.min(age / GROW_DURATION, 1);
		const eased = t * t * (3 - 2 * t); // smoothstep
		this.group.scale.setScalar(Math.max(0.001, eased));
		if (t >= 1) this.grown = true;
	}

	dispose(): void {
		this.streakMesh?.dispose();
		this.cubeMesh?.dispose();
		this.group.clear();
	}
}

// ── Environment ─────────────────────────────────────────────────────────────

export class FiberTunnelEnvironment implements Environment {
	readonly verticalRadius = 1;

	private streakGeo: THREE.BoxGeometry;
	private streakMat: THREE.ShaderMaterial;
	private cubeGeo: THREE.BoxGeometry;
	private cubeMat: THREE.ShaderMaterial;
	private ringGeo: THREE.TorusGeometry;
	private ringMat: THREE.MeshBasicMaterial;
	private elapsed = 0;

	constructor() {
		const { streakWidth, streakLength, cubeSize } = FIBER_CONFIG;

		this.streakGeo = new THREE.BoxGeometry(
			streakWidth,
			streakWidth,
			streakLength,
		);

		this.streakMat = new THREE.ShaderMaterial({
			vertexShader: streakVertexShader,
			fragmentShader: streakFragmentShader,
			uniforms: {
				uTime: { value: 0 },
			},
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});

		this.cubeGeo = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);

		this.cubeMat = new THREE.ShaderMaterial({
			vertexShader: cubeVertexShader,
			fragmentShader: cubeFragmentShader,
			uniforms: {
				uTime: { value: 0 },
			},
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});

		this.ringGeo = new THREE.TorusGeometry(
			FIBER_CONFIG.ringRadius,
			FIBER_CONFIG.ringTubeRadius,
			FIBER_CONFIG.ringRadialSegments,
			FIBER_CONFIG.ringTubularSegments,
		);

		this.ringMat = new THREE.MeshBasicMaterial({
			color: 0x6688cc,
			transparent: true,
			opacity: 0.25,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
	}

	buildChunk(
		cx: number,
		cy: number,
		cz: number,
		params: EnvironmentBuildParams,
		_spawnTime: number,
	): ChunkContent {
		return new FiberTunnelChunk(
			cx,
			cy,
			cz,
			params,
			this.streakGeo,
			this.streakMat,
			this.ringGeo,
			this.ringMat,
			this.cubeGeo,
			this.cubeMat,
			_spawnTime,
		);
	}

	tick(delta: number): void {
		this.elapsed += delta;
		this.streakMat.uniforms.uTime.value = this.elapsed;
		this.cubeMat.uniforms.uTime.value = this.elapsed;
		this.ringMat.opacity = 0.2 + 0.08 * Math.sin(this.elapsed * 3.0);
	}

	updateNeonColor(_color: THREE.Color): void {
		// Uses its own anamorphic blue-white palette.
	}

	updateBuildingOpacity(_opacity: number): void {
		// No buildings to fade.
	}

	terrainHeightAt(
		_x: number,
		_z: number,
		_terrainLevel: number,
	): number | null {
		return null; // Volumetric tunnel — no ground collision.
	}

	dispose(): void {
		this.streakGeo.dispose();
		this.streakMat.dispose();
		this.cubeGeo.dispose();
		this.cubeMat.dispose();
		this.ringGeo.dispose();
		this.ringMat.dispose();
	}
}
