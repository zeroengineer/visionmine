import * as THREE from 'three';
import type { SkyState } from '../environment/DayNightCycle';

const LIGHT_DISTANCE = 140;
const SHADOW_EXTENT = 46;

/**
 * Scene lighting: one directional light (sun by day, moon by night) plus a
 * hemisphere light for ambient sky/ground bounce. A single shadow map follows
 * the viewer so shadow cost is independent of world size.
 */
export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;
  private shadowMapSize = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.ambient = new THREE.HemisphereLight(0xcfe6ff, 0x6b5a45, 1.15);
    this.sun = new THREE.DirectionalLight(0xfff3d6, 1.9);
    this.sun.position.set(60, 100, 40);

    const camera = this.sun.shadow.camera;
    camera.left = -SHADOW_EXTENT;
    camera.right = SHADOW_EXTENT;
    camera.top = SHADOW_EXTENT;
    camera.bottom = -SHADOW_EXTENT;
    camera.near = 1;
    camera.far = LIGHT_DISTANCE * 2;
    camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;

    scene.add(this.ambient, this.sun, this.sun.target);
  }

  /** Sets the shadow map resolution; 0 turns shadows off. */
  setShadowMapSize(size: number): void {
    if (size === this.shadowMapSize) return;
    this.shadowMapSize = size;
    this.sun.castShadow = size > 0;
    if (size > 0) this.sun.shadow.mapSize.set(size, size);
    // Force the map to be reallocated at the new resolution.
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  /** Applies sky state and re-centres the light (and its shadow volume) on `focus`. */
  update(state: SkyState, focus: { x: number; y: number; z: number }, dim: number): void {
    this.sun.color.copy(state.lightColor);
    this.sun.intensity = state.lightIntensity * dim;
    this.ambient.color.copy(state.ambientSky);
    this.ambient.groundColor.copy(state.ambientGround);
    this.ambient.intensity = state.ambientIntensity * (0.75 + 0.25 * dim);

    // Snap to whole blocks so shadow edges do not crawl as the viewer moves.
    const fx = Math.round(focus.x);
    const fy = Math.round(focus.y);
    const fz = Math.round(focus.z);
    this.sun.target.position.set(fx, fy, fz);
    this.sun.position
      .copy(state.lightDirection)
      .multiplyScalar(LIGHT_DISTANCE)
      .add(this.sun.target.position);
    this.sun.target.updateMatrixWorld();
  }

  dispose(): void {
    this.scene.remove(this.ambient, this.sun, this.sun.target);
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
    this.ambient.dispose();
  }
}
