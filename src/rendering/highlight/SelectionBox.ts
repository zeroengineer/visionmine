import * as THREE from 'three';
import type { Cell, Region } from '@/gameplay/building/regionOps';

/**
 * Shows the builder's selection: a tinted box around the selected region, or a
 * single marked block while only the first corner is set.
 */
export class SelectionBox {
  private readonly group = new THREE.Group();
  private readonly outline: THREE.LineSegments;
  private readonly fill: THREE.Mesh;
  private readonly outlineMaterial: THREE.LineBasicMaterial;
  private readonly fillMaterial: THREE.MeshBasicMaterial;

  constructor(private readonly scene: THREE.Scene) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.outlineMaterial = new THREE.LineBasicMaterial({
      color: 0x8ddc4f,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      fog: false,
    });
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(box), this.outlineMaterial);
    this.fillMaterial = new THREE.MeshBasicMaterial({
      color: 0x8ddc4f,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.fill = new THREE.Mesh(box, this.fillMaterial);
    this.group.add(this.fill, this.outline);
    this.group.visible = false;
    this.group.renderOrder = 4;
    scene.add(this.group);
  }

  /** Shows the region if there is one, else the first corner, else nothing. */
  update(region: Region | null, firstCorner: Cell | null): void {
    if (region) {
      this.place(
        region.minX,
        region.minY,
        region.minZ,
        region.maxX + 1,
        region.maxY + 1,
        region.maxZ + 1,
      );
    } else if (firstCorner) {
      const { x, y, z } = firstCorner;
      this.place(x, y, z, x + 1, y + 1, z + 1);
    } else {
      this.group.visible = false;
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.outline.geometry.dispose();
    this.fill.geometry.dispose();
    this.outlineMaterial.dispose();
    this.fillMaterial.dispose();
  }

  private place(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    // Slightly larger than the blocks so the faces do not z-fight with them.
    const grow = 0.01;
    this.group.visible = true;
    this.group.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.group.scale.set(x1 - x0 + grow, y1 - y0 + grow, z1 - z0 + grow);
  }
}
