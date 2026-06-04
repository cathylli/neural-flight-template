import * as THREE from "three";

const CHUNK_SIZE = 200;
const GRID_SIZE = 4;

function hash(x: number, z: number, seed: number) {
	const val = Math.sin(x * 12.9898 + z * 78.233 + seed * 137.1) * 43758.5453123;
	return val - Math.floor(val);
}

class CircuitChunk {
	worldX: number;
	worldZ: number;
	group: THREE.Group;
	private segmentsMesh: THREE.InstancedMesh | null = null;
	private nodesMesh: THREE.InstancedMesh | null = null;
	private segmentPhases: number[] = [];

	constructor(worldX: number, worldZ: number) {
		this.worldX = worldX;
		this.worldZ = worldZ;
		this.group = new THREE.Group();
		this.group.position.set(worldX, 0, worldZ);
	}

	generate(material: THREE.Material, density: number) {
		const dummyObj = new THREE.Object3D();
		const segmentTransforms: THREE.Matrix4[] = [];
		const nodeTransforms: THREE.Matrix4[] = [];

		// Helper zum Runden für das Set
		const someRound = (num: number, step: number) => {
			return Math.round(num / step) * step;
		};

		// Nutzt ein Set mit einem strikten Toleranz-String, um doppelte Vias an exakt gleichen Orten zu vermeiden
		const placedNodeKeys = new Set<string>();
		const tryAddVia = (pos: THREE.Vector3) => {
			const key = `${someRound(pos.x, 0.5)},${someRound(pos.z, 0.5)}`;
			if (!placedNodeKeys.has(key)) {
				placedNodeKeys.add(key);

				dummyObj.position.set(pos.x, 0.02, pos.z); // Exakt auf der Linie platziert
				dummyObj.scale.set(0.7, 0.7, 0.7);
				dummyObj.rotation.set(0, 0, 0);
				dummyObj.updateMatrix();
				nodeTransforms.push(dummyObj.matrix.clone());
			}
		};

		const directions = [
			new THREE.Vector3(1, 0, 0),
			new THREE.Vector3(1, 0, 1).normalize(),
			new THREE.Vector3(0, 0, 1),
			new THREE.Vector3(-1, 0, 1).normalize(),
			new THREE.Vector3(-1, 0, 0),
			new THREE.Vector3(-1, 0, -1).normalize(),
			new THREE.Vector3(0, 0, -1),
			new THREE.Vector3(1, 0, -1).normalize()
		];

		// 1. Virtuelle Ankerpunkte als Richtwerte generieren
		const numAnchors = Math.floor(density * 0.2);
		const anchors: THREE.Vector3[] = [];
		for (let a = 0; a < numAnchors; a++) {
			const ax = Math.round(((hash(this.worldX, this.worldZ, a * 5) - 0.5) * CHUNK_SIZE) / GRID_SIZE) * GRID_SIZE;
			const az = Math.round(((hash(this.worldX, this.worldZ, a * 7) - 0.5) * CHUNK_SIZE) / GRID_SIZE) * GRID_SIZE;
			anchors.push(new THREE.Vector3(ax, 0, az));
		}

		const addSegment = (p1: THREE.Vector3, p2: THREE.Vector3, isSignalTrack: boolean, phaseOffset: number) => {
			const center = p1.clone().lerp(p2, 0.5);
			const length = p1.distanceTo(p2);
			dummyObj.position.copy(center);
			dummyObj.lookAt(p2);
			dummyObj.scale.set(0.4, 0.15, length);
			dummyObj.updateMatrix();

			segmentTransforms.push(dummyObj.matrix.clone());
			this.segmentPhases.push(isSignalTrack ? phaseOffset : -99.0);
		};

		// 2. Leitungsbahnen generieren
		const numMainTraces = Math.floor(density * 0.12);

		for (let i = 0; i < numMainTraces; i++) {
			const anchorIndex = Math.floor(hash(this.worldX, this.worldZ, i * 3) * anchors.length);
			const startAnchor = anchors[anchorIndex] || new THREE.Vector3(0, 0, 0);

			let currentPos = startAnchor.clone();
			let dirIndex = Math.floor(hash(this.worldX, this.worldZ, i * 11) * 8);
			let currentDir = directions[dirIndex];

			const traceLength = 6 + Math.floor(hash(this.worldX, this.worldZ, i * 17) * 12);
			const isBus = hash(this.worldX, this.worldZ, i * 23) < 0.45;
			const numParallelLines = isBus ? 3 : 1;
			const busSpacing = 1.6;

			const sideDir = new THREE.Vector3(-currentDir.z, 0, currentDir.x);
			const cellPhase = hash(this.worldX + currentPos.x, this.worldZ + currentPos.z, i) * Math.PI * 2;

			for (let step = 0; step < traceLength; step++) {
				const stepSize = GRID_SIZE * 2;
				let nextPos = currentPos.clone().addScaledVector(currentDir, stepSize);

				if (Math.abs(nextPos.x) > CHUNK_SIZE / 2 || Math.abs(nextPos.z) > CHUNK_SIZE / 2) break;

				// Anker-Routing am Ende des Pfades
				if (step === traceLength - 1) {
					let closestAnchor = anchors[0];
					let minDist = Infinity;
					for (const anchor of anchors) {
						const dist = nextPos.distanceTo(anchor);
						if (dist < minDist && dist > 2) {
							minDist = dist;
							closestAnchor = anchor;
						}
					}

					if (minDist < CHUNK_SIZE * 0.2) {
						const toAnchor = closestAnchor.clone().sub(currentPos);
						let bestDir = currentDir;
						let maxDot = -Infinity;
						for (const d of directions) {
							const dot = d.dot(toAnchor.clone().normalize());
							if (dot > maxDot) {
								maxDot = dot;
								bestDir = d;
							}
						}
						currentDir = bestDir;
						nextPos = currentPos.clone().addScaledVector(currentDir, currentPos.distanceTo(closestAnchor));
					}
				}

				// Segmente und Vias parallel zeichnen
				for (let b = 0; b < numParallelLines; b++) {
					const offsetAmount = (b - (numParallelLines - 1) / 2) * busSpacing;
					const p1 = currentPos.clone().addScaledVector(sideDir, offsetAmount);
					const p2 = nextPos.clone().addScaledVector(sideDir, offsetAmount);

					const isSignal = (i + b) % 2 === 0;
					addSegment(p1, p2, isSignal, cellPhase + step * 0.2);

					// Vias werden direkt auf den echten Start- und Endkoordinaten der Linie erzeugt!
					if (step === 0) {
						tryAddVia(p1);
					}
					if (step === traceLength - 1 || (step < traceLength - 1 && hash(currentPos.x, currentPos.z, step * 3) < 0.25)) {
						tryAddVia(p2);
					}
				}

				currentPos.copy(nextPos);

				// Richtungswechsel
				if (step < traceLength - 1 && hash(currentPos.x, currentPos.z, step * 3) < 0.25) {
					const turn = hash(currentPos.x, currentPos.z, step * 7) > 0.5 ? 1 : -1;
					dirIndex = (dirIndex + turn + 8) % 8;
					currentDir = directions[dirIndex];
				}
			}
		}

		// Instanced Meshes befüllen
		if (segmentTransforms.length > 0) {
			const segGeo = new THREE.BoxGeometry(1, 1, 1);
			this.segmentsMesh = new THREE.InstancedMesh(segGeo, material, segmentTransforms.length);
			for (let i = 0; i < segmentTransforms.length; i++) {
				this.segmentsMesh.setMatrixAt(i, segmentTransforms[i]);
			}
			const phaseArray = new Float32Array(this.segmentPhases);
			segGeo.setAttribute('vPhase', new THREE.InstancedBufferAttribute(phaseArray, 1));
			this.segmentsMesh.frustumCulled = false;
			this.group.add(this.segmentsMesh);
		}

		if (nodeTransforms.length > 0) {
			const nodeGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.15, 6);
			const nodeMat = new THREE.MeshBasicMaterial({ color: "#a8c3a0" });
			this.nodesMesh = new THREE.InstancedMesh(nodeGeo, nodeMat, nodeTransforms.length);
			for (let i = 0; i < nodeTransforms.length; i++) {
				this.nodesMesh.setMatrixAt(i, nodeTransforms[i]);
			}
			this.nodesMesh.frustumCulled = false;
			this.group.add(this.nodesMesh);
		}
	}

	dispose(scene: THREE.Scene) {
		scene.remove(this.group);
		if (this.segmentsMesh) {
			this.segmentsMesh.geometry.dispose();
			this.segmentsMesh.dispose();
		}
		if (this.nodesMesh) {
			this.nodesMesh.geometry.dispose();
			this.nodesMesh.dispose();
		}
		this.group.clear();
		this.segmentPhases = [];
	}
}

