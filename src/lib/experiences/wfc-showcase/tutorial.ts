// ── WFC Tutorial Overlay ───────────────────────────────────────────────────
//
// Two-phase tutorial:
//   1. Full mode — big centered overlay with narrative text + grid (0–69s)
//   2. Compact mode — small corner widget with just the WFC grid, looping

const CELL_PX = 48;
const GAP = 3;
const PADDING = 30;
const CANVAS_MIN_W = 580;

// Compact mode settings
const COMPACT_CELL = 18;
const COMPACT_GAP = 2;
const COMPACT_PAD = 10;

// ── Tile vocabulary (simplified) ───────────────────────────────────────────

interface TileDef {
	id: number;
	north: boolean;
	east: boolean;
	south: boolean;
	west: boolean;
	color: string;
}

const TILES: TileDef[] = [
	{ id: 0, north: false, east: false, south: false, west: false, color: "#1a1a2e" },
	{ id: 1, north: false, east: true, south: false, west: true, color: "#00ff66" },
	{ id: 2, north: true, east: false, south: true, west: false, color: "#00ff66" },
	{ id: 3, north: true, east: true, south: false, west: false, color: "#00cc55" },
	{ id: 4, north: true, east: false, south: false, west: true, color: "#00cc55" },
	{ id: 5, north: false, east: true, south: true, west: false, color: "#00cc55" },
	{ id: 6, north: false, east: false, south: true, west: true, color: "#00cc55" },
	{ id: 7, north: true, east: true, south: false, west: true, color: "#ffcc00" },
	{ id: 8, north: false, east: true, south: true, west: true, color: "#ffcc00" },
	{ id: 9, north: true, east: true, south: true, west: false, color: "#ffcc00" },
	{ id: 10, north: true, east: false, south: true, west: true, color: "#ffcc00" },
	{ id: 11, north: true, east: true, south: true, west: true, color: "#ffaa00" },
	{ id: 12, north: false, east: false, south: false, west: false, color: "#0088ff" },
];

function compatible(a: number, b: number, dir: "north" | "east" | "south" | "west"): boolean {
	const ta = TILES[a];
	const tb = TILES[b];
	switch (dir) {
		case "north": return ta.south === tb.north;
		case "south": return ta.north === tb.south;
		case "east": return ta.west === tb.east;
		case "west": return ta.east === tb.west;
	}
}

// ── Mini WFC Solver (reusable for both modes) ─────────────────────────────

interface SolverStep {
	grid: number[][];
	highlight: { row: number; col: number } | null;
	propagated: Array<{ row: number; col: number }>;
}

class MiniWFCSolver {
	private steps: SolverStep[] = [];
	private built = false;

	constructor(private size: number) {}

	build(): void {
		if (this.built) return;
		this.built = true;

		const cells: Set<number>[][] = Array.from({ length: this.size }, () =>
			Array.from({ length: this.size }, () => new Set(TILES.map((t) => t.id))),
		);
		const collapsed: (number | null)[][] = Array.from({ length: this.size }, () =>
			Array(this.size).fill(null),
		);
		this.steps = [];

		// Strip edge connections
		for (let i = 0; i < this.size; i++) {
			for (const { row, col } of [
				{ row: 0, col: i },
				{ row: this.size - 1, col: i },
				{ row: i, col: 0 },
				{ row: i, col: this.size - 1 },
			]) {
				const poss = cells[row][col];
				for (const t of Array.from(poss)) {
					const tile = TILES[t];
					if (row === 0 && tile.north) poss.delete(t);
					if (row === this.size - 1 && tile.south) poss.delete(t);
					if (col === 0 && tile.west) poss.delete(t);
					if (col === this.size - 1 && tile.east) poss.delete(t);
				}
			}
		}

		const maxIter = this.size * this.size * 2;
		for (let iter = 0; iter < maxIter; iter++) {
			let minE = Infinity;
			const candidates: Array<{ row: number; col: number }> = [];
			for (let r = 0; r < this.size; r++) {
				for (let c = 0; c < this.size; c++) {
					if (collapsed[r][c] !== null) continue;
					const e = cells[r][c].size;
					if (e === 0) continue;
					if (e < minE) { minE = e; candidates.length = 0; }
					if (e === minE) candidates.push({ row: r, col: c });
				}
			}
			if (candidates.length === 0) break;

			const target = candidates[Math.floor(Math.random() * candidates.length)];

			// Pick step
			this.steps.push({
				grid: this.snapshotGrid(collapsed),
				highlight: target,
				propagated: [],
			});

			// Collapse
			const options = Array.from(cells[target.row][target.col]);
			const chosen = options[Math.floor(Math.random() * options.length)];
			collapsed[target.row][target.col] = chosen;
			cells[target.row][target.col] = new Set([chosen]);

			// Propagate
			const propagated = this.propagate(cells, collapsed, target.row, target.col);

			this.steps.push({
				grid: this.snapshotGrid(collapsed),
				highlight: null,
				propagated,
			});
		}

		// Final
		this.steps.push({
			grid: this.snapshotGrid(collapsed),
			highlight: null,
			propagated: [],
		});
	}

