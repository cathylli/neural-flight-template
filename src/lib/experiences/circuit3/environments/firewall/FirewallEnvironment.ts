import * as THREE from "three";
import type {
	ChunkContent,
	Environment,
	EnvironmentBuildParams,
} from "../types";
import { CircuitEnvironment } from "../circuit/CircuitEnvironment";

// ── Firewall Environment ─────────────────────────────────────────────────────
//
// The inside of a firewall: a pulsing node-and-line dome.
// Vertices visible as glowing points, lines appear near the player (draw range).
// After 20 seconds the storm calms and everything turns green.

const DOME_RADIUS = 120;
const DOME_DETAIL = 4;
const COLOR_CHANGE_DELAY = 20;
const COLOR_CHANGE_DURATION = 4;
const LINE_CONNECT_DIST = 35;
const NODE_PULSE_SPEED = 2.0;
const ENERGY_LINE_COUNT = 16;

// ── Dome Shader (stormy version) ─────────────────────────────────────────────

const domeVertexShader = /* glsl */ `
uniform float uTime;
uniform float uStorm;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vDisplacement;

void main() {
  vNormal = normalize(normalMatrix * normal);

  float fast = sin(uTime * 2.5) * 0.5 + 0.5;
  float wave = sin(position.x * 0.07 + position.y * 0.04 + uTime * 2.0) *
               cos(position.z * 0.05 + position.y * 0.08 + uTime * 1.5);
  float chaos = sin(position.x * 0.12 + uTime * 3.0) *
                cos(position.z * 0.11 + uTime * 2.7) * 0.3;
  float displacement = (fast * 0.6 + wave * 0.4 + chaos) * 2.0 * uStorm;
  vDisplacement = displacement;

  vec3 displaced = position + normal * displacement;
  vWorldPos = (modelMatrix * vec4(displaced, 1.0)).xyz;

  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  vViewDir = normalize(-mvPosition.xyz);

  gl_Position = projectionMatrix * mvPosition;
}
`;

const domeFragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uStorm;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vDisplacement;