export class CircuitWorld {
	private scene: THREE.Scene;
	private playerPosition: THREE.Vector3;
	private chunks: Map<string, CircuitChunk> = new Map();
	private material: THREE.ShaderMaterial;
	private density: number;
	private readonly VIEW_DISTANCE = 2;
	private globalAutomataTime: number = 0;

	private customShaderUniforms = {
		uTime: { value: 0.0 },
		uSpeedMultiplier: { value: 1.0 }
	};

	constructor(scene: THREE.Scene, initialPosition: THREE.Vector3, initialColor: string, initialDensity: number) {
		this.scene = scene;
		this.playerPosition = initialPosition.clone();
		this.density = initialDensity;

		this.material = new THREE.ShaderMaterial({
			uniforms: this.customShaderUniforms,
			vertexShader: `
                attribute float vPhase;
                varying float fragPhase;
                void main() {
                    fragPhase = vPhase;
                    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
                }
            `,
			fragmentShader: `
                uniform float uTime;
                uniform float uSpeedMultiplier;
                varying float fragPhase;
                void main() {
                    if (fragPhase < -90.0) {
                        gl_FragColor = vec4(0.02, 0.22, 0.05, 1.0); 
                        return;
                    }

                    float wave = sin(uTime * 3.5 * uSpeedMultiplier + fragPhase);
                    vec3 finalColor = vec3(0.05, 0.45, 0.1); 
                    
                    if (wave > 0.7) {
                        finalColor = vec3(0.3, 1.0, 0.6); 
                    } else if (wave > 0.2) {
                        finalColor = vec3(0.0, 0.6, 0.9); 
                    }
                    
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `
		});

		this.updateChunks();
	}

