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
import { ICAROS_HOST } from "$lib/config/flight";

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
let stopHandshake: (() => void) | null = null;
let stopController: (() => void) | null = null;

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

	// Load whichever experience is selected (persisted in localStorage)
	const experienceId = getActiveExperienceId();

	loadExperience(experienceId, { scene, camera: dummyCamera, renderer }).then(
		(exp: ActiveExperience) => {
			experienceName = exp.manifest.name;
			hasOutputs = (exp.manifest.outputs?.length ?? 0) > 0;
			const renderCamera = exp.state.camera as THREE.PerspectiveCamera;

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

					// Only use WS orientation when ICAROS Host is not active
					if (!icarosActive && isOrientationData(msg)) {
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
	};
});

onDestroy(() => {
	renderer?.setAnimationLoop(null);
	if (scene) unloadExperience(scene);
	renderer?.dispose();
	vrButton?.remove();
	ws.disconnect();
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
