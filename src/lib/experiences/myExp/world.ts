import * as THREE from 'three';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { WORLD, CUBE_TYPES, NETWORK, NOISE } from './config';
import { seededRandom2D } from '$lib/three/random';

class DataChunk {
	worldX: number;
	worldZ: number;
	group: THREE.Group;
	cubes: THREE.InstancedMesh[] = [];
	networkLine: THREE.LineSegments | null = null;
	networkTunnels: THREE.Mesh[] = [];
	private simplex: SimplexNoise;
	private sharedGeometries: Map<string, THREE.BoxGeometry>;
	private sharedMaterials: Map<string, THREE.Material>;

	constructor(
		worldX: number, 
		worldZ: number, 
		simplex: SimplexNoise,
		geometries: Map<string, THREE.BoxGeometry>,
		materials: Map<string, THREE.Material>
	) {
		this.worldX = worldX;
		this.worldZ = worldZ;
		this.group = new THREE.Group();
		this.group.position.set(worldX, 0, worldZ);
		this.simplex = simplex;
		this.sharedGeometries = geometries;
		this.sharedMaterials = materials;
	}

	generate(scene: THREE.Scene) {
		this.generateCubes();
		this.generateNetwork();
		this.group.matrixWorldNeedsUpdate = true;
		scene.add(this.group);
	}

	private generateCubes() {
		const tempMatrix = new THREE.Matrix4();
		const tempPosition = new THREE.Vector3();
		const tempQuaternion = new THREE.Quaternion();
		const tempScale = new THREE.Vector3();

		for (const typeKey in CUBE_TYPES) {
			const type = CUBE_TYPES[typeKey as keyof typeof CUBE_TYPES];
			const geometry = this.sharedGeometries.get(type.id)!;
			const material = this.sharedMaterials.get(type.id)!;

			const maxInstances = Math.floor(
				(WORLD.CHUNK_SIZE * WORLD.CHUNK_SIZE * type.densityMultiplier) / (type.size * type.size) / 10
			);
			if (maxInstances === 0) continue;

			const instancedMesh = new THREE.InstancedMesh(geometry, material, maxInstances);
			instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
			instancedMesh.castShadow = true;
			instancedMesh.receiveShadow = true;

			let instanceCount = 0;
			// Use seeded random for deterministic placement across chunk re-generation
			for (let i = 0; i < maxInstances * 5; i++) {
				const x = seededRandom2D(this.worldX, i) * WORLD.CHUNK_SIZE;
				const z = seededRandom2D(i, this.worldZ) * WORLD.CHUNK_SIZE;
				const noiseVal = this.simplex.noise(
					(this.worldX + x) * NOISE.SCALE,
					(this.worldZ + z) * NOISE.SCALE
				);

				if (noiseVal > NOISE.DENSITY_THRESHOLD * type.densityMultiplier) {
					tempPosition.set(
						x - WORLD.CHUNK_SIZE / 2,
						WORLD.CUBE_BASE_Y + noiseVal * WORLD.CUBE_HEIGHT_VARIATION,
						z - WORLD.CHUNK_SIZE / 2
					);
					tempQuaternion.setFromEuler(
						new THREE.Euler(
							Math.random() * Math.PI,
							Math.random() * Math.PI,
							Math.random() * Math.PI
						)
					);
					tempScale.setScalar(1 + Math.random() * 0.5);

					tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
					instancedMesh.setMatrixAt(instanceCount, tempMatrix);
					instanceCount++;

					if (instanceCount >= maxInstances) break;
				}
			}
			instancedMesh.count = instanceCount;
			instancedMesh.instanceMatrix.needsUpdate = true;
			if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;

			this.group.add(instancedMesh);
			this.cubes.push(instancedMesh);
		}
	}

	private generateNetwork() {
		const networkNodes: THREE.Vector3[] = [];
		const numNodes = Math.floor(WORLD.CHUNK_SIZE * WORLD.CHUNK_SIZE * NETWORK.NODE_DENSITY_PER_CHUNK);

		for (let i = 0; i < numNodes; i++) {
			const x = seededRandom2D(this.worldX + i, 10) * WORLD.CHUNK_SIZE - WORLD.CHUNK_SIZE / 2;
			const z = seededRandom2D(this.worldZ + i, 20) * WORLD.CHUNK_SIZE - WORLD.CHUNK_SIZE / 2;
			const y =
				WORLD.CUBE_BASE_Y +
				this.simplex.noise(
					(this.worldX + x) * NOISE.SCALE,
					(this.worldZ + z) * NOISE.SCALE
				) *
					WORLD.CUBE_HEIGHT_VARIATION +
				Math.random() * 50; // Add some height variation for nodes
			networkNodes.push(new THREE.Vector3(x, y, z));
		}

		// Connect nodes with a single LineSegments object for efficiency
		const linePoints: THREE.Vector3[] = [];
		for (let i = 0; i < networkNodes.length; i++) {
			const startNode = networkNodes[i];
			for (let j = i + 1; j < networkNodes.length; j++) {
				const endNode = networkNodes[j];
				if (startNode.distanceTo(endNode) < NETWORK.MAX_LINE_LENGTH) {
					linePoints.push(startNode, endNode);
				}
			}
		}

		const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
		this.networkLine = new THREE.LineSegments(lineGeometry, this.sharedMaterials.get('networkLine')!);
		this.group.add(this.networkLine);

		// Generate structured tunnels (more complex connections)
		for (let i = 0; i < networkNodes.length; i += 2) {
			if (networkNodes[i + 1]) {
				const start = networkNodes[i];
				const end = networkNodes[i + 1];
				if (start.distanceTo(end) < NETWORK.MAX_LINE_LENGTH * 0.7) {
					const path = new THREE.CatmullRomCurve3([start, start.clone().lerp(end, 0.3), end.clone().lerp(start, 0.3), end]);
					const tubeGeometry = new THREE.TubeGeometry(
						path,
						NETWORK.LINE_SEGMENTS,
						NETWORK.TUNNEL_RADIUS,
						NETWORK.TUNNEL_SEGMENTS,
						false
					);
					const tunnel = new THREE.Mesh(tubeGeometry, this.sharedMaterials.get('networkTunnel')!);
					this.group.add(tunnel);
					this.networkTunnels.push(tunnel);
				}
			}
		}
	}

