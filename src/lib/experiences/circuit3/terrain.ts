import * as THREE from "three";
import { getTerrainAmplitude } from "./config";

//TODO: Terrain material ist hässlich und liegt ÜBER dem Grid Boden. !!! MUSS NOCH GEÄNDERT WERDEN !!!
// Terrain erhöht sich jetzt levelbasiert (getTerrainAmplitude(level, …)): Level 0
// bleibt flach, jeder Levelwechsel hebt es eine Stufe an, und nur im letzten
// Level fließt zusätzlich die Distanz ein. Siehe config.ts.

// ── Terrain Overlay Mesh (#3a) ───────────────────────────────────────────────
//
// A separate heightfield mesh, one per WFC chunk and the same footprint, that
// floats over the circuit board. Built/disposed together with its chunk (see
// ChunkManager); it never touches the WFC / board, the data-room floor, or the
// scene lighting.
//
// "Only hills" model — the key design choice:
//   The heightfield is invisible wherever it sits at/below the board plane. A
//   per-vertex alpha + alphaTest *discards* those fragments, so flat ground and
//   valleys keep showing the clean dark grid floor. Only where the surface
//   rises into a real hill does it turn opaque and read as earth. Because the
//   amplitude is tiny near the origin (getTerrainAmplitude), the whole overlay
//   stays below the visibility threshold there → the data room starts clean and
//   earth hills only emerge as the player flies out (clean → industrial).
//
// It uses its OWN self-illuminated material (MeshBasicMaterial) with the
// shading baked into the vertex colors, so it needs no scene light — adding a
// light to make a lit terrain visible would also tint the data-room floor.
//
// Heights are sampled in *world* space, so adjacent chunks share identical
// heights (and identical alpha) along their seam → gap-free, no visible cut.

/** Plane subdivisions per chunk side. 64 → fine enough to resolve the crags. */
const TERRAIN_SEGMENTS = 64;

/** High-frequency micro-relief amplitude (world units) — fine surface grain. */
const MICRO_AMP = 0.12;
/**
 * How strongly the ridged crag detail modulates the hill height (0 = smooth
 * dome, higher = rockier/jaggeder). The crags are scaled by the local hill
 * height, so flat ground stays clean and only the hills turn stony.
 */
const ROCK_STRENGTH = 0.55;

// Ground diffuse texture (served from static/). MeshBasicMaterial is unlit, so
// only the color `map` is usable here — the matching normal/roughness/AO maps
// would need a lit material (which we intentionally avoid, see header). The
// texture supplies the soil color; the per-vertex shade + palette only tint it.
const GROUND_TEXTURE_URL =
	"/experiences/circuit/Textures/Terrain/ground_0046_color_1k.jpg";

/** World units covered by one full texture tile (controls visual grain size). */
const TEXTURE_TILE = 24;

// Visibility ramp (world-Y). Below VIS_LOW the terrain is fully transparent
// (clean grid floor shows); above VIS_HIGH it is fully opaque earth. With the
// alphaTest cutoff at 0.5 the visible edge sits at the midpoint — a natural
// "earth breaking through" contour. Near the origin the amplitude never reaches
// VIS_LOW, so nothing is drawn at all.
const VIS_LOW = 0.2;
const VIS_HIGH = 1.8;
const ALPHA_CUTOFF = 0.5;

// World-Y the terrain mesh is sunk to so it doesn't float over the grid floor.
// This *is* the "Platinen-Ebene" reference: wherever the sampled height rises
// above this offset, earth pokes through the board (and buildings are removed,
// see terrainRisesAboveBoard / ChunkManager).
const TERRAIN_Y_OFFSET = -0.9;

// Earthy palette (sRGB hex), blended per vertex for natural soil variation.
const C_SOIL = new THREE.Color(0x3a2614); // dark damp soil (low / sheltered)
const C_CLAY = new THREE.Color(0x6e4a28); // mid clay/earth
const C_SAND = new THREE.Color(0xb08a4e); // dry sandy ochre (exposed ridges)
const C_ROCK = new THREE.Color(0x5b5248); // grey-brown rock (steep slopes)
const C_WHITE = new THREE.Color(0xffffff);
const _col = new THREE.Color();

// How strongly the earthy palette tints the ground texture. The texture now
// supplies the base soil color (map ⊗ vertexColor), so the palette is pulled
// toward white and only mottles the texture rather than darkening it out.
const TINT_STRENGTH = 0.45;

// Baked "sun": a fixed light direction + ambient floor, folded into the vertex
// colors so the relief reads without any real scene light.
const LIGHT_DIR = new THREE.Vector3(0.45, 0.85, 0.3).normalize();
const BAKED_AMBIENT = 0.5;

