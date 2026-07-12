import * as THREE from "three";
import { loadGLTF } from "$lib/three/loader";
import type { StationContext, StationVisual } from "./types";

const COMPUTER_SCALE = 80;
const ROTATION_SPEED = 0.3;
const BOB_AMPLITUDE = 1.5;
const BOB_SPEED = 0.8;
const GLTF_PATH = "/models/desktop_computer.glb";

const GREEN = new THREE.Color(0x00ff66);

export class ComputerStation implements StationVisual {
	static readonly TRIGGER_RADIUS = 40;
	readonly object = new THREE.Group();
	private readonly pivot: THREE.Group;
	private loaded = false;
	private readonly baseY = 0;
	private readonly sharedMat: THREE.MeshStandardMaterial;
	private readonly wireMat: THREE.LineBasicMaterial;
	private readonly wires: THREE.LineSegments[] = [];

	constructor(ctx: StationContext) {
		this.pivot = new THREE.Group();
		this.pivot.position.set(ctx.position.x, this.baseY, ctx.position.z);
		this.object.add(this.pivot);

		this.sharedMat = new THREE.MeshStandardMaterial({
			color: GREEN,
			emissive: GREEN,
			emissiveIntensity: 0.5,
			metalness: 0.3,
			roughness: 0.4,
		});

		this.wireMat = new THREE.LineBasicMaterial({
			color: GREEN,
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

			const box = new THREE.Box3().setFromObject(model);
			const center = box.getCenter(new THREE.Vector3());
			model.position.sub(center);

			model.scale.set(COMPUTER_SCALE, COMPUTER_SCALE, COMPUTER_SCALE);

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
			console.warn("ComputerStation: failed to load desktop_computer.glb", e);
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
