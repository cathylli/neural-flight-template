// ── WFC Showcase Configuration ─────────────────────────────────────────────
//
// Cycles through ALL circuit3 environments every CYCLE_SECONDS to demonstrate
// the full range of Wave Function Collapse worlds. Each variation uses a
// different Environment class with its own look, materials and generation.

import * as THREE from "three";
import { CircuitEnvironment } from "../circuit3/environments/circuit/CircuitEnvironment";
import { NeuralEnvironment } from "../circuit3/environments/neural/NeuralEnvironment";
import { FiberTunnelEnvironment } from "../circuit3/environments/fiber/FiberTunnelEnvironment";
import { DrainEnvironment } from "../circuit3/environments/drain/DrainEnvironment";
import { ParticleNetworkEnvironment } from "../circuit3/environments/particle-network/ParticleNetworkEnvironment";
import type { Environment } from "../circuit3/environments/types";

/** Seconds between environment swaps. */
export const CYCLE_SECONDS = 30;

/** Duration (seconds) of the black fade-out/in on a cycle. */
export const FADE_SECONDS = 1.5;

/** Duration (seconds) of the neon color cross-fade. */
export const COLOR_TRANSITION_SECONDS = 2.5;

/** Duration (seconds) the tutorial overlay is visible on first variation. */
export const TUTORIAL_DURATION = 69;

/** Reduced flight speed during the tutorial phase. */
export const TUTORIAL_SPEED = 6;

export interface WFCVariation {
	/** Display name. */
	label: string;
	/** Factory creating this environment instance. */
	factory: () => Environment;
	/** Neon color for the fade cross-fade (CSS hex). */
	neonColor: string;
	/** Player flight speed for this variation. */
	flightSpeed: number;
	/** Generation params passed to ChunkManager. */
	buildingDensity: number;
	traceComplexity: number;
}

export const VARIATIONS: WFCVariation[] = [
	{
		label: "Circuit Board",
		factory: () => new CircuitEnvironment(new THREE.Color("#00ff66")),
		neonColor: "#00ff66",
		flightSpeed: 20,
		buildingDensity: 0.3,
		traceComplexity: 0.6,
	},
	{
		label: "Neural Network",
		factory: () => new NeuralEnvironment(),
		neonColor: "#00ffcc",
		flightSpeed: 20,
		buildingDensity: 0,
		traceComplexity: 0,
	},
	{
		label: "Fiber Tunnel",
		factory: () => new FiberTunnelEnvironment(),
		neonColor: "#00ff66",
		flightSpeed: 25,
		buildingDensity: 0,
		traceComplexity: 0,
	},
	{
		label: "Drain Grid",
		factory: () => new DrainEnvironment(),
		neonColor: "#00aaff",
		flightSpeed: 20,
		buildingDensity: 0,
		traceComplexity: 0,
	},
	{
		label: "Particle Network",
		factory: () => new ParticleNetworkEnvironment(),
		neonColor: "#ffffff",
		flightSpeed: 22,
		buildingDensity: 0,
		traceComplexity: 0,
	},
];