/**
 * Broad underlying shape — a few low-frequency swells (cheap, deterministic,
 * seamless). The caller clamps this to its positive part so it reads as separate
 * big hills rising out of flat ground rather than continuous rolling waves.
 * Coefficients sum to 1, so the result stays within roughly [-1, 1].
 */
function baseShape(x: number, z: number): number {
	let n = 0;
	n += Math.sin(x * 0.045 + z * 0.020) * 0.6;
	n += Math.sin(x * 0.017 - z * 0.090 + 1.7) * 0.3;
	n += Math.sin(x * 0.110 + z * 0.130 - 2.1) * Math.cos(z * 0.05) * 0.1;
	return n;
}

/**
 * Ridged crag detail (~[-1, 1], with sharp peaks near +1). Stacked |sine|
 * ridges at rising frequencies — the jagged, stony surface that rides on top of
 * the hill. `1 - |sin + sin|` turns the smooth waves into sharp creases, the way
 * rock faces fold, instead of rounded bumps.
 */
function rockDetail(x: number, z: number): number {
	const ridge = (a: number, b: number) => 1 - Math.abs(Math.sin(a) + Math.sin(b));
	let n = 0;
	n += ridge(x * 0.09 + z * 0.05, x * 0.04 - z * 0.11) * 0.5;
	n += ridge(x * 0.20 - z * 0.16, x * 0.13 + z * 0.18) * 0.3;
	n += ridge(x * 0.39 + z * 0.31, x * 0.28 - z * 0.34) * 0.2;
	return n;
}

/** High-frequency detail noise for micro-relief and color mottling (~[-1,1]). */
function detailNoise(x: number, z: number): number {
	return (
		Math.sin(x * 0.9 - z * 0.5) * 0.5 +
		Math.sin(x * 0.31 + z * 1.3 + 0.8) * 0.5
	);
}

/**
 * Sample the terrain height (local mesh-Y, before the {@link TERRAIN_Y_OFFSET}
 * sink) at a world position. This is the single source of truth for the
 * displacement — {@link buildTerrainMesh} uses it per vertex, and the
 * building-suppression check ({@link terrainRisesAboveBoard}) uses it per tile,
 * so the two can never drift apart.
 */
export function sampleTerrainHeight(
	wx: number,
	wz: number,
	chunkSize: number,
	level: number,
): number {
	// Amplitude is level-driven; distance (in chunk units) only feeds the final
	// level, where the terrain keeps building up as the player flies.
	const chunkDistance = Math.hypot(wx, wz) / chunkSize;
	const amp = getTerrainAmplitude(level, chunkDistance);
	const hill = Math.max(baseShape(wx, wz), 0);
	const crag = rockDetail(wx, wz) * ROCK_STRENGTH;
	return hill * (1 + crag) * amp + detailNoise(wx, wz) * MICRO_AMP * hill;
}

/**
 * True when the terrain rises above the board plane (Platine) at this world
 * position — i.e. a hill breaks through and earth is visible. Buildings are
 * suppressed wherever this holds, so the circuit city only fills the flat
 * ground and the growing hills push it back. `margin` (world units) lifts the
 * threshold so buildings keep a clearance from the emerging earth instead of
 * being half-buried right at the contour.
 */
export function terrainRisesAboveBoard(
	wx: number,
	wz: number,
	chunkSize: number,
	level: number,
	margin = 0,
): boolean {
	return sampleTerrainHeight(wx, wz, chunkSize, level) + TERRAIN_Y_OFFSET > margin;
}

/**
 * The terrain's own material: self-illuminated (ignores scene lights). The
 * alphaTest discards the transparent lows so only hills draw; vertex colors are
 * RGBA — RGB is earth + baked shade, A is the height-based visibility.
 */
export function createTerrainMaterial(): THREE.MeshBasicMaterial {
	const material = new THREE.MeshBasicMaterial({
		color: 0xffffff,
		vertexColors: true,
		side: THREE.DoubleSide,
		alphaTest: ALPHA_CUTOFF,
	});

	// Load the soil diffuse map asynchronously and tile it (UVs are laid out in
	// world space per chunk — see buildTerrainMesh — so the tiling is seamless
	// across chunk seams). Assigned when ready; three re-uploads on next render.
	new THREE.TextureLoader().load(GROUND_TEXTURE_URL, (tex) => {
		tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.anisotropy = 8;
		material.map = tex;
		material.needsUpdate = true;
	});

	return material;
}

/**
 * Build the terrain overlay for the chunk whose world origin is (originX,
 * originZ). `chunkSize` is the chunk footprint in world units (shared with the
 * WFC chunk so the two overlap exactly).
 */
