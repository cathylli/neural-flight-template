import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { WORLD, CUBE_TYPES, NOISE, STREAM } from './config';

// Local deterministic random to ensure chunk consistency without external dependencies
function chunkRandom(x: number, z: number, seed: number) {
	const val = Math.sin(x * 12.9898 + z * 78.233 + seed) * 43758.5453123;
	return val - Math.floor(val);
}

class DataChunk {
	worldX: number;
	worldZ: number;
	group: THREE.Group;
	spawnTime: number;
	cubes: THREE.InstancedMesh[] = [];
	streamMesh: THREE.InstancedMesh | null = null;
	terrain: THREE.Mesh | null = null;
	grid: THREE.GridHelper | null = null;
	private simplex: SimplexNoise;
	private sharedGeometries: Map<string, THREE.BoxGeometry>;
	private sharedMaterials: Map<string, THREE.Material>;

	// Cache for deterministic animation data
	private instanceData: Array<{ 
		matrices: THREE.Matrix4[], 
		targetY: number[],
		typeId: string,
		seeds: number[] 
	}> = [];

	constructor(
		worldX: number, 
		worldZ: number, 
		simplex: SimplexNoise,
		geometries: Map<string, THREE.BoxGeometry>,
		materials: Map<string, THREE.Material>,
		spawnTime: number
	) {
		this.worldX = worldX;
		this.worldZ = worldZ;
		this.group = new THREE.Group();
		this.group.position.set(worldX, 0, worldZ);
		this.simplex = simplex;
		this.sharedGeometries = geometries;
		this.sharedMaterials = materials;
		this.spawnTime = spawnTime;
	}

	generate(scene: THREE.Scene) {
		this.generateCubes();
		this.generateStreams();
		this.generateTerrain();
		scene.add(this.group);
	}

	private generateStreams() {
		const totalPackages = STREAM.PACKAGES_PER_STREAM * 2; // X and Z directions
		this.streamMesh = new THREE.InstancedMesh(
			this.sharedGeometries.get('package')!,
			this.sharedMaterials.get('package')!,
			totalPackages
		);
		this.streamMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.group.add(this.streamMesh);
	}

	private generateTerrain() {
		const geometry = new THREE.PlaneGeometry(WORLD.CHUNK_SIZE, WORLD.CHUNK_SIZE);
		geometry.rotateX(-Math.PI / 2);
		const material = this.sharedMaterials.get('terrain')!;
		this.terrain = new THREE.Mesh(geometry, material);
		this.terrain.position.set(0, WORLD.CUBE_BASE_Y, 0);
		this.terrain.receiveShadow = true;
		// We use a global shader terrain in scene.ts instead of chunk-based floors
		// this.group.add(this.terrain);

		// Add a digital grid overlay
		this.grid = new THREE.GridHelper(
			WORLD.CHUNK_SIZE,
			WORLD.GRID_DIVISIONS,
			WORLD.GRID_COLOR,
			WORLD.GRID_SECONDARY_COLOR
		);
		this.grid.position.set(0, WORLD.CUBE_BASE_Y + 0.1, 0);
		this.group.add(this.grid);
	}

