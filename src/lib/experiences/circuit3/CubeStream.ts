import * as THREE from "three";

const CUBE_SIZE = 1.8;
const CUBE_SPEED = 20;
const MAX_CUBES = 60;
const SPAWN_INTERVAL = 0.25;
const SPAWN_RADIUS_MIN = 30;
const SPAWN_RADIUS_MAX = 80;
const ARRIVAL_RADIUS = 15;
const RECYCLE_RADIUS = 150;
const GREEN = new THREE.Color(0x00ff66);
const RED = new THREE.Color(0xff2222);

interface MovingCube {
	mesh: THREE.Mesh;
	arrived: boolean;
}

export class CubeStream {
	private scene: THREE.Scene;
	private pool: MovingCube[] = [];
	private domeCenter: THREE.Vector3 | null = null;
	private active = false;
	private spawnTimer = 0;
	private geo: THREE.BoxGeometry;

	constructor(scene: THREE.Scene) {
		this.scene = scene;
		this.geo = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
	}

	setDomePosition(pos: THREE.Vector3) {
		this.domeCenter = pos.clone();
		this.active = true;
	}

	private spawnOne(playerPos: THREE.Vector3) {
		if (this.pool.length >= MAX_CUBES) return;

		const angle = Math.random() * Math.PI * 2;
		const r =
			SPAWN_RADIUS_MIN +
			Math.random() * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN);

		const mat = new THREE.MeshStandardMaterial({
			color: GREEN,
			emissive: GREEN,
			emissiveIntensity: 0.8,
			metalness: 0.4,
			roughness: 0.3,
		});

		const mesh = new THREE.Mesh(this.geo, mat);
		mesh.position.set(
			playerPos.x + Math.cos(angle) * r,
			1.5,
			playerPos.z + Math.sin(angle) * r,
		);
		this.scene.add(mesh);
		this.pool.push({ mesh, arrived: false });
	}

	update(delta: number, playerPos: THREE.Vector3) {
		if (!this.active) return;

		this.spawnTimer += delta;
		while (this.spawnTimer >= SPAWN_INTERVAL) {
			this.spawnTimer -= SPAWN_INTERVAL;
			this.spawnOne(playerPos);
		}

		for (let i = this.pool.length - 1; i >= 0; i--) {
			const cube = this.pool[i];

			// Recycle cubes that flew far past the player or are off-screen
			if (!cube.arrived) {
				const dFromPlayer = cube.mesh.position.distanceTo(playerPos);
				if (dFromPlayer > RECYCLE_RADIUS) {
					this.scene.remove(cube.mesh);
					(cube.mesh.material as THREE.Material).dispose();
					this.pool.splice(i, 1);
					continue;
				}
			}

			if (cube.arrived) continue;

			if (this.domeCenter) {
				const dir = new THREE.Vector3().subVectors(
					this.domeCenter,
					cube.mesh.position,
				);
				const dist = dir.length();
				if (dist < ARRIVAL_RADIUS) {
					cube.arrived = true;
					const mat = cube.mesh.material as THREE.MeshStandardMaterial;
					mat.color.set(RED);
					mat.emissive.set(RED);
				} else {
					dir.normalize().multiplyScalar(CUBE_SPEED * delta);
					cube.mesh.position.add(dir);
				}
			}
		}
	}

	reset() {
		for (const cube of this.pool) {
			this.scene.remove(cube.mesh);
			(cube.mesh.material as THREE.Material).dispose();
		}
		this.pool = [];
		this.domeCenter = null;
		this.active = false;
		this.spawnTimer = 0;
	}

	dispose() {
		this.reset();
		this.geo.dispose();
	}
}
