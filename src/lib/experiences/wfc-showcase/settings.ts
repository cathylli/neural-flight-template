import type * as THREE from "three";
import type { ExperienceState } from "../types";
import type { WFCState } from "./scene";

export function applySettings(
	id: string,
	value: number | boolean | string,
	state: ExperienceState,
	_scene: THREE.Scene,
): void {
	const s = state as WFCState;

	switch (id) {
		case "moveSpeed":
			s.player.baseSpeed = value as number;
			break;
		case "buildingOpacity":
			s.chunkManager.updateBuildingOpacity(value as number);
			break;
		case "regenerate":
			if (value === true) s._needsRebuild = true;
			break;
		default:
			break;
	}
}
