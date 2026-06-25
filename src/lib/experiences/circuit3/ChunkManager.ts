import * as THREE from "three";
import type { StationSpawnPolicy } from "./stations";

// ── Constants ──────────────────────────────────────────────────────────────

const CHUNK_GRID = 30; // tiles per chunk side
const CELL = 4; // world units per tile
export const CHUNK_SIZE = CHUNK_GRID * CELL; // 80 world units per chunk
const RENDER_RADIUS = 1; // 3×3 = 9 chunks around player
const GROWTH_DURATION = 1.4; // seconds for buildings to rise
const TRACE_W  = CELL * 0.025;  // ribbon half-width per trace
const PAD_R    = CELL * 0.11;   // pad circle radius

// ── WFC Tile System ────────────────────────────────────────────────────────

interface TileConnections {
  north: boolean;
  east: boolean;
  south: boolean;
  west: boolean;
}

interface TileDef {
  id: number;
  connections: TileConnections;
  weight: number;
  isBuilding: boolean;
}

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
const DIAG_NESW = 15;  // 45° diagonal trace: SW corner → NE corner
const DIAG_NWSE = 16;  // 45° diagonal trace: NW corner → SE corner
const STATION   = 17;  // unique per-level station anchor (single-spawn via flag)

const TILES: TileDef[] = [
  { id: EMPTY,         connections: { north: false, east: false, south: false, west: false }, weight: 40,  isBuilding: false },
  { id: STRAIGHT_H,   connections: { north: false, east: true,  south: false, west: true  }, weight: 3,   isBuilding: false },
  { id: STRAIGHT_V,   connections: { north: true,  east: false, south: true,  west: false }, weight: 3,   isBuilding: false },
  { id: CORNER_NE,    connections: { north: true,  east: true,  south: false, west: false }, weight: 0.8, isBuilding: false },
  { id: CORNER_NW,    connections: { north: true,  east: false, south: false, west: true  }, weight: 0.8, isBuilding: false },
  { id: CORNER_SE,    connections: { north: false, east: true,  south: true,  west: false }, weight: 0.8, isBuilding: false },
  { id: CORNER_SW,    connections: { north: false, east: false, south: true,  west: true  }, weight: 0.8, isBuilding: false },
  { id: T_NORTH,      connections: { north: true,  east: true,  south: false, west: true  }, weight: 0.4, isBuilding: false },
  { id: T_SOUTH,      connections: { north: false, east: true,  south: true,  west: true  }, weight: 0.4, isBuilding: false },
  { id: T_EAST,       connections: { north: true,  east: true,  south: true,  west: false }, weight: 0.4, isBuilding: false },
  { id: T_WEST,       connections: { north: true,  east: false, south: true,  west: true  }, weight: 0.4, isBuilding: false },
  { id: CROSS,        connections: { north: true,  east: true,  south: true,  west: true  }, weight: 0.6, isBuilding: false },
  { id: BUILDING_SMALL, connections: { north: false, east: false, south: false, west: false }, weight: 2,   isBuilding: true },
  { id: BUILDING_TALL,  connections: { north: false, east: false, south: false, west: false }, weight: 1.5, isBuilding: true },
  { id: BUILDING_WIDE,  connections: { north: false, east: false, south: false, west: false }, weight: 1,   isBuilding: true },
  { id: DIAG_NESW,      connections: { north: false, east: false, south: false, west: false }, weight: 0.8, isBuilding: false },
  { id: DIAG_NWSE,      connections: { north: false, east: false, south: false, west: false }, weight: 0.8, isBuilding: false },
  // Station: connectionless (sits like a footprint). Weight is supplied at
  // runtime — 0 means "removed from the active set" until the level's
  // station should spawn.
  { id: STATION,        connections: { north: false, east: false, south: false, west: false }, weight: 0,   isBuilding: false },
];

