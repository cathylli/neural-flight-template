<script lang="ts">
import { Trophy } from "lucide-svelte";
import { onDestroy, onMount } from "svelte";
import * as THREE from "three";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import type { ActiveExperience } from "$lib/experiences/loader";
import {
	getActiveExperienceId,
	loadExperience,
	unloadExperience,
} from "$lib/experiences/loader";
import { createWebSocketClient } from "$lib/ws/client.svelte";
import { startHandshake } from "$lib/ws/icaros-handshake";
import { startControllerStream } from "$lib/ws/icaros-control";
import type { ControlOrientation } from "$lib/ws/icaros-types";
import {
	isOrientationData,
	isSettingsUpdate,
	isSpeedCommand,
} from "$lib/ws/protocol";
import {
	PUBLIC_ICAROS_EXPERIENCE_ID,
	PUBLIC_ICAROS_HOST_ORIGIN,
	PUBLIC_ICAROS_EXPERIENCE_TITLE,
} from "$env/static/public";
import { CONTROLS, ICAROS_HOST } from "$lib/config/flight";

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let vrButton: HTMLElement;
let score = $state(0);
let experienceName = $state("ICAROS VR");
let hasOutputs = $state(false);
let lastProcessedTimestamp = 0;
const CLIENT_ID_KEY = "neural-flight:icaros-client-id";

function loadClientId(): string {
	if (typeof localStorage === "undefined")
		return `nf-${crypto.randomUUID().slice(0, 8)}`;
	let id = localStorage.getItem(CLIENT_ID_KEY);
	if (!id) {
		id = `nf-${crypto.randomUUID().slice(0, 8)}`;
		localStorage.setItem(CLIENT_ID_KEY, id);
	}
	return id;
}

const hostOrigin = PUBLIC_ICAROS_HOST_ORIGIN ?? "";
const icarosActive = hostOrigin.length > 0;

const ws = createWebSocketClient();
const clock = new THREE.Clock();

let lastOrientation = { pitch: 0, roll: 0 };
let lastSpeed = { accelerate: false, brake: false };
let removeResizeListener: (() => void) | null = null;
let removeKeyboardListeners: (() => void) | null = null;
let stopHandshake: (() => void) | null = null;
let stopController: (() => void) | null = null;
let jumpToLevel: ((level: number) => void) | null = null;

// Keyboard fallback for desktop testing — mirrors ControlPad behaviour exactly
let kbPitch = 0;
let kbRoll = 0;
let keyboardActive = false;

function kbPress(button: "UP" | "DOWN" | "LEFT" | "RIGHT"): void {
	if (icarosActive) return;
	const dir = CONTROLS.BUTTONS[button];
	const [minPitch, maxPitch] = CONTROLS.PITCH_RANGE;
	const [minRoll, maxRoll] = CONTROLS.ROLL_RANGE;
	kbPitch = Math.max(
		minPitch,
		Math.min(maxPitch, kbPitch + dir.pitch * CONTROLS.STEP_DEGREES),
	);
	kbRoll = Math.max(
		minRoll,
		Math.min(maxRoll, kbRoll + dir.roll * CONTROLS.STEP_DEGREES),
	);
	keyboardActive = true;
}

function kbRelease(): void {
	kbPitch = 0;
	kbRoll = 0;
	keyboardActive = false;
}

function handleKeyDown(e: KeyboardEvent): void {
	// Level switching: keys 1-7 (levels 0-6)
	if (e.key >= "1" && e.key <= "7" && jumpToLevel) {
		e.preventDefault();
		jumpToLevel(Number.parseInt(e.key, 10) - 1);
		return;
	}

	const map: Record<string, "UP" | "DOWN" | "LEFT" | "RIGHT"> = {
		ArrowUp: "UP",
		ArrowDown: "DOWN",
		ArrowLeft: "LEFT",
		ArrowRight: "RIGHT",
	};
	const button = map[e.key];
	if (button) {
		e.preventDefault();
		kbPress(button);
	}
}

function handleKeyUp(e: KeyboardEvent): void {
	const map: Record<string, "UP" | "DOWN" | "LEFT" | "RIGHT"> = {
		ArrowUp: "UP",
		ArrowDown: "DOWN",
		ArrowLeft: "LEFT",
		ArrowRight: "RIGHT",
	};
	if (map[e.key]) kbRelease();
}

function handleBlur(): void {
	kbRelease();
}

