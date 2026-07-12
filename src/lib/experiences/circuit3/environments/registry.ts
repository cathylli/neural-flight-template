import * as THREE from "three";
import { CircuitEnvironment } from "./circuit/CircuitEnvironment";
import { NeuralEnvironment } from "./neural/NeuralEnvironment";
import { FiberTunnelEnvironment } from "./fiber/FiberTunnelEnvironment";
import { FirewallEnvironment } from "./firewall/FirewallEnvironment";
import { DrainEnvironment } from "./drain/DrainEnvironment";
import { ParticleNetworkEnvironment } from "./particle-network/ParticleNetworkEnvironment";
import type { Environment } from "./types";

// ── Environment Registry ──────────────────────────────────────────────────────
//
// Maps a level index to the environment used for that level — the exact same
// pattern as stations/registry.ts, just for the whole world instead of the
// station visual. To give a level a completely different look, write a new class
// implementing Environment (copy CircuitEnvironment) and swap its factory in
// here — nothing in the ChunkManager changes.
//
// Environment and station visuals are intentionally two *separate* registries,
// both keyed by level: a level can mix any environment with any station look.
//
// Instances are cached per level (they own GPU materials) so a rebuild or a
// re-entry into the same level reuses the one environment rather than leaking a
// new material set each time.

/** level index → factory building that level's environment, given its neon color. */
type EnvironmentFactory = (neonColor: THREE.Color) => Environment;

const ENVIRONMENT_FACTORIES: EnvironmentFactory[] = [
	(c) => new CircuitEnvironment(c),    // L0 — clean data room
	()  => new NeuralEnvironment(),      // L1 — infinite 3D routing net
	()  => new FiberTunnelEnvironment(), // L2 — fiber optic highway (psychedelic light tunnel)
	(c) => new CircuitEnvironment(c),    // L3 — white data room (circuit board variant) + firewall dome
	()  => new FirewallEnvironment(),    // L4 — inside the firewall (red data field)
	()  => new DrainEnvironment(),       // L5 — grid floor with drain holes
	()  => new ParticleNetworkEnvironment(), // L6 — particle network (drawrange volumetric)
];

/**
 * Per-experience environment cache. Owned by the scene so nothing leaks across
 * experience restarts (unlike a module-level singleton would). Levels beyond the
 * table fall back to the last registered environment, so a new level always has
 * a world to render.
 */
export class EnvironmentRegistry {
	private readonly cache = new Map<number, Environment>();

	/** The (cached) environment for `level`, created with that level's neon color. */
	forLevel(level: number, neonColor: THREE.Color): Environment {
		const idx = Math.min(
			Math.max(level, 0),
			ENVIRONMENT_FACTORIES.length - 1,
		);
		let env = this.cache.get(idx);
		if (!env) {
			env = ENVIRONMENT_FACTORIES[idx](neonColor);
			this.cache.set(idx, env);
		}
		return env;
	}

	/** Dispose every environment created so far (experience teardown). */
	dispose(): void {
		for (const env of this.cache.values()) env.dispose();
		this.cache.clear();
	}
}