function compatible(
  tileA: number,
  tileB: number,
  dir: "north" | "east" | "south" | "west",
): boolean {
  const a = TILES[tileA];
  const b = TILES[tileB];
  switch (dir) {
    case "north": return a.connections.south === b.connections.north;
    case "south": return a.connections.north === b.connections.south;
    case "east":  return a.connections.west  === b.connections.east;
    case "west":  return a.connections.east  === b.connections.west;
  }
}

function weightedCollapse(
  possibilities: Set<number>,
  buildingDensity: number,
  traceComplexity: number,
  stationWeight: number,
): number {
  const options = Array.from(possibilities);
  const weights = options.map((t) => {
    const tile = TILES[t];
    if (tile.id === STATION) return stationWeight;
    if (tile.isBuilding)   return tile.weight * (buildingDensity * 3);
    if (tile.id === EMPTY) return tile.weight * (1 - traceComplexity + 0.1);
    if (tile.id === DIAG_NESW || tile.id === DIAG_NWSE)
      return tile.weight * (0.4 + traceComplexity * 0.8);
    return tile.weight * (0.5 + traceComplexity);
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let rand = Math.random() * total;
  for (let i = 0; i < options.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return options[i];
  }
  return options[options.length - 1];
}

function propagate(
  cells: Set<number>[][],
  collapsed: (number | null)[][],
  size: number,
  startRow: number,
  startCol: number,
): void {
  const queue = [{ row: startRow, col: startCol }];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const neighbors = [
      { row: cur.row - 1, col: cur.col,     dir: "north" as const },
      { row: cur.row + 1, col: cur.col,     dir: "south" as const },
      { row: cur.row,     col: cur.col + 1, dir: "east"  as const },
      { row: cur.row,     col: cur.col - 1, dir: "west"  as const },
    ];
    for (const nb of neighbors) {
      if (nb.row < 0 || nb.row >= size || nb.col < 0 || nb.col >= size) continue;
      if (collapsed[nb.row][nb.col] !== null) continue;
      const nbPoss = cells[nb.row][nb.col];
      const curPoss = cells[cur.row][cur.col];
      const toRemove: number[] = [];
      for (const nbTile of nbPoss) {
        let ok = false;
        for (const curTile of curPoss) {
          if (compatible(nbTile, curTile, nb.dir)) { ok = true; break; }
        }
        if (!ok) toRemove.push(nbTile);
      }
      if (toRemove.length > 0) {
        for (const t of toRemove) nbPoss.delete(t);
        if (nbPoss.size > 0) queue.push({ row: nb.row, col: nb.col });
      }
    }
  }
}

// Remove trace-connected components that have no CROSS or T-junction terminator.
// Every path on a real PCB must terminate at a junction node — isolated arcs are artifacts.
function removeIsolatedLoops(grid: number[][]): void {
  const size = grid.length;
  const visited: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );

  const dirs: Array<[number, number, keyof TileConnections, keyof TileConnections]> = [
    [-1,  0, "north", "south"],
    [ 1,  0, "south", "north"],
    [ 0,  1, "east",  "west" ],
    [ 0, -1, "west",  "east" ],
  ];

  for (let sr = 0; sr < size; sr++) {
    for (let sc = 0; sc < size; sc++) {
      const tid = grid[sr][sc];
      // Skip cells that are not part of the orthogonal trace network
      if (
        visited[sr][sc] ||
        tid === EMPTY ||
        TILES[tid].isBuilding ||
        tid === DIAG_NESW ||
        tid === DIAG_NWSE ||
        tid === STATION
      ) {
        visited[sr][sc] = true;
        continue;
      }

      // BFS this connected component
      const component: Array<[number, number]> = [];
      let hasTerminator = false;
      const queue: Array<[number, number]> = [[sr, sc]];
      visited[sr][sc] = true;

      while (queue.length > 0) {
        const [r, c] = queue.shift()!;
        component.push([r, c]);
        const ct = grid[r][c];
        if (ct === CROSS || ct === T_NORTH || ct === T_SOUTH || ct === T_EAST || ct === T_WEST) {
          hasTerminator = true;
        }
        const myTile = TILES[ct];
        for (const [dr, dc, myDir, theirDir] of dirs) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= size || nc < 0 || nc >= size || visited[nr][nc]) continue;
          const nt = grid[nr][nc];
          if (TILES[nt].isBuilding || nt === DIAG_NESW || nt === DIAG_NWSE || nt === STATION) continue;
          if (myTile.connections[myDir] && TILES[nt].connections[theirDir]) {
            visited[nr][nc] = true;
            queue.push([nr, nc]);
          }
        }
      }

      // No junction node → isolated arc/loop → erase
      if (!hasTerminator) {
        for (const [r, c] of component) {
          grid[r][c] = EMPTY;
        }
      }
    }
  }
}