onMount(() => {
	scene = new THREE.Scene();
	const dummyCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);

	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.xr.enabled = true;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;

	vrButton = VRButton.createButton(renderer);
	document.body.appendChild(vrButton);

	// Start ICAROS Host connection when configured
	if (icarosActive) {
		const clientId = loadClientId();
		console.log("[vr] Starting ICAROS Host connection", {
			hostOrigin,
			clientId,
			clientUrl: window.location.href,
		});
		stopHandshake = startHandshake({
			hostOrigin,
			clientId,
			experienceId: PUBLIC_ICAROS_EXPERIENCE_ID ?? "neural-flight",
			title: PUBLIC_ICAROS_EXPERIENCE_TITLE ?? "Neural Flight",
			clientUrl: window.location.href,
			onRejected(reason: string) {
				console.error(
					"[vr] ICAROS Host rejected handshake:",
					reason,
				);
			},
		});
		stopController = startControllerStream(
			hostOrigin,
			(orientation: ControlOrientation) => {
				lastOrientation =
					orientation.quality > 0
						? {
								pitch: orientation.roll * ICAROS_HOST.MAX_PITCH_DEGREES,
								roll: orientation.pitch * ICAROS_HOST.MAX_ROLL_DEGREES,
							}
						: { pitch: 0, roll: 0 };
			},
		);
	}

	// Keyboard fallback for desktop testing (disabled when ICAROS is active)
	window.addEventListener("keydown", handleKeyDown);
	window.addEventListener("keyup", handleKeyUp);
	window.addEventListener("blur", handleBlur);
	removeKeyboardListeners = () => {
		window.removeEventListener("keydown", handleKeyDown);
		window.removeEventListener("keyup", handleKeyUp);
		window.removeEventListener("blur", handleBlur);
	};

	// Load whichever experience is selected (persisted in localStorage)
	const experienceId = getActiveExperienceId();

	loadExperience(experienceId, { scene, camera: dummyCamera, renderer }).then(
		(exp: ActiveExperience) => {
			experienceName = exp.manifest.name;
			hasOutputs = (exp.manifest.outputs?.length ?? 0) > 0;
			const renderCamera = exp.state.camera as THREE.PerspectiveCamera;

			// Level switching for circuit3 experience (testing)
			const state = exp.state as Record<string, unknown>;
			if (state.levelState && typeof state.levelState === "object") {
				const ls = state.levelState as { jumpToLevel?: (n: number) => void };
				if (typeof ls.jumpToLevel === "function") {
					jumpToLevel = ls.jumpToLevel.bind(ls);
				}
			}

			function onResize(): void {
				renderCamera.aspect = window.innerWidth / window.innerHeight;
				renderCamera.updateProjectionMatrix();
				renderer.setSize(window.innerWidth, window.innerHeight);
			}
			window.addEventListener("resize", onResize);
			removeResizeListener = () =>
				window.removeEventListener("resize", onResize);

			renderer.setAnimationLoop(() => {
				const delta = clock.getDelta();

				const msg = ws.lastMessage;
				if (msg && msg.timestamp > lastProcessedTimestamp) {
					lastProcessedTimestamp = msg.timestamp;

					// Use WS orientation from controller page / gyro page
					if (isOrientationData(msg)) {
						lastOrientation = { pitch: msg.pitch, roll: msg.roll };
					}
					if (isSpeedCommand(msg)) {
						lastSpeed = {
							accelerate: msg.action === "accelerate" && msg.active,
							brake: msg.action === "brake" && msg.active,
						};
					}
					if (isSettingsUpdate(msg)) {
						for (const key of Object.keys(msg.settings)) {
							exp.manifest.applySettings(
								key,
								msg.settings[key] as number | boolean | string,
								exp.state,
								scene,
							);
						}
					}
				}

				// Keyboard overrides WebSocket when keys are pressed (never overrides ICAROS)
				if (keyboardActive) {
					lastOrientation = { pitch: kbPitch, roll: kbRoll };
					lastSpeed = { accelerate: false, brake: false };
				}

				exp.manifest.updatePlayer(lastOrientation, lastSpeed, exp.state, delta);
				const result = exp.manifest.tick(exp.state, {
					delta,
					elapsed: clock.elapsedTime,
					camera: renderCamera,
					playerPosition: renderCamera.parent?.position ?? new THREE.Vector3(),
					playerRotation: renderCamera.parent?.rotation ?? new THREE.Euler(),
				});
				exp.state = result.state;
				if (result.outputs?.score !== undefined) {
					score = result.outputs.score as number;
				}

				renderer.render(scene, renderCamera);
			});
		},
	);

	return () => {
		removeResizeListener?.();
		removeKeyboardListeners?.();
	};
});

	onDestroy(() => {
	renderer?.setAnimationLoop(null);
	if (scene) unloadExperience(scene);
	renderer?.dispose();
	vrButton?.remove();
	ws.disconnect();
	removeKeyboardListeners?.();
	stopHandshake?.();
	stopController?.();
});
</script>

<svelte:head>
	<title>{experienceName} | ICAROS VR</title>
</svelte:head>

<canvas bind:this={canvas} class="vr-canvas"></canvas>

{#if hasOutputs}
	<div class="score-overlay">
		<Trophy size={20} /> {score}
	</div>
{/if}
