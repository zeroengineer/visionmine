import * as THREE from 'three';
import { damp, lerp } from '@/utils/math';

export type WeatherKind = 'clear' | 'rain' | 'snow';

const VERTEX = /* glsl */ `
attribute vec3 aSeed;
attribute float aEnd;
uniform vec3 uCamera;
uniform vec3 uSize;
uniform float uTime;
uniform float uSpeed;
uniform float uStreak;
uniform float uSway;
varying float vFade;

void main() {
  vec3 p = aSeed;
  p.y -= uTime * uSpeed * (0.75 + aSeed.x * 0.5) / uSize.y;
  p.x += sin(uTime * 0.9 + aSeed.z * 6.2831) * uSway / uSize.x;
  // Anchor drops in world space while wrapping them inside a box around the camera.
  p = fract(p - uCamera / uSize);
  vec3 world = uCamera + (p - 0.5) * uSize;
  world.y += aEnd * uStreak;
  vFade = 1.0 - smoothstep(0.3, 0.5, length(p.xz - 0.5));
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vFade);
  #include <colorspace_fragment>
}
`;

const BOX = new THREE.Vector3(44, 30, 44);

/**
 * Rain and snow as a single draw call of GPU-animated streaks in a box that
 * follows the camera. Also runs the simple weather state machine.
 */
export class Weather {
  kind: WeatherKind = 'clear';
  /** Eased precipitation strength, 0..1. */
  intensity = 0;
  enabled = true;
  private target = 0;
  private timer = 60;
  private readonly lines: THREE.LineSegments;
  private readonly material: THREE.ShaderMaterial;

  constructor(
    private readonly scene: THREE.Scene,
    dropCount: number,
    private readonly random: () => number = Math.random,
  ) {
    const count = Math.max(64, Math.floor(dropCount));
    const seeds = new Float32Array(count * 2 * 3);
    const ends = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = random();
      const y = random();
      const z = random();
      seeds.set([x, y, z, x, y, z], i * 6);
      ends[i * 2 + 1] = 1;
    }
    const geometry = new THREE.BufferGeometry();
    // `position` is required by three but unused; the shader derives everything from seeds.
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uCamera: { value: new THREE.Vector3() },
        uSize: { value: BOX.clone() },
        uTime: { value: 0 },
        uSpeed: { value: 22 },
        uStreak: { value: 0.7 },
        uSway: { value: 0 },
        uColor: { value: new THREE.Color(0xa9c4e6) },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.lines = new THREE.LineSegments(geometry, this.material);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.lines.renderOrder = 3;
    this.lines.matrixAutoUpdate = false;
    scene.add(this.lines);
  }

  /** Forces a weather state (used when loading a world or from settings). */
  set(kind: WeatherKind, immediate = false): void {
    this.kind = kind;
    this.target = kind === 'clear' ? 0 : 1;
    if (immediate) this.intensity = this.target;
    this.timer = 90 + this.random() * 150;
  }

  /**
   * @param cold true where precipitation should fall as snow
   */
  update(dt: number, elapsed: number, camera: THREE.Vector3, cold: boolean): void {
    if (!this.enabled) {
      this.target = 0;
    } else {
      this.timer -= dt;
      if (this.timer <= 0) {
        const wet = this.random() < 0.35;
        this.set(wet ? (cold ? 'snow' : 'rain') : 'clear');
      }
      if (this.target > 0) this.kind = cold ? 'snow' : 'rain';
    }

    this.intensity = lerp(this.intensity, this.target, damp(0.35, dt));
    if (this.intensity < 0.01) {
      this.lines.visible = false;
      if (this.target === 0) this.kind = 'clear';
      return;
    }

    const snow = this.kind === 'snow';
    const u = this.material.uniforms;
    (u.uCamera!.value as THREE.Vector3).copy(camera);
    u.uTime!.value = elapsed;
    u.uSpeed!.value = snow ? 2.6 : 24;
    u.uStreak!.value = snow ? 0.06 : 0.75;
    u.uSway!.value = snow ? 0.9 : 0.05;
    u.uOpacity!.value = this.intensity * (snow ? 0.9 : 0.42);
    (u.uColor!.value as THREE.Color).set(snow ? 0xffffff : 0xa9c4e6);
    this.lines.visible = true;
  }

  dispose(): void {
    this.scene.remove(this.lines);
    this.lines.geometry.dispose();
    this.material.dispose();
  }
}
