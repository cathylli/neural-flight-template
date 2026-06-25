import * as THREE from "three";
import {
  MotherboardChunk,
  type MotherboardMaterials,
} from "./MotherboardChunk";

export interface MotherboardManagerConfig {
  chunkSize?: number;
  tileSize?: number;
  viewRadius?: number;
  /** Gebäude-Dichte: 0.0 (keine Gebäude) bis 1.0 (jeder freie Platz bebaut) */
  buildingDensity?: number;
  /** WFC-Leiterbahn-Dichte: 0.0 (fast nur Blank) bis 1.0 (extrem dichte Bahnen) */
  traceDensity?: number;
}

const DEFAULTS: Required<MotherboardManagerConfig> = {
  chunkSize: 20,
  tileSize: 2,
  viewRadius: 3,
  buildingDensity: 0.4,
  traceDensity: 0.5,
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
      board: new THREE.MeshStandardMaterial({
        color: 0x190e7d,
        roughness: 0.9,
        metalness: 0.1,
      }),
      trace: new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0.0 },
          uBaseColor: { value: new THREE.Color(0x001a05) },
          uPacketColor: { value: new THREE.Color(0x00ff41) },
        },
        vertexShader: `
          varying float vLocalZ;
          varying float vRandom;

          float random(vec2 st) {
              return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
          }

          void main() {
            vLocalZ = position.z;
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
            float z = vLocalZ + 0.5;
            float direction = (vRandom > 0.5) ? 1.0 : -1.0;
            float speed = 0.5 + vRandom * 1.5;
            float wave = fract(z * direction - uTime * speed + vRandom * 10.0);
            float packet = smoothstep(0.95, 0.98, wave) * smoothstep(1.0, 0.98, wave);
            float traffic = step(0.85, vRandom);
            vec3 finalColor = mix(uBaseColor, uPacketColor, packet * traffic);
            gl_FragColor = vec4(finalColor, 1.0);
          }
        `,
      }),

      // Buildings Material — einfaches Neon-Wireframe ohne Vertex-Manipulation
      // (Die Wachstums-Animation läuft über CPU-seitige instanceMatrix-Updates)
      building: new THREE.ShaderMaterial({
        uniforms: {
          uNeonColor: { value: new THREE.Color(0x00ff00) },
          uNeonIntensity: { value: 2.0 },
        },
        vertexShader: `
          varying float vHeight;

          void main() {
            vHeight = position.y;

            mat4 finalMatrix = modelMatrix;
            #ifdef USE_INSTANCING
              finalMatrix = modelMatrix * instanceMatrix;
            #endif

            gl_Position = projectionMatrix * viewMatrix * finalMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uNeonColor;
          uniform float uNeonIntensity;
          varying float vHeight;

          void main() {
            // Helligkeit steigt mit Höhe für schönen Glow-Effekt
            float brightness = 0.4 + 0.6 * clamp(vHeight, 0.0, 1.0);
            vec3 color = uNeonColor * uNeonIntensity * brightness;
            gl_FragColor = vec4(color, 1.0);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        wireframe: true,
      }),
    };
  }

  public dispose(): void {
    // 1. Alle aktiven Chunks zerstören und aus der Szene entfernen
    for (const chunk of this.active.values()) {
      this.group.remove(chunk.group);
      chunk.dispose();
    }
    this.active.clear();

    // 2. Die gemeinsam genutzten Materialien aus dem GPU-Speicher löschen
    this.materials.board.dispose();
    this.materials.trace.dispose();
    if (this.materials.building) {
      this.materials.building.dispose();
    }
  }

  update(position: THREE.Vector3): void {
    const timeSec = performance.now() * 0.001;

    // 1. Uniforms für Leiterbahnen aktualisieren
    if (this.materials.trace instanceof THREE.ShaderMaterial) {
      this.materials.trace.uniforms.uTime.value = timeSec;
      this.materials.trace.uniforms.uBaseColor.value.set(0x002510);
      this.materials.trace.needsUpdate = true;
    }

    // 2. Gebäude-Animation für alle aktiven Chunks aktualisieren
    for (const chunk of this.active.values()) {
      chunk.update(timeSec);
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
            this.config.traceDensity,
            this.config.buildingDensity,
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
}
