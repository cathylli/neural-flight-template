import * as THREE from "three";
import { CHUNK_SIZE } from "../types";
import type {
	ChunkContent,
	Environment,
	EnvironmentBuildParams,
} from "../types";

// ── Void Environment (empty transition space) ─────────────────────────────────
//
// A blank environment with no WFC tiles, buildings, traces or terrain. Every
// chunk is an empty group — the only visible element is the station (CubeStation)
// that appears when the level's spawn delay expires. Designed as a brief
// transition level between substantive environments.

class VoidChunk implements ChunkContent {
	readonly group = new THREE.Group();
	readonly stationSlot: THREE.Vector3 | null;

	constructor(
		cx: number,
		cz: number,
		stationWeight: number,
	) {
		this.group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);

		// Place the station slot at the chunk's center if this chunk is allowed
		// to host one.
		if (stationWeight > 0) {
			this.stationSlot = new THREE.Vector3(
				cx * CHUNK_SIZE,
				0,
				cz * CHUNK_SIZE,
			);
		} else {
			this.stationSlot = null;
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	update(_elapsed: number): void {
		// Nothing to animate — this chunk is empty.
	}

	dispose(): void {
		this.group.clear();
	}
}

export class VoidEnvironment implements Environment {
	buildChunk(
		cx: number,
		_cy: number,
		cz: number,
		params: EnvironmentBuildParams,
		_spawnTime: number,
	): ChunkContent {
		// Ground-based environment: no vertical streaming, so `cy` is always 0.
		return new VoidChunk(cx, cz, params.stationWeight);
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	updateNeonColor(_color: THREE.Color): void {
		// No neon geometry to recolor.
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	updateBuildingOpacity(_opacity: number): void {
		// No buildings to fade.
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	terrainHeightAt(_x: number, _z: number, _terrainLevel: number): number | null {
		// No terrain — player flies at the ground plane's height.
		return null;
	}

	dispose(): void {
		// No shared materials to free.
	}
}
