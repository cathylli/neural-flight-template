import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { FlightPlayer } from "$lib/three/player";
import { CAMERA, FLIGHT } from "$lib/config/flight";

const MAX_PARTICLES = 2000;
const NETWORK_SIZE = 500;

interface ParticleData {
	vx: number;
	vy: number;
	vz: number;
}

function createNetwork(particleCount: number, color: THREE.Color, networkSize: number) {
	const half = networkSize / 2;
	const particlesData: ParticleData[] = [];
	const positions = new Float32Array(MAX_PARTICLES * 3);

	for (let i = 0; i < MAX_PARTICLES; i++) {
		positions[i * 3] = (Math.random() - 0.5) * networkSize;
		positions[i * 3 + 1] = (Math.random() - 0.5) * networkSize;
		positions[i * 3 + 2] = (Math.random() - 0.5) * networkSize;
		particlesData.push({
			vx: -1 + Math.random() * 2,
			vy: -1 + Math.random() * 2,
			vz: -1 + Math.random() * 2,
		});
	}

	const particleGeo = new THREE.BufferGeometry();
	particleGeo.setDrawRange(0, particleCount);
	particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));

	const particleMat = new THREE.PointsMaterial({
		color,
		size: 2.5,
		blending: THREE.AdditiveBlending,
		transparent: true,
		opacity: 0.9,
		depthWrite: false,
	});
	const points = new THREE.Points(particleGeo, particleMat);
	points.frustumCulled = false;

	const maxLines = MAX_PARTICLES * MAX_PARTICLES;
	const linePositions = new Float32Array(maxLines * 3);
	const lineColors = new Float32Array(maxLines * 3);

	const lineGeo = new THREE.BufferGeometry();
	lineGeo.setAttribute("position", new THREE.BufferAttribute(linePositions, 3).setUsage(THREE.DynamicDrawUsage));
	lineGeo.setAttribute("color", new THREE.BufferAttribute(lineColors, 3).setUsage(THREE.DynamicDrawUsage));
	lineGeo.setDrawRange(0, 0);

	const lineMat = new THREE.LineBasicMaterial({
		vertexColors: true,
		blending: THREE.AdditiveBlending,
		transparent: true,
		opacity: 0.6,
		depthWrite: false,
	});
	const lines = new THREE.LineSegments(lineGeo, lineMat);
	lines.frustumCulled = false;

	return { particlesData, positions, linePositions, lineColors, points, lines, half, particleGeo, lineGeo };
}

function updateNetwork(
	particlesData: ParticleData[],
	positions: Float32Array,
	linePositions: Float32Array,
	lineColors: Float32Array,
	particleCount: number,
	lineGeo: THREE.BufferGeometry,
	particleGeo: THREE.BufferGeometry,
	half: number,
	connectionDistance: number,
	delta: number,
	speed: number,
) {
	const connDistSq = connectionDistance * connectionDistance;
	let vertexpos = 0;
	let colorpos = 0;
	let numConnected = 0;

	for (let i = 0; i < particleCount; i++) {
		const d = particlesData[i];
		positions[i * 3] += d.vx * delta * speed;
		positions[i * 3 + 1] += d.vy * delta * speed;
		positions[i * 3 + 2] += d.vz * delta * speed;

		if (positions[i * 3] < -half || positions[i * 3] > half) d.vx = -d.vx;
		if (positions[i * 3 + 1] < -half || positions[i * 3 + 1] > half) d.vy = -d.vy;
		if (positions[i * 3 + 2] < -half || positions[i * 3 + 2] > half) d.vz = -d.vz;
	}

	for (let i = 0; i < particleCount; i++) {
		for (let j = i + 1; j < particleCount; j++) {
			const dx = positions[i * 3] - positions[j * 3];
			const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
			const dz = positions[i * 3 + 2] - positions[j * 3 + 2];
			const distSq = dx * dx + dy * dy + dz * dz;

			if (distSq < connDistSq) {
				const dist = Math.sqrt(distSq);
				const alpha = 1.0 - dist / connectionDistance;

				linePositions[vertexpos] = positions[i * 3];
				linePositions[vertexpos + 1] = positions[i * 3 + 1];
				linePositions[vertexpos + 2] = positions[i * 3 + 2];
				linePositions[vertexpos + 3] = positions[j * 3];
				linePositions[vertexpos + 4] = positions[j * 3 + 1];
				linePositions[vertexpos + 5] = positions[j * 3 + 2];

				lineColors[colorpos] = alpha;
				lineColors[colorpos + 1] = alpha;
				lineColors[colorpos + 2] = alpha;
				lineColors[colorpos + 3] = alpha;
				lineColors[colorpos + 4] = alpha;
				lineColors[colorpos + 5] = alpha;

				vertexpos += 6;
				colorpos += 6;
				numConnected++;
			}
		}
	}

	lineGeo.setDrawRange(0, numConnected * 2);
	lineGeo.attributes.position.needsUpdate = true;
	lineGeo.attributes.color.needsUpdate = true;
	particleGeo.attributes.position.needsUpdate = true;
}

