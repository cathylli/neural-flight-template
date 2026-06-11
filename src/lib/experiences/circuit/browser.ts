import * as THREE from "three";

export interface GridConfig {
  gridSize?: number;
  spacing?: number;
  dotRadius?: number;
  scatterPower?: number;
  dispersionZ?: number;
  blobRadius?: number;
  explodeEase?: number;
  color?: number | string | THREE.Color;
}

interface SeedData {
  distFactor: number;
  zDir: number;
  rotSpeed: number;
  startOffset: THREE.Vector3;
}

export class GridExplosionLogic {
  public params: Required<GridConfig>;

  private targetPositions: THREE.Vector3[] = [];
  private randomSeeds: SeedData[] = [];
  private instancedMesh: THREE.InstancedMesh | null = null;
  private cubeMesh: THREE.Mesh | null = null;
  private cubeBaseColor: THREE.Color;
  private elapsed: number = 0;
  private dummy: THREE.Object3D;

  /**
   * @param config - Die Konfigurationseinstellungen für das Grid
   */
  constructor(config: GridConfig = {}) {
    // Standardparameter mit den übergebenen Werten zusammenführen
    this.params = Object.assign(
      {
        gridSize: 50,
        spacing: 1.2,
        dotRadius: 0.1,
        scatterPower: 80,
        dispersionZ: 35,
        blobRadius: 18,
        explodeEase: 2,
        color: 0xffffff,
      },
      config,
    ) as Required<GridConfig>;

    this.cubeBaseColor = new THREE.Color(this.params.color as any);
    this.dummy = new THREE.Object3D();

    // Initialisiert die Geometrie und Vektoren
    this.createGrid();
  }

