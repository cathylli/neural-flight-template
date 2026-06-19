import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";

// ══════════════════════════════════════════════════════════════════════
// Wave Function Collapse — Data Room Cityscape
// Generates a cyberpunk circuit-board environment with connected traces
// and neon-edged buildings using constraint propagation.
// ══════════════════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────────

export interface WFCState extends ExperienceState {
  camera: THREE.PerspectiveCamera;
  moveSpeed: number;
  gridSize: number;
  cellSize: number;
  buildingDensity: number;
  traceComplexity: number;
  neonColor: string;
  animateData: boolean;
  buildingGroup: THREE.Group;
  traceGroup: THREE.Group;
  glowEdgesGroup: THREE.Group;
  dataPanels: THREE.Mesh[];
  ground: THREE.Mesh;
  elapsed: number;
  _needsRebuild?: boolean;
}

// ── Tile Definitions ─────────────────────────────────────────────

/** Connection flags: does this edge have a circuit trace? */
interface TileConnections {
  north: boolean;
  east: boolean;
  south: boolean;
  west: boolean;
}

interface TileDef {
  id: number;
  name: string;
  connections: TileConnections;
  /** Weight for random selection — higher = more likely */
  weight: number;
  /** Is this a building tile? */
  isBuilding: boolean;
}

// Tile type constants
const EMPTY = 0;
const STRAIGHT_H = 1;
const STRAIGHT_V = 2;
const CORNER_NE = 3;
const CORNER_NW = 4;
const CORNER_SE = 5;
const CORNER_SW = 6;
const T_NORTH = 7;
const T_SOUTH = 8;
const T_EAST = 9;
const T_WEST = 10;
const CROSS = 11;
const BUILDING_SMALL = 12;
const BUILDING_TALL = 13;
const BUILDING_WIDE = 14;

const TILES: TileDef[] = [
  {
    id: EMPTY,
    name: "empty",
    connections: { north: false, east: false, south: false, west: false },
    weight: 3,
    isBuilding: false,
  },
  {
    id: STRAIGHT_H,
    name: "straight_h",
    connections: { north: false, east: true, south: false, west: true },
    weight: 4,
    isBuilding: false,
  },
  {
    id: STRAIGHT_V,
    name: "straight_v",
    connections: { north: true, east: false, south: true, west: false },
    weight: 4,
    isBuilding: false,
  },
  {
    id: CORNER_NE,
    name: "corner_ne",
    connections: { north: true, east: true, south: false, west: false },
    weight: 2,
    isBuilding: false,
  },
  {
    id: CORNER_NW,
    name: "corner_nw",
    connections: { north: true, east: false, south: false, west: true },
    weight: 2,
    isBuilding: false,
  },
  {
    id: CORNER_SE,
    name: "corner_se",
    connections: { north: false, east: true, south: true, west: false },
    weight: 2,
    isBuilding: false,
  },
  {
    id: CORNER_SW,
    name: "corner_sw",
    connections: { north: false, east: false, south: true, west: true },
    weight: 2,
    isBuilding: false,
  },
  {
    id: T_NORTH,
    name: "t_north",
    connections: { north: true, east: true, south: false, west: true },
    weight: 1.5,
    isBuilding: false,
  },
  {
    id: T_SOUTH,
    name: "t_south",
    connections: { north: false, east: true, south: true, west: true },
    weight: 1.5,
    isBuilding: false,
  },
  {
    id: T_EAST,
    name: "t_east",
    connections: { north: true, east: true, south: true, west: false },
    weight: 1.5,
    isBuilding: false,
  },
  {
    id: T_WEST,
    name: "t_west",
    connections: { north: true, east: false, south: true, west: true },
    weight: 1.5,
    isBuilding: false,
  },
  {
    id: CROSS,
    name: "cross",
    connections: { north: true, east: true, south: true, west: true },
    weight: 1,
    isBuilding: false,
  },
  {
    id: BUILDING_SMALL,
    name: "building_small",
    connections: { north: false, east: false, south: false, west: false },
    weight: 2,
    isBuilding: true,
  },
  {
    id: BUILDING_TALL,
    name: "building_tall",
    connections: { north: false, east: false, south: false, west: false },
    weight: 1.5,
    isBuilding: true,
  },
  {
    id: BUILDING_WIDE,
    name: "building_wide",
    connections: { north: false, east: false, south: false, west: false },
    weight: 1,
    isBuilding: true,
  },
];

