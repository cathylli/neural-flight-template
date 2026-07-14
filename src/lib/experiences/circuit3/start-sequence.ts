import * as THREE from "three";

const W = 1024;
const H = 768;

const PROMPT_TEXT = "erkläre mir wie ein prompt verarbeitet wird";

const TOTAL_CHARS = PROMPT_TEXT.length;

const TIMING = {
	idle: 2.0,
	charInterval: 0.08,
	sendPause: 2.0,
	sendDuration: 2.5,
	readyHold: 1.0,
	crossfadeDuration: 1.2,
	rainDuration: 2.5,
	fadeDuration: 1.2,
	blackHold: 0.5,
};

const PADDING = 40;
const HEADER_H = 50;
const INPUT_H = 50;
const INPUT_BOTTOM = 30;
const CHAT_TOP = 80;

const RAIN_CHARS =
	"アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF";

interface RainDrop {
	x: number;
	y: number;
	speed: number;
	chars: string[];
}

export class StartSequence {
	readonly group: THREE.Group;

	// Black background behind everything
	private bgMesh: THREE.Mesh;

	// Screen
	private screenMesh: THREE.Mesh;
	private canvas: HTMLCanvasElement;
	private texture: THREE.CanvasTexture;

	// Rain overlay
	private rainCanvas: HTMLCanvasElement;
	private rainTexture: THREE.CanvasTexture;
	private rainMesh: THREE.Mesh;
	private rainDrops: RainDrop[];

	// Timing
	private startTime = 0;
	private started = false;
	private _done = false;
	private totalDuration = 0;

	get done(): boolean {
		return this._done;
	}

	constructor() {
		this.group = new THREE.Group();

		// ── Black Background ───────────────────────────────────────
		this.bgMesh = new THREE.Mesh(
			new THREE.PlaneGeometry(100, 100),
			new THREE.MeshBasicMaterial({ color: 0x000000 }),
		);
		this.bgMesh.position.set(0, 0, -20);
		this.bgMesh.renderOrder = -1;
		this.group.add(this.bgMesh);

		// ── Screen Canvas ──────────────────────────────────────────
		this.canvas = document.createElement("canvas");
		this.canvas.width = W;
		this.canvas.height = H;

		this.texture = new THREE.CanvasTexture(this.canvas);
		this.texture.minFilter = THREE.LinearFilter;
		this.texture.magFilter = THREE.LinearFilter;

		const screenGeo = new THREE.PlaneGeometry(8, 6);
		const screenMat = new THREE.MeshBasicMaterial({
			map: this.texture,
			transparent: true,
			opacity: 1,
			depthWrite: false,
		});
		this.screenMesh = new THREE.Mesh(screenGeo, screenMat);
		this.screenMesh.position.set(0, 0, -6);
		this.group.add(this.screenMesh);

		// ── Rain Canvas ────────────────────────────────────────────
		this.rainCanvas = document.createElement("canvas");
		this.rainCanvas.width = W;
		this.rainCanvas.height = H;
		this.rainTexture = new THREE.CanvasTexture(this.rainCanvas);
		this.rainTexture.minFilter = THREE.LinearFilter;

		const rainGeo = new THREE.PlaneGeometry(8, 6);
		const rainMat = new THREE.MeshBasicMaterial({
			map: this.rainTexture,
			transparent: true,
			opacity: 0,
			depthTest: false,
			depthWrite: false,
		});
		this.rainMesh = new THREE.Mesh(rainGeo, rainMat);
		this.rainMesh.position.set(0, 0, -6);
		this.rainMesh.renderOrder = 998;
		this.rainMesh.visible = false;
		this.group.add(this.rainMesh);

		// ── Rain Drops ─────────────────────────────────────────────
		this.rainDrops = [];
		const COLS = 120;
		const ROWS = 50;
		for (let i = 0; i < COLS; i++) {
			const chars: string[] = [];
			for (let j = 0; j < ROWS; j++) {
				chars.push(
					RAIN_CHARS[Math.floor(Math.random() * RAIN_CHARS.length)],
				);
			}
			this.rainDrops.push({
				x: (i / COLS) * W,
				y: Math.random() * H,
				speed: 200 + Math.random() * 400,
				chars,
			});
		}

		this.draw(0, 0, false);
	}

