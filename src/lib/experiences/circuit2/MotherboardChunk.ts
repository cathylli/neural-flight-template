import * as THREE from "three";
import { WFCCircuitGenerator, getTileById } from "./WFCCircuitGenerator";

export interface MotherboardMaterials {
  board: THREE.Material;
  trace: THREE.Material;
  building: THREE.Material;
}

interface BuildingData {
  lx: number;
  lz: number;
  targetHeight: number;
  birthTime: number;
  widthX: number;
  widthZ: number;
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
  private readonly traceDensity: number;
  private readonly buildingDensity: number;

  // Basis-Geometrien exakt auf 1x1x1 skaliert für perfektes Scaling im InstancedMesh.
  // Das Building hat den Pivot-Punkt nach unten verschoben, damit Y-Skalierung aus dem Boden wächst.
  private static readonly GEO = {
    segment: new THREE.BoxGeometry(1, 1, 1),
    node: new THREE.CylinderGeometry(1, 1, 1, 8),
    building: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  };

  private traceMesh: THREE.InstancedMesh | null = null;
  private nodeMesh: THREE.InstancedMesh | null = null;
  private buildingMesh: THREE.InstancedMesh | null = null;

  // Animation state für Gebäude
  private buildings: BuildingData[] = [];
  private buildingsFullyGrown = false;
  private readonly GROWTH_DURATION = 1.5; // Sekunden bis voll ausgefahren

  constructor(
    gx: number,
    gz: number,
    size: number,
    tileSize: number,
    materials: MotherboardMaterials,
    traceDensity: number = 0.5,
    buildingDensity: number = 0.4,
  ) {
    this.size = size;
    this.tileSize = tileSize;
    this.gx = gx;
    this.gz = gz;
    this.traceDensity = traceDensity;
    this.buildingDensity = buildingDensity;

    // Position des Chunks in der Welt
    this.group.position.set(gx * size * tileSize, 0, gz * size * tileSize);

    this.build(materials);
  }

