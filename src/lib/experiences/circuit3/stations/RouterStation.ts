import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { StationContext, StationVisual } from "./types";

const ROUTER_SCALE = 600;
const ROTATION_SPEED = 0.5;
const BOB_AMPLITUDE = 3;
const BOB_SPEED = 0.8;
const GLTF_PATH = "/models/router.glb";

const GREEN = new THREE.Color(0x00ff66);

export class RouterStation implements StationVisual {
  static readonly TRIGGER_RADIUS = 80;
  readonly object = new THREE.Group();
  private readonly pivot: THREE.Group;
  private readonly baseY: number;
  private loaded = false;
  private readonly sharedMat: THREE.MeshStandardMaterial;
  private readonly wireMat: THREE.LineBasicMaterial;
  private readonly wires: THREE.LineSegments[] = [];

  constructor(ctx: StationContext) {
    this.pivot = new THREE.Group();
    this.baseY = 60;
    this.pivot.position.set(ctx.position.x, this.baseY, ctx.position.z);
    this.object.add(this.pivot);

    // Green material applied to every mesh in the router model.
    this.sharedMat = new THREE.MeshStandardMaterial({
      color: GREEN,
      emissive: GREEN,
      emissiveIntensity: 0.4,
      metalness: 0.3,
      roughness: 0.5,
      wireframe: false,
    });

    // Wireframe overlay for the "mesh looking" aesthetic.
    this.wireMat = new THREE.LineBasicMaterial({
      color: GREEN,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const loader = new GLTFLoader();
    loader.load(GLTF_PATH, (gltf) => {
      const model = gltf.scene;
      model.scale.set(ROUTER_SCALE, ROUTER_SCALE, ROUTER_SCALE);

      // Replace every mesh material with the shared green material and add
      // a wireframe overlay so the router reads as a glowing mesh object.
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = this.sharedMat;
          child.castShadow = false;
          child.receiveShadow = false;

          // Thin wireframe overlay on top of the solid mesh.
          const wireGeo = new THREE.WireframeGeometry(child.geometry);
          const wire = new THREE.LineSegments(wireGeo, this.wireMat);
          child.add(wire);
          this.wires.push(wire);
        }
      });

      this.pivot.add(model);
      this.loaded = true;
    });
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