	private propagate(
		cells: Set<number>[][],
		collapsed: (number | null)[][],
		startRow: number,
		startCol: number,
	): Array<{ row: number; col: number }> {
		const queue = [{ row: startRow, col: startCol }];
		const propagated: Array<{ row: number; col: number }> = [];
		const visited = new Set<string>();
		visited.add(`${startRow},${startCol}`);

		while (queue.length > 0) {
			const cur = queue.shift()!;
			const neighbors = [
				{ row: cur.row - 1, col: cur.col, dir: "north" as const },
				{ row: cur.row + 1, col: cur.col, dir: "south" as const },
				{ row: cur.row, col: cur.col + 1, dir: "east" as const },
				{ row: cur.row, col: cur.col - 1, dir: "west" as const },
			];
			for (const nb of neighbors) {
				if (nb.row < 0 || nb.row >= this.size || nb.col < 0 || nb.col >= this.size) continue;
				if (collapsed[nb.row][nb.col] !== null) continue;
				const nbPoss = cells[nb.row][nb.col];
				const curPoss = cells[cur.row][cur.col];
				const before = nbPoss.size;
				for (const nbTile of Array.from(nbPoss)) {
					let ok = false;
					for (const curTile of curPoss) {
						if (compatible(nbTile, curTile, nb.dir)) { ok = true; break; }
					}
					if (!ok) nbPoss.delete(nbTile);
				}
				if (nbPoss.size < before) {
					const key = `${nb.row},${nb.col}`;
					if (!visited.has(key)) {
						visited.add(key);
						propagated.push({ row: nb.row, col: nb.col });
						queue.push({ row: nb.row, col: nb.col });
					}
				}
			}
		}
		return propagated;
	}

	private snapshotGrid(collapsed: (number | null)[][]): number[][] {
		return collapsed.map((row) => row.map((v) => v ?? 0));
	}

	getSteps(): SolverStep[] {
		if (!this.built) this.build();
		return this.steps;
	}
}

// ── Tutorial Phases (full mode) ────────────────────────────────────────────

interface Phase {
	title: string;
	text: string;
	duration: number;
	grid: number[][] | null;
	highlight?: { row: number; col: number; color?: string };
	propagated?: Array<{ row: number; col: number }>;
}

const GRID_SIZE = 8;

