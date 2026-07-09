<script lang="ts">
import { onDestroy, onMount } from "svelte";
import * as THREE from "three";
import { loadExperience, unloadExperience } from "$lib/experiences/loader";
import type { ActiveExperience } from "$lib/experiences/loader";

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;

onMount(() => {
	scene = new THREE.Scene();
	const dummyCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);

	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setSize(window.innerWidth, window.innerHeight);

	const keys: Record<string, boolean> = {};
	let mouseX = 0;
	let mouseY = 0;

	function onKey(e: KeyboardEvent, down: boolean) {
		keys[e.key.toLowerCase()] = down;
	}
	function onMouseMove(e: MouseEvent) {
		mouseX = (e.clientX / window.innerWidth) * 2 - 1;
		mouseY = (e.clientY / window.innerHeight) * 2 - 1;
	}
	window.addEventListener("keydown", (e) => onKey(e, true));
	window.addEventListener("keyup", (e) => onKey(e, false));
	window.addEventListener("mousemove", onMouseMove);
	canvas.addEventListener("click", () => canvas.requestPointerLock());

	loadExperience("network", { scene, camera: dummyCamera, renderer }).then(
		(exp: ActiveExperience) => {
			const renderCamera = exp.state.camera as THREE.PerspectiveCamera;

			function onResize() {
				renderCamera.aspect = window.innerWidth / window.innerHeight;
				renderCamera.updateProjectionMatrix();
				renderer.setSize(window.innerWidth, window.innerHeight);
			}
			window.addEventListener("resize", onResize);

			const clock = new THREE.Clock();

			renderer.setAnimationLoop(() => {
				const delta = clock.getDelta();

				const pitch = -mouseY * 0.5;
				const roll = mouseX * 0.3;
				exp.manifest.updatePlayer(
					{ pitch, roll },
					{
						accelerate: keys["w"] || keys["arrowup"],
						brake: keys["s"] || keys["arrowdown"],
					},
					exp.state,
					delta,
				);

				const result = exp.manifest.tick(exp.state, {
					delta,
					elapsed: clock.elapsedTime,
					camera: renderCamera,
					playerPosition: renderCamera.parent?.position ?? new THREE.Vector3(),
					playerRotation: renderCamera.parent?.rotation ?? new THREE.Euler(),
				});
				exp.state = result.state;

				renderer.render(scene, renderCamera);
			});
		},
	);

	return () => {
		renderer?.setAnimationLoop(null);
		if (scene) unloadExperience(scene);
		renderer?.dispose();
	};
});

onDestroy(() => {
	renderer?.setAnimationLoop(null);
	if (scene) unloadExperience(scene);
	renderer?.dispose();
});
</script>

<div class="lab">
	<canvas bind:this={canvas}></canvas>
	<div class="hud">
		<p><kbd>W</kbd><kbd>S</kbd> accelerate/brake &nbsp;·&nbsp; <kbd>click</kbd> lock mouse &nbsp;·&nbsp; move to steer</p>
	</div>
</div>

<style>
	.lab {
		position: fixed;
		inset: 0;
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
	.hud {
		position: fixed;
		bottom: 2rem;
		left: 50%;
		transform: translateX(-50%);
		color: #888;
		font-family: system-ui, sans-serif;
		font-size: 0.85rem;
		background: rgba(0,0,0,0.6);
		padding: 0.5rem 1rem;
		border-radius: 8px;
		pointer-events: none;
	}
	kbd {
		background: #222;
		border: 1px solid #555;
		border-radius: 3px;
		padding: 1px 6px;
		font-family: inherit;
		margin: 0 2px;
	}
</style>