	start(): void {
		this.startTime = performance.now() / 1000;
		this.started = true;

		// Pre-calculate total duration
		const typingEnd = TIMING.idle + TOTAL_CHARS * TIMING.charInterval;
		const sendStart = typingEnd + TIMING.sendPause;
		const sendEnd = sendStart + TIMING.sendDuration;
		const readyEnd = sendEnd + TIMING.readyHold;
		const crossfadeEnd = readyEnd + TIMING.crossfadeDuration;
		const rainEnd = crossfadeEnd + TIMING.rainDuration;
		const fadeEnd = rainEnd + TIMING.fadeDuration;
		this.totalDuration = fadeEnd + TIMING.blackHold;
	}

	update(delta: number): void {
		if (this._done || !this.started) return;

		const t = performance.now() / 1000 - this.startTime;

		const typingEnd = TIMING.idle + TOTAL_CHARS * TIMING.charInterval;
		const sendStart = typingEnd + TIMING.sendPause;
		const sendEnd = sendStart + TIMING.sendDuration;
		const readyEnd = sendEnd + TIMING.readyHold;
		const crossfadeEnd = readyEnd + TIMING.crossfadeDuration;
		const rainEnd = crossfadeEnd + TIMING.rainDuration;
		const fadeEnd = rainEnd + TIMING.fadeDuration;
		const blackEnd = fadeEnd + TIMING.blackHold;

		// ── Phase 1: Idle ──────────────────────────────────────────
		if (t < TIMING.idle) {
			this.draw(0, 0, false);
			return;
		}

		// ── Phase 2: Typing ────────────────────────────────────────
		if (t < typingEnd) {
			const chars = Math.floor((t - TIMING.idle) / TIMING.charInterval);
			this.draw(chars, 0, true);
			return;
		}

		// ── Phase 3: Send pause ────────────────────────────────────
		if (t < sendStart) {
			this.draw(TOTAL_CHARS, 0, false);
			return;
		}

		// ── Phase 4: Send animation ────────────────────────────────
		if (t < sendEnd) {
			const sendProgress = (t - sendStart) / TIMING.sendDuration;
			this.draw(TOTAL_CHARS, sendProgress, false);
			return;
		}

		// ── Phase 5: Ready hold ────────────────────────────────────
		if (t < readyEnd) {
			this.draw(TOTAL_CHARS, 1, false);
			return;
		}

		// ── Phase 6: Cross-fade (DataGPT out, Rain in) ─────────────
		if (t < crossfadeEnd) {
			const p = (t - readyEnd) / TIMING.crossfadeDuration;
			// DataGPT fades out
			this.screenMesh.visible = true;
			screenMat(this.screenMesh).opacity = 1 - p;
			// Rain fades in, no zoom yet
			this.updateRain(delta);
			this.rainMesh.visible = true;
			rainMat(this.rainMesh).opacity = p;
			return;
		}

		// ── Phase 7: Rain only, zooming in ─────────────────────────
		if (t < rainEnd) {
			const rainProgress = (t - crossfadeEnd) / TIMING.rainDuration;
			this.screenMesh.visible = false;
			this.updateRain(delta);
			this.rainMesh.visible = true;
			rainMat(this.rainMesh).opacity = 1;
			// Zoom: starts slow, accelerates
			const zoom = 1 + rainProgress * rainProgress * 12;
			this.rainMesh.scale.setScalar(zoom);
			return;
		}

		// ── Phase 8: Fade to black (stays zoomed in) ─────────────────
		if (t < fadeEnd) {
			const fadeProgress = (t - rainEnd) / TIMING.fadeDuration;
			this.updateRain(delta);
			rainMat(this.rainMesh).opacity = 1 - fadeProgress;
			this.rainMesh.scale.setScalar(13);
			return;
		}

		// ── Phase 9: Black hold ────────────────────────────────────
		if (t < blackEnd) {
			this.screenMesh.visible = false;
			this.rainMesh.visible = false;
			return;
		}

		this._done = true;
	}