	private generateCubes() {
		const tempMatrix = new THREE.Matrix4();
		const tempPosition = new THREE.Vector3();
		const tempQuaternion = new THREE.Quaternion();
		const tempScale = new THREE.Vector3();

		// Tracking to prevent overlapping buildings within this chunk
		const placedInChunk: Array<{ x: number; z: number; radius: number }> = [];

		// Sort types by size descending (largest first) to prioritize big buildings
		const sortedTypes = Object.values(CUBE_TYPES).sort((a, b) => b.size - a.size);

		// Map type IDs to offsets for deterministic random
		const typeOffsets: Record<string, number> = {};
		Object.keys(CUBE_TYPES).forEach((key, i) => {
			typeOffsets[CUBE_TYPES[key as keyof typeof CUBE_TYPES].id] = i * 2000;
		});

		for (const type of sortedTypes) {
			const geometry = this.sharedGeometries.get(type.id)!;
			const material = this.sharedMaterials.get(type.id)!;

			const capacity = (WORLD.CHUNK_SIZE * WORLD.CHUNK_SIZE) / (type.size * type.size);
			const maxInstances = Math.max(
				type.densityMultiplier > 0.01 ? 1 : 0,
				Math.floor(capacity * type.densityMultiplier * 0.5)
			);

			if (maxInstances === 0) continue;

			const instancedMesh = new THREE.InstancedMesh(geometry, material, maxInstances);
			instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
			instancedMesh.castShadow = true;
			instancedMesh.receiveShadow = true;

			let instanceCount = 0;
			const chunkMatrices: THREE.Matrix4[] = [];
			const chunkTargetY: number[] = [];
			const chunkSeeds: number[] = [];

			const typeOffset = typeOffsets[type.id];

			// Use seeded random for deterministic placement across chunk re-generation
			for (let i = 0; i < maxInstances * 15; i++) {
				const x = chunkRandom(this.worldX, i + typeOffset, 1) * WORLD.CHUNK_SIZE;
				const z = chunkRandom(i + typeOffset, this.worldZ, 2) * WORLD.CHUNK_SIZE;
				
				// Local coordinates relative to chunk center (-128 to 128)
				const lx = x - WORLD.CHUNK_SIZE / 2;
				const lz = z - WORLD.CHUNK_SIZE / 2;

				// EDGE PROTECTION: Don't place buildings that bleed over chunk boundaries
				const halfSize = type.size / 2;
				if (Math.abs(lx) + halfSize > WORLD.CHUNK_SIZE / 2 - 2 || 
					Math.abs(lz) + halfSize > WORLD.CHUNK_SIZE / 2 - 2) {
					continue;
				}

				// COLLISION CHECK: Ensure we aren't inside another building
				const checkRadius = type.size * 0.8; // Circle approximation for box footprint
				let overlaps = false;
				for (const other of placedInChunk) {
					const dx = lx - other.x;
					const dz = lz - other.z;
					const minDist = checkRadius + other.radius;
					if (dx * dx + dz * dz < minDist * minDist) {
						overlaps = true;
						break;
					}
				}
				if (overlaps) continue;

				const seed = chunkRandom(x, z, i + typeOffset);
				
				const noiseVal = this.simplex.noise(
					(this.worldX + x) * NOISE.SCALE,
					(this.worldZ + z) * NOISE.SCALE
				);

				// Modified logic: Use densityMultiplier to shift the threshold higher for rare types
				const spawnThreshold = 1.0 - (1.0 - NOISE.DENSITY_THRESHOLD) * type.densityMultiplier;

				if (noiseVal > spawnThreshold) {
					// Calculate height based on noise (making them "lengths")
					const yScale = 1.0 + (noiseVal - spawnThreshold) * (WORLD.CUBE_HEIGHT_VARIATION / type.size) * 2;
					const finalScale = new THREE.Vector3(0.8 + seed * 0.4, yScale, 0.8 + seed * 0.4);
					
					const actualHeight = type.size * yScale;
					// Position center at height / 2 so the bottom is at CUBE_BASE_Y
					const targetY = WORLD.CUBE_BASE_Y + actualHeight / 2;
					const startY = WORLD.CUBE_BASE_Y - actualHeight / 2 - 10; // Start slightly deeper for better "shoot" feel
					
					tempPosition.set(lx, startY, lz);
					
					tempQuaternion.setFromEuler(
						new THREE.Euler(
							0, // Standard buildings don't tilt on X
							seed * Math.PI * 2, // Variety in Y rotation is fine
							0  // Standard buildings don't tilt on Z
						)
					);

					tempMatrix.compose(tempPosition, tempQuaternion, finalScale);
					instancedMesh.setMatrixAt(instanceCount, tempMatrix);
					
					chunkMatrices.push(tempMatrix.clone());
					chunkTargetY.push(targetY);
					chunkSeeds.push(seed);
					
					placedInChunk.push({ x: lx, z: lz, radius: checkRadius });
					
					instanceCount++;

					if (instanceCount >= maxInstances) break;
				}
			}

			instancedMesh.count = instanceCount;
			instancedMesh.instanceMatrix.needsUpdate = true;

			this.group.add(instancedMesh);
			this.cubes.push(instancedMesh);
			this.instanceData.push({ matrices: chunkMatrices, targetY: chunkTargetY, typeId: type.id, seeds: chunkSeeds });
		}
	}