	dispose(scene: THREE.Scene) {
		scene.remove(this.group);
		// Dispose instanced meshes (but not shared geoms/mats)
		this.cubes.forEach((mesh) => mesh.dispose());
		this.cubes = [];
		
		if (this.networkLine) {
			this.networkLine.geometry.dispose();
		}

		this.networkTunnels.forEach((tunnel) => {
			tunnel.geometry.dispose();
			// Tunnel material is shared, don't dispose here
		});
		this.group.clear();
	}
}

export class DataSpaceWorld {
	private scene: THREE.Scene;
	private playerPosition: THREE.Vector3;
	private chunks: Map<string, DataChunk> = new Map();
	private simplex: SimplexNoise;
	private geometries = new Map<string, THREE.BoxGeometry>();
	private materials = new Map<string, THREE.Material>();

	constructor(scene: THREE.Scene, initialPlayerPosition: THREE.Vector3) {
		this.scene = scene;
		this.playerPosition = initialPlayerPosition.clone();
		this.simplex = new SimplexNoise();
		this.initSharedResources();
		this.updateChunks();
	}

	private initSharedResources() {
		for (const typeKey in CUBE_TYPES) {
			const type = CUBE_TYPES[typeKey as keyof typeof CUBE_TYPES];
			this.geometries.set(
				type.id, 
				new THREE.BoxGeometry(type.size, type.size, type.size)
			);
			this.materials.set(
				type.id,
				new THREE.MeshStandardMaterial({
					color: type.baseColor,
					emissive: type.emissiveColor,
					emissiveIntensity: 0.5,
					roughness: 0.5,
					metalness: 0.8
				})
			);
		}

		this.materials.set('networkLine', new THREE.LineBasicMaterial({
			color: NETWORK.LINE_COLOR,
			transparent: true,
			opacity: 0.7,
			blending: THREE.AdditiveBlending
		}));

		this.materials.set('networkTunnel', new THREE.MeshStandardMaterial({
			color: NETWORK.LINE_COLOR,
			emissive: NETWORK.LINE_EMISSIVE,
			emissiveIntensity: 0.3,
			transparent: true,
			opacity: 0.2,
			side: THREE.DoubleSide,
			blending: THREE.AdditiveBlending
		}));
	}

	update(playerPosition: THREE.Vector3) {
		this.playerPosition.copy(playerPosition);
		this.updateChunks();
	}

	private getChunkKey(x: number, z: number): string {
		return `${Math.floor(x / WORLD.CHUNK_SIZE)}_${Math.floor(z / WORLD.CHUNK_SIZE)}`;
	}

	private updateChunks() {
		const currentChunkX = Math.floor(this.playerPosition.x / WORLD.CHUNK_SIZE);
		const currentChunkZ = Math.floor(this.playerPosition.z / WORLD.CHUNK_SIZE);

		const newChunks: Map<string, DataChunk> = new Map();

		// Generate/keep chunks within view distance
		for (let x = -WORLD.CHUNK_VIEW_DISTANCE; x <= WORLD.CHUNK_VIEW_DISTANCE; x++) {
			for (let z = -WORLD.CHUNK_VIEW_DISTANCE; z <= WORLD.CHUNK_VIEW_DISTANCE; z++) {
				const chunkWorldX = (currentChunkX + x) * WORLD.CHUNK_SIZE;
				const chunkWorldZ = (currentChunkZ + z) * WORLD.CHUNK_SIZE;
				const key = this.getChunkKey(chunkWorldX, chunkWorldZ);

				let chunk = this.chunks.get(key);
				if (!chunk) {
					chunk = new DataChunk(
						chunkWorldX, 
						chunkWorldZ, 
						this.simplex, 
						this.geometries, 
						this.materials
					);
					chunk.generate(this.scene);
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

	applySettings(id: string, value: number | boolean | string) {
		// Apply settings to existing chunks or update generation parameters for new chunks
		if (id === 'haze-density') {
			if (this.scene.fog instanceof THREE.FogExp2) {
				this.scene.fog.density = value as number;
			}
		}
		// For cube densities, we'd need to regenerate chunks or update existing instanced meshes
		// For simplicity in this initial version, new chunks will use updated densities.
		// A more complex implementation would update existing instanced meshes.
	}

	dispose() {
		this.chunks.forEach((chunk) => chunk.dispose(this.scene));
		this.chunks.clear();
		
		this.geometries.forEach(g => g.dispose());
		this.materials.forEach(m => m.dispose());
		this.geometries.clear();
		this.materials.clear();
	}
}