export function buildTerrainMesh(
	originX: number,
	originZ: number,
	chunkSize: number,
	material: THREE.Material,
	level: number,
): THREE.Mesh {
	const geo = new THREE.PlaneGeometry(
		chunkSize,
		chunkSize,
		TERRAIN_SEGMENTS,
		TERRAIN_SEGMENTS,
	);
	// Lay the plane flat in the XZ plane (former +Y becomes -Z).
	geo.rotateX(-Math.PI / 2);

	// ── Displace into the world-space heightfield (+ micro-relief grain) ───
	const pos = geo.attributes.position as THREE.BufferAttribute;
	const uv = geo.attributes.uv as THREE.BufferAttribute;
	for (let i = 0; i < pos.count; i++) {
		const wx = originX + pos.getX(i);
		const wz = originZ + pos.getZ(i);
		// One big hill clamped to its positive part (flat ground stays at 0, the
		// clean grid), ridged crags riding on top — see sampleTerrainHeight, the
		// shared source of truth also used to suppress buildings under hills.
		const h = sampleTerrainHeight(wx, wz, chunkSize, level);
		pos.setY(i, h);
		// World-space UVs so the tiled ground map lines up across chunk seams.
		uv.setXY(i, wx / TEXTURE_TILE, wz / TEXTURE_TILE);
	}
	pos.needsUpdate = true;
	uv.needsUpdate = true;
	geo.computeVertexNormals();

	// ── Per-vertex RGBA: earthy color + baked shade (RGB), visibility (A) ──
	const nrm = geo.attributes.normal as THREE.BufferAttribute;
	const colors = new Float32Array(pos.count * 4);
	for (let i = 0; i < pos.count; i++) {
		const wx = originX + pos.getX(i);
		const wz = originZ + pos.getZ(i);
		const h = pos.getY(i);
		const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);

		// Broad soil patches from low-frequency world noise (0..1).
		const patch = (baseShape(wx * 0.6 + 1000, wz * 0.6 - 800) + 1) * 0.5;
		_col.copy(C_SOIL).lerp(C_CLAY, patch).lerp(C_SAND, Math.max(0, patch - 0.5) * 1.2);
		// Steep faces turn rocky (normal tilts away from straight up).
		const slope = 1 - Math.min(Math.max(ny, 0), 1);
		_col.lerp(C_ROCK, Math.min(slope * 1.5, 0.8));
		// Pull toward white so the texture (map ⊗ color) shows through; the
		// palette now only mottles the soil rather than replacing it.
		_col.lerp(C_WHITE, 1 - TINT_STRENGTH);

		// Bake a fixed sun so relief shows without scene lights.
		const ndl = Math.max(0, nx * LIGHT_DIR.x + ny * LIGHT_DIR.y + nz * LIGHT_DIR.z);
		let shade = BAKED_AMBIENT + (1 - BAKED_AMBIENT) * ndl;
		// High-frequency value mottling → visible soil grain on flat-ish faces.
		shade *= 0.88 + 0.12 * detailNoise(wx * 2.3, wz * 2.3);
		_col.multiplyScalar(shade);

		// Visibility: transparent in the lows, opaque on the hills.
		const alpha = THREE.MathUtils.smoothstep(h, VIS_LOW, VIS_HIGH);

		colors[i * 4] = _col.r;
		colors[i * 4 + 1] = _col.g;
		colors[i * 4 + 2] = _col.b;
		colors[i * 4 + 3] = alpha;
	}
	geo.setAttribute("color", new THREE.BufferAttribute(colors, 4));

	const mesh = new THREE.Mesh(geo, material);
	// Terrain Overlay etwas absenken, weil es sonst über dem Grid Boden liegt und in der Luft schwebt
	mesh.position.y = TERRAIN_Y_OFFSET;
	// Chunks are small relative to the view; per-chunk culling is unnecessary
	// and matches how the WFC building/trace meshes are handled.
	mesh.frustumCulled = false;
	return mesh;
}

/**
 * Animate a terrain chunk's growth, same idea as the rising buildings. `t` in
 * [0, 1] scales the hills up from flat (Y-scale) and refreshes the height-based
 * visibility alpha so the earth rises out of the clean grid floor rather than
 * popping in fully formed. Call once per frame until grown, then stop.
 */
export function setTerrainGrowth(mesh: THREE.Mesh, t: number): void {
	const s = Math.max(t, 0.0001);
	mesh.scale.y = s;
	const geo = mesh.geometry as THREE.BufferGeometry;
	const pos = geo.attributes.position as THREE.BufferAttribute;
	const col = geo.attributes.color as THREE.BufferAttribute;
	// Alpha follows the *current* (scaled) height → the hill fades in as it rises.
	for (let i = 0; i < pos.count; i++) {
		col.setW(i, THREE.MathUtils.smoothstep(pos.getY(i) * s, VIS_LOW, VIS_HIGH));
	}
	col.needsUpdate = true;
}