function createPhases(): Phase[] {
	const emptyGrid: number[][] = Array.from({ length: GRID_SIZE }, () =>
		new Array(GRID_SIZE).fill(0),
	);

	const solved: number[][] = [
		[0, 1, 0, 0, 0, 2, 0, 0],
		[0, 11, 1, 1, 9, 2, 0, 0],
		[0, 2, 0, 0, 8, 2, 0, 0],
		[0, 2, 0, 0, 8, 2, 0, 0],
		[0, 2, 0, 0, 8, 2, 0, 0],
		[0, 10, 1, 1, 7, 2, 0, 0],
		[0, 0, 0, 0, 0, 11, 1, 1],
		[0, 0, 0, 0, 0, 2, 0, 0],
	];

	return [
		{
			title: "Wave Function Collapse",
			text: "Ein Algorithmus, der aus Zufall Muster erzeugt.\nWie ein Puzzle — aber das Programm wählt die Stücke selbst.",
			duration: 7,
			grid: null,
		},
		{
			title: "1. Ein leeres Raster",
			text: "Stell dir ein leeres Schachbrett vor.\nJedes Feld muss mit einem Stück befüllt werden.",
			duration: 6,
			grid: emptyGrid,
		},
		{
			title: "2. Die Stücke",
			text: "Jedes Stück hat Anschlüsse: oben, unten, links, rechts.\nAnschlüsse müssen immer zusammenpassen —\nwie Steckdosen und Stecker.",
			duration: 9,
			grid: solved,
		},
		{
			title: "3. Das erste Stück",
			text: "Das Programm wählt ein zufälliges Feld\nund setzt ein passendes Stück ein.",
			duration: 7,
			grid: (() => {
				const g = emptyGrid.map((r) => [...r]);
				g[3][3] = 11;
				return g;
			})(),
			highlight: { row: 3, col: 3, color: "#ff5555" },
		},
		{
			title: "4. Die Nachbarn werden geprüft",
			text: "Nun schaut das Programm: Welche Stücke passen\nnoch zu den Nachbarfeldern?\nUnpassende werden aussortiert.",
			duration: 9,
			grid: (() => {
				const g = emptyGrid.map((r) => [...r]);
				g[3][3] = 11;
				return g;
			})(),
			highlight: { row: 3, col: 3 },
			propagated: [
				{ row: 2, col: 3 },
				{ row: 4, col: 3 },
				{ row: 3, col: 2 },
				{ row: 3, col: 4 },
			],
		},
		{
			title: "5. Das nächste Feld",
			text: "Das Feld mit den wenigsten verbleibenden\nMöglichkeiten wird als nächstes ausgewählt.\nSo entsteht Schritt für Schritt ein Muster.",
			duration: 8,
			grid: (() => {
				const g = emptyGrid.map((r) => [...r]);
				g[3][3] = 11;
				g[3][4] = 8;
				g[4][3] = 2;
				g[2][3] = 2;
				g[3][2] = 10;
				return g;
			})(),
			highlight: { row: 3, col: 4, color: "#ff5555" },
			propagated: [
				{ row: 2, col: 4 },
				{ row: 4, col: 4 },
				{ row: 3, col: 5 },
			],
		},
		{
			title: "6. Das Muster wächst",
			text: "Feld für Feld wird befüllt.\nImmer mit derselben Regel:\nNur Stücke, die zu allen Nachbarn passen.",
			duration: 9,
			grid: (() => {
				const g = emptyGrid.map((r) => [...r]);
				g[3][3] = 11; g[3][4] = 8; g[3][5] = 2;
				g[4][3] = 2;  g[4][4] = 8; g[4][5] = 2;
				g[2][3] = 2;  g[2][4] = 8; g[2][5] = 2;
				g[3][2] = 10; g[4][2] = 2; g[5][2] = 10;
				g[5][3] = 1;  g[5][4] = 7; g[5][5] = 2;
				return g;
			})(),
		},
		{
			title: "7. Fertig!",
			text: "So entsteht aus Zufall ein zusammenhängendes Muster.\nJedes Mal anders — aber immer logisch.\nDas ist Wave Function Collapse.",
			duration: 8,
			grid: solved,
		},
		{
			title: "Jetzt in 3D",
			text: "Schau zu, wie die Landschaft vor dir\nauf dieselbe Weise entsteht —\nStück für Stück, Chunk für Chunk.",
			duration: 6,
			grid: solved,
		},
	];
}

// ── WFCtutorial ────────────────────────────────────────────────────────────