	// ── Screen Drawing ─────────────────────────────────────────────

	private draw(
		charsTyped: number,
		sendProgress: number,
		cursorVisible: boolean,
	): void {
		const ctx = this.canvas.getContext("2d")!;
		ctx.clearRect(0, 0, W, H);

		ctx.fillStyle = "#1a1a1a";
		ctx.fillRect(0, 0, W, H);

		this.drawHeader(ctx);
		this.drawChatArea(ctx, sendProgress);
		this.drawInputArea(ctx, charsTyped, cursorVisible, sendProgress);

		this.texture.needsUpdate = true;
	}

	private drawHeader(ctx: CanvasRenderingContext2D): void {
		ctx.fillStyle = "#141414";
		ctx.fillRect(0, 0, W, HEADER_H);

		ctx.fillStyle = "#ffffff";
		ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText("DataGPT", W / 2, HEADER_H / 2);
		ctx.textAlign = "start";
		ctx.textBaseline = "alphabetic";
	}

	private drawChatArea(
		ctx: CanvasRenderingContext2D,
		sendProgress: number,
	): void {
		if (sendProgress <= 0) return;

		const bubbleX = PADDING;
		const bubbleY = CHAT_TOP;
		const bubbleW = W - PADDING * 2;

		ctx.font = "17px system-ui, -apple-system, sans-serif";
		const words = PROMPT_TEXT.split(" ");
		const lines: string[] = [];
		let currentLine = "";
		for (const word of words) {
			const test = currentLine ? `${currentLine} ${word}` : word;
			if (ctx.measureText(test).width > bubbleW - 32) {
				lines.push(currentLine);
				currentLine = word;
			} else {
				currentLine = test;
			}
		}
		if (currentLine) lines.push(currentLine);

		const lineH = 26;
		const bubbleH = lines.length * lineH + 30;

		ctx.fillStyle = "#2a2a2a";
		ctx.beginPath();
		ctx.roundRect(bubbleX, bubbleY, bubbleW, bubbleH, 10);
		ctx.fill();

		ctx.fillStyle = "#e0e0e0";
		for (let i = 0; i < lines.length; i++) {
			ctx.fillText(lines[i], bubbleX + 16, bubbleY + 24 + i * lineH);
		}

		const statusY = bubbleY + bubbleH + 35;
		const cubeSize = 12;
		const cubeX = bubbleX;
		const cubeY = statusY - cubeSize / 2 - 5;

		if (sendProgress < 1) {
			const angle = sendProgress * Math.PI * 4;
			const skew = Math.abs(Math.cos(angle));
			ctx.save();
			ctx.translate(cubeX + cubeSize / 2, cubeY + cubeSize / 2);
			ctx.transform(skew, 0, 0, 1, 0, 0);
			ctx.fillStyle = "#00ff66";
			ctx.fillRect(-cubeSize / 2, -cubeSize / 2, cubeSize, cubeSize);
			ctx.restore();

			ctx.fillStyle = "#888888";
			ctx.font = "16px system-ui, -apple-system, sans-serif";
			const dots = Math.floor(sendProgress * 6) % 4;
			ctx.fillText(
				"Thinking" + ".".repeat(dots),
				cubeX + cubeSize + 10,
				statusY,
			);
		} else {
			ctx.fillStyle = "#00ff66";
			ctx.fillRect(cubeX, cubeY, cubeSize, cubeSize);

			ctx.fillStyle = "#555555";
			ctx.font = "14px system-ui, -apple-system, sans-serif";
			ctx.fillText("Ready", cubeX + cubeSize + 10, statusY);
		}
	}

