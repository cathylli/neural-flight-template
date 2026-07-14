import * as THREE from "three";

const W = 1024;
const H = 768;

const RESPONSE_TEXT =
  "Jetzt weißt du, wie ein Prompt verarbeitet wird. Willkommen Zurück!";

const TOTAL_CHARS = RESPONSE_TEXT.length;

const TIMING = {
	rainInDuration: 2.0,
	rainHoldDuration: 1.0,
	crossfadeDuration: 1.2,
	typeInterval: 0.04,
	responseHold: 3.0,
};

const PADDING = 40;
const HEADER_H = 50;
const CHAT_TOP = 80;

const RAIN_CHARS =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF";

interface RainDrop {
  x: number;
  y: number;
  speed: number;
  chars: string[];
}

export class EndSequence {
  readonly group: THREE.Group;

  // Black background behind everything
  private bgMesh: THREE.Mesh;

  // Rain canvas (starts visible, zoomed in)
  private rainCanvas: HTMLCanvasElement;
  private rainTexture: THREE.CanvasTexture;
  private rainMesh: THREE.Mesh;
  private rainDrops: RainDrop[];

  // Screen canvas (DataGPT response)
  private screenCanvas: HTMLCanvasElement;
  private screenTexture: THREE.CanvasTexture;
  private screenMesh: THREE.Mesh;

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
        chars.push(RAIN_CHARS[Math.floor(Math.random() * RAIN_CHARS.length)]);
      }
      this.rainDrops.push({
        x: (i / COLS) * W,
        y: Math.random() * H,
        speed: 200 + Math.random() * 400,
        chars,
      });
    }

    // ── Screen Canvas (DataGPT response) ──────────────────────
    this.screenCanvas = document.createElement("canvas");
    this.screenCanvas.width = W;
    this.screenCanvas.height = H;

    this.screenTexture = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTexture.minFilter = THREE.LinearFilter;
    this.screenTexture.magFilter = THREE.LinearFilter;

    const screenGeo = new THREE.PlaneGeometry(8, 6);
    const screenMat = new THREE.MeshBasicMaterial({
      map: this.screenTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.screenMesh = new THREE.Mesh(screenGeo, screenMat);
    this.screenMesh.position.set(0, 0, -6);
    this.screenMesh.renderOrder = 999;
    this.screenMesh.visible = false;
    this.group.add(this.screenMesh);

    this.drawRain();
    this.drawScreen(0, false);
  }

	start(): void {
		this.startTime = performance.now() / 1000;
		this.started = true;

		// Pre-calculate total duration
		const rainInEnd = TIMING.rainInDuration;
		const rainHoldEnd = rainInEnd + TIMING.rainHoldDuration;
		const crossfadeEnd = rainHoldEnd + TIMING.crossfadeDuration;
		const typeEnd = crossfadeEnd + TOTAL_CHARS * TIMING.typeInterval;
		this.totalDuration = typeEnd + TIMING.responseHold;
	}

  update(delta: number): void {
    if (this._done || !this.started) return;

    const t = performance.now() / 1000 - this.startTime;

		const rainInEnd = TIMING.rainInDuration;
		const rainHoldEnd = rainInEnd + TIMING.rainHoldDuration;
		const crossfadeEnd = rainHoldEnd + TIMING.crossfadeDuration;
		const typeEnd = crossfadeEnd + TOTAL_CHARS * TIMING.typeInterval;
		const holdEnd = typeEnd + TIMING.responseHold;

    // ── Phase 1: Rain zooms in ──────────────────────────────────
    if (t < rainInEnd) {
      const p = t / rainInEnd;
      const eased = p * p * (3 - 2 * p);
      const zoom = 1 + (1 - eased) * 12;
      this.rainMesh.scale.setScalar(zoom);
      this.rainMesh.visible = true;
      rainMat(this.rainMesh).opacity = eased;
      this.screenMesh.visible = false;
      this.updateRain(delta);
      return;
    }

    // ── Phase 2: Rain hold (zoomed in) ──────────────────────────
    if (t < rainHoldEnd) {
      this.rainMesh.scale.setScalar(1);
      this.rainMesh.visible = true;
      rainMat(this.rainMesh).opacity = 1;
      this.screenMesh.visible = false;
      this.updateRain(delta);
      return;
    }

    // ── Phase 3: Cross-fade (Rain out, DataGPT in) ─────────────
    if (t < crossfadeEnd) {
      const p = (t - rainHoldEnd) / TIMING.crossfadeDuration;
      // Rain fades out
      this.rainMesh.visible = true;
      rainMat(this.rainMesh).opacity = 1 - p;
      this.updateRain(delta);
      // DataGPT fades in
      this.screenMesh.visible = true;
      screenMat(this.screenMesh).opacity = p;
      this.drawScreen(0, false);
      return;
    }

    // ── Phase 4: Typing response ────────────────────────────────
    if (t < typeEnd) {
      const chars = Math.floor((t - crossfadeEnd) / TIMING.typeInterval);
      this.rainMesh.visible = false;
      this.screenMesh.visible = true;
      screenMat(this.screenMesh).opacity = 1;
      this.drawScreen(chars, true);
      return;
    }

		// ── Phase 5: Hold ──────────────────────────────────────────
		if (t < holdEnd) {
			this.rainMesh.visible = false;
			this.screenMesh.visible = true;
			screenMat(this.screenMesh).opacity = 1;
			this.drawScreen(TOTAL_CHARS, false);
			return;
		}

		// ── Phase 6: Hold final state (stays visible) ───────────────
		this.rainMesh.visible = false;
		this.screenMesh.visible = true;
		screenMat(this.screenMesh).opacity = 1;
		this.drawScreen(TOTAL_CHARS, false);

    // Stay on black — don't set _done, the group stays visible
  }

  // ── Screen Drawing ─────────────────────────────────────────────

  private drawScreen(charsTyped: number, cursorVisible: boolean): void {
    const ctx = this.screenCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, W, H);

    this.drawHeader(ctx);
    this.drawResponseArea(ctx, charsTyped, cursorVisible);

    this.screenTexture.needsUpdate = true;
  }

  private drawHeader(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, W, HEADER_H);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("DataGPT", W / 2, HEADER_H / 2);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  private drawResponseArea(
    ctx: CanvasRenderingContext2D,
    charsTyped: number,
    cursorVisible: boolean,
  ): void {
    const bubbleX = PADDING;
    const bubbleY = CHAT_TOP;
    const bubbleW = W - PADDING * 2;

    ctx.font = "17px system-ui, -apple-system, sans-serif";
    const displayed = Math.min(charsTyped, TOTAL_CHARS);
    const text = RESPONSE_TEXT.substring(0, displayed);

    // Word wrap
    const words = text.split(" ");
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
    const bubbleH = Math.max(lines.length * lineH + 30, 60);

    // AI response bubble (green)
    ctx.fillStyle = "#0a2a0a";
    ctx.beginPath();
    ctx.roundRect(bubbleX, bubbleY, bubbleW, bubbleH, 10);
    ctx.fill();

    ctx.fillStyle = "#e0e0e0";
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], bubbleX + 16, bubbleY + 24 + i * lineH);
    }

    // Cursor
    if (cursorVisible && displayed < TOTAL_CHARS) {
      const lastLine = lines[lines.length - 1] || "";
      const cursorX = bubbleX + 16 + ctx.measureText(lastLine).width + 2;
      const cursorY = bubbleY + 24 + (lines.length - 1) * lineH;
      ctx.fillStyle = "#e0e0e0";
      ctx.fillRect(cursorX, cursorY - 14, 2, 18);
    }
  }

  // ── Matrix Rain ───────────────────────────────────────────────

  private drawRain(): void {
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
      }
    }

    this.rainTexture.needsUpdate = true;
  }

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

    this.rainMesh.geometry.dispose();
    (this.rainMesh.material as THREE.Material).dispose();
    this.rainTexture.dispose();

    this.screenMesh.geometry.dispose();
    (this.screenMesh.material as THREE.Material).dispose();
    this.screenTexture.dispose();
  }
}

function rainMat(mesh: THREE.Mesh): THREE.MeshBasicMaterial {
  return mesh.material as THREE.MeshBasicMaterial;
}

function screenMat(mesh: THREE.Mesh): THREE.MeshBasicMaterial {
  return mesh.material as THREE.MeshBasicMaterial;
}
