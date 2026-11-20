import * as THREE from 'three';
import type { PrimedTnt } from '@/gameplay/interaction/TntManager';

const CAPACITY = 48;

/** Blinking white shells over lit TNT blocks, drawn as one InstancedMesh. */
export class PrimedTntRenderer {
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly matrix = new THREE.Matrix4();

  constructor(private readonly scene: THREE.Scene) {
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.material, CAPACITY);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  update(primed: readonly PrimedTnt[], elapsed: number): void {
    const count = Math.min(primed.length, CAPACITY);
    if (count === 0) {
      this.mesh.count = 0;
      return;
    }
    let shortest = Infinity;
    for (let i = 0; i < count; i++) {
      const tnt = primed[i]!;
      shortest = Math.min(shortest, tnt.fuse);
      // Swell slightly just before detonation.
      const scale = 1.02 + Math.max(0, 0.4 - tnt.fuse) * 0.25;
      this.matrix.makeScale(scale, scale, scale).setPosition(tnt.x + 0.5, tnt.y + 0.5, tnt.z + 0.5);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    // Blink faster as the fuse runs out.
    const rate = shortest < 0.5 ? 26 : 11;
    this.material.opacity = 0.15 + 0.55 * (0.5 + 0.5 * Math.sin(elapsed * rate));
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