// ── WFC Algorithm ────────────────────────────────────────────────

type PossibilitySet = Set<number>;

interface WFCGrid {
  cells: PossibilitySet[][];
  collapsed: (number | null)[][];
  size: number;
}

/** Check adjacency compatibility between two tiles */
function compatible(
  tileA: number,
  tileB: number,
  direction: "north" | "east" | "south" | "west",
): boolean {
  const a = TILES[tileA];
  const b = TILES[tileB];

  // Opposite direction mapping
  switch (direction) {
    case "north": // A is north of B → A's south must match B's north
      return a.connections.south === b.connections.north;
    case "south":
      return a.connections.north === b.connections.south;
    case "east": // A is east of B → A's west must match B's east
      return a.connections.west === b.connections.east;
    case "west":
      return a.connections.east === b.connections.west;
  }
}

/** Initialize a WFC grid with all possibilities */
function initGrid(
  size: number,
  buildingDensity: number,
  traceComplexity: number,
): WFCGrid {
  const cells: PossibilitySet[][] = [];
  const collapsed: (number | null)[][] = [];

  // Adjust tile weights based on parameters
  const adjustedWeights = TILES.map((tile) => {
    if (tile.isBuilding) return tile.weight * (buildingDensity * 3);
    if (tile.id === EMPTY) return tile.weight * (1 - traceComplexity);
    return tile.weight * (0.5 + traceComplexity);
  });

  for (let row = 0; row < size; row++) {
    cells[row] = [];
    collapsed[row] = [];
    for (let col = 0; col < size; col++) {
      const possibilities = new Set<number>();
      for (let t = 0; t < TILES.length; t++) {
        if (adjustedWeights[t] > 0) {
          possibilities.add(t);
        }
      }
      cells[row][col] = possibilities;
      collapsed[row][col] = null;
    }
  }

  return { cells, collapsed, size };
}