function runWFC(
  buildingDensity: number,
  traceComplexity: number,
  stationWeight: number,
): number[][] {
  const size = CHUNK_GRID;

  // Build per-cell possibility sets
  const cells: Set<number>[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => new Set(TILES.map((t) => t.id)))
  );
  const collapsed: (number | null)[][] = Array.from({ length: size }, () =>
    Array(size).fill(null)
  );

  // Remove the STATION tile from the active set unless this chunk is allowed
  // to host one — guarantees the unique single-spawn semantics.
  if (stationWeight <= 0) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) cells[r][c].delete(STATION);
    }
  }

  // Strip edge-facing connections at borders
  for (let i = 0; i < size; i++) {
    for (const { row, col } of [
      { row: 0, col: i }, { row: size - 1, col: i },
      { row: i, col: 0 }, { row: i, col: size - 1 },
    ]) {
      const poss = cells[row][col];
      for (const t of Array.from(poss)) {
        const tile = TILES[t];
        if (row === 0        && tile.connections.north) poss.delete(t);
        if (row === size - 1 && tile.connections.south) poss.delete(t);
        if (col === 0        && tile.connections.west)  poss.delete(t);
        if (col === size - 1 && tile.connections.east)  poss.delete(t);
      }
    }
  }

  const maxIter = size * size * 2;
  for (let iter = 0; iter < maxIter; iter++) {
    // Find lowest-entropy uncollapsed cell
    let minE = Infinity;
    const candidates: { row: number; col: number }[] = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (collapsed[r][c] !== null) continue;
        const e = cells[r][c].size;
        if (e === 0) continue;
        if (e < minE) { minE = e; candidates.length = 0; }
        if (e === minE) candidates.push({ row: r, col: c });
      }
    }
    if (candidates.length === 0) break;

    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const poss = cells[target.row][target.col];
    const chosen = poss.size === 0
      ? EMPTY
      : weightedCollapse(poss, buildingDensity, traceComplexity, stationWeight);

    collapsed[target.row][target.col] = chosen;
    cells[target.row][target.col] = new Set([chosen]);
    propagate(cells, collapsed, size, target.row, target.col);
  }

  const result = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => collapsed[r][c] ?? EMPTY)
  );
  removeIsolatedLoops(result);
  return result;
}

// ── Trace Geometry ─────────────────────────────────────────────────────────

function addQuad(
  arr: number[],
  ax: number, ay: number, az: number,
  bx: number, bz: number,
): void {
  const dx = bx - ax, dz = bz - az;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 1e-6) return;
  const px = (-dz / len) * TRACE_W;
  const pz = (dx  / len) * TRACE_W;
  arr.push(
    ax + px, ay, az + pz,  ax - px, ay, az - pz,  bx + px, ay, bz + pz,
    ax - px, ay, az - pz,  bx - px, ay, bz - pz,  bx + px, ay, bz + pz,
  );
}

function addDisc(arr: number[], cx: number, cy: number, cz: number): void {
  const segs = 14;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    arr.push(
      cx, cy, cz,
      cx + Math.cos(a0) * PAD_R, cy, cz + Math.sin(a0) * PAD_R,
      cx + Math.cos(a1) * PAD_R, cy, cz + Math.sin(a1) * PAD_R,
    );
  }
}

