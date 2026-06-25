import * as THREE from "three";
import { getTerrainAmplitude } from "./config";

// ── Terrain Overlay Mesh (#3a) ───────────────────────────────────────────────
//
// A separate heightfield mesh, one per WFC chunk and the same footprint, that
// floats over the circuit board. It is built/disposed together with its chunk
// (see ChunkManager) but never touches the WFC / board geometry.
//
// The height is a continuous function of *world* position, so adjacent chunks
// share identical heights along their seam and the surface is gap-free. The
// amplitude is sampled per vertex from getTerrainAmplitude(distFromOrigin),
// which keeps the amplitude itself continuous as well (no per-chunk steps).

/** Plane subdivisions per chunk side. 32 → smooth hills, ~2k tris/chunk. */
const TERRAIN_SEGMENTS = 32;

/**
 * Continuous pseudo-terrain noise, evaluated in world space. A small stack of
 * directional sine waves (cheap, deterministic, perfectly seamless). The
 * coefficients sum to 1, so the result stays within roughly [-1, 1].
 */
function terrainNoise(x: number, z: number): number {
	let n = 0;
	n += Math.sin(x * 0.045 + z * 0.020) * 0.6;
	n += Math.sin(x * 0.017 - z * 0.090 + 1.7) * 0.3;
	n += Math.sin(x * 0.110 + z * 0.130 - 2.1) * Math.cos(z * 0.05) * 0.1;
	return n;
}

/**
 * Dark surface that reads as terrain hiding the glowing board. Shared across
 * all chunks (disposed once by the ChunkManager). Kept deliberately neutral —
 * it does not participate in the neon level cross-fade.
 */
export function createTerrainMaterial(): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color: 0x0a0612,
		metalness: 0.4,
		roughness: 0.75,
		side: THREE.DoubleSide,
		flatShading: false,
	});
}

/**
 * Build the heightfield mesh for the chunk whose world origin is (originX,
 * originZ). `chunkSize` is the chunk footprint in world units (shared with the
 * WFC chunk so the two overlap exactly).
 */
export function buildTerrainMesh(
	originX: number,
	originZ: number,
	chunkSize: number,
	material: THREE.Material,
): THREE.Mesh {
	const geo = new THREE.PlaneGeometry(
		chunkSize,
		chunkSize,
		TERRAIN_SEGMENTS,
		TERRAIN_SEGMENTS,
	);
	// Lay the plane flat in the XZ plane (former +Y becomes -Z).
	geo.rotateX(-Math.PI / 2);

	const pos = geo.attributes.position as THREE.BufferAttribute;
	for (let i = 0; i < pos.count; i++) {
		const wx = originX + pos.getX(i);
		const wz = originZ + pos.getZ(i);
		// Distance from origin in chunk units (continuous) → continuous amplitude.
		const chunkDistance = Math.hypot(wx, wz) / chunkSize;
		const amp = getTerrainAmplitude(chunkDistance);
		pos.setY(i, terrainNoise(wx, wz) * amp);
	}
	pos.needsUpdate = true;
	geo.computeVertexNormals();

	const mesh = new THREE.Mesh(geo, material);
	// Chunks are small relative to the view; culling per-chunk is unnecessary
	// and matches how the WFC building/trace meshes are handled.
	mesh.frustumCulled = false;
	return mesh;
}