	private drawInputArea(
		ctx: CanvasRenderingContext2D,
		charsTyped: number,
		cursorVisible: boolean,
		sendProgress: number,
	): void {
		const inputX = PADDING;
		const inputY = H - INPUT_BOTTOM - INPUT_H;
		const inputW = W - PADDING * 2;

		// Simple rounded rectangle input field
		ctx.fillStyle = "#2a2a2a";
		ctx.beginPath();
		ctx.roundRect(inputX, inputY, inputW, INPUT_H, 8);
		ctx.fill();

		const displayed = Math.min(charsTyped, TOTAL_CHARS);
		const text = PROMPT_TEXT.substring(0, displayed);
		const textX = inputX + 18;
		const textY = inputY + INPUT_H / 2 + 1;

		ctx.fillStyle = "#e0e0e0";
		ctx.font = "17px system-ui, -apple-system, sans-serif";
		ctx.textBaseline = "middle";
		ctx.fillText(text, textX, textY);

		if (cursorVisible && sendProgress === 0) {
			const textW = ctx.measureText(text).width;
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(textX + textW + 2, inputY + 12, 2, INPUT_H - 24);
		}

		const btnSize = 34;
		const btnX = inputX + inputW - btnSize - 8;
		const btnY = inputY + (INPUT_H - btnSize) / 2;

		ctx.beginPath();
		ctx.arc(
			btnX + btnSize / 2,
			btnY + btnSize / 2,
			btnSize / 2,
			0,
			Math.PI * 2,
		);
		ctx.fillStyle =
			sendProgress > 0
				? "#ffffff"
				: charsTyped > 0
					? "#3a3a3a"
					: "#2a2a2a";
		ctx.fill();

		ctx.fillStyle =
			sendProgress > 0 ? "#1a1a1a" : charsTyped > 0 ? "#ffffff" : "#555555";
		ctx.font = "18px system-ui, -apple-system, sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(
			sendProgress > 0 ? "✓" : "↑",
			btnX + btnSize / 2,
			btnY + btnSize / 2 + 1,
		);
		ctx.textAlign = "start";
		ctx.textBaseline = "alphabetic";
	}

	// ── Matrix Rain ───────────────────────────────────────────────

	private updateRain(delta: number): void {
		const ctx = this.rainCanvas.getContext("2d");
		if (!ctx) return;

		ctx.fillStyle = "#000000";
		ctx.fillRect(0, 0, W, H);

		ctx.font = "14px monospace";

		for (const drop of this.rainDrops) {
			for (let j = 0; j < drop.chars.length; j++) {
				const y = drop.y - j * 20;
				if (y < -20 || y > H + 20) continue;

				if (j === 0) {
					ctx.fillStyle = "#bbffbb";
				} else if (j < 3) {
					ctx.fillStyle = "#00ff66";
				} else {
					ctx.fillStyle = "#00cc44";
				}
				ctx.fillText(drop.chars[j], drop.x, y);

				if (Math.random() < 0.02) {
					drop.chars[j] =
						RAIN_CHARS[Math.floor(Math.random() * RAIN_CHARS.length)];
				}
			}

			drop.y += drop.speed * delta;
			if (drop.y - drop.chars.length * 20 > H) {
				drop.y = -Math.random() * 300;
				for (let j = 0; j < drop.chars.length; j++) {
					drop.chars[j] =
						RAIN_CHARS[Math.floor(Math.random() * RAIN_CHARS.length)];
				}
			}
		}

		this.rainTexture.needsUpdate = true;
	}

	dispose(): void {
		this.bgMesh.geometry.dispose();
		(this.bgMesh.material as THREE.Material).dispose();

		this.screenMesh.geometry.dispose();
		(this.screenMesh.material as THREE.Material).dispose();
		this.texture.dispose();

		this.rainMesh.geometry.dispose();
		(this.rainMesh.material as THREE.Material).dispose();
		this.rainTexture.dispose();
	}
}

function rainMat(mesh: THREE.Mesh): THREE.MeshBasicMaterial {
	return mesh.material as THREE.MeshBasicMaterial;
}

function screenMat(mesh: THREE.Mesh): THREE.MeshBasicMaterial {
	return mesh.material as THREE.MeshBasicMaterial;
}