function buildTraceGeometry(grid: number[][]): {
  traceVerts:    Float32Array;
  padVerts:      Float32Array;
  gridPositions: Float32Array;
} {
  const tv: number[] = [];
  const pv: number[] = [];
  const gv: number[] = [];
  const size  = CHUNK_GRID;
  const half  = CELL / 2;
  const halfW = (CHUNK_GRID * CELL) / 2;
  const yT    = 0.04;
  const yP    = 0.05;
  // Two parallel ribbons per connection, thin enough that they never overlap
  const BUNDLE = [-CELL * 0.065, CELL * 0.065];

  const seg = (ax: number, az: number, bx: number, bz: number) => {
    const dx = bx - ax, dz = bz - az;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-6) return;
    const nx = -dz / len, nz = dx / len;
    for (const o of BUNDLE) {
      addQuad(tv, ax + nx * o, yT, az + nz * o, bx + nx * o, bz + nz * o);
    }
  };

  const pad = (cx: number, cz: number) => addDisc(pv, cx, yP, cz);

  // Pass 1: trace ribbons
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const tileId = grid[row][col];
      const tile   = TILES[tileId];
      if (tile.isBuilding || tileId === EMPTY || tileId === STATION) continue;

      const cx = col * CELL - halfW + CELL / 2;
      const cz = row * CELL - halfW + CELL / 2;

      switch (tileId) {
        case DIAG_NESW:
          seg(cx - half, cz + half, cx + half, cz - half);
          pad(cx - half, cz + half);
          pad(cx + half, cz - half);
          break;
        case DIAG_NWSE:
          seg(cx - half, cz - half, cx + half, cz + half);
          pad(cx - half, cz - half);
          pad(cx + half, cz + half);
          break;
        case CORNER_NE: seg(cx, cz - half, cx + half, cz); break;
        case CORNER_NW: seg(cx, cz - half, cx - half, cz); break;
        case CORNER_SE: seg(cx, cz + half, cx + half, cz); break;
        case CORNER_SW: seg(cx, cz + half, cx - half, cz); break;
        default:
          if (tile.connections.north) seg(cx, cz, cx, cz - half);
          if (tile.connections.south) seg(cx, cz, cx, cz + half);
          if (tile.connections.east)  seg(cx, cz, cx + half, cz);
          if (tile.connections.west)  seg(cx, cz, cx - half, cz);
      }
    }
  }

  // Pass 2: pads only where a trace terminates (neighbor doesn't connect back)
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const tileId = grid[row][col];
      const tile   = TILES[tileId];
      if (tile.isBuilding || tileId === EMPTY || tileId === DIAG_NESW || tileId === DIAG_NWSE || tileId === STATION) continue;

      const cx = col * CELL - halfW + CELL / 2;
      const cz = row * CELL - halfW + CELL / 2;

      const endpoints: Array<[boolean, number, number, keyof TileConnections, number, number]> = [
        [tile.connections.north, row - 1, col,     "south", cx,        cz - half],
        [tile.connections.south, row + 1, col,     "north", cx,        cz + half],
        [tile.connections.east,  row,     col + 1, "west",  cx + half, cz       ],
        [tile.connections.west,  row,     col - 1, "east",  cx - half, cz       ],
      ];

      for (const [hasConn, nr, nc, theirDir, ex, ez] of endpoints) {
        if (!hasConn) continue;
        const inBounds = nr >= 0 && nr < size && nc >= 0 && nc < size;
        if (!inBounds || !TILES[grid[nr][nc]].connections[theirDir]) {
          pad(ex, ez);
        }
      }
    }
  }

  const ext = halfW;
  for (let i = -ext; i <= ext; i += CELL) {
    gv.push(-ext, 0.01, i, ext, 0.01, i);
    gv.push(i, 0.01, -ext, i, 0.01, ext);
  }

  return {
    traceVerts:    new Float32Array(tv),
    padVerts:      new Float32Array(pv),
    gridPositions: new Float32Array(gv),
  };
}

// ── Shared Materials ────────────────────────────────────────────────────────

export interface ChunkMaterials {
  building:      THREE.MeshStandardMaterial;
  buildingEdge:  THREE.LineBasicMaterial;
  traceMesh:     THREE.MeshBasicMaterial;
  gridLine:      THREE.LineBasicMaterial;
  dispose(): void;
}