	/** Animates the "shooting" effect and subtle hovering */
	stepAnimation(elapsed: number) {
		const duration = 2.0; // Seconds to reach full height
		const age = elapsed - this.spawnTime;
		const progress = THREE.MathUtils.smoothstep(age, 0, duration);

		// Optimization: If the animation is finished, stop re-calculating and 
		// re-uploading matrices to the GPU every frame.
		const isFinished = age > duration + 0.1;
		
		const tempMatrix = new THREE.Matrix4();
		const tempPosition = new THREE.Vector3();
		const tempQuaternion = new THREE.Quaternion();
		const tempScale = new THREE.Vector3();

		// Map type IDs to configs once to avoid repeated find() operations in the loop
		const typeEntries = Object.values(CUBE_TYPES);

		this.cubes.forEach((mesh, meshIdx) => {
			const data = this.instanceData[meshIdx];
			const typeConfig = typeEntries.find(t => t.id === data.typeId);

			if (!data || !typeConfig) return;

			for (let i = 0; i < mesh.count; i++) {
				data.matrices[i].decompose(tempPosition, tempQuaternion, tempScale);
				const actualHeight = typeConfig.size * tempScale.y;
				
				// Shoot up from base to target
				const targetY = data.targetY[i];
				const startY = WORLD.CUBE_BASE_Y - actualHeight / 2 - 10;
				
				tempPosition.y = THREE.MathUtils.lerp(startY, targetY, progress);
				
				tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
				mesh.setMatrixAt(i, tempMatrix);
			}
			mesh.instanceMatrix.needsUpdate = true;
			
			if (isFinished) mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
		});

		// Update Data Package Streams
		if (this.streamMesh) {
			const tempMatrix = new THREE.Matrix4();
			const tempPosition = new THREE.Vector3();
			const tempScale = new THREE.Vector3(1, 1, 1);
			const tempQuaternion = new THREE.Quaternion();

			for (let i = 0; i < STREAM.PACKAGES_PER_STREAM; i++) {
				const offset = i / STREAM.PACKAGES_PER_STREAM;
				const progress = (elapsed * STREAM.PACKAGE_SPEED + offset) % 1.0;
				
				// Package moving in X direction (to East neighbor)
				tempPosition.set(progress * WORLD.CHUNK_SIZE - WORLD.CHUNK_SIZE / 2, WORLD.STREAM_HEIGHT, 0);
				tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
				this.streamMesh.setMatrixAt(i, tempMatrix);

				// Package moving in Z direction (to North neighbor)
				tempPosition.set(0, WORLD.STREAM_HEIGHT, progress * WORLD.CHUNK_SIZE - WORLD.CHUNK_SIZE / 2);
				tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
				this.streamMesh.setMatrixAt(i + STREAM.PACKAGES_PER_STREAM, tempMatrix);
			}
			this.streamMesh.instanceMatrix.needsUpdate = true;
		}
	}

	dispose(scene: THREE.Scene) {
		scene.remove(this.group);
		if (this.terrain) {
			this.terrain.geometry.dispose();
		}
		if (this.grid) {
			this.grid.geometry.dispose();
			(this.grid.material as THREE.Material).dispose();
		}
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
		
		try {
			this.simplex = new SimplexNoise();
			this.initSharedResources();
			this.updateChunks(0);
		} catch (e) {
			console.error("Failed to initialize DataSpaceWorld:", e);
			// Fallback to avoid breaking the setup() promise
			this.simplex = { noise: () => 0 } as any;
		}
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
				new THREE.MeshPhongMaterial({
					color: type.baseColor,
					emissive: type.emissiveColor,
					emissiveIntensity: 2.5 // Boosted for a strong "glow" effect
				})
			);
		}

		// Shared resources for data packages
		this.geometries.set('package', new THREE.BoxGeometry(STREAM.PACKAGE_SIZE, STREAM.PACKAGE_SIZE, STREAM.PACKAGE_SIZE));
		this.materials.set('package', new THREE.MeshPhongMaterial({
			color: STREAM.COLOR,
			emissive: STREAM.COLOR,
			emissiveIntensity: 3.0,
			transparent: true,
			opacity: 0.8
		}));

		this.materials.set('terrain', new THREE.MeshPhongMaterial({
			color: WORLD.TERRAIN_COLOR,
			shininess: 10
		}));
	}

	update(playerPosition: THREE.Vector3, elapsed: number) {
		this.playerPosition.copy(playerPosition);
		this.updateChunks(elapsed);
		
		this.chunks.forEach(chunk => {
			chunk.stepAnimation(elapsed);
		});
	}

	private getChunkKey(x: number, z: number): string {
		return `${Math.floor(x / WORLD.CHUNK_SIZE)}_${Math.floor(z / WORLD.CHUNK_SIZE)}`;
	}

	private updateChunks(elapsed: number) {
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
						this.materials,
						elapsed
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
		
		if (id === 'enduser-density') {
			CUBE_TYPES.ENDUSER.densityMultiplier = value as number;
		}
		
		if (id === 'ai-density') {
			CUBE_TYPES.AI_DATA_CENTER.densityMultiplier = value as number;
			CUBE_TYPES.SERVER.densityMultiplier = (value as number) * 0.9;
		}
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
