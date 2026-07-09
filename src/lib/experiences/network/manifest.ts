import type { ExperienceManifest, ParameterDef } from "../types";
import { updatePlayer } from "./player";
import { dispose, setup, tick } from "./scene";
import { applySettings } from "./settings";

const parameters: ParameterDef[] = [
	{
		id: "moveSpeed",
		label: "Move Speed",
		group: "Movement",
		min: 1,
		max: 50,
		default: 10,
		step: 1,
		unit: "m/s",
		icon: "Gauge",
	},
	{
		id: "particleCount",
		label: "Particles",
		group: "Network",
		min: 100,
		max: 2000,
		default: 800,
		step: 50,
		icon: "Dot",
	},
	{
		id: "connectionDistance",
		label: "Connection Dist.",
		group: "Network",
		min: 20,
		max: 200,
		default: 80,
		step: 5,
		unit: "m",
		icon: "Share2",
	},
	{
		id: "driftSpeed",
		label: "Drift Speed",
		group: "Network",
		min: 1,
		max: 40,
		default: 12,
		step: 1,
		icon: "Wind",
	},
	{
		id: "neonColor",
		label: "Color",
		group: "Visual",
		type: "color",
		min: 0,
		max: 1,
		default: "#00ffcc",
		step: 1,
		icon: "Palette",
	},
];

export const manifest: ExperienceManifest = {
	id: "network",
	name: "Network",
	description: "Fly through a living particle network — nodes drift and dynamically connect",
	version: "0.1.0",
	author: "Conrad und Catharina",

	parameters,
	outputs: [],
	interfaces: { orientation: true, speed: true },

	camera: { fov: 70, near: 0.1, far: 600 },
	scene: {
		background: "#050510",
		fogNear: 0,
		fogFar: 0,
		fogColor: "#050510",
		ambientIntensity: 0,
		sunIntensity: 0,
		sunColor: "#ffffff",
		sunPosition: { x: 0, y: 100, z: 0 },
	},
	spawn: { position: { x: 0, y: 3, z: 0 } },

	setup,
	tick,
	applySettings,
	updatePlayer,
	dispose,
};