export function createChunkMaterials(neonColor: THREE.Color): ChunkMaterials {
  const building = new THREE.MeshStandardMaterial({
    color: 0x080818,
    transparent: true,
    opacity: 0.7,
    metalness: 0.9,
    roughness: 0.1,
    side: THREE.DoubleSide,
  });
  const buildingEdge = new THREE.LineBasicMaterial({
    color: neonColor,
    transparent: true,
    opacity: 0.9,
  });
  const traceMesh = new THREE.MeshBasicMaterial({
    color: neonColor,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const gridLine = new THREE.LineBasicMaterial({
    color: neonColor,
    transparent: true,
    opacity: 0.07,
  });
  return {
    building,
    buildingEdge,
    traceMesh,
    gridLine,
    dispose() {
      building.dispose();
      buildingEdge.dispose();
      traceMesh.dispose();
      gridLine.dispose();
    },
  };
}

// ── Circuit3Chunk ──────────────────────────────────────────────────────────

interface BuildingAnim {
  idx:          number;
  lx:           number;
  lz:           number;
  targetHeight: number;
  wx:           number;
  wz:           number;
  birthTime:    number;
}

// 12 edges × 2 vertices × 3 floats = 72 floats per building
const FLOATS_PER_BUILDING_EDGE = 72;

/** Fill 12 box edges (72 floats) into arr starting at offset, returns new offset */
function fillBoxEdges(
  arr: Float32Array,
  o: number,
  lx: number, lz: number,
  wx: number, wz: number,
  height: number,
): number {
  const hx = wx / 2, hz = wz / 2;
  const x0 = lx - hx, x1 = lx + hx;
  const z0 = lz - hz, z1 = lz + hz;
  const y1 = height;
  // Bottom ring
  arr[o++]=x0; arr[o++]=0;  arr[o++]=z0; arr[o++]=x1; arr[o++]=0;  arr[o++]=z0;
  arr[o++]=x1; arr[o++]=0;  arr[o++]=z0; arr[o++]=x1; arr[o++]=0;  arr[o++]=z1;
  arr[o++]=x1; arr[o++]=0;  arr[o++]=z1; arr[o++]=x0; arr[o++]=0;  arr[o++]=z1;
  arr[o++]=x0; arr[o++]=0;  arr[o++]=z1; arr[o++]=x0; arr[o++]=0;  arr[o++]=z0;
  // Top ring
  arr[o++]=x0; arr[o++]=y1; arr[o++]=z0; arr[o++]=x1; arr[o++]=y1; arr[o++]=z0;
  arr[o++]=x1; arr[o++]=y1; arr[o++]=z0; arr[o++]=x1; arr[o++]=y1; arr[o++]=z1;
  arr[o++]=x1; arr[o++]=y1; arr[o++]=z1; arr[o++]=x0; arr[o++]=y1; arr[o++]=z1;
  arr[o++]=x0; arr[o++]=y1; arr[o++]=z1; arr[o++]=x0; arr[o++]=y1; arr[o++]=z0;
  // Vertical pillars
  arr[o++]=x0; arr[o++]=0;  arr[o++]=z0; arr[o++]=x0; arr[o++]=y1; arr[o++]=z0;
  arr[o++]=x1; arr[o++]=0;  arr[o++]=z0; arr[o++]=x1; arr[o++]=y1; arr[o++]=z0;
  arr[o++]=x1; arr[o++]=0;  arr[o++]=z1; arr[o++]=x1; arr[o++]=y1; arr[o++]=z1;
  arr[o++]=x0; arr[o++]=0;  arr[o++]=z1; arr[o++]=x0; arr[o++]=y1; arr[o++]=z1;
  return o;
}

// Shared base geometry: pivot at bottom so Y-scale grows upward
const BUILDING_GEO = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

export class Circuit3Chunk {
  readonly group = new THREE.Group();
  /** World position of the station this chunk placed, or null if none. */
  readonly stationWorldPos: THREE.Vector3 | null;

  private buildingMesh:  THREE.InstancedMesh | null = null;
  private edgePosArr:    Float32Array | null = null;
  private edgePosAttr:   THREE.BufferAttribute | null = null;
  private buildings:     BuildingAnim[] = [];
  private grown = false;
  private readonly dummy = new THREE.Object3D();

  constructor(
    cx: number,
    cz: number,
    materials: ChunkMaterials,
    buildingDensity: number,
    traceComplexity: number,
    spawnTime: number,
    stationWeight = 0,
  ) {
    this.group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    this.stationWorldPos = this.build(
      materials,
      buildingDensity,
      traceComplexity,
      spawnTime,
      stationWeight,
    );
  }

  private build(
    m: ChunkMaterials,
    buildingDensity: number,
    traceComplexity: number,
    spawnTime: number,
    stationWeight: number,
  ): THREE.Vector3 | null {
    const grid  = runWFC(buildingDensity, traceComplexity, stationWeight);
    const halfW = (CHUNK_GRID * CELL) / 2;

    // ── Station: enforce exactly one per chunk ─────────────────────────────
    // When this chunk is allowed to host a station, keep a single STATION
    // cell (force-placing one if the WFC produced none) and clear any extras.
    let stationWorldPos: THREE.Vector3 | null = null;
    if (stationWeight > 0) {
      const stationCells: Array<[number, number]> = [];
      for (let row = 0; row < CHUNK_GRID; row++) {
        for (let col = 0; col < CHUNK_GRID; col++) {
          if (grid[row][col] === STATION) stationCells.push([row, col]);
        }
      }

      let chosen = stationCells[0];
      if (!chosen) {
        // WFC happened to skip it — force one near the chunk centre.
        const mid = Math.floor(CHUNK_GRID / 2);
        grid[mid][mid] = STATION;
        chosen = [mid, mid];
      } else {
        // Drop the extras so the station stays unique within the chunk.
        for (let i = 1; i < stationCells.length; i++) {
          const [r, c] = stationCells[i];
          grid[r][c] = EMPTY;
        }
      }

      const [sr, sc] = chosen;
      const lx = sc * CELL - halfW + CELL / 2;
      const lz = sr * CELL - halfW + CELL / 2;
      stationWorldPos = new THREE.Vector3(
        this.group.position.x + lx,
        0,
        this.group.position.z + lz,
      );
    }

    // Collect building definitions
    const buildingData: { lx: number; lz: number; tileId: number }[] = [];
    for (let row = 0; row < CHUNK_GRID; row++) {
      for (let col = 0; col < CHUNK_GRID; col++) {
        const tileId = grid[row][col];
        if (TILES[tileId].isBuilding) {
          buildingData.push({
            lx: col * CELL - halfW + CELL / 2,
            lz: row * CELL - halfW + CELL / 2,
            tileId,
          });
        }
      }
    }

    if (buildingData.length > 0) {
      // ── Bodies: InstancedMesh (semi-transparent dark) ──────────────────
      this.buildingMesh = new THREE.InstancedMesh(
        BUILDING_GEO,
        m.building,
        buildingData.length,
      );
      this.buildingMesh.frustumCulled = false;

      buildingData.forEach(({ lx, lz, tileId }, i) => {
        let h: number, wx: number, wz: number;
        switch (tileId) {
          case BUILDING_TALL:
            h = 8 + Math.random() * 16; wx = CELL * 0.5; wz = CELL * 0.5; break;
          case BUILDING_WIDE:
            h = 3 + Math.random() * 6;  wx = CELL * 0.8; wz = CELL * 0.8; break;
          default:
            h = 3 + Math.random() * 8;
            wx = CELL * 0.4 + Math.random() * CELL * 0.2;
            wz = CELL * 0.4 + Math.random() * CELL * 0.2;
        }
        this.buildings.push({ idx: i, lx, lz, targetHeight: h, wx, wz, birthTime: spawnTime });

        // Start invisible — grows in update()
        this.dummy.position.set(lx, 0, lz);
        this.dummy.scale.set(wx, 0.001, wz);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.buildingMesh!.setMatrixAt(i, this.dummy.matrix);
      });
      this.buildingMesh.instanceMatrix.needsUpdate = true;
      this.group.add(this.buildingMesh);

      // ── Edges: merged dynamic LineSegments (neon wireframe) ────────────
      const edgeArr = new Float32Array(buildingData.length * FLOATS_PER_BUILDING_EDGE);
      // Initially all zero (height 0) — filled properly in first update()
      this.edgePosArr  = edgeArr;
      const attr = new THREE.BufferAttribute(edgeArr, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      this.edgePosAttr = attr;

      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute("position", attr);
      this.group.add(new THREE.LineSegments(edgeGeo, m.buildingEdge));
    }

    // ── Traces: flat ribbon meshes + pad discs ─────────────────────────
    const { traceVerts, padVerts, gridPositions } = buildTraceGeometry(grid);

    if (traceVerts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(traceVerts, 3));
      this.group.add(new THREE.Mesh(geo, m.traceMesh));
    }
    if (padVerts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(padVerts, 3));
      this.group.add(new THREE.Mesh(geo, m.traceMesh));
    }
    if (gridPositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(gridPositions, 3));
      this.group.add(new THREE.LineSegments(geo, m.gridLine));
    }

    return stationWorldPos;
  }

  update(elapsed: number): void {
    if (this.grown || this.buildings.length === 0) return;

    let allDone = true;
    for (const b of this.buildings) {
      const t     = Math.min((elapsed - b.birthTime) / GROWTH_DURATION, 1.0);
      const eased = 1.0 - (1.0 - t) ** 3; // ease-out cubic
      if (t < 1.0) allDone = false;
      const h = Math.max(0.001, eased * b.targetHeight);

      // Animate body
      if (this.buildingMesh) {
        this.dummy.position.set(b.lx, 0, b.lz);
        this.dummy.scale.set(b.wx, h, b.wz);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.buildingMesh.setMatrixAt(b.idx, this.dummy.matrix);
      }

      // Animate neon edges (same height as body)
      if (this.edgePosArr) {
        fillBoxEdges(this.edgePosArr, b.idx * FLOATS_PER_BUILDING_EDGE, b.lx, b.lz, b.wx, b.wz, h);
      }
    }

    if (this.buildingMesh) this.buildingMesh.instanceMatrix.needsUpdate = true;
    if (this.edgePosAttr) this.edgePosAttr.needsUpdate = true;

    if (allDone) this.grown = true;
  }

  dispose(): void {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh) {
        child.geometry.dispose();
      } else if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
      }
    });
    this.group.clear();
    this.buildings  = [];
    this.edgePosArr  = null;
    this.edgePosAttr = null;
    this.grown = false;
  }
}

