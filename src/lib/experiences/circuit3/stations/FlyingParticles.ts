import * as THREE from "three";

// ── FlyingParticles ─────────────────────────────────────────────────────────
//
// A swarm of small cube shards with optional target-seeking behaviour:
//   1. Exploding  — burst outward from the cube's position
//   2. Floating   — gentle bobbing/idle (indefinite if no target is set)
//   3. Flying     — all shards fly toward the target position (optional)
//   4. Merging    — shards shrink and lerp into the target, then disappear
//
// If `setTarget` is never called, the swarm stays in "floating" forever.
// If a target is set (even during explode/float), it transitions through the
// full sequence and eventually enters "done" for cleanup.

const SHARD_COUNT = 80;
const EXPLOSION_SPEED = 28;
const EXPLOSION_DURATION = 0.6;
const FLY_SPEED = 35;
const MERGE_DISTANCE = 2;

type ParticleState = "exploding" | "floating" | "flying" | "merging" | "done";

interface Shard {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  /** Per-shard offset from the target so the swarm arrives spread out. */
  offset: THREE.Vector3;
  phase: number;
}

export class FlyingParticles {
  readonly group = new THREE.Group();
  private state: ParticleState = "exploding";
  private elapsed = 0;
  private target: THREE.Vector3 | null = null;
  private readonly shards: Shard[] = [];
  private readonly disposers: Array<() => void> = [];

  constructor(origin: THREE.Vector3, color: THREE.Color) {
    const geo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.5,
      metalness: 0.4,
      roughness: 0.3,
    });

    for (let i = 0; i < SHARD_COUNT; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      const half = 14;
      mesh.position.set(
        (Math.random() - 0.5) * half,
        (Math.random() - 0.5) * half,
        (Math.random() - 0.5) * half,
      );
      mesh.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      );

      const dir = mesh.position.clone().normalize();
      if (dir.length() < 0.01) dir.set(0, 1, 0);
      const speed = EXPLOSION_SPEED * (0.5 + Math.random() * 0.5);
      dir.multiplyScalar(speed);

      this.shards.push({
        mesh,
        velocity: dir,
        offset: new THREE.Vector3(
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10,
        ),
        phase: Math.random() * Math.PI * 2,
      });
      this.group.add(mesh);
    }

    this.disposers.push(() => {
      geo.dispose();
      mat.dispose();
      for (const shard of this.shards) {
        this.group.remove(shard.mesh);
      }
    });
  }

  /** Set the target position to fly toward — kicks off flying → merging → done. */
  setTarget(target: THREE.Vector3): void {
    this.target = target.clone();
    if (this.state === "floating" || this.state === "exploding") {
      this.state = "flying";
      this.elapsed = 0;
    }
  }

  /** True once the swarm has fully merged into its target and can be disposed. */
  get isDone(): boolean {
    return this.state === "done";
  }

  update(delta: number): void {
    this.elapsed += delta;

    switch (this.state) {
      case "exploding":
        this.updateExplosion(delta);
        break;
      case "floating":
        this.updateFloating(delta);
        break;
      case "flying":
        this.updateFlying(delta);
        break;
      case "merging":
        this.updateMerging(delta);
        break;
      case "done":
        break;
    }
  }

  // ── Phase 1: Explosion ────────────────────────────────────────────────

  private updateExplosion(delta: number): void {
    for (const shard of this.shards) {
      shard.mesh.position.add(shard.velocity.clone().multiplyScalar(delta));
      shard.mesh.rotation.x += delta * 3;
      shard.mesh.rotation.y += delta * 5;
      shard.mesh.rotation.z += delta * 2;
      shard.velocity.multiplyScalar(1 - delta * 1.8);
      shard.velocity.y -= delta * 6;
    }

    if (this.elapsed >= EXPLOSION_DURATION) {
      this.state = "floating";
      this.elapsed = 0;
    }
  }

  // ── Phase 2: Floating idle ────────────────────────────────────────────

  private updateFloating(delta: number): void {
    const t = this.elapsed;
    for (const shard of this.shards) {
      shard.mesh.position.y += Math.sin(t * 1.2 + shard.phase) * delta * 1.2;
      shard.mesh.rotation.x += delta * 0.5;
      shard.mesh.rotation.y += delta * 0.8;
    }
  }

  // ── Phase 3: Flying toward target ─────────────────────────────────────

  private updateFlying(delta: number): void {
    if (!this.target) return;

    let allArrived = true;
    const t = this.elapsed;
    const convergence = 0.3 + 0.7 * Math.min(1, t / 2);

    for (const shard of this.shards) {
      const targetOff = shard.offset.clone().multiplyScalar(convergence);
      const targetPos = this.target.clone().add(targetOff);

      const dir = new THREE.Vector3().copy(targetPos).sub(shard.mesh.position);
      const dist = dir.length();

      if (dist > MERGE_DISTANCE) {
        allArrived = false;
        dir.normalize().multiplyScalar(FLY_SPEED * delta * (0.85 + Math.random() * 0.3));
        shard.mesh.position.add(dir);
        shard.mesh.rotation.x += delta * (2 + Math.random() * 2);
        shard.mesh.rotation.y += delta * (3 + Math.random() * 2);
      }
    }

    if (allArrived) {
      this.state = "merging";
      this.elapsed = 0;
    }
  }

  // ── Phase 4: Merge into target ────────────────────────────────────────

  private updateMerging(delta: number): void {
    const duration = 0.5;
    this.elapsed += delta;
    const progress = Math.min(1, this.elapsed / duration);
    const ease = 1 - Math.pow(1 - progress, 3);

    if (this.target) {
      for (const shard of this.shards) {
        shard.mesh.position.lerp(this.target, ease);
        const scale = 1 - ease;
        shard.mesh.scale.setScalar(Math.max(0, scale));
      }
    }

    if (progress >= 1) {
      this.state = "done";
    }
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
  }
}