  /**
   * Generiert die InstancedMesh-Instanz sowie alle Richtungs- und Chaos-Vektoren.
   */
  public createGrid(): void {
    // Falls bereits Geometrien existieren, Ressourcen freigeben
    if (this.instancedMesh) {
      this.instancedMesh.geometry.dispose();
      if (Array.isArray(this.instancedMesh.material)) {
        this.instancedMesh.material.forEach((mat) => mat.dispose());
      } else {
        this.instancedMesh.material.dispose();
      }
    }
    if (this.cubeMesh) {
      this.cubeMesh.geometry.dispose();
      if (Array.isArray(this.cubeMesh.material)) {
        this.cubeMesh.material.forEach((mat) => mat.dispose());
      } else {
        this.cubeMesh.material.dispose();
      }
      this.cubeMesh = null;
    }

    const count = this.params.gridSize * this.params.gridSize;

    // Flache Kreise als Partikel
    const geometry = new THREE.CircleGeometry(this.params.dotRadius, 32);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.params.color as any),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
    });

    this.instancedMesh = new THREE.InstancedMesh(geometry, material, count);
    this.instancedMesh.visible = false;

    // Solid cube mesh — erscheint als ganzer Würfel bevor die Explosion losgeht
    const cubeSize = this.params.blobRadius * 2;
    const cubeGeo = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
    const cubeMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.params.color as any),
    });
    this.cubeMesh = new THREE.Mesh(cubeGeo, cubeMat);

    this.targetPositions = [];
    this.randomSeeds = [];

    // Zentrierungsoffset berechnen, damit das Grid um den Ursprung (0,0,0) liegt
    const offset = ((this.params.gridSize - 1) * this.params.spacing) / 2;

    for (let x = 0; x < this.params.gridSize; x++) {
      for (let y = 0; y < this.params.gridSize; y++) {
        // Perfekte 2D-Rasterposition ermitteln
        const posX = x * this.params.spacing - offset;
        const posY = y * this.params.spacing - offset;

        this.targetPositions.push(new THREE.Vector3(posX, posY, 0));

        // Zufällige Startposition innerhalb eines Würfels — bildet den
        // kompakten kubischen Block, bevor die Explosion beginnt.
        const half = this.params.blobRadius;
        const startOffset = new THREE.Vector3(
          (Math.random() - 0.5) * 2 * half,
          (Math.random() - 0.5) * 2 * half,
          (Math.random() - 0.5) * 2 * half,
        );

        // Einzigartige Triebkräfte für den "Flug" generieren
        this.randomSeeds.push({
          distFactor: 0.7 + Math.random() * 0.6, // Wie weit fliegt der Punkt?
          zDir: (Math.random() - 0.5) * 2, // Fliegt er nach vorne oder hinten?
          rotSpeed: (Math.random() - 0.5) * 5, // Wie schnell rotiert er im Flug?
          startOffset,
        });
      }
    }

    // Initial gebündelt am Zentrum (progress = 0) — Partikel starten zusammen
    this.update(0);
  }

  /**
   * Berechnet die Positionen und Rotationen für alle Partikel neu.
   * @param progress - Wert zwischen 0 (Partikel gebündelt am Zentrum) und 1 (vollständig explodiert)
   */
  public update(progress: number, delta: number = 0): void {
    if (!this.instancedMesh) return;

    const p = THREE.MathUtils.clamp(progress, 0, 1);
    this.elapsed += delta;

    // Cube sichtbar im Ruhezustand, Partikel während der Explosion
    if (this.cubeMesh) {
      this.cubeMesh.visible = p === 0;
      if (p === 0) {
        // Pulsieren zwischen Basis-Farbe und hellerem Farbton
        const pulse = Math.sin(this.elapsed * 3) * 0.5 + 0.5;
        const mat = this.cubeMesh.material as THREE.MeshBasicMaterial;
        mat.color.copy(this.cubeBaseColor).lerp(new THREE.Color(0xffffff), pulse * 0.5);
      }
    }
    this.instancedMesh.visible = p > 0;

    const count = this.targetPositions.length;

    // Sanfte Easing-Kurve: explodeEase > 1 = Ease-Out (langsam am Ende),
    // < 1 = Ease-In (schnell am Ende), = 1 = linear.
    // Höherer Wert = die Partikel brauchen länger, bis sie "losfliegen".
    const explode = Math.pow(p, this.params.explodeEase);

    for (let i = 0; i < count; i++) {
      const target = this.targetPositions[i];
      const seed = this.randomSeeds[i];

      // Explosionsrichtung: vom Blob-Zentrum (0,0,0) radial nach außen
      const dir = target.clone().normalize();

      // Falls ein Punkt exakt im Zentrum sitzt, bekommt er eine Zufallsrichtung
      if (dir.length() === 0) {
        dir.set(Math.random() - 0.5, Math.random() - 0.5, 0).normalize();
      }

      // Endpunkt der Explosion (progress = 1)
      const scatterDist = this.params.scatterPower * seed.distFactor;
      const explodedX = target.x + dir.x * scatterDist;
      const explodedY = target.y + dir.y * scatterDist;
      const explodedZ = seed.zDir * this.params.dispersionZ * seed.distFactor;

      // Startposition = kompakter Blob (zufälliger Punkt in der Kugel),
      // Endposition = explodierter Endpunkt. Mit steigendem explode
      // bewegen sich die Partikel vom Blob zur Streuung.
      const currentX = THREE.MathUtils.lerp(
        seed.startOffset.x,
        explodedX,
        explode,
      );
      const currentY = THREE.MathUtils.lerp(
        seed.startOffset.y,
        explodedY,
        explode,
      );
      const currentZ = THREE.MathUtils.lerp(
        seed.startOffset.z,
        explodedZ,
        explode,
      );

      this.dummy.position.set(currentX, currentY, currentZ);

      // Dynamische Rotation während des Fluges: rotiert nur, solange
      // die Partikel noch nicht vollständig explodiert sind.
      if (explode < 0.99) {
        const angle = (1 - explode) * seed.rotSpeed;
        this.dummy.rotation.set(angle, angle * 0.5, 0);
      } else {
        this.dummy.rotation.set(0, 0, 0);
      }

      // Matrix des Partikels aktualisieren
      this.dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, this.dummy.matrix);
    }

    // Three.js signalisieren, dass sich die Instanzen verändert haben
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Gibt das InstancedMesh (Partikel) zurück.
   */
  public getMesh(): THREE.InstancedMesh | null {
    return this.instancedMesh;
  }

  /**
   * Gibt den soliden Würfel zurück.
   */
  public getCubeMesh(): THREE.Mesh | null {
    return this.cubeMesh;
  }
}
