import * as THREE from "three";
import { loadGLTF } from "$lib/three/loader";
import { buildBeacon } from "./beacon";
import type { StationContext, StationVisual } from "./types";

const BRAIN_SCALE = 1;
const ROTATION_SPEED = 0.35;
const BOB_AMPLITUDE = 2;
const BOB_SPEED = 0.7;
const GLTF_PATH = "/models/the_brain.glb";

export class BrainStation implements StationVisual {
	static readonly TRIGGER_RADIUS = 120;
  readonly object = new THREE.Group();
  private readonly pivot: THREE.Group;
  private loaded = false;
  private readonly baseY = 120;
  private readonly sharedMat: THREE.MeshStandardMaterial;
  private readonly wireMat: THREE.LineBasicMaterial;
  private readonly wires: THREE.LineSegments[] = [];

  constructor(ctx: StationContext) {
    const beacon = buildBeacon(ctx);
    this.object.add(beacon.object);

    this.pivot = new THREE.Group();
    this.pivot.position.set(ctx.position.x, this.baseY, ctx.position.z);
    this.object.add(this.pivot);

    const col = new THREE.Color(0xffffff);
    this.sharedMat = new THREE.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: 0.5,
      metalness: 0.3,
      roughness: 0.4,
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

      // Center the model
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);

      model.scale.set(BRAIN_SCALE, BRAIN_SCALE, BRAIN_SCALE);

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
      console.warn("BrainStation: failed to load the_brain.glb", e);
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
