import * as THREE from "three";
import { AudioLoader } from "three";
import { AUDIO } from "$lib/config/flight";

export class SpatialAudio {
  readonly listener: THREE.AudioListener;
  readonly context: AudioContext;
  private sources: THREE.Audio<AudioNode>[] = [];
  private sessionCb: (() => void) | null = null;

  constructor(camera: THREE.PerspectiveCamera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.context = this.listener.context;
  }

  resume(): void {
    if (this.context.state === "suspended") {
      this.context.resume();
    }
  }

  initXR(renderer: THREE.WebGLRenderer): void {
    this.sessionCb = () => this.resume();
    renderer.xr.addEventListener("sessionstart", this.sessionCb);
    if (renderer.xr.getSession()) this.resume();
  }

  createPositionalAudio(parent: THREE.Object3D): THREE.PositionalAudio {
    const audio = new THREE.PositionalAudio(this.listener);
    audio.setRefDistance(AUDIO.POSITIONAL.refDistance);
    audio.setMaxDistance(AUDIO.POSITIONAL.maxDistance);
    audio.setRolloffFactor(AUDIO.POSITIONAL.rolloffFactor);
    parent.add(audio);
    this.sources.push(audio);
    return audio;
  }

  private generateBuffer(
    duration: number,
    fill: (t: number, sampleRate: number) => number,
  ): AudioBuffer {
    const sampleRate = this.context.sampleRate;
    const length = sampleRate * duration;
    const buffer = this.context.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = fill(i / sampleRate, sampleRate);
    }
    return buffer;
  }

  createAmbientDrone(parent: THREE.Object3D): THREE.PositionalAudio {
    const c = AUDIO.AMBIENT_DRONE;
    const buffer = this.generateBuffer(4, (t) => {
      const env = Math.min(1, t * 2) * Math.max(0, 1 - Math.max(0, t - 3.5) * 2);
      const sig =
        Math.sin(2 * Math.PI * c.frequency * t) * 0.4 +
        Math.sin(2 * Math.PI * c.frequency * 2.01 * t) * 0.2 +
        Math.sin(2 * Math.PI * c.frequency * 3.07 * t) * 0.1 +
        (Math.random() - 0.5) * 0.06;
      return sig * env;
    });
    const audio = this.createPositionalAudio(parent);
    audio.setBuffer(buffer);
    audio.setLoop(true);
    audio.setVolume(c.volume);
    audio.play();
    return audio;
  }

  createEngineSound(parent: THREE.Object3D): THREE.PositionalAudio {
    const c = AUDIO.ENGINE;
    const buffer = this.generateBuffer(2, (t) => {
      const env = Math.min(1, t * 4) * Math.max(0, 1 - Math.max(0, t - 1.7) * 3.3);
      const sig =
        Math.sin(2 * Math.PI * 110 * t) * 0.3 +
        Math.sin(2 * Math.PI * 220 * t) * 0.15 +
        Math.sin(2 * Math.PI * 330 * t) * 0.08 +
        (Math.random() - 0.5) * 0.12;
      return sig * env;
    });
    const audio = this.createPositionalAudio(parent);
    audio.setBuffer(buffer);
    audio.setLoop(true);
    audio.setVolume(c.volume);
    audio.play();
    return audio;
  }

  async createBackgroundMusic(
    url: string,
    volume = 0.4,
  ): Promise<THREE.Audio> {
    const loader = new AudioLoader();
    const buffer = await loader.loadAsync(url);
    const audio = new THREE.Audio(this.listener);
    audio.setBuffer(buffer);
    audio.setLoop(true);
    audio.setVolume(volume);
    audio.play();
    this.sources.push(audio);
    return audio;
  }

  dispose(renderer?: THREE.WebGLRenderer): void {
    if (renderer && this.sessionCb) {
      renderer.xr.removeEventListener("sessionstart", this.sessionCb);
    }
    this.sessionCb = null;
    for (const src of this.sources) {
      if (src.isPlaying) src.stop();
      src.disconnect();
      src.parent?.remove(src);
    }
    this.sources = [];
    this.listener.parent?.remove(this.listener);
  }
}