export class WFCtutorial {
	// Full mode
	private fullCanvas: HTMLCanvasElement;
	private fullCtx: CanvasRenderingContext2D;
	private phases: Phase[];
	private currentPhase = 0;
	private phaseTimer = 0;
	/** Seconds between solver steps in full mode. */
	private stepInterval = 0.4;
	private fullOpacity = 0;
	private fullFadeOut = false;
	private fullFadeStartTime = 0;

	// Compact mode
	private compactCanvas: HTMLCanvasElement;
	private compactCtx: CanvasRenderingContext2D;
	private compactOpacity = 0;
	private compactSolver: MiniWFCSolver;
	private compactSteps: SolverStep[] = [];
	private compactStep = 0;
	private compactStepTimer = 0;
	/** Seconds between solver steps in compact mode. */
	private compactStepInterval = 0.6;
	private compactWidth: number;
	private compactHeight: number;

	// Shared
	private solver: MiniWFCSolver;
	private solverSteps: SolverStep[] = [];
	private solverStep = 0;
	private solverStepTimer = 0;
	readonly duration: number;
	private _fullFinished = false;
	private gridWidth: number;

	constructor(duration = 69) {
		this.duration = duration;
		this.phases = createPhases();

		this.solver = new MiniWFCSolver(GRID_SIZE);
		this.solver.build();
		this.solverSteps = this.solver.getSteps();

		this.compactSolver = new MiniWFCSolver(GRID_SIZE);
		this.compactSolver.build();
		this.compactSteps = this.compactSolver.getSteps();

		// Full canvas
		this.gridWidth = GRID_SIZE * (CELL_PX + GAP);
		const gridHeight = GRID_SIZE * (CELL_PX + GAP);
		const w = Math.max(this.gridWidth + PADDING * 2, CANVAS_MIN_W);
		const h = gridHeight + PADDING * 2 + 160;

		this.fullCanvas = document.createElement("canvas");
		this.fullCanvas.width = w;
		this.fullCanvas.height = h;
		this.fullCanvas.style.cssText = `
			position: fixed;
			top: 50%;
			left: 50%;
			transform: translate(-50%, -50%);
			z-index: 1000;
			pointer-events: none;
			border-radius: 16px;
			background: rgba(5, 5, 20, 0.94);
			border: 1px solid rgba(0, 255, 102, 0.3);
			box-shadow: 0 0 60px rgba(0, 255, 102, 0.1);
		`;
		this.fullCtx = this.fullCanvas.getContext("2d")!;

		// Compact canvas
		this.compactWidth = GRID_SIZE * (COMPACT_CELL + COMPACT_GAP) + COMPACT_PAD * 2;
		this.compactHeight = GRID_SIZE * (COMPACT_CELL + COMPACT_GAP) + COMPACT_PAD * 2;

		this.compactCanvas = document.createElement("canvas");
		this.compactCanvas.width = this.compactWidth;
		this.compactCanvas.height = this.compactHeight;
		this.compactCanvas.style.cssText = `
			position: fixed;
			top: 16px;
			right: 16px;
			z-index: 999;
			pointer-events: none;
			border-radius: 8px;
			background: rgba(5, 5, 20, 0.85);
			border: 1px solid rgba(0, 255, 102, 0.2);
			box-shadow: 0 0 20px rgba(0, 255, 102, 0.06);
			opacity: 0;
		`;
		this.compactCtx = this.compactCanvas.getContext("2d")!;
	}

	mount(): void {
		document.body.appendChild(this.fullCanvas);
		document.body.appendChild(this.compactCanvas);
		this.fullOpacity = 0;
		this.fullFadeOut = false;
		this.currentPhase = 0;
		this.phaseTimer = 0;
		this.compactStep = 0;
		this.compactStepTimer = 0;
	}

	update(delta: number, elapsed: number): void {
		if (!this._fullFinished) {
			this.updateFull(delta, elapsed);
		} else {
			this.updateCompact(delta);
		}
	}

	// ── Full mode ───────────────────────────────────────────────────

