import type { ExperienceManifest, ParameterDef } from "../types";
import { updatePlayer } from "./player";
import { dispose, setup, tick } from "./scene";
import { applySettings } from "./settings";

// ── Parameter Definitions ──────────────────────────────────────
// Jeder Parameter erscheint automatisch in der Settings Sidebar (Slider/Toggle/ColorPicker)
// und im Node Editor (als Output Node, 0-1 Signal wird auf min/max remapped).
//
// Felder:
//   id       → Eindeutiger Key — wird in applySettings() als switch-case genutzt
//   label    → Anzeigename im UI
//   group    → Gruppierung in der Settings Sidebar
//   type     → "number" (Slider), "boolean" (Toggle), "color" (ColorPicker) — default: "number"
//   min/max  → Wertebereich (für boolean: 0/1, für color: ignoriert)
//   default  → Startwert
//   step     → Schrittweite im Slider
//   icon     → Lucide Icon-Name für den Node Editor Output Node
//
// Siehe Mountain Flight manifest.ts für ein umfangreiches Beispiel (~20 Parameter).

const parameters: ParameterDef[] = [
	// ── Movement ────────────────────────────────────
	{
		id: "moveSpeed",
		label: "Move Speed",
		group: "Movement",
		min: 1,
		max: 20,
		default: 5,
		step: 0.5,
		unit: "m/s",
		icon: "Gauge",
	},

	// ── Audio ──────────────────────────────────────
	{
		id: "volume",
		label: "Volume",
		group: "Audio",
		min: 0,
		max: 1,
		default: 0.5,
		step: 0.05,
		icon: "Volume2",
	},

	// ── Scene ───────────────────────────────────────
	{
		id: "traceDensity",
		label: "Trace Density",
		group: "Scene",
		min: 50,
		max: 500,
		default: 150,
		step: 10,
		icon: "Cpu",
	},
	{
		id: "traceColor",
		label: "Trace Color",
		group: "Scene",
		type: "color",
		min: 0,
		max: 1,
		default: "#00ff33", // Solid green LED glow
		step: 1,
		icon: "Palette",
	},
];

// ── Manifest ───────────────────────────────────────────────────
// Das Manifest ist der "Vertrag" zwischen deiner Experience und der Plattform.
// Die Plattform liest daraus: welche Parameter gibt es, wie sieht die Scene aus,
// und welche Lifecycle-Funktionen soll sie aufrufen.

export const manifest: ExperienceManifest = {
	// ── Identity ──
	id: "circuit",
	name: "Circuit",
	description: "A generative flat circuit board environment",
	version: "0.1.0",
	author: "AI",

	// ── I/O Contract ──
	parameters,
	outputs: [],
	interfaces: { orientation: true, speed: false },

	// ── Scene Defaults ──
	camera: { fov: 70, near: 0.1, far: 500 },
	scene: {
		background: "#020205", // Dark void
		fogNear: 50,
		fogFar: 300,
		fogColor: "#020205",
		ambientIntensity: 0.2,
		sunIntensity: 0.5,
		sunColor: "#ffffff",
		sunPosition: { x: 50, y: 80, z: 30 },
	},
	spawn: { position: { x: 0, y: 5, z: 0 } },

	// ── Lifecycle ──
	// Diese Funktionen werden von der Plattform aufgerufen:
	setup, //    → Einmal beim Laden (3D-Objekte erstellen)
	tick, //     → Jeden Frame (Animation, Physik)
	applySettings, // → Wenn ein Parameter sich ändert
	updatePlayer, //  → Wenn Orientation-Daten ankommen
	dispose, //  → Beim Entladen (aufräumen!)
};
