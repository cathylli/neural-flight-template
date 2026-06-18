import * as THREE from "three"; // Nur falls du später THREE-Math brauchst, ansonsten optional hier

// ── 1. RICHTUNGS-DEFINITONEN (8-WEGE-SYSTEM) ──
// Index-Mapping für die 8 Richtungen einer Kachel:
// 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW
const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];
const OPPOSITE = [4, 5, 6, 7, 0, 1, 2, 3]; // Jeweils gegenüberliegende Richtung

export interface BaseTile {
  name: string;
  edges: number[]; // 8 Einträge: 0 = Leer, 1 = Leiterbahn-Anschluss
  weight: number; // Relative Häufigkeit der Kachel
  hasVia: boolean; // Erzeugt einen Lötpunkt/Durchkontaktierung in der Mitte
}

export interface Tile {
  id: number;
  baseName: string;
  edges: number[];
  weight: number;
  rotationSteps: number; // Wie oft um 45 Grad rotiert (0 bis 7)
  hasVia: boolean;
}

// ── 2. BASIS-BAUSTEINE FÜR EIN MOTHERBOARD ──
const BASE_TILES: BaseTile[] = [
  // Gewicht von Blank ist hoch (300), was viel schwarzen Freiraum garantiert
  {
    name: "Blank",
    edges: [0, 0, 0, 0, 0, 0, 0, 0],
    weight: 300,
    hasVia: false,
  },
  {
    name: "Straight_O",
    edges: [1, 0, 0, 0, 1, 0, 0, 0],
    weight: 20,
    hasVia: false,
  }, // Gerade (N-S)
  {
    name: "Straight_D",
    edges: [0, 1, 0, 0, 0, 1, 0, 0],
    weight: 15,
    hasVia: false,
  }, // Gerade (Diagonal NE-SW)
  {
    name: "Bend_45",
    edges: [1, 1, 0, 0, 0, 0, 0, 0],
    weight: 5,
    hasVia: false,
  }, // 45°-Knick
  {
    name: "Corner_90",
    edges: [1, 0, 1, 0, 0, 0, 0, 0],
    weight: 3,
    hasVia: false,
  }, // 90°-Ecke
  {
    name: "Via_Term",
    edges: [1, 0, 0, 0, 0, 0, 0, 0],
    weight: 2,
    hasVia: true,
  }, // Endpunkt (Lötpunkt)
  {
    name: "T_Junction",
    edges: [1, 0, 1, 0, 0, 0, 1, 0],
    weight: 0.5,
    hasVia: false,
  }, // T-Kreuzung (sehr selten)
];

// Generiert alle sinnvollen Rotationsstufen (jeweils 45 Grad im Uhrzeigersinn)
function generateTileSet(): Tile[] {
  const tiles: Tile[] = [];
  let idCounter = 0;
  const seenSignatures = new Set<string>();

  for (const base of BASE_TILES) {
    for (let r = 0; r < 8; r++) {
      // Rotieren der Kanten-Anschlüsse im 8er-Array
      const rotatedEdges = new Array(8).fill(0);
      for (let i = 0; i < 8; i++) {
        rotatedEdges[i] = base.edges[(i - r + 8) % 8];
      }

      // Duplikate durch Symmetrie vermeiden (z.B. Blank sieht in jeder Rotation gleich aus)
      const sig = rotatedEdges.join(",");
      if (!seenSignatures.has(sig)) {
        seenSignatures.add(sig);
        tiles.push({
          id: idCounter++,
          baseName: base.name,
          edges: rotatedEdges,
          weight: base.weight,
          rotationSteps: r,
          hasVia: base.hasVia,
        });
      }
    }
  }
  return tiles;
}

export const ALL_TILES = generateTileSet();

export function getTileById(id: number): Tile | undefined {
  return ALL_TILES.find((t) => t.id === id);
}

// ── 3. WFC ALGORITHMUS KERN (8-RICHTUNGEN) ──
export class WFCCircuitGenerator {
  private size: number;
  private grid: number[][]; // Gültige Tile-IDs pro Zelle
  private collapsed: number[]; // Finales kollabiertes Gitter
  private blankWeight: number; // Dynamisches Gewicht für Leerraum

