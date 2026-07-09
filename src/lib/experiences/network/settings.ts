import * as THREE from "three";
import type { ExperienceState } from "../types";
import type { NetworkState } from "./scene";

export function applySettings(
	id: string,
	value: number | boolean | string,
	state: ExperienceState,
	_scene: THREE.Scene,
): void {
	const s = state as NetworkState;

	switch (id) {
		case "moveSpeed":
			s.moveSpeed = value as number;
			s.player.baseSpeed = s.moveSpeed;
			break;

		case "particleCount": {
			const count = Math.min(value as number, 2000);
			s.particleCount = count;
			s.particleGeo.setDrawRange(0, count);
			break;
		}

		case "connectionDistance":
			s.connectionDistance = value as number;
			break;

		case "driftSpeed":
			s.driftSpeed = value as number;
			break;

		case "neonColor":
			s.neonColor.set(value as string);
			if (s.group.children[0] instanceof THREE.Points) {
				(s.group.children[0].material as THREE.PointsMaterial).color.copy(s.neonColor);
			}
			break;

		default:
			break;
	}
}
