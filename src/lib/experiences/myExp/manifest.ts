import type { ExperienceManifest, ParameterDef } from "../types";
import { updatePlayer } from "./player";
import { dispose, setup, tick } from "./scene";
import { applySettings } from "./settings";

// ── Parameter Definitions ──────────────────────────────────────

const parameters: ParameterDef[] = [
  {
    id: "moveSpeed",
    label: "Flight Speed",
    group: "Movement",
    min: 5,
    max: 100,
    default: 30,
    step: 1,
    unit: "m/s",
    icon: "Gauge",
  },
  {
    id: "haze-density",
    label: "Cyber-Smog",
    group: "Atmosphere",
    min: 0.0001,
    max: 0.02,
    default: 0.005,
    step: 0.0001,
    icon: "Cloud",
  },
  {
    id: "enduser-density",
    label: "Device Density",
    group: "Infrastructure",
    min: 0.1,
    max: 1,
    default: 0.5,
    step: 0.05,
    icon: "Smartphone",
  },
  {
    id: "ai-density",
    label: "AI Compute Load",
    group: "Infrastructure",
    min: 0.01,
    max: 0.5,
    default: 0.1,
    step: 0.01,
    icon: "Cpu",
  },
];

// ── Manifest ───────────────────────────────────────────────────

export const manifest: ExperienceManifest = {
  // ── Identity ──
  id: "data-space-flight",
  name: "Data Space Flight",
  description:
    "Navigate an infinite 3D data space visualizing cloud infrastructure and AI resource consumption.",
  version: "1.0.0",
  author: "AI Assistant",

  // ── I/O Contract ──
  parameters,
  outputs: [],
  interfaces: { orientation: true, speed: true },
  // ── Scene Defaults ──
  camera: { fov: 70, near: 0.1, far: 1000 },
  scene: {
    background: "#000000",
    fogNear: 50,
    fogFar: 800,
    fogColor: "#0a0a1a",
    ambientIntensity: 0.5,
    sunIntensity: 1.0,
    sunColor: "#ffffff",
    sunPosition: { x: 0, y: 100, z: 0 },
  },
  spawn: { position: { x: 0, y: 50, z: 0 } },

  // ── Lifecycle ──
  setup,
  tick,
  applySettings,
  updatePlayer,
  dispose,
};
