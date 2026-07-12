import * as THREE from "three";
import { loadGLTF } from "$lib/three/loader";
import { buildBeacon } from "./beacon";
import type { StationContext, StationVisual } from "./types";

const SERVER_SCALE = 1200;
const ROTATION_SPEED = 0.3;
const BOB_AMPLITUDE = 3;
const BOB_SPEED = 0.5;
const GLTF_PATH = "/models/server.glb";

export class ServerStation implements StationVisual {
	static readonly TRIGGER_RADIUS = 80;
	readonly object = new THREE.Group();
	private readonly pivot: THREE.Group;
	private readonly baseY: number;
	private loaded = false;
	private readonly sharedMat: THREE.MeshStandardMaterial;
	private readonly wireMat: THREE.LineBasicMaterial;
	private readonly wires: THREE.LineSegments[] = [];

	constructor(ctx: StationContext) {
		const beacon = buildBeacon(ctx);
		this.object.add(beacon.object);

		this.pivot = new THREE.Group();
		this.baseY = 0;
		this.pivot.position.set(ctx.position.x, this.baseY, ctx.position.z);
		this.object.add(this.pivot);

		const col = ctx.neonColor;
		this.sharedMat = new THREE.MeshStandardMaterial({
			color: col,
			emissive: col,
			emissiveIntensity: 0.5,
			metalness: 0.3,
			roughness: 0.5,
		});

		this.wireMat = new THREE.LineBasicMaterial({
			color: col,
			transparent: true,
			opacity: 0.4,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});

		this.loadModel();
	}

	private async loadModel(): Promise<void> {
		try {
			const gltf = await loadGLTF(GLTF_PATH);
			const model = gltf.scene;

			// Center the model — server.glb geometry is offset from origin
			const box = new THREE.Box3().setFromObject(model);
			const center = box.getCenter(new THREE.Vector3());
			model.position.sub(center);

			model.scale.set(SERVER_SCALE, SERVER_SCALE, SERVER_SCALE);

			model.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					child.material = this.sharedMat;
					child.castShadow = false;
					child.receiveShadow = false;

					const wireGeo = new THREE.WireframeGeometry(child.geometry);
					const wire = new THREE.LineSegments(wireGeo, this.wireMat);
					child.add(wire);
					this.wires.push(wire);
				}
			});

			this.pivot.add(model);
			this.loaded = true;
		} catch (e) {
			console.warn("ServerStation: failed to load server.glb", e);
		}
	}

	update(elapsed: number): void {
		if (!this.loaded) return;
		this.pivot.rotation.y = elapsed * ROTATION_SPEED;
		this.pivot.position.y =
			this.baseY + Math.sin(elapsed * BOB_SPEED) * BOB_AMPLITUDE;
	}

	dispose(): void {
		this.sharedMat.dispose();
		this.wireMat.dispose();
		for (const w of this.wires) {
			w.geometry.dispose();
		}
		this.wires.length = 0;
		this.pivot.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				child.geometry.dispose();
			}
		});
	}
}