void main() {
  vec3 local = vWorldPos;

  float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
  fresnel = pow(fresnel, 2.0);

  float ripple = sin(vDisplacement * 6.0 + uTime * 2.0) * 0.5 + 0.5;
  ripple = smoothstep(0.3, 0.7, ripple);

  float pulse = 0.7 + 0.3 * sin(uTime * 1.5 + local.y * 0.05);

  float glow = fresnel * 0.6;
  float energy = ripple * 0.15;

  float flash = pow(max(0.0, sin(uTime * 4.0 + local.x * 0.03) *
                             cos(uTime * 3.0 + local.z * 0.04)), 8.0);
  float darken = 1.0 - uStorm * 0.3;

  float alpha = (0.4 + glow * 0.5 + energy * 0.15 + flash * 0.25) * pulse * darken;

  gl_FragColor = vec4(uColor, alpha);
}
`;

// ── Lerp helper ──────────────────────────────────────────────────────────────

const RED = new THREE.Color(0xff2222);
const GREEN = new THREE.Color(0x22ff44);

function lerpColor(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
	return new THREE.Color(
		a.r + (b.r - a.r) * t,
		a.g + (b.g - a.g) * t,
		a.b + (b.b - a.b) * t,
	);
}

// ── Edge data ────────────────────────────────────────────────────────────────

interface Edge {
	a: number;
	b: number;
	midX: number;
	midY: number;
	midZ: number;
}

// ── Environment ──────────────────────────────────────────────────────────────

export class FirewallEnvironment implements Environment {
	readonly verticalRadius = 0;

	private scene: THREE.Scene | null = null;

	// Dome shell (semi-transparent background)
	private domeMat: THREE.ShaderMaterial | null = null;
	private domeMesh: THREE.Mesh | null = null;

	// Node points
	private nodePoints: THREE.Points | null = null;
	private nodeMat: THREE.PointsMaterial | null = null;
	private nodePositions: Float32Array | null = null;
	private nodePulsePhases: Float32Array | null = null;

	// Dynamic lines (draw range)
	private lineGeo: THREE.BufferGeometry | null = null;
	private lineMat: THREE.LineBasicMaterial | null = null;
	private lineObj: THREE.LineSegments | null = null;
	private edges: Edge[] = [];
	private edgeDistances: Float32Array | null = null;

	private elapsed = 0;
	private colorT = 0;

	// Energy lines
	private energyLines: THREE.Line[] = [];
	private energyPhases: Float32Array | null = null;

	// Lightning
	private lightningLight: THREE.PointLight | null = null;
	private nextFlashTime = 0;
	private flashIntensity = 0;

	// White circuit board (delegated)
	private circuitEnv: CircuitEnvironment | null = null;

	readonly domeCenter = new THREE.Vector3();
	readonly domeRadius = DOME_RADIUS;

	get colorProgress(): number {
		return this.colorT;
	}

	get domeActive(): boolean {
		return true;
	}

	init(scene: THREE.Scene): void {
		if (this.scene) {
			this.elapsed = 0;
			this.colorT = 0;
			this.nextFlashTime = 2;
			this.flashIntensity = 0;
			return;
		}
		this.scene = scene;
		this.circuitEnv = new CircuitEnvironment(new THREE.Color(RED));
		this.nextFlashTime = 2;
		this.buildDomeShell();
		this.buildNodes();
		this.buildLines();
		this.buildEnergyLines();
		this.buildLightning();
	}

	buildChunk(
		cx: number,
		cy: number,
		cz: number,
		params: EnvironmentBuildParams,
		spawnTime: number,
	): ChunkContent {
		return this.circuitEnv!.buildChunk(cx, cy, cz, params, spawnTime);
	}

	updateNeonColor(color: THREE.Color): void {
		this.circuitEnv?.updateNeonColor(color);
	}

	updateBuildingOpacity(opacity: number): void {
		this.circuitEnv?.updateBuildingOpacity(opacity);
	}

	terrainHeightAt(x: number, z: number, terrainLevel: number): number | null {
		return this.circuitEnv?.terrainHeightAt?.(x, z, terrainLevel) ?? null;
	}

	tick(delta: number, playerPos?: THREE.Vector3): void {
		this.elapsed += delta;
		const storm = this.colorT < 1 ? 1 - this.colorT : 0;

		// ── Color transition (red → green) ──────────────────────────────
		if (this.elapsed >= COLOR_CHANGE_DELAY && this.colorT < 1) {
			this.colorT = Math.min(
				1,
				(this.elapsed - COLOR_CHANGE_DELAY) / COLOR_CHANGE_DURATION,
			);
			const eased = this.colorT * this.colorT * (3 - 2 * this.colorT);

			const domeColor = lerpColor(RED, GREEN, eased);
			if (this.domeMat) this.domeMat.uniforms.uColor.value.copy(domeColor);
			if (this.nodeMat) this.nodeMat.color.copy(domeColor);
			if (this.lineMat) this.lineMat.color.copy(domeColor);

			for (const line of this.energyLines) {
				(line.material as THREE.LineBasicMaterial).color.copy(domeColor);
			}

			this.circuitEnv?.updateNeonColor(domeColor);
		}

		// ── Dome shell animation ────────────────────────────────────────
		if (this.domeMat) {
			this.domeMat.uniforms.uTime.value = this.elapsed;
			this.domeMat.uniforms.uStorm.value = storm;
		}

		// ── Node pulsing ────────────────────────────────────────────────
		this.animateNodes(storm);

		// ── Dynamic lines (draw range) ──────────────────────────────────
		if (playerPos) {
			this.animateLines(playerPos, storm);
		}

		// ── Energy lines ────────────────────────────────────────────────
		for (let i = 0; i < this.energyLines.length; i++) {
			const mat = this.energyLines[i].material as THREE.LineBasicMaterial;
			const base = 0.15;
			const erratic = storm * Math.abs(Math.sin(this.elapsed * 3.0 + this.energyPhases![i] * 5));
			mat.opacity = base + 0.3 * Math.sin(this.elapsed * 2.0 + this.energyPhases![i]) + erratic * 0.2;
		}

		// ── Lightning flashes ───────────────────────────────────────────
		if (storm > 0.5) {
			this.flashIntensity *= 0.85;
			if (this.elapsed >= this.nextFlashTime) {
				this.flashIntensity = 1.0 + Math.random() * 2.0;
				this.nextFlashTime = this.elapsed + 0.8 + Math.random() * 3.0;
			}
			if (this.lightningLight) {
				this.lightningLight.intensity = this.flashIntensity * 6 * storm;
				if (this.flashIntensity > 0.5) {
					this.lightningLight.position.set(
						(Math.random() - 0.5) * DOME_RADIUS,
						20 + Math.random() * 40,
						(Math.random() - 0.5) * DOME_RADIUS,
					);
				}
			}
		} else if (this.lightningLight) {
			this.lightningLight.intensity = 0;
		}
	}

	dispose(): void {
		if (this.domeMat) { this.domeMat.dispose(); this.domeMat = null; }
		if (this.nodeMat) { this.nodeMat.dispose(); this.nodeMat = null; }
		if (this.lineGeo) { this.lineGeo.dispose(); this.lineGeo = null; }
		if (this.lineMat) { this.lineMat.dispose(); this.lineMat = null; }
		if (this.nodePoints && this.scene) {
			this.scene.remove(this.nodePoints);
			this.nodePoints.geometry.dispose();
			this.nodePoints = null;
		}
		if (this.lineObj && this.scene) {
			this.scene.remove(this.lineObj);
			this.lineObj = null;
		}
		this.removeEnergyLines();
		if (this.lightningLight && this.scene) {
			this.scene.remove(this.lightningLight);
			this.lightningLight.dispose();
			this.lightningLight = null;
		}
		this.circuitEnv?.dispose();
	}

	// ── Dome shell (very transparent backdrop) ──────────────────────────

	private buildDomeShell(): void {
		if (!this.scene) return;
		this.domeCenter.set(0, 0, 0);

		const icoGeo = new THREE.IcosahedronGeometry(DOME_RADIUS, DOME_DETAIL);

		this.domeMat = new THREE.ShaderMaterial({
			vertexShader: domeVertexShader,
			fragmentShader: domeFragmentShader,
			uniforms: {
				uTime: { value: 0 },
				uColor: { value: RED.clone() },
				uStorm: { value: 1 },
			},
			transparent: true,
			side: THREE.BackSide,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
		this.domeMesh = new THREE.Mesh(icoGeo, this.domeMat);
		this.domeMesh.renderOrder = 0;
		this.scene.add(this.domeMesh);
	}

	// ── Node points ─────────────────────────────────────────────────────

	private buildNodes(): void {
		if (!this.scene) return;

		const icoGeo = new THREE.IcosahedronGeometry(DOME_RADIUS, DOME_DETAIL);
		const posAttr = icoGeo.getAttribute("position") as THREE.BufferAttribute;
		const count = posAttr.count;

		this.nodePositions = new Float32Array(posAttr.array);
		this.nodePulsePhases = new Float32Array(count);
		for (let i = 0; i < count; i++) {
			this.nodePulsePhases[i] = Math.random() * Math.PI * 2;
		}

		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(this.nodePositions, 3));

		this.nodeMat = new THREE.PointsMaterial({
			color: RED.clone(),
			size: 3.0,
			sizeAttenuation: true,
			blending: THREE.AdditiveBlending,
			transparent: true,
			opacity: 0.9,
			depthWrite: false,
		});

		this.nodePoints = new THREE.Points(geo, this.nodeMat);
		this.nodePoints.renderOrder = 10;
		this.scene.add(this.nodePoints);

		icoGeo.dispose();
	}

	private animateNodes(storm: number): void {
		if (!this.nodePositions || !this.nodePulsePhases || !this.nodePoints) return;

		const src = this.nodePositions;
		const posAttr = this.nodePoints.geometry.getAttribute(
			"position",
		) as THREE.BufferAttribute;
		const baseSize = 3.0;

		for (let i = 0; i < src.length / 3; i++) {
			const i3 = i * 3;
			const ox = src[i3];
			const oy = src[i3 + 1];
			const oz = src[i3 + 2];
			const len = Math.sqrt(ox * ox + oy * oy + oz * oz);
			if (len < 0.001) continue;

			// Breathing displacement
			const breathe =
				Math.sin(this.elapsed * 1.5 + this.nodePulsePhases[i]) * 1.5 * storm;
			const scale = (len + breathe) / len;

			const px = ox * scale;
			const py = oy * scale;
			const pz = oz * scale;

			posAttr.array[i3] = px;
			posAttr.array[i3 + 1] = py;
			posAttr.array[i3 + 2] = pz;

			// Store for lines
			this.nodePositions[i3] = px;
			this.nodePositions[i3 + 1] = py;
			this.nodePositions[i3 + 2] = pz;
		}

		posAttr.needsUpdate = true;

		// Pulsing point size
		const pulse = baseSize + storm * 1.5 * Math.sin(this.elapsed * NODE_PULSE_SPEED);
		if (this.nodeMat) this.nodeMat.size = pulse;
	}

	// ── Dynamic lines (draw range) ─────────────────────────────────────

	private buildLines(): void {
		if (!this.scene) return;

		// Extract edges from icosahedron
		const icoGeo = new THREE.IcosahedronGeometry(DOME_RADIUS, DOME_DETAIL);
		const indexAttr = icoGeo.getIndex();
		const posAttr = icoGeo.getAttribute("position") as THREE.BufferAttribute;
		const verts = posAttr.array as Float32Array;

		if (indexAttr) {
			const idx = indexAttr.array;
			const seen = new Set<string>();
			for (let i = 0; i < idx.length; i += 3) {
				for (let j = 0; j < 3; j++) {
					const a = idx[i + j];
					const b = idx[i + ((j + 1) % 3)];
					const key = a < b ? `${a}-${b}` : `${b}-${a}`;
					if (seen.has(key)) continue;
					seen.add(key);
					const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
					const bx = verts[b * 3], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
					this.edges.push({
						a,
						b,
						midX: (ax + bx) / 2,
						midY: (ay + by) / 2,
						midZ: (az + bz) / 2,
					});
				}
			}
		}
		icoGeo.dispose();

		// Pre-compute edge distances from origin
		this.edgeDistances = new Float32Array(this.edges.length);
		for (let i = 0; i < this.edges.length; i++) {
			const e = this.edges[i];
			this.edgeDistances[i] = Math.sqrt(
				e.midX * e.midX + e.midY * e.midY + e.midZ * e.midZ,
		);
		}

		// Line buffer (max possible edges × 2 vertices × 3 components)
		const linePositions = new Float32Array(this.edges.length * 6);
		this.lineGeo = new THREE.BufferGeometry();
		this.lineGeo.setAttribute(
			"position",
			new THREE.BufferAttribute(linePositions, 3).setUsage(
				THREE.DynamicDrawUsage,
			),
		);

		this.lineMat = new THREE.LineBasicMaterial({
			color: RED.clone(),
			transparent: true,
			opacity: 0.4,
			blending: THREE.AdditiveBlending,
			depthTest: false,
			depthWrite: false,
		});

		this.lineObj = new THREE.LineSegments(this.lineGeo, this.lineMat);
		this.lineObj.renderOrder = 5;
		(this.lineObj as THREE.LineSegments).geometry.setDrawRange(0, 0);
		this.scene.add(this.lineObj);
	}

	private animateLines(playerPos: THREE.Vector3, storm: number): void {
		if (!this.lineGeo || !this.lineObj || !this.nodePositions) return;

		const linePos = this.lineGeo.getAttribute(
			"position",
		) as THREE.BufferAttribute;
		const arr = linePos.array as Float32Array;
		let writeIdx = 0;
		const viewDist = LINE_CONNECT_DIST + storm * 15;

		for (let i = 0; i < this.edges.length; i++) {
			const e = this.edges[i];
			const dx = e.midX - playerPos.x;
			const dy = e.midY - playerPos.y;
			const dz = e.midZ - playerPos.z;
			const distSq = dx * dx + dy * dy + dz * dz;

			if (distSq > viewDist * viewDist) continue;

			const ax = this.nodePositions[e.a * 3];
			const ay = this.nodePositions[e.a * 3 + 1];
			const az = this.nodePositions[e.a * 3 + 2];
			const bx = this.nodePositions[e.b * 3];
			const by = this.nodePositions[e.b * 3 + 1];
			const bz = this.nodePositions[e.b * 3 + 2];

			arr[writeIdx] = ax;
			arr[writeIdx + 1] = ay;
			arr[writeIdx + 2] = az;
			arr[writeIdx + 3] = bx;
			arr[writeIdx + 4] = by;
			arr[writeIdx + 5] = bz;
			writeIdx += 6;
		}

		linePos.needsUpdate = true;
		this.lineGeo.setDrawRange(0, writeIdx / 3);

		// Pulsing opacity
		if (this.lineMat) {
			const pulse = 0.2 + 0.3 * Math.sin(this.elapsed * 2.5);
			this.lineMat.opacity = pulse + storm * 0.2;
		}
	}

	// ── Energy Lines ────────────────────────────────────────────────────

	private buildEnergyLines(): void {
		if (!this.scene) return;
		this.energyPhases = new Float32Array(ENERGY_LINE_COUNT);
		const mat = new THREE.LineBasicMaterial({
			color: RED.clone(),
			transparent: true,
			opacity: 0.15,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
		for (let i = 0; i < ENERGY_LINE_COUNT; i++) {
			const points: THREE.Vector3[] = [];
			const angle = (i / ENERGY_LINE_COUNT) * Math.PI * 2;
			const r = 15 + Math.random() * 80;
			const x = Math.cos(angle) * r;
			const z = Math.sin(angle) * r;
			const h = 5 + Math.random() * 50;
			points.push(new THREE.Vector3(x, 0, z));
			points.push(new THREE.Vector3(x, h, z));
			const geo = new THREE.BufferGeometry().setFromPoints(points);
			const line = new THREE.Line(geo, mat.clone());
			this.scene.add(line);
			this.energyLines.push(line);
			this.energyPhases[i] = Math.random() * Math.PI * 2;
		}
	}

	private removeEnergyLines(): void {
		if (this.scene) {
			for (const line of this.energyLines) {
				this.scene.remove(line);
				line.geometry.dispose();
				(line.material as THREE.Material).dispose();
			}
		}
		this.energyLines = [];
	}

	// ── Lightning ───────────────────────────────────────────────────────

	private buildLightning(): void {
		if (!this.scene) return;
		this.lightningLight = new THREE.PointLight(0xff6644, 0, 250);
		this.scene.add(this.lightningLight);
	}
}