  // density: 0.0 (sehr leer) bis 1.0 (extrem voll)
  constructor(size: number, density: number = 0.5) {
    this.size = size;
    this.grid = [];
    this.collapsed = new Array(size * size).fill(-1);

    // Dichte-Berechnung: Je niedriger die Dichte, desto höher das Gewicht der Blank-Kachel.
    // Bei density 1.0 -> blankWeight ca. 10
    // Bei density 0.1 -> blankWeight ca. 800
    const safeDensity = Math.max(0, Math.min(1, density));
    this.blankWeight = 10 + (1.0 - safeDensity) * 800;

    const allIds = ALL_TILES.map((t) => t.id);
    for (let i = 0; i < size * size; i++) {
      this.grid.push([...allIds]);
    }
  }

  public generate(): number[] {
    let uncollapsedCount = this.size * this.size;

    while (uncollapsedCount > 0) {
      // 1. Zelle mit der niedrigsten Entropie (wenigste verbleibende Optionen) finden
      let minEntropy = Infinity;
      let minIndex = -1;

      for (let i = 0; i < this.grid.length; i++) {
        if (this.collapsed[i] !== -1) continue;
        const optionsCount = this.grid[i].length;
        if (optionsCount < minEntropy) {
          minEntropy = optionsCount;
          minIndex = i;
        }
      }

      if (minIndex === -1) break; // Alle Zellen abgearbeitet

      // Fehlerfall abfangen (WFC ist in Widerspruch gelaufen)
      if (this.grid[minIndex].length === 0) {
        this.collapsed[minIndex] = 0; // Rückfalloption: Blank Tile (ID 0)
        this.grid[minIndex] = [0];
        uncollapsedCount--;
        continue;
      }

      // 2. Zelle kollabieren lassen (Auswahl nach dynamischer Gewichtung)
      const selectedId = this.pickTileWithWeight(this.grid[minIndex]);
      this.collapsed[minIndex] = selectedId;
      this.grid[minIndex] = [selectedId];
      uncollapsedCount--;

      // 3. Einschränkungen in alle 8 Richtungen propagieren
      this.propagate(minIndex);
    }

    return this.collapsed;
  }

  private pickTileWithWeight(options: number[]): number {
    let totalWeight = 0;
    const available = options.map((id) => ALL_TILES.find((t) => t.id === id)!);

    // Gesamte Gewichte berechnen (mit dynamischem Blank-Gewicht)
    available.forEach((t) => {
      totalWeight += t.baseName === "Blank" ? this.blankWeight : t.weight;
    });

    let rand = Math.random() * totalWeight;
    for (const tile of available) {
      const currentWeight =
        tile.baseName === "Blank" ? this.blankWeight : tile.weight;
      if (rand < currentWeight) return tile.id;
      rand -= currentWeight;
    }
    return options[0];
  }

  private propagate(startIndex: number) {
    const stack = [startIndex];

    while (stack.length > 0) {
      const currIdx = stack.pop()!;
      const currOptions = this.grid[currIdx];

      const cx = currIdx % this.size;
      const cy = Math.floor(currIdx / this.size);

      // Iteration über alle 8 Nachbarn (Orthogonal + Diagonal)
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];

        // Grid-Grenzen prüfen
        if (nx < 0 || nx >= this.size || ny < 0 || ny >= this.size) continue;

        const nIdx = ny * this.size + nx;
        if (this.collapsed[nIdx] !== -1) continue; // Bereits fest definiert

        // Welche Anschlüsse erlaubt die aktuelle Zelle in Richtung 'd'?
        const allowedSockets = new Set<number>();
        for (const optId of currOptions) {
          const tile = ALL_TILES.find((t) => t.id === optId)!;
          allowedSockets.add(tile.edges[d]);
        }

        // Filter Nachbaroptionen: Passt der gegenüberliegende Socket?
        const nOptions = this.grid[nIdx];
        const oppDir = OPPOSITE[d];
        const filtered = nOptions.filter((id) => {
          const neighborTile = ALL_TILES.find((t) => t.id === id)!;
          return allowedSockets.has(neighborTile.edges[oppDir]);
        });

        // Wenn Optionen reduziert wurden, muss der Nachbar weiter propagieren
        if (filtered.length < nOptions.length) {
          this.grid[nIdx] = filtered;
          stack.push(nIdx);
        }
      }
    }
  }
}