	update(playerPosition: THREE.Vector3, delta: number) {
		const distanceGained = this.playerPosition.distanceTo(playerPosition);
		const safeDelta = delta > 0.1 ? 0.016 : delta;

		const speedMultiplier = 1.0 + (distanceGained / (safeDelta + 0.0001)) * 0.02;
		this.globalAutomataTime += safeDelta * speedMultiplier;

		this.customShaderUniforms.uTime.value = this.globalAutomataTime;
		this.customShaderUniforms.uSpeedMultiplier.value = speedMultiplier;

		if (distanceGained > 10) {
			this.playerPosition.copy(playerPosition);
			this.updateChunks();
		}
	}

	private getChunkKey(x: number, z: number): string {
		return `${Math.floor(x / CHUNK_SIZE)}_${Math.floor(z / CHUNK_SIZE)}`;
	}

	private updateChunks() {
		const currentChunkX = Math.floor(this.playerPosition.x / CHUNK_SIZE);
		const currentChunkZ = Math.floor(this.playerPosition.z / CHUNK_SIZE);
		const newChunks: Map<string, CircuitChunk> = new Map();

		for (let x = -this.VIEW_DISTANCE; x <= this.VIEW_DISTANCE; x++) {
			for (let z = -this.VIEW_DISTANCE; z <= this.VIEW_DISTANCE; z++) {
				const chunkWorldX = (currentChunkX + x) * CHUNK_SIZE;
				const chunkWorldZ = (currentChunkZ + z) * CHUNK_SIZE;
				const key = this.getChunkKey(chunkWorldX, chunkWorldZ);

				let chunk = this.chunks.get(key);
				if (!chunk) {
					chunk = new CircuitChunk(chunkWorldX, chunkWorldZ);
					chunk.generate(this.material, this.density);
					this.scene.add(chunk.group);
				}
				newChunks.set(key, chunk);
			}
		}

		this.chunks.forEach((chunk, key) => {
			if (!newChunks.has(key)) {
				chunk.dispose(this.scene);
			}
		});

		this.chunks = newChunks;
	}

	applySettings(id: string, value: any) {
		if (id === "traceDensity") {
			this.density = value as number;
			this.chunks.forEach((chunk) => chunk.dispose(this.scene));
			this.chunks.clear();
			this.updateChunks();
		}
	}

	dispose() {
		this.chunks.forEach((chunk) => chunk.dispose(this.scene));
		this.chunks.clear();
		this.material.dispose();
	}
}