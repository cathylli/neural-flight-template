import * as THREE from "three";
import {
  MotherboardChunk,
  type MotherboardMaterials,
} from "./MotherboardChunk";

export interface MotherboardManagerConfig {
  chunkSize?: number;
  tileSize?: number;
  viewRadius?: number;
}

const DEFAULTS: Required<MotherboardManagerConfig> = {
  chunkSize: 20,
  tileSize: 2,
  viewRadius: 3, // Etwas reduziert für WFC-Performance (9 Chunks total)
};

export class MotherboardManager {
  readonly group = new THREE.Group();
  private readonly active = new Map<string, MotherboardChunk>();
  private readonly materials: MotherboardMaterials;
  private readonly config: Required<MotherboardManagerConfig>;

  constructor(scene: THREE.Scene, config?: MotherboardManagerConfig) {
    this.config = { ...DEFAULTS, ...config };
    scene.add(this.group);

    this.materials = {
      // Tiefdunkle Basisplatte (kaum sichtbar, schluckt Licht)
      board: new THREE.MeshStandardMaterial({
        color: 0x190e7d,
        roughness: 0.9,
        metalness: 0.1,
      }),
      // Cyber-Neon-Leiterbahnen (MeshBasic leuchtet von selbst)
      trace: new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0.0 },
          // Die dunklere Grundfarbe der Platine (Standby-Leitung)
          uBaseColor: { value: new THREE.Color(0x001a05) },
          // Die grelle Farbe des Datenpakets
          uPacketColor: { value: new THREE.Color(0x00ff41) },
        },
        vertexShader: `
                varying float vLocalZ;
                varying float vRandom;

                // Ein kleiner Pseudo-Zufallsgenerator
                float random(vec2 st) {
                    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
                }

                void main() {
                  // DER FIX: Wir nehmen die lokale Z-Koordinate der Geometrie.
                  // Weil wir die Boxen im Chunk gedreht haben, zeigt Z immer exakt ENTLANG der Leiterbahn!
                  vLocalZ = position.z;

                  // Wir nutzen die Weltposition des Leitungs-Anfangs als festen Seed,
                  // damit jede Linie einen einzigartigen Zufallswert bekommt.
                  vec3 instancePos = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                  vRandom = random(instancePos.xz);

                  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
                }
              `,
        fragmentShader: `
                uniform float uTime;
                uniform vec3 uBaseColor;
                uniform vec3 uPacketColor;

                varying float vLocalZ;
                varying float vRandom;

                void main() {
                  // vLocalZ geht von -0.5 bis 0.5. Wir schieben es auf 0.0 bis 1.0
                  float z = vLocalZ + 0.5;

                  // Manche Daten fließen vorwärts, manche rückwärts
                  float direction = (vRandom > 0.5) ? 1.0 : -1.0;

                  // Zufällige Geschwindigkeit für jede Leitung (macht es organischer)
                  float speed = 0.5 + vRandom * 1.5;

                  // Die Berechnung des fließenden Punktes
                  // uTime bewegt ihn. vRandom * 10.0 sorgt dafür, dass nicht alle Pakete gleichzeitig starten.
                  float wave = fract(z * direction - uTime * speed + vRandom * 10.0);

                  // Aus der fließenden Welle formen wir ein kurzes, scharfes Datenpaket (ca. 10% der Länge)
                  float packet = smoothstep(0.95, 0.98, wave) * smoothstep(1.0, 0.98, wave);

                  // Optional: Nicht auf jeder Leitung ist Verkehr. 30% bleiben einfach dunkel.
                  float traffic = step(0.85, vRandom);

                  // Mische die dunkle Grundfarbe mit dem grellen Paket
                  vec3 finalColor = mix(uBaseColor, uPacketColor, packet * traffic);

                  gl_FragColor = vec4(finalColor, 1.0);
                }
              `,
      }),
    };
  }

  update(position: THREE.Vector3): void {
    if (this.materials.trace instanceof THREE.ShaderMaterial) {
      // performance.now() liefert Millisekunden, wir rechnen es in Sekunden um
      this.materials.trace.uniforms.uTime.value = performance.now() * 0.001;
      this.materials.trace.uniforms.uBaseColor.value.set(0x002510);
      this.materials.trace.needsUpdate = true;
    }

    const fullChunkSize = this.config.chunkSize * this.config.tileSize;
    const cx = Math.round(position.x / fullChunkSize);
    const cz = Math.round(position.z / fullChunkSize);

    const needed = new Set<string>();

    for (let dx = -this.config.viewRadius; dx <= this.config.viewRadius; dx++) {
      for (
        let dz = -this.config.viewRadius;
        dz <= this.config.viewRadius;
        dz++
      ) {
        const gx = cx + dx;
        const gz = cz + dz;
        const key = `${gx},${gz}`;
        needed.add(key);

        if (!this.active.has(key)) {
          const chunk = new MotherboardChunk(
            gx,
            gz,
            this.config.chunkSize,
            this.config.tileSize,
            this.materials,
          );
          this.group.add(chunk.group);
          this.active.set(key, chunk);
        }
      }
    }

    // Alte Chunks aufräumen
    for (const [key, chunk] of this.active) {
      if (!needed.has(key)) {
        this.group.remove(chunk.group);
        chunk.dispose();
        this.active.delete(key);
      }
    }
  }

  dispose(): void {
    for (const chunk of this.active.values()) {
      this.group.remove(chunk.group);
      chunk.dispose();
    }
    this.active.clear();

    this.materials.board.dispose();
    this.materials.trace.dispose();
  }
}
