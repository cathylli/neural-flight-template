import * as THREE from "three";
import type { StationContext } from "./types";

// ── Shared Beacon ────────────────────────────────────────────────────────────
//
// The "find me from far away" part of every station: a vertical light beam, a
// bright core pillar and a ground ring marking the trigger footprint. It's level
// colored and reusable, so each station type composes it into its own group
// instead of rebuilding it. The per-station geometry (cube, torus, …) is added
// on top by the station class itself.

/**
 * Builds the shared beacon for a station. Returns its group plus a `dispose`
 * that frees the geometries/materials it created — the caller adds the group to
 * its own station group and forwards `dispose` on teardown.
 */
export function buildBeacon(ctx: StationContext): {
  object: THREE.Group;
  dispose: () => void;
} {
  const { position: pos, neonColor: color, triggerRadius, beaconHeight } = ctx;
  const group = new THREE.Group();
  const materials: THREE.Material[] = [];

  // Vertical light beam — visible from a distance so the player can fly to it.
  const beamMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.5, beaconHeight, 20, 1, true),
    beamMat,
  );
  beam.position.set(pos.x, beaconHeight / 2, pos.z);
  group.add(beam);
  materials.push(beamMat);

  // Bright core pillar.
  const coreMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, beaconHeight, 12),
    coreMat,
  );
  core.position.set(pos.x, beaconHeight / 2, pos.z);
  group.add(core);
  materials.push(coreMat);

  // Ground ring marking the trigger footprint.
  const ringMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(triggerRadius - 1.5, triggerRadius, 48),
    ringMat,
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, 0.1, pos.z);
  group.add(ring);
  materials.push(ringMat);

  return {
    object: group,
    dispose() {
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
      for (const mat of materials) mat.dispose();
    },
  };
}
