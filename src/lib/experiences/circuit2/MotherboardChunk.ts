import * as THREE from "three";
import { WFCCircuitGenerator, getTileById } from "./WFCCircuitGenerator";

export interface MotherboardMaterials {
  board: THREE.Material;
  trace: THREE.Material;
}

// 8-Wege-Richtungen (N, NE, E, SE, S, SW, W, NW)
const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];

export class MotherboardChunk {
  readonly group = new THREE.Group();
  private readonly size: number;
  private readonly tileSize: number;
  private readonly gx: number;
  private readonly gz: number;

  // Basis-Geometrien exakt auf 1x1x1 skaliert für perfektes Scaling im InstancedMesh
  private static readonly GEO = {
    segment: new THREE.BoxGeometry(1, 1, 1),
    node: new THREE.CylinderGeometry(1, 1, 1, 8),
  };

  private traceMesh: THREE.InstancedMesh | null = null;
  private nodeMesh: THREE.InstancedMesh | null = null;

  constructor(
    gx: number,
    gz: number,
    size: number,
    tileSize: number,
    materials: MotherboardMaterials,
  ) {
    this.size = size;
    this.tileSize = tileSize;
    this.gx = gx;
    this.gz = gz;

    // Position des Chunks in der Welt
    this.group.position.set(gx * size * tileSize, 0, gz * size * tileSize);

    this.build(materials);
  }

  private build(m: MotherboardMaterials) {
    const generator = new WFCCircuitGenerator(this.size);
    const grid = generator.generate();

    // 1. Dunkle Basis-Platte (Cyberpunk-Boden)
    const boardGeo = new THREE.BoxGeometry(
      this.size * this.tileSize,
      0.5,
      this.size * this.tileSize,
    );
    const board = new THREE.Mesh(boardGeo, m.board);
    board.position.y = -0.25;
    this.group.add(board);

    // 2. Central Hub Landmark (Nur im Chunk 0,0)
    if (this.gx === 0 && this.gz === 0) {
      this.addCentralHub(m);
    }

    // --- In der build() Methode von MotherboardChunk.ts ---
    const segmentMatrices: THREE.Matrix4[] = [];
    const segmentColors: THREE.Color[] = []; // NEU: Speichert die Farbe pro Segment
    const nodeMatrices: THREE.Matrix4[] = [];
    const nodeColors: THREE.Color[] = []; // NEU: Speichert die Farbe pro Node
    const dummy = new THREE.Object3D();

    const traceWidth = 0.04;
    const traceHeight = 0.05;
    const busSpacing = 0.4;
    const numParallelLines = 3;
    const halfCell = this.tileSize / 2;

    const colorGreen = new THREE.Color(0x00ff33);
    const colorBlue = new THREE.Color(0x0066ff);

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const tileId = grid[y * this.size + x];
        if (tileId === -1 || tileId === 0) continue;

        const tile = getTileById(tileId);
        if (!tile) continue;

        const lx = (x - this.size / 2 + 0.5) * this.tileSize;
        const lz = (y - this.size / 2 + 0.5) * this.tileSize;

        // Hash-basierte Farbwahl (wie in deinem alten Code)
        const isBlue =
          (Math.sin(lx * 12.9898 + lz * 78.233) * 43758.5453) % 2 > 1;
        const tileColor = isBlue ? colorBlue : colorGreen;

        if (
          this.gx === 0 &&
          this.gz === 0 &&
          Math.abs(x - this.size / 2) < 4 &&
          Math.abs(y - this.size / 2) < 4
        ) {
          continue;
        }

        let connectionCount = 0;

        for (let d = 0; d < 8; d++) {
          if (tile.edges[d] === 1) {
            connectionCount++;
            const tx = DX[d] * halfCell;
            const tz = DY[d] * halfCell;
            const len = Math.sqrt(tx * tx + tz * tz);

            const dirX = tx / len;
            const dirZ = tz / len;
            const perpX = -dirZ;
            const perpZ = dirX;
            const rotationY = Math.atan2(DX[d], DY[d]);

            for (let b = 0; b < numParallelLines; b++) {
              const offset = (b - (numParallelLines - 1) / 2) * busSpacing;

              dummy.position.set(
                lx + tx / 2 + perpX * offset,
                traceHeight / 2,
                lz + tz / 2 + perpZ * offset,
              );
              dummy.rotation.set(0, rotationY, 0);
              dummy.scale.set(traceWidth, traceHeight, len * 1.1);
              dummy.updateMatrix();

              segmentMatrices.push(dummy.matrix.clone());
              segmentColors.push(tileColor); // Farbe merken
            }
          }
        }

        if (tile.hasVia) {
          dummy.position.set(lx, 0.4, lz);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(0.15, 0.8, 0.15);
          dummy.updateMatrix();

          nodeMatrices.push(dummy.matrix.clone());
          nodeColors.push(tileColor); // Farbe merken
        }
      }
    }

    // Instanced Meshes erstellen UND Farben anwenden
    if (segmentMatrices.length > 0) {
      this.traceMesh = new THREE.InstancedMesh(
        MotherboardChunk.GEO.segment,
        m.trace,
        segmentMatrices.length,
      );
      for (let i = 0; i < segmentMatrices.length; i++) {
        this.traceMesh.setMatrixAt(i, segmentMatrices[i]);
        this.traceMesh.setColorAt(i, segmentColors[i]); // Farbe setzen!
      }
      if (this.traceMesh.instanceColor)
        this.traceMesh.instanceColor.needsUpdate = true;
      this.group.add(this.traceMesh);
    }

    if (nodeMatrices.length > 0) {
      this.nodeMesh = new THREE.InstancedMesh(
        MotherboardChunk.GEO.node,
        m.trace,
        nodeMatrices.length,
      );
      for (let i = 0; i < nodeMatrices.length; i++) {
        this.nodeMesh.setMatrixAt(i, nodeMatrices[i]);
        this.nodeMesh.setColorAt(i, nodeColors[i]); // Farbe setzen!
      }
      if (this.nodeMesh.instanceColor)
        this.nodeMesh.instanceColor.needsUpdate = true;
      this.group.add(this.nodeMesh);
    }
  }

  private addCentralHub(m: MotherboardMaterials) {
    const cpuGeo = new THREE.BoxGeometry(10, 2, 10);
    const cpu = new THREE.Mesh(cpuGeo, m.board);
    cpu.position.y = 1;
    this.group.add(cpu);

    const glowGeo = new THREE.BoxGeometry(8, 0.5, 8);
    const glow = new THREE.Mesh(glowGeo, m.trace);
    glow.position.y = 2.2;
    this.group.add(glow);

    const gridGeo = new THREE.PlaneGeometry(7.5, 7.5);
    const gridMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      wireframe: true,
    });
    const grid = new THREE.Mesh(gridGeo, gridMat);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = 2.46;
    this.group.add(grid);
  }

  dispose() {
    if (this.traceMesh) this.traceMesh.dispose();
    if (this.nodeMesh) this.nodeMesh.dispose();
    this.group.clear();
  }
}