	private updateFull(delta: number, elapsed: number): void {
		// Fade in
		if (!this.fullFadeOut) {
			this.fullOpacity = Math.min(1, this.fullOpacity + delta * 1.5);
		}

		// Start fade-out near end
		if (elapsed >= this.duration - 2 && !this.fullFadeOut) {
			this.fullFadeOut = true;
			this.fullFadeStartTime = elapsed;
		}

		// Fade out
		if (this.fullFadeOut) {
			const t = Math.min((elapsed - this.fullFadeStartTime) / 2, 1);
			this.fullOpacity = 1 - t;
			if (this.fullOpacity <= 0) {
				this.fullOpacity = 0;
				this._fullFinished = true;
				this.fullCanvas.style.display = "none";
			}
		}

		// Advance phases
		if (!this.fullFadeOut) {
			this.phaseTimer += delta;
			const phase = this.phases[this.currentPhase];
			if (phase && this.phaseTimer >= phase.duration) {
				this.phaseTimer -= phase.duration;
				this.currentPhase = Math.min(
					this.currentPhase + 1,
					this.phases.length - 1,
				);
			}
		}

		// Advance solver for live grid in phases
		this.solverStepTimer += delta;
		if (this.solverStepTimer >= this.stepInterval) {
			this.solverStepTimer -= this.stepInterval;
			this.solverStep = Math.min(
				this.solverStep + 1,
				this.solverSteps.length - 1,
			);
			this.stepInterval = Math.max(0.12, this.stepInterval * 0.98);
		}

		this.renderFull();
	}

	private renderFull(): void {
		const ctx = this.fullCtx;
		const w = this.fullCanvas.width;
		const h = this.fullCanvas.height;

		ctx.clearRect(0, 0, w, h);
		ctx.globalAlpha = this.fullOpacity;

		const phase = this.phases[this.currentPhase];
		if (!phase) return;

		// Title
		ctx.fillStyle = "#00ff66";
		ctx.font = "bold 20px system-ui, sans-serif";
		ctx.textAlign = "center";
		ctx.fillText(phase.title, w / 2, PADDING + 24);

		// Text (word-wrapped)
		ctx.fillStyle = "#dddddd";
		ctx.font = "15px system-ui, sans-serif";
		const maxWidth = w - PADDING * 2;
		const rawLines = phase.text.split("\n");
		const wrappedLines: string[] = [];
		for (const raw of rawLines) {
			const words = raw.split(" ");
			let current = "";
			for (const word of words) {
				const test = current ? `${current} ${word}` : word;
				if (ctx.measureText(test).width > maxWidth && current) {
					wrappedLines.push(current);
					current = word;
				} else {
					current = test;
				}
			}
			if (current) wrappedLines.push(current);
		}
		for (let i = 0; i < wrappedLines.length; i++) {
			ctx.fillText(wrappedLines[i], w / 2, PADDING + 54 + i * 22);
		}

		// Grid
		if (phase.grid) {
			const ox = (w - this.gridWidth) / 2;
			const oy = PADDING + 54 + wrappedLines.length * 22 + 20;
			this.renderGrid(ctx, phase.grid, ox, oy, CELL_PX, GAP, phase.highlight, phase.propagated);
		}

		ctx.textAlign = "left";
	}

	// ── Compact mode ────────────────────────────────────────────────

	private updateCompact(delta: number): void {
		// Fade in
		this.compactOpacity = Math.min(0.9, this.compactOpacity + delta * 0.8);
		this.compactCanvas.style.opacity = String(this.compactOpacity);

		// Advance solver steps
		this.compactStepTimer += delta;
		if (this.compactStepTimer >= this.compactStepInterval) {
			this.compactStepTimer -= this.compactStepInterval;
			this.compactStep++;
			if (this.compactStep >= this.compactSteps.length) {
				// Loop: rebuild solver for a fresh grid
				this.compactStep = 0;
				this.compactStepInterval = 0.6;
			}
			this.compactStepInterval = Math.max(0.15, this.compactStepInterval * 0.97);
		}

		this.renderCompact();
	}