  private build(m: MotherboardMaterials) {
    const generator = new WFCCircuitGenerator(this.size, this.traceDensity);
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

    const segmentMatrices: THREE.Matrix4[] = [];
    const segmentColors: THREE.Color[] = [];
    const nodeMatrices: THREE.Matrix4[] = [];
    const nodeColors: THREE.Color[] = [];

    // Zwischenspeicher für Gebäude, bevor wir die Buffer-Arrays anlegen
    const tempBuildings: { lx: number; lz: number; targetHeight: number }[] =
      [];
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
        const tile = getTileById(tileId);

        if (!tile) continue;

        const lx = (x - this.size / 2 + 0.5) * this.tileSize;
        const lz = (y - this.size / 2 + 0.5) * this.tileSize;

        // Freihalten der Mitte für den Central Hub in Chunk 0,0
        if (
          this.gx === 0 &&
          this.gz === 0 &&
          Math.abs(x - this.size / 2) < 4 &&
          Math.abs(y - this.size / 2) < 4
        ) {
          continue;
        }

        const isBlue =
          (Math.sin(lx * 12.9898 + lz * 78.233) * 43758.5453) % 2 > 1;
        const tileColor = isBlue ? colorBlue : colorGreen;

        // 3. WFC Blank Tile Erkennung für Gebäude
        if (tile.baseName === "Blank") {
          if (Math.random() < this.buildingDensity) {
            const targetHeight = 3.0 + Math.random() * 9.0;
            tempBuildings.push({ lx, lz, targetHeight });
          }
          continue; // WFC-Leiterbahnen für diesen Slot überspringen
        }

        // 4. WFC Leiterbahnen (Traces) berechnen
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
              segmentColors.push(tileColor);
            }
          }
        }

        // 5. WFC Lötpunkte (Vias)
        if (tile.hasVia) {
          dummy.position.set(lx, 0.4, lz);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(0.15, 0.8, 0.15);
          dummy.updateMatrix();

          nodeMatrices.push(dummy.matrix.clone());
          nodeColors.push(tileColor);
        }
      }
    }

    // --- INSTANCED MESHES ERSTELLEN ---

    // A. Traces (Leiterbahnen)
    if (segmentMatrices.length > 0) {
      this.traceMesh = new THREE.InstancedMesh(
        MotherboardChunk.GEO.segment,
        m.trace,
        segmentMatrices.length,
      );
      this.traceMesh.frustumCulled = false;
      for (let i = 0; i < segmentMatrices.length; i++) {
        this.traceMesh.setMatrixAt(i, segmentMatrices[i]);
        this.traceMesh.setColorAt(i, segmentColors[i]);
      }
      if (this.traceMesh.instanceColor)
        this.traceMesh.instanceColor.needsUpdate = true;
      this.group.add(this.traceMesh);
    }

    // B. Nodes (Lötpunkte)
    if (nodeMatrices.length > 0) {
      this.nodeMesh = new THREE.InstancedMesh(
        MotherboardChunk.GEO.node,
        m.trace,
        nodeMatrices.length,
      );
      this.nodeMesh.frustumCulled = false;
      for (let i = 0; i < nodeMatrices.length; i++) {
        this.nodeMesh.setMatrixAt(i, nodeMatrices[i]);
        this.nodeMesh.setColorAt(i, nodeColors[i]);
      }
      if (this.nodeMesh.instanceColor)
        this.nodeMesh.instanceColor.needsUpdate = true;
      this.group.add(this.nodeMesh);
    }

    // C. Buildings (CPU-animiert über instanceMatrix Y-Scale)
    if (tempBuildings.length > 0) {
      const currentTime = performance.now() * 0.001;

      this.buildingMesh = new THREE.InstancedMesh(
        MotherboardChunk.GEO.building,
        m.building,
        tempBuildings.length,
      );
      this.buildingMesh.frustumCulled = false;

      tempBuildings.forEach((b, i) => {
        const widthX = this.tileSize * 0.75;
        const widthZ = this.tileSize * 0.75;

        this.buildings.push({
          lx: b.lx,
          lz: b.lz,
          targetHeight: b.targetHeight,
          birthTime: currentTime,
          widthX,
          widthZ,
        });

        // Initial: Höhe 0 (aus dem Boden kommend)
        dummy.position.set(b.lx, 0, b.lz);
        dummy.scale.set(widthX, 0.001, widthZ); // Fast unsichtbar anfangs
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();

        this.buildingMesh!.setMatrixAt(i, dummy.matrix);
      });

      this.buildingMesh.instanceMatrix.needsUpdate = true;
      this.group.add(this.buildingMesh);
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

  /**
   * Aktualisiert die Gebäude-Animation (aus dem Boden fahren).
   * Wird jeden Frame vom MotherboardManager aufgerufen.
   */
  update(timeSec: number): void {
    if (
      !this.buildingMesh ||
      this.buildings.length === 0 ||
      this.buildingsFullyGrown
    ) {
      return;
    }

    const dummy = new THREE.Object3D();
    let allDone = true;

    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      const age = timeSec - b.birthTime;
      // Ease-out quadratic: schneller Start, sanftes Abbremsen
      const t = Math.min(age / this.GROWTH_DURATION, 1.0);
      const eased = 1.0 - (1.0 - t) * (1.0 - t);

      if (t < 1.0) {
        allDone = false;
      }

      const currentHeight = eased * b.targetHeight;

      dummy.position.set(b.lx, 0, b.lz);
      dummy.scale.set(b.widthX, Math.max(0.001, currentHeight), b.widthZ);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();

      this.buildingMesh.setMatrixAt(i, dummy.matrix);
    }

    this.buildingMesh.instanceMatrix.needsUpdate = true;

    if (allDone) {
      this.buildingsFullyGrown = true;
    }
  }

  dispose() {
    if (this.traceMesh) {
      this.traceMesh.dispose();
    }
    if (this.nodeMesh) {
      this.nodeMesh.dispose();
    }
    if (this.buildingMesh) {
      this.buildingMesh.dispose();
    }
    this.buildings = [];
    this.group.clear();
  }
}
