import * as THREE from "three";
import type { ExperienceState } from "../types";
import type { CircuitState } from "./scene";

export function applySettings(
	id: string,
	value: number | boolean | string,
	state: ExperienceState,
	scene: THREE.Scene,
): void {
	const s = state as CircuitState;

	switch (id) {
		case "moveSpeed":
			s.player.baseSpeed = value as number;
			break;

		case "traceDensity":
		case "traceColor":
			s.world.applySettings(id, value);
			break;

		case "volume":
			s.backgroundAudio.setVolume(value as number);
			break;

		default:
			break;
	}
}
