import * as THREE from "three";

const W = 800;
const H = 600;

const PROMPT_TEXT =
  "A neon-lit circuit board world with glowing traces\nand explosive grid particles.";

const TOTAL_CHARS = PROMPT_TEXT.length;

const TIMING = {
  idle: 1.0,
  charInterval: 0.065,
  sendPause: 1.0,
  sendDuration: 1.5,
  fadeDuration: 1.0,
};

export class StartSequence {
  readonly group: THREE.Group;
  private mesh: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private startTime = 0;
  private started = false;
  private _done = false;

  get done(): boolean {
    return this._done;
  }

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d")!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const geometry = new THREE.PlaneGeometry(8, 6);
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.group.position.set(0, 0.5, -6);

    this.drawIdle();
  }

  start(): void {
    this.startTime = performance.now() / 1000;
    this.started = true;
  }

  update(elapsed: number): void {
    if (this._done || !this.started) return;

    const t = elapsed - this.startTime;

    if (t < TIMING.idle) {
      this.drawIdle();
      return;
    }

    const typingEnd = TIMING.idle + TOTAL_CHARS * TIMING.charInterval;

    if (t < typingEnd) {
      const chars = Math.floor((t - TIMING.idle) / TIMING.charInterval);
      this.draw(chars, 0, 0, true);
      return;
    }

    const sendStart = typingEnd + TIMING.sendPause;

    if (t < sendStart) {
      this.draw(TOTAL_CHARS, 0, 0, false);
      return;
    }

    const sendEnd = sendStart + TIMING.sendDuration;

    if (t < sendEnd) {
      const sendProgress = (t - sendStart) / TIMING.sendDuration;
      this.draw(TOTAL_CHARS, sendProgress, 0, false);
      return;
    }

    const fadeEnd = sendEnd + TIMING.fadeDuration;

    if (t < fadeEnd) {
      const fadeProgress = (t - sendEnd) / TIMING.fadeDuration;
      this.draw(TOTAL_CHARS, 1, fadeProgress, false);
      return;
    }

    this._done = true;
  }

  private drawIdle(): void {
    this.draw(0, 0, 0, false);
  }

  private draw(
    charsTyped: number,
    sendProgress: number,
    fadeProgress: number,
    cursorVisible: boolean,
  ): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    this.roundRect(ctx, 0, 0, W, H, 10);
    ctx.fillStyle = "#1a1a1a";
    ctx.fill();

    this.drawHeader(ctx);
    this.drawChatArea(ctx, sendProgress);
    this.drawInputArea(ctx, charsTyped, cursorVisible, sendProgress);
    this.drawSendButton(ctx, charsTyped, sendProgress);

    (this.mesh.material as THREE.MeshBasicMaterial).opacity =
      1 - fadeProgress;
    this.texture.needsUpdate = true;
  }

  private drawHeader(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, W, 44);

    ctx.fillStyle = "#ffffff";
    ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("ChatGPT", W / 2, 28);
    ctx.textAlign = "start";
  }

  private drawChatArea(
    ctx: CanvasRenderingContext2D,
    sendProgress: number,
  ): void {
    if (sendProgress <= 0) return;

    const bubbleY = 70;
    const bubbleX = 40;
    const maxW = W - 80;

    // Message bubble (user message)
    ctx.fillStyle = "#2a2a2a";
    const lines = PROMPT_TEXT.split("\n");
    const lineH = 22;
    const bubbleH = lines.length * lineH + 24;
    this.roundRect(ctx, bubbleX, bubbleY, maxW, bubbleH, 8);
    ctx.fill();

    ctx.fillStyle = "#e0e0e0";
    ctx.font = "15px system-ui, -apple-system, sans-serif";
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], bubbleX + 14, bubbleY + 20 + i * lineH);
    }

    // Thinking indicator
    if (sendProgress < 1) {
      ctx.fillStyle = "#888888";
      ctx.font = "15px system-ui, -apple-system, sans-serif";
      const dots = Math.floor(sendProgress * 6) % 4;
      ctx.fillText(
        "Thinking" + ".".repeat(dots),
        bubbleX,
        bubbleY + bubbleH + 30,
      );
    } else {
      // "Ready" state
      ctx.fillStyle = "#555555";
      ctx.font = "13px system-ui, -apple-system, sans-serif";
      ctx.fillText("Ready", bubbleX, bubbleY + bubbleH + 30);
    }
  }

  private drawInputArea(
    ctx: CanvasRenderingContext2D,
    charsTyped: number,
    cursorVisible: boolean,
    sendProgress: number,
  ): void {
    const inputX = 30;
    const inputY = H - 58;
    const inputW = W - 100;
    const inputH = 42;

    ctx.fillStyle = "#2a2a2a";
    this.roundRect(ctx, inputX, inputY, inputW, inputH, 8);
    ctx.fill();

    const displayed = Math.min(charsTyped, TOTAL_CHARS);
    const text = PROMPT_TEXT.substring(0, displayed);

    ctx.fillStyle = "#e0e0e0";
    ctx.font = "15px system-ui, -apple-system, sans-serif";
    ctx.fillText(text, inputX + 14, inputY + 27);

    if (cursorVisible && sendProgress === 0) {
      const textW = ctx.measureText(text).width;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(inputX + 14 + textW, inputY + 12, 1.5, 18);
    }
  }

  private drawSendButton(
    ctx: CanvasRenderingContext2D,
    charsTyped: number,
    sendProgress: number,
  ): void {
    const btnX = W - 56;
    const btnY = H - 54;
    const size = 34;

    const active = charsTyped > 0;

    ctx.beginPath();
    ctx.arc(btnX + size / 2, btnY + size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle =
      sendProgress > 0
        ? "#ffffff"
        : active
          ? "#3a3a3a"
          : "#2a2a2a";
    ctx.fill();

    // Arrow
    ctx.fillStyle = sendProgress > 0 ? "#1a1a1a" : active ? "#ffffff" : "#555555";
    ctx.font = "18px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      sendProgress > 0 ? "✓" : "↑",
      btnX + size / 2,
      btnY + size / 2 + 1,
    );
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
