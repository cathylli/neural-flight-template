import type { ExperienceManifest, ParameterDef } from "../types";
import { updatePlayer } from "./player";
import { dispose, setup, tick } from "./scene";
import { applySettings } from "./settings";

const parameters: ParameterDef[] = [
	{
		id: "moveSpeed",
		label: "Movement Speed",
		group: "Movement",
		min: 1,
		max: 50,
		default: 20,
		step: 0.5,
		unit: "m/s",
		icon: "Gauge",
	},
	{
		id: "buildingOpacity",
		label: "Building Opacity",
		group: "Visual",
		min: 0.1,
		max: 1,
		default: 0.7,
		step: 0.05,
		icon: "Eye",
	},
	{
		id: "regenerate",
		label: "Regenerate",
		group: "WFC",
		type: "boolean",
		min: 0,
		max: 1,
		default: false,
		step: 1,
		icon: "RefreshCw",
	},
];

export const manifest: ExperienceManifest = {
	id: "wfc-showcase",
	name: "WFC Showcase",
	description:
		"Wave Function Collapse demonstration — auto-cycling through all environments",
	version: "1.0.0",
	author: "Conrad und Catharina",

	parameters,
	interfaces: { orientation: true, speed: false },

	camera: { fov: 70, near: 0.1, far: 600 },
	scene: {
		background: "#0a0a1a",
		fogNear: 50,
		fogFar: 300,
		fogColor: "#0a0a1a",
		ambientIntensity: 0.2,
		sunIntensity: 0.3,
		sunColor: "#4444ff",
		sunPosition: { x: 0, y: 100, z: 0 },
	},
	spawn: { position: { x: 0, y: 35, z: 0 } },

	setup,
	tick,
	applySettings,
	updatePlayer,
	dispose,
};