export interface NetworkState extends ExperienceState {
	camera: THREE.PerspectiveCamera;
	player: FlightPlayer;
	group: THREE.Group;
	particlesData: ParticleData[];
	positions: Float32Array;
	linePositions: Float32Array;
	lineColors: Float32Array;
	particleGeo: THREE.BufferGeometry;
	lineGeo: THREE.BufferGeometry;
	particleCount: number;
	connectionDistance: number;
	networkSize: number;
	driftSpeed: number;
	half: number;
	moveSpeed: number;
	neonColor: THREE.Color;
}

export async function setup(ctx: SetupContext): Promise<NetworkState> {
	const neonColor = new THREE.Color("#00ffcc");

	const player = new FlightPlayer({
		fov: CAMERA.FOV,
		near: CAMERA.NEAR,
		far: CAMERA.FAR,
		spawnPosition: { x: 0, y: 3, z: 0 },
		baseSpeed: 10,
		terrainSlowdown: FLIGHT.TERRAIN_SLOWDOWN,
	});
	player.minClearance = -1000;
	ctx.scene.add(player.rig);

	const group = new THREE.Group();
	const particleCount = 800;
	const connectionDistance = 80;
	const networkSize = NETWORK_SIZE;

	const net = createNetwork(particleCount, neonColor, networkSize);
	group.add(net.points);
	group.add(net.lines);
	ctx.scene.add(group);

	return {
		player,
		camera: player.camera,
		group,
		particlesData: net.particlesData,
		positions: net.positions,
		linePositions: net.linePositions,
		lineColors: net.lineColors,
		particleGeo: net.particleGeo,
		lineGeo: net.lineGeo,
		particleCount,
		connectionDistance,
		networkSize,
		driftSpeed: 12,
		half: net.half,
		moveSpeed: 10,
		neonColor,
	};
}

export function tick(
	state: ExperienceState,
	ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
	const s = state as NetworkState;
	s.player.tick(ctx.delta);

	const pos = s.player.rig.position;
	s.group.position.set(pos.x, pos.y, pos.z);

	updateNetwork(
		s.particlesData,
		s.positions,
		s.linePositions,
		s.lineColors,
		s.particleCount,
		s.lineGeo,
		s.particleGeo,
		s.half,
		s.connectionDistance,
		ctx.delta,
		s.driftSpeed,
	);

	return { state: s };
}

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
	const s = state as NetworkState;
	s.particleGeo.dispose();
	s.lineGeo.dispose();
	if (s.group.children[0] instanceof THREE.Points) {
		(s.group.children[0].material as THREE.Material).dispose();
	}
	if (s.group.children[1] instanceof THREE.LineSegments) {
		(s.group.children[1].material as THREE.Material).dispose();
	}
	scene.remove(s.group);
}