/** Find the cell with lowest entropy (fewest possibilities) */
function findLowestEntropy(grid: WFCGrid): { row: number; col: number } | null {
  let minEntropy = Number.POSITIVE_INFINITY;
  let candidates: { row: number; col: number }[] = [];

  for (let row = 0; row < grid.size; row++) {
    for (let col = 0; col < grid.size; col++) {
      if (grid.collapsed[row][col] !== null) continue;
      const entropy = grid.cells[row][col].size;
      if (entropy === 0) continue; // contradiction
      if (entropy < minEntropy) {
        minEntropy = entropy;
        candidates = [{ row, col }];
      } else if (entropy === minEntropy) {
        candidates.push({ row, col });
      }
    }
  }

  if (candidates.length === 0) return null;
  // Random tie-breaking
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** Weighted random selection from possibilities */
function weightedCollapse(
  possibilities: PossibilitySet,
  buildingDensity: number,
  traceComplexity: number,
): number {
  const options = Array.from(possibilities);
  const weights = options.map((t) => {
    const tile = TILES[t];
    if (tile.isBuilding) return tile.weight * (buildingDensity * 3);
    if (tile.id === EMPTY) return tile.weight * (1 - traceComplexity + 0.1);
    return tile.weight * (0.5 + traceComplexity);
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let rand = Math.random() * totalWeight;

  for (let i = 0; i < options.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return options[i];
  }
  return options[options.length - 1];
}

/** Propagate constraints from a collapsed cell using BFS */
function propagate(grid: WFCGrid, startRow: number, startCol: number): void {
  const queue: { row: number; col: number }[] = [
    { row: startRow, col: startCol },
  ];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    const key = `${current.row},${current.col}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const neighbors: {
      row: number;
      col: number;
      dir: "north" | "east" | "south" | "west";
    }[] = [
        { row: current.row - 1, col: current.col, dir: "north" },
        { row: current.row + 1, col: current.col, dir: "south" },
        { row: current.row, col: current.col + 1, dir: "east" },
        { row: current.row, col: current.col - 1, dir: "west" },
      ];

    for (const neighbor of neighbors) {
      if (neighbor.row < 0 || neighbor.row >= grid.size) continue;
      if (neighbor.col < 0 || neighbor.col >= grid.size) continue;
      if (grid.collapsed[neighbor.row][neighbor.col] !== null) continue;

      const neighborPossibilities = grid.cells[neighbor.row][neighbor.col];
      const currentPossibilities = grid.cells[current.row][current.col];
      let changed = false;

      // For each possibility in the neighbor, check if it's compatible
      // with at least one possibility in the current cell
      const toRemove: number[] = [];
      for (const neighborTile of neighborPossibilities) {
        let hasCompatible = false;
        for (const currentTile of currentPossibilities) {
          if (compatible(neighborTile, currentTile, neighbor.dir)) {
            hasCompatible = true;
            break;
          }
        }
        if (!hasCompatible) {
          toRemove.push(neighborTile);
        }
      }

      for (const t of toRemove) {
        neighborPossibilities.delete(t);
        changed = true;
      }

      if (changed && neighborPossibilities.size > 0) {
        queue.push({ row: neighbor.row, col: neighbor.col });
      }
    }
  }
}

/** Run the full WFC algorithm */
function runWFC(
  size: number,
  buildingDensity: number,
  traceComplexity: number,
): number[][] {
  const grid = initGrid(size, buildingDensity, traceComplexity);

  // Force edges to be EMPTY or buildings to avoid dangling traces at boundaries
  for (let i = 0; i < size; i++) {
    const edgeCells = [
      { row: 0, col: i },
      { row: size - 1, col: i },
      { row: i, col: 0 },
      { row: i, col: size - 1 },
    ];
    for (const cell of edgeCells) {
      // Remove tiles that have connections facing outward
      const possibilities = grid.cells[cell.row][cell.col];
      const toRemove: number[] = [];
      for (const t of possibilities) {
        const tile = TILES[t];
        if (cell.row === 0 && tile.connections.north) toRemove.push(t);
        if (cell.row === size - 1 && tile.connections.south) toRemove.push(t);
        if (cell.col === 0 && tile.connections.west) toRemove.push(t);
        if (cell.col === size - 1 && tile.connections.east) toRemove.push(t);
      }
      for (const t of toRemove) {
        possibilities.delete(t);
      }
    }
  }

  // Iteratively collapse
  let iterations = 0;
  const maxIterations = size * size * 2; // safety limit

  while (iterations < maxIterations) {
    iterations++;
    const target = findLowestEntropy(grid);
    if (!target) break; // all cells collapsed or impossible

    const possibilities = grid.cells[target.row][target.col];
    if (possibilities.size === 0) {
      // Contradiction: fallback to EMPTY
      grid.collapsed[target.row][target.col] = EMPTY;
      grid.cells[target.row][target.col] = new Set([EMPTY]);
    } else {
      const chosen = weightedCollapse(
        possibilities,
        buildingDensity,
        traceComplexity,
      );
      grid.collapsed[target.row][target.col] = chosen;
      grid.cells[target.row][target.col] = new Set([chosen]);
    }

    propagate(grid, target.row, target.col);
  }

  // Build result grid
  const result: number[][] = [];
  for (let row = 0; row < size; row++) {
    result[row] = [];
    for (let col = 0; col < size; col++) {
      result[row][col] = grid.collapsed[row][col] ?? EMPTY;
    }
  }

  return result;
}

// ── Geometry Generation ──────────────────────────────────────────

/** Generate trace geometry for a single cell */
function createTraceForCell(
  tileId: number,
  cx: number,
  cz: number,
  cellSize: number,
): THREE.Vector3[][] {
  const tile = TILES[tileId];
  if (tile.isBuilding || tileId === EMPTY) return [];

  const paths: THREE.Vector3[][] = [];
  const half = cellSize / 2;
  const y = 0.05; // slightly above ground

  const center = new THREE.Vector3(cx, y, cz);
  const north = new THREE.Vector3(cx, y, cz - half);
  const south = new THREE.Vector3(cx, y, cz + half);
  const east = new THREE.Vector3(cx + half, y, cz);
  const west = new THREE.Vector3(cx - half, y, cz);

  // Main trace paths based on connections
  if (tile.connections.north) paths.push([center.clone(), north.clone()]);
  if (tile.connections.south) paths.push([center.clone(), south.clone()]);
  if (tile.connections.east) paths.push([center.clone(), east.clone()]);
  if (tile.connections.west) paths.push([center.clone(), west.clone()]);

  // Add parallel detail traces (PCB style) with small offset
  const offset = cellSize * 0.12;
  if (tile.connections.east && tile.connections.west) {
    // Horizontal parallel traces
    paths.push([
      new THREE.Vector3(cx - half, y, cz + offset),
      new THREE.Vector3(cx + half, y, cz + offset),
    ]);
    paths.push([
      new THREE.Vector3(cx - half, y, cz - offset),
      new THREE.Vector3(cx + half, y, cz - offset),
    ]);
  }
  if (tile.connections.north && tile.connections.south) {
    // Vertical parallel traces
    paths.push([
      new THREE.Vector3(cx + offset, y, cz - half),
      new THREE.Vector3(cx + offset, y, cz + half),
    ]);
    paths.push([
      new THREE.Vector3(cx - offset, y, cz - half),
      new THREE.Vector3(cx - offset, y, cz + half),
    ]);
  }

  // Add junction dots (small cross at trace intersections)
  if (tileId === CROSS || tileId >= T_NORTH) {
    const dotSize = cellSize * 0.06;
    paths.push([
      new THREE.Vector3(cx - dotSize, y, cz - dotSize),
      new THREE.Vector3(cx + dotSize, y, cz + dotSize),
    ]);
    paths.push([
      new THREE.Vector3(cx + dotSize, y, cz - dotSize),
      new THREE.Vector3(cx - dotSize, y, cz + dotSize),
    ]);
  }

  return paths;
}

/** Create a neon building mesh + edges */
function createBuilding(
  tileId: number,
  cx: number,
  cz: number,
  cellSize: number,
  neonColor: THREE.Color,
): { body: THREE.Mesh; edges: THREE.LineSegments } {
  let height: number;
  let width: number;
  let depth: number;

  switch (tileId) {
    case BUILDING_TALL:
      height = 8 + Math.random() * 16;
      width = cellSize * 0.5;
      depth = cellSize * 0.5;
      break;
    case BUILDING_WIDE:
      height = 3 + Math.random() * 6;
      width = cellSize * 0.8;
      depth = cellSize * 0.8;
      break;
    default: // BUILDING_SMALL
      height = 3 + Math.random() * 8;
      width = cellSize * 0.4 + Math.random() * cellSize * 0.2;
      depth = cellSize * 0.4 + Math.random() * cellSize * 0.2;
      break;
  }

  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshStandardMaterial({
    color: 0x080818,
    transparent: true,
    opacity: 0.7,
    metalness: 0.9,
    roughness: 0.1,
    side: THREE.DoubleSide,
  });

  const body = new THREE.Mesh(geometry, material);
  body.position.set(cx, height / 2, cz);
  body.castShadow = true;

  // Neon edge wireframe
  const edgeGeo = new THREE.EdgesGeometry(geometry);
  const edgeMat = new THREE.LineBasicMaterial({
    color: neonColor,
    transparent: true,
    opacity: 0.9,
  });
  const edges = new THREE.LineSegments(edgeGeo, edgeMat);
  edges.position.copy(body.position);

  return { body, edges };
}

/** Create a data panel (matrix-rain style) for a building face */
function createDataPanel(
  cx: number,
  cz: number,
  height: number,
  width: number,
  neonColor: THREE.Color,
): THREE.Mesh {
  // Generate a canvas texture with matrix-style text
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx2d = canvas.getContext("2d");
  if (ctx2d) {
    ctx2d.fillStyle = "#000000";
    ctx2d.fillRect(0, 0, 128, 256);
    ctx2d.font = "10px monospace";

    const hexColor = `#${neonColor.getHexString()}`;
    ctx2d.fillStyle = hexColor;

    // Generate random data text
    const chars = "01アイウエオカキクケコ{}[]<>=;:.";
    for (let y = 10; y < 256; y += 12) {
      let line = "";
      for (let i = 0; i < 14; i++) {
        line += chars[Math.floor(Math.random() * chars.length)];
      }
      ctx2d.globalAlpha = 0.3 + Math.random() * 0.7;
      ctx2d.fillText(line, 4, y);
    }

    // Add section headers
    ctx2d.globalAlpha = 1;
    ctx2d.fillStyle = "#ffffff";
    ctx2d.font = "bold 9px monospace";
    ctx2d.fillText("data sector " + Math.floor(Math.random() * 9), 4, 20);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const panelGeo = new THREE.PlaneGeometry(width * 0.8, height * 0.6);
  const panelMat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });

  const panel = new THREE.Mesh(panelGeo, panelMat);
  // Position on the face of the building, offset outward
  const faceOffset = width * 0.52;
  const side = Math.floor(Math.random() * 4);
  switch (side) {
    case 0:
      panel.position.set(cx + faceOffset, height * 0.5, cz);
      panel.rotation.y = Math.PI / 2;
      break;
    case 1:
      panel.position.set(cx - faceOffset, height * 0.5, cz);
      panel.rotation.y = -Math.PI / 2;
      break;
    case 2:
      panel.position.set(cx, height * 0.5, cz + faceOffset);
      break;
    default:
      panel.position.set(cx, height * 0.5, cz - faceOffset);
      panel.rotation.y = Math.PI;
      break;
  }

  return panel;
}

/** Build the entire scene geometry from WFC grid */
function buildSceneFromGrid(
  grid: number[][],
  gridSize: number,
  cellSize: number,
  neonColor: THREE.Color,
): {
  buildingGroup: THREE.Group;
  traceGroup: THREE.Group;
  glowEdgesGroup: THREE.Group;
  dataPanels: THREE.Mesh[];
} {
  const buildingGroup = new THREE.Group();
  const traceGroup = new THREE.Group();
  const glowEdgesGroup = new THREE.Group();
  const dataPanels: THREE.Mesh[] = [];

  const halfWorld = (gridSize * cellSize) / 2;

  // Collect all trace line segments for merged geometry
  const allTracePositions: number[] = [];

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const tileId = grid[row][col];
      const cx = col * cellSize - halfWorld + cellSize / 2;
      const cz = row * cellSize - halfWorld + cellSize / 2;

      const tile = TILES[tileId];

      if (tile.isBuilding) {
        const { body, edges } = createBuilding(
          tileId,
          cx,
          cz,
          cellSize,
          neonColor,
        );
        buildingGroup.add(body);
        glowEdgesGroup.add(edges);

        // Add data panel to ~40% of tall buildings
        if (tileId === BUILDING_TALL && Math.random() < 0.4) {
          const buildingHeight = body.position.y * 2; // height = position.y * 2 since centered
          const buildingWidth = cellSize * 0.5;
          const panel = createDataPanel(
            cx,
            cz,
            buildingHeight,
            buildingWidth,
            neonColor,
          );
          dataPanels.push(panel);
          buildingGroup.add(panel);
        }
      } else if (tileId !== EMPTY) {
        // Generate trace paths
        const paths = createTraceForCell(tileId, cx, cz, cellSize);
        for (const path of paths) {
          for (let i = 0; i < path.length - 1; i++) {
            allTracePositions.push(path[i].x, path[i].y, path[i].z);
            allTracePositions.push(path[i + 1].x, path[i + 1].y, path[i + 1].z);
          }
        }
      } else {
        // Empty cells: add subtle grid lines
        if (Math.random() < 0.3) {
          const y = 0.02;
          const half = cellSize / 2;
          // Occasional subtle single trace in empty areas
          if (Math.random() > 0.5) {
            allTracePositions.push(
              cx - half * 0.3,
              y,
              cz,
              cx + half * 0.3,
              y,
              cz,
            );
          } else {
            allTracePositions.push(
              cx,
              y,
              cz - half * 0.3,
              cx,
              y,
              cz + half * 0.3,
            );
          }
        }
      }
    }
  }

  // Create merged trace geometry (single draw call)
  if (allTracePositions.length > 0) {
    const traceGeo = new THREE.BufferGeometry();
    traceGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(allTracePositions, 3),
    );
    const traceMat = new THREE.LineBasicMaterial({
      color: neonColor,
      transparent: true,
      opacity: 0.9,
    });
    const traceLines = new THREE.LineSegments(traceGeo, traceMat);
    traceGroup.add(traceLines);
  }

  // Add a subtle ground grid for PCB aesthetic
  const gridLinePositions: number[] = [];
  const gridExtent = halfWorld;
  const gridSpacing = cellSize;
  for (let i = -gridExtent; i <= gridExtent; i += gridSpacing) {
    gridLinePositions.push(-gridExtent, 0.01, i, gridExtent, 0.01, i);
    gridLinePositions.push(i, 0.01, -gridExtent, i, 0.01, gridExtent);
  }
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(gridLinePositions, 3),
  );
  const gridMat = new THREE.LineBasicMaterial({
    color: neonColor,
    transparent: true,
    opacity: 0.08,
  });
  const gridLines = new THREE.LineSegments(gridGeo, gridMat);
  traceGroup.add(gridLines);

  return { buildingGroup, traceGroup, glowEdgesGroup, dataPanels };
}

