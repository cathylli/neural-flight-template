import * as THREE from "three";
import { loadGLTF } from "$lib/three/loader";

/**
 * DirectionArrows — Ein 3D-Pfeil, der auf ein beliebiges Three.js-Objekt
 * zeigen kann. Die Geometrie wird aus einem glTF-Asset geladen, die
 * Pfeilspitze entlang der lokalen −Z-Achse ausgerichtet, sodass
 * `Object3D.lookAt()` direkt in Richtung Zielobjekt rotiert.
 *
 * Verwendung:
 *   const arrows = await DirectionArrows.create();
 *   scene.add(arrows.group);
 *   arrows.pointAt(someObject);
 */

// Pfad zum glTF-Pfeilmodell (Sketchfab "ARROW 3D" von c0ntra5t, CC-BY-4.0).
const DEFAULT_ARROW_URL = "/experiences/circuit/Assets/Arrow/scene.gltf";

// Das Sketchfab-Asset ist ~10 Einheiten hoch — wir skalieren es herunter,
// damit der Pfeil eine ähnliche Größe wie der vorherige prozedurale Pfeil hat.
const ARROW_SCALE = 1;

export class DirectionArrows {
  /** Wird an die Szene gehängt. */
  public readonly group: THREE.Group;

  /** Innerer Container — wird durch `pointAt()` rotiert. */
  private readonly arrow: THREE.Group;

  /** Wiederverwendeter Vektor, vermeidet pro Frame ein neues `Vector3`. */
  private readonly tmpVec: THREE.Vector3 = new THREE.Vector3();

  /** Alle Meshes des geladenen Modells, für Color-Updates und Disposal. */
  private readonly meshes: THREE.Mesh[] = [];

  /** Initialfarbe — wird beim Erzeugen der Materialien verwendet. */
  private readonly baseColor: THREE.Color;

  private constructor(baseColor: THREE.Color) {
    this.baseColor = baseColor.clone();

    this.arrow = new THREE.Group();
    this.group = new THREE.Group();
    this.group.add(this.arrow);
  }

  /**
   * Lädt das glTF-Pfeilmodell und gibt eine einsatzbereite Instanz zurück.
   *
   * @param color - Anfangsfarbe (Hex, CSS-String oder `THREE.Color`)
   * @param url - Optionaler Override für den Pfad zum glTF-Asset
   */
  public static async create(
    color: THREE.ColorRepresentation = 0x00ff00,
    url: string = DEFAULT_ARROW_URL,
  ): Promise<DirectionArrows> {
    const arrows = new DirectionArrows(new THREE.Color(color));
    await arrows.load(url);
    return arrows;
  }

  private async load(url: string): Promise<void> {
    const gltf = await loadGLTF(url);
    const model = gltf.scene;

    model.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        // PBR-Material durch ein unlit Material ersetzen, damit der Pfeil
        // unabhängig von der Szenenbeleuchtung immer sichtbar bleibt
        // (gleiches Verhalten wie der vorherige prozedurale Pfeil).
        // `side: DoubleSide` respektiert die `doubleSided: true`-Eigenschaft
        // des glTF-Materials.
        obj.material = new THREE.MeshBasicMaterial({
          color: this.baseColor.clone(),
          side: THREE.DoubleSide,
        });
        this.meshes.push(obj);
      }
    });

    // Das glTF-Mesh zeigt nach unten. Three.js' `lookAt()` richtet die lokale
    // −Z-Achse auf das Ziel aus — also das Modell um 90° um Z drehen, damit
    // die Pfeilspitze in −Z zeigt.
    model.scale.setScalar(ARROW_SCALE);
    model.rotation.y = Math.PI / 2;
    model.rotation.x = Math.PI / 2;
    model.rotation.z = Math.PI;

    this.arrow.add(model);
  }

  /**
   * Richtet den Pfeil so aus, dass er auf das übergebene Objekt zeigt.
   * Funktioniert mit jedem Three.js-Objekt (Mesh, Group, Light, Camera, …),
   * da `getWorldPosition()` Teil der `Object3D`-Basisklasse ist.
   *
   * @param target - Das Ziel, auf das der Pfeil zeigen soll
   */
  public pointAt(target: THREE.Object3D): void {
    target.getWorldPosition(this.tmpVec);
    this.arrow.lookAt(this.tmpVec);
  }

  /** Setzt die Farbe von Schaft und Spitze. */
  public setColor(color: THREE.ColorRepresentation): void {
    const c = new THREE.Color(color);
    for (const mesh of this.meshes) {
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.copy(c);
    }
  }

  /** Gibt die für die GPU reservierten Ressourcen frei. */
  public dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material.dispose();
      }
    }
    this.meshes.length = 0;
  }
}
