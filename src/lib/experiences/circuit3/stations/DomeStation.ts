import * as THREE from "three";
import type { StationContext, StationVisual } from "./types";

// ── DomeStation ──────────────────────────────────────────────────────────────
//
// A large solid dome — the firewall boundary in L2.

const DOME_RADIUS = 120;
const DOME_DETAIL = 5;

// ── Dome Shader ──────────────────────────────────────────────────────────────

const domeVertexShader = /* glsl */ `
uniform float uTime;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vDisplacement;

void main() {
  vNormal = normalize(normalMatrix * normal);

  float pulse = sin(uTime * 1.2) * 0.5 + 0.5;
  float wave = sin(position.x * 0.05 + position.y * 0.03 + uTime * 1.2) *
               sin(position.z * 0.04 + position.y * 0.06 + uTime * 0.8);
  float displacement = (pulse * 0.6 + wave * 0.4) * 1.5;
  vDisplacement = displacement;

  vec3 displaced = position + normal * displacement;
  vWorldPos = (modelMatrix * vec4(displaced, 1.0)).xyz;

  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  vViewDir = normalize(-mvPosition.xyz);

  gl_Position = projectionMatrix * mvPosition;
}
`;

const domeFragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vDisplacement;

void main() {
  vec3 local = vWorldPos;

  float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
  fresnel = pow(fresnel, 2.0);

  float ripple = sin(vDisplacement * 6.0 + uTime * 2.0) * 0.5 + 0.5;
  ripple = smoothstep(0.3, 0.7, ripple);

  float pulse = 0.7 + 0.3 * sin(uTime * 1.5 + local.y * 0.05);

  float glow = fresnel * 0.6;
  float energy = ripple * 0.15;
  float alpha = (0.25 + glow + energy) * pulse;

  gl_FragColor = vec4(uColor, alpha);
}
`;

// ── DomeStation ──────────────────────────────────────────────────────────────

export class DomeStation implements StationVisual {
	static readonly TRIGGER_RADIUS = 120;
	readonly object: THREE.Group;
	private readonly domeMat: THREE.ShaderMaterial;
	private readonly wireframeMat: THREE.LineBasicMaterial;

	constructor(ctx: StationContext) {
		this.object = new THREE.Group();
		this.object.position.copy(ctx.position);

		const neon = new THREE.Color(0xff2222);

		const icoGeo = new THREE.IcosahedronGeometry(DOME_RADIUS, DOME_DETAIL);
		this.domeMat = new THREE.ShaderMaterial({
			vertexShader: domeVertexShader,
			fragmentShader: domeFragmentShader,
			uniforms: {
				uTime: { value: 0 },
				uColor: { value: neon.clone() },
			},
			transparent: true,
			side: THREE.DoubleSide,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
		const domeMesh = new THREE.Mesh(icoGeo, this.domeMat);
		this.object.add(domeMesh);

		const wireGeo = new THREE.WireframeGeometry(icoGeo);
		this.wireframeMat = new THREE.LineBasicMaterial({
			color: neon,
			transparent: true,
			opacity: 0.15,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
		const wireframe = new THREE.LineSegments(wireGeo, this.wireframeMat);
		this.object.add(wireframe);
	}

	update(elapsed: number): void {
		this.domeMat.uniforms.uTime.value = elapsed;
		const flicker =
			0.12 + 0.04 * Math.sin(elapsed * 3.7) + 0.03 * Math.sin(elapsed * 7.1);
		this.wireframeMat.opacity = flicker;
	}

	dispose(): void {
		this.object.traverse((child) => {
			if (child instanceof THREE.LineSegments) child.geometry.dispose();
			if (child instanceof THREE.Mesh) {
				child.geometry.dispose();
				if (child.material instanceof THREE.Material) child.material.dispose();
			}
		});
		this.domeMat.dispose();
		this.wireframeMat.dispose();
	}
}