// ── ChunkManager ──────────────────────────────────────────────────────────

export interface ChunkManagerSettings {
  buildingDensity: number;
  traceComplexity: number;
  neonColor: string;
}

export class ChunkManager {
  private readonly scene:    THREE.Scene;
  private materials:         ChunkMaterials;
  private settings:          ChunkManagerSettings;
  private activeChunks       = new Map<string, Circuit3Chunk>();
  private lastPlayerCX       = Infinity;
  private lastPlayerCZ       = Infinity;
  /** Called once per newly generated chunk. Suppressed during rebuilds. */
  private onChunkGenerated?: () => void;
  /**
   * Skip the generation callback while (re)populating chunks that weren't
   * "flown" to — the initial spawn ring and rebuild repopulation. Starts true
   * so the chunks present at spawn don't pre-satisfy the level threshold.
   */
  private suppressChunkCount = true;
  /** Drives unique per-level station spawning. */
  private stationPolicy?: StationSpawnPolicy;

  constructor(
    scene: THREE.Scene,
    settings: ChunkManagerSettings,
    onChunkGenerated?: () => void,
    stationPolicy?: StationSpawnPolicy,
  ) {
    this.scene    = scene;
    this.settings = { ...settings };
    this.materials = createChunkMaterials(new THREE.Color(settings.neonColor));
    this.onChunkGenerated = onChunkGenerated;
    this.stationPolicy = stationPolicy;
  }

