import * as THREE from 'three';

/** Wireframe outline around the targeted block, plus a darkening overlay while mining. */
export class BlockHighlight {
  private readonly group = new THREE.Group();
  private readonly outline: THREE.LineSegments;
  private readonly overlay: THREE.Mesh;
  private readonly outlineMaterial: THREE.LineBasicMaterial;
  private readonly overlayMaterial: THREE.MeshBasicMaterial;

  constructor(private readonly scene: THREE.Scene) {
    const box = new THREE.BoxGeometry(1.004, 1.004, 1.004);
    const edges = new THREE.EdgesGeometry(box);
    this.outlineMaterial = new THREE.LineBasicMaterial({
      color: 0x0a0a0a,
      transparent: true,
      opacity: 0.75,
      fog: false,
    });
    this.outline = new THREE.LineSegments(edges, this.outlineMaterial);
    box.dispose();

    this.overlayMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.overlay = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), this.overlayMaterial);
    this.overlay.visible = false;

    this.group.add(this.outline, this.overlay);
    this.group.visible = false;
    this.group.renderOrder = 2;
    scene.add(this.group);
  }

  /** Shows the highlight on a block, or hides it when `target` is null. */
  update(target: { x: number; y: number; z: number } | null, breakProgress: number): void {
    if (!target) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.group.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    this.overlay.visible = breakProgress > 0;
    this.overlayMaterial.opacity = Math.min(0.6, breakProgress * 0.6);
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.outline.geometry.dispose();
    this.overlay.geometry.dispose();
    this.outlineMaterial.dispose();
    this.overlayMaterial.dispose();
  }
}
