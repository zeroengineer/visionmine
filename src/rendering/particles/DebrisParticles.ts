import * as THREE from 'three';
import type { BlockQuery } from '@/gameplay/collision/aabb';
import { IS_SOLID } from '@/world/blocks/blocks';

const GRAVITY = 22;

/**
 * Pooled block-debris particles: small cubes simulated on the CPU and drawn
 * with one InstancedMesh, so any number of bursts costs a single draw call.
 */
export class DebrisParticles {
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly capacity: number;
  private readonly position: Float32Array;
  private readonly velocity: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly colors: Float32Array;
  private alive = 0;
  private readonly color = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    capacity: number,
  ) {
    this.capacity = Math.max(32, Math.floor(capacity));
    this.position = new Float32Array(this.capacity * 3);
    this.velocity = new Float32Array(this.capacity * 3);
    this.life = new Float32Array(this.capacity);
    this.maxLife = new Float32Array(this.capacity);
    this.size = new Float32Array(this.capacity);
    this.colors = new Float32Array(this.capacity * 3);

    this.material = new THREE.MeshLambertMaterial();
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      this.material,
      this.capacity,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity * 3),
      3,
    );
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  /**
   * Emits `count` particles from around a point.
   * @param spread half-size of the spawn volume in blocks
   * @param speed initial outward speed
   */
  burst(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    count: number,
    spread = 0.4,
    speed = 3,
  ): void {
    this.color.set(colorHex);
    for (let n = 0; n < count; n++) {
      // When full, recycle the oldest slot (index 0 is swapped out first on expiry).
      const i =
        this.alive < this.capacity ? this.alive++ : Math.floor(Math.random() * this.capacity);
      const p = i * 3;
      const dx = Math.random() * 2 - 1;
      const dy = Math.random() * 2 - 1;
      const dz = Math.random() * 2 - 1;
      this.position[p] = x + dx * spread;
      this.position[p + 1] = y + dy * spread;
      this.position[p + 2] = z + dz * spread;
      this.velocity[p] = dx * speed;
      this.velocity[p + 1] = Math.abs(dy) * speed * 1.1 + speed * 0.4;
      this.velocity[p + 2] = dz * speed;
      this.maxLife[i] = this.life[i] = 0.5 + Math.random() * 0.6;
      this.size[i] = 0.07 + Math.random() * 0.08;
      const tint = 0.75 + Math.random() * 0.4;
      this.colors[p] = this.color.r * tint;
      this.colors[p + 1] = this.color.g * tint;
      this.colors[p + 2] = this.color.b * tint;
    }
  }

  update(dt: number, blocks: BlockQuery): void {
    if (this.alive === 0) {
      if (this.mesh.count !== 0) this.mesh.count = 0;
      return;
    }
    const { position, velocity, life, maxLife, size, colors } = this;
    const matrices = this.mesh.instanceMatrix.array as Float32Array;
    const instanceColors = this.mesh.instanceColor!.array as Float32Array;

    let i = 0;
    while (i < this.alive) {
      life[i]! -= dt;
      if (life[i]! <= 0) {
        // Swap-remove: move the last live particle into this slot.
        const last = --this.alive;
        if (i !== last) {
          position.copyWithin(i * 3, last * 3, last * 3 + 3);
          velocity.copyWithin(i * 3, last * 3, last * 3 + 3);
          colors.copyWithin(i * 3, last * 3, last * 3 + 3);
          life[i] = life[last]!;
          maxLife[i] = maxLife[last]!;
          size[i] = size[last]!;
        }
        continue;
      }
      const p = i * 3;
      velocity[p + 1]! -= GRAVITY * dt;
      const nx = position[p]! + velocity[p]! * dt;
      const ny = position[p + 1]! + velocity[p + 1]! * dt;
      const nz = position[p + 2]! + velocity[p + 2]! * dt;
      if (IS_SOLID[blocks.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz))] === 1) {
        // Come to rest on impact rather than resolving a full collision.
        velocity[p] = velocity[p]! * 0.3;
        velocity[p + 1] = 0;
        velocity[p + 2] = velocity[p + 2]! * 0.3;
      } else {
        position[p] = nx;
        position[p + 1] = ny;
        position[p + 2] = nz;
      }

      const scale = size[i]! * Math.min(1, (life[i]! / maxLife[i]!) * 2.5);
      const m = i * 16;
      matrices.fill(0, m, m + 16);
      matrices[m] = scale;
      matrices[m + 5] = scale;
      matrices[m + 10] = scale;
      matrices[m + 12] = position[p]!;
      matrices[m + 13] = position[p + 1]!;
      matrices[m + 14] = position[p + 2]!;
      matrices[m + 15] = 1;
      instanceColors[p] = colors[p]!;
      instanceColors[p + 1] = colors[p + 1]!;
      instanceColors[p + 2] = colors[p + 2]!;
      i++;
    }

    this.mesh.count = this.alive;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