  update(playerPos: THREE.Vector3, elapsed: number): void {
    const playerCX = Math.floor(playerPos.x / CHUNK_SIZE + 0.5);
    const playerCZ = Math.floor(playerPos.z / CHUNK_SIZE + 0.5);

    // Only recalculate active set when the player crosses a chunk boundary
    if (playerCX !== this.lastPlayerCX || playerCZ !== this.lastPlayerCZ) {
      this.lastPlayerCX = playerCX;
      this.lastPlayerCZ = playerCZ;
      this.reconcileChunks(playerCX, playerCZ, elapsed);
    }

    // Always animate building growth
    for (const chunk of this.activeChunks.values()) {
      chunk.update(elapsed);
    }
  }

  private reconcileChunks(pcx: number, pcz: number, elapsed: number): void {
    const desired = new Set<string>();
    for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
      for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
        desired.add(`${pcx + dx},${pcz + dz}`);
      }
    }

    // Remove out-of-range chunks
    for (const [key, chunk] of this.activeChunks) {
      if (!desired.has(key)) {
        this.scene.remove(chunk.group);
        chunk.dispose();
        this.activeChunks.delete(key);
        const [cx, cz] = key.split(",").map(Number);
        this.stationPolicy?.onChunkUnloaded(cx, cz);
      }
    }

    // Spawn new chunks
    for (const key of desired) {
      if (!this.activeChunks.has(key)) {
        const [cx, cz] = key.split(",").map(Number);
        const stationWeight = this.stationPolicy?.stationWeightFor(cx, cz, pcx, pcz) ?? 0;
        const chunk = new Circuit3Chunk(
          cx,
          cz,
          this.materials,
          this.settings.buildingDensity,
          this.settings.traceComplexity,
          elapsed,
          stationWeight,
        );
        this.scene.add(chunk.group);
        this.activeChunks.set(key, chunk);
        // Report a placed station before the next chunk is built, so the
        // policy can flip its spawn flag and keep the station unique even
        // across chunks created in the same batch.
        if (chunk.stationWorldPos) {
          this.stationPolicy?.reportStationPlaced(chunk.stationWorldPos, cx, cz);
        }
        // Count genuinely-explored chunks only — repopulation after a
        // rebuild regenerates the same positions and must not inflate the
        // level-progression counter.
        if (!this.suppressChunkCount) this.onChunkGenerated?.();
      }
    }

    // First reconcile after a rebuild is done — resume counting.
    this.suppressChunkCount = false;
  }

  /** Call when settings change — rebuilds all chunks with new parameters */
  rebuild(newSettings: Partial<ChunkManagerSettings>, elapsed: number): void {
    Object.assign(this.settings, newSettings);

    if (newSettings.neonColor) {
      const color = new THREE.Color(newSettings.neonColor);
      this.materials.traceMesh.color.copy(color);
      this.materials.gridLine.color.copy(color);
      this.materials.buildingEdge.color.copy(color);
    }

    // Force full chunk regen
    for (const [key, chunk] of this.activeChunks) {
      this.scene.remove(chunk.group);
      chunk.dispose();
      this.activeChunks.delete(key);
    }
    this.lastPlayerCX = Infinity; // forces reconcileChunks on next update
    // The forced reconcile re-spawns the same chunk positions — don't let
    // that repopulation count toward level progression.
    this.suppressChunkCount = true;
    void elapsed;
  }

  updateNeonColor(color: THREE.Color): void {
    this.materials.traceMesh.color.copy(color);
    this.materials.gridLine.color.copy(color);
    this.materials.buildingEdge.color.copy(color);
  }

  updateBuildingOpacity(opacity: number): void {
    this.materials.building.opacity = opacity;
  }

  dispose(): void {
    for (const chunk of this.activeChunks.values()) {
      this.scene.remove(chunk.group);
      chunk.dispose();
    }
    this.activeChunks.clear();
    this.materials.dispose();
  }
}