// ── Helper: dispose a whole group ────────────────────────────────

function disposeGroup(group: THREE.Group, scene: THREE.Scene): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) {
        child.material.dispose();
        if (
          "map" in child.material &&
          child.material.map instanceof THREE.Texture
        ) {
          child.material.map.dispose();
        }
      }
    } else if (
      child instanceof THREE.LineSegments ||
      child instanceof THREE.Line
    ) {
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) {
        child.material.dispose();
      }
    }
  });
  scene.remove(group);
}

// ── Lifecycle: setup() ─────────────────────────────────────────

export async function setup(ctx: SetupContext): Promise<WFCState> {
  const gridSize = 20;
  const cellSize = 4;
  const buildingDensity = 0.3;
  const traceComplexity = 0.6;
  const neonColorStr = "#00ff66";
  const neonColor = new THREE.Color(neonColorStr);

  // Dark ground plane
  const groundSize = gridSize * cellSize + 40;
  const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x050510,
    metalness: 0.95,
    roughness: 0.3,
  });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ctx.scene.add(ground);

  // Run WFC algorithm
  const grid = runWFC(gridSize, buildingDensity, traceComplexity);

  // Build geometry from collapsed grid
  const { buildingGroup, traceGroup, glowEdgesGroup, dataPanels } =
    buildSceneFromGrid(grid, gridSize, cellSize, neonColor);

  ctx.scene.add(buildingGroup);
  ctx.scene.add(traceGroup);
  ctx.scene.add(glowEdgesGroup);

  return {
    camera: ctx.camera,
    moveSpeed: 8,
    gridSize,
    cellSize,
    buildingDensity,
    traceComplexity,
    neonColor: neonColorStr,
    animateData: true,
    buildingGroup,
    traceGroup,
    glowEdgesGroup,
    dataPanels,
    ground,
    elapsed: 0,
  };
}