	private renderCompact(): void {
		const ctx = this.compactCtx;
		const w = this.compactWidth;
		const h = this.compactHeight;

		ctx.clearRect(0, 0, w, h);

		const step = this.compactSteps[this.compactStep];
		if (!step) return;

		const ox = COMPACT_PAD;
		const oy = COMPACT_PAD;
		this.renderGrid(ctx, step.grid, ox, oy, COMPACT_CELL, COMPACT_GAP, step.highlight ?? undefined, step.propagated);
	}

	// ── Shared grid renderer ────────────────────────────────────────

	private renderGrid(
		ctx: CanvasRenderingContext2D,
		grid: number[][],
		ox: number,
		oy: number,
		cellPx: number,
		gap: number,
		highlight?: { row: number; col: number; color?: string },
		propagated?: Array<{ row: number; col: number }>,
	): void {
		const gridSize = grid.length;

		for (let r = 0; r < gridSize; r++) {
			for (let c = 0; c < gridSize; c++) {
				const x = ox + c * (cellPx + gap);
				const y = oy + r * (cellPx + gap);
				const tileId = grid[r][c];
				const tile = TILES[tileId];

				// Highlight: selected cell
				if (highlight && highlight.row === r && highlight.col === c) {
					ctx.fillStyle = "rgba(255, 80, 80, 0.3)";
					ctx.fillRect(x - 3, y - 3, cellPx + 6, cellPx + 6);
					ctx.strokeStyle = highlight.color || "#ff3333";
					ctx.lineWidth = 2.5;
					ctx.strokeRect(x - 2, y - 2, cellPx + 4, cellPx + 4);
				}

				// Highlight: propagation
				const isProp = propagated?.some((p) => p.row === r && p.col === c);
				if (isProp) {
					ctx.fillStyle = "rgba(255, 200, 0, 0.15)";
					ctx.fillRect(x - 1, y - 1, cellPx + 2, cellPx + 2);
					ctx.strokeStyle = "rgba(255, 200, 0, 0.6)";
					ctx.lineWidth = 1.5;
					ctx.strokeRect(x - 1, y - 1, cellPx + 2, cellPx + 2);
				}

				// Cell
				if (tileId === 0) {
					ctx.fillStyle = "#0e0e22";
					ctx.fillRect(x, y, cellPx, cellPx);
					ctx.strokeStyle = "rgba(0, 255, 102, 0.1)";
					ctx.lineWidth = 0.5;
					ctx.strokeRect(x, y, cellPx, cellPx);
				} else {
					ctx.fillStyle = tile.color;
					ctx.fillRect(x, y, cellPx, cellPx);
					ctx.strokeStyle = "rgba(0,0,0,0.3)";
					ctx.lineWidth = 0.5;
					ctx.strokeRect(x, y, cellPx, cellPx);

					// Connection lines
					if (cellPx >= 20) {
						ctx.strokeStyle = "rgba(0,0,0,0.5)";
						ctx.lineWidth = cellPx >= 40 ? 4 : 2;
						const cx = x + cellPx / 2;
						const cy = y + cellPx / 2;
						if (tile.north) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, y); ctx.stroke(); }
						if (tile.south) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, y + cellPx); ctx.stroke(); }
						if (tile.east)  { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x + cellPx, cy); ctx.stroke(); }
						if (tile.west)  { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, cy); ctx.stroke(); }
						// Center dot
						if (cellPx >= 40) {
							ctx.fillStyle = "rgba(0,0,0,0.4)";
							ctx.beginPath();
							ctx.arc(cx, cy, 4, 0, Math.PI * 2);
							ctx.fill();
						}
					}
				}
			}
		}
	}

	// ── Public API ──────────────────────────────────────────────────

	get fullFinished(): boolean {
		return this._fullFinished;
	}

	get isDone(): boolean {
		return this._fullFinished;
	}

	dispose(): void {
		this.fullCanvas.remove();
		this.compactCanvas.remove();
	}
}
