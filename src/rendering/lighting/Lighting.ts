import * as THREE from 'three';

/**
 * Scene lighting: one directional "sun" plus a hemisphere light for ambient
 * sky/ground bounce. Kept deliberately small so it stays cheap on integrated GPUs.
 */
export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;

  constructor(private readonly scene: THREE.Scene) {
    this.ambient = new THREE.HemisphereLight(0xcfe6ff, 0x6b5a45, 1.15);
    this.sun = new THREE.DirectionalLight(0xfff3d6, 1.9);
    this.sun.position.set(60, 100, 40);
    scene.add(this.ambient, this.sun, this.sun.target);
  }

  dispose(): void {
    this.scene.remove(this.ambient, this.sun, this.sun.target);
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
    this.ambient.dispose();
  }
}