// ── Lifecycle: tick() ──────────────────────────────────────────

export function tick(
  state: ExperienceState,
  ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
  const s = state as WFCState;
  s.elapsed += ctx.delta;

  // Handle rebuild flag (triggered by settings changes)
  if (s._needsRebuild) {
    s._needsRebuild = false;

    const scene = s.buildingGroup.parent as THREE.Scene | null;
    if (scene) {
      disposeGroup(s.buildingGroup, scene);
      disposeGroup(s.traceGroup, scene);
      disposeGroup(s.glowEdgesGroup, scene);

      const neonColor = new THREE.Color(s.neonColor);
      const grid = runWFC(s.gridSize, s.buildingDensity, s.traceComplexity);
      const result = buildSceneFromGrid(
        grid,
        s.gridSize,
        s.cellSize,
        neonColor,
      );

      s.buildingGroup = result.buildingGroup;
      s.traceGroup = result.traceGroup;
      s.glowEdgesGroup = result.glowEdgesGroup;
      s.dataPanels = result.dataPanels;

      scene.add(s.buildingGroup);
      scene.add(s.traceGroup);
      scene.add(s.glowEdgesGroup);
    }
  }

  // Animate traces: subtle pulsing glow
  if (s.animateData) {
    const pulse = 0.6 + 0.3 * Math.sin(s.elapsed * 2.0);
    for (const child of s.traceGroup.children) {
      if (child instanceof THREE.LineSegments || child instanceof THREE.Line) {
        const mat = child.material;
        if (mat instanceof THREE.LineBasicMaterial && mat.opacity > 0.5) {
          mat.opacity = pulse;
        }
      }
    }

    // Animate data panels: flicker effect
    for (const panel of s.dataPanels) {
      if (panel.material instanceof THREE.MeshBasicMaterial) {
        panel.material.opacity =
          0.6 + 0.3 * Math.sin(s.elapsed * 4 + panel.position.x);
      }
    }
  }

  // Animate building edge glow
  const edgePulse = 0.7 + 0.2 * Math.sin(s.elapsed * 1.5);
  for (const child of s.glowEdgesGroup.children) {
    if (child instanceof THREE.LineSegments) {
      const mat = child.material;
      if (mat instanceof THREE.LineBasicMaterial) {
        mat.opacity = edgePulse;
      }
    }
  }

  return { state: s };
}

// ── Lifecycle: dispose() ───────────────────────────────────────

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
  const s = state as WFCState;

  disposeGroup(s.buildingGroup, scene);
  disposeGroup(s.traceGroup, scene);
  disposeGroup(s.glowEdgesGroup, scene);

  if (s.ground.geometry) s.ground.geometry.dispose();
  if (s.ground.material instanceof THREE.Material) s.ground.material.dispose();
  scene.remove(s.ground);
}
