import * as THREE from 'three';
import type { SkyState } from './DayNightCycle';

const VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = position;
  // Rotation only: the dome is always centred on the camera.
  vec4 viewPosition = vec4(mat3(modelViewMatrix) * position, 1.0);
  gl_Position = projectionMatrix * viewPosition;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
uniform vec3 uMoonDirection;
uniform float uStarOpacity;
uniform float uSunVisibility;
uniform float uDim;
varying vec3 vDirection;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 dir = normalize(vDirection);
  float height = max(dir.y, 0.0);
  vec3 color = mix(uHorizon, uZenith, pow(height, 0.5));

  float sunDot = dot(dir, uSunDirection);
  float disc = smoothstep(0.9990, 0.9994, sunDot);
  float glow = pow(max(sunDot, 0.0), 40.0) * 0.35 + pow(max(sunDot, 0.0), 6.0) * 0.08;
  color += uSunColor * (disc * 1.4 + glow) * uSunVisibility;

  float moonDot = dot(dir, uMoonDirection);
  color += vec3(0.82, 0.88, 1.0) * smoothstep(0.9992, 0.9995, moonDot) * uStarOpacity;

  if (uStarOpacity > 0.01 && dir.y > 0.0) {
    vec3 cell = floor(dir * 160.0);
    float star = step(0.9965, hash(cell));
    color += vec3(star) * uStarOpacity * smoothstep(0.0, 0.25, dir.y) * (0.5 + 0.5 * hash(cell + 7.0));
  }

  gl_FragColor = vec4(color * uDim, 1.0);
  #include <colorspace_fragment>
}
`;

/** Camera-centred sky dome with gradient, sun, moon and stars. */
export class Sky {
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(private readonly scene: THREE.Scene) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunColor: { value: new THREE.Color() },
        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uMoonDirection: { value: new THREE.Vector3(0, -1, 0) },
        uStarOpacity: { value: 0 },
        uSunVisibility: { value: 1 },
        uDim: { value: 1 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  /** @param dim 0..1 multiplier used to darken the sky in bad weather. */
  update(state: SkyState, dim: number): void {
    const u = this.material.uniforms;
    (u.uZenith!.value as THREE.Color).copy(state.zenith);
    (u.uHorizon!.value as THREE.Color).copy(state.horizon);
    (u.uSunColor!.value as THREE.Color).copy(state.sunColor);
    (u.uSunDirection!.value as THREE.Vector3).copy(state.sunDirection);
    (u.uMoonDirection!.value as THREE.Vector3).copy(state.moonDirection);
    u.uStarOpacity!.value = state.starOpacity * dim;
    u.uSunVisibility!.value = dim * dim;
    u.uDim!.value = dim;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
