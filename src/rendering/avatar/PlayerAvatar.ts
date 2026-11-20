import * as THREE from 'three';

interface Limb {
  pivot: THREE.Group;
  phase: number;
}

/** Simple blocky character shown in third-person view. */
export class PlayerAvatar {
  readonly root = new THREE.Group();
  private readonly limbs: Limb[] = [];
  private readonly head: THREE.Mesh;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private stride = 0;

  constructor(private readonly scene: THREE.Scene) {
    const skin = this.material(0xd9a074);
    const shirt = this.material(0x3fa7a3);
    const trousers = this.material(0x39457a);

    // Dimensions sum to the 1.8-block player height: legs 0.72, torso 0.66, head 0.42.
    const torso = this.box(0.5, 0.66, 0.26, shirt);
    torso.position.y = 0.72 + 0.33;
    this.head = this.box(0.42, 0.42, 0.42, skin);
    this.head.position.y = 1.38 + 0.21;
    this.root.add(torso, this.head);

    this.addLimb(0.16, 0.72, 0.2, trousers, -0.13, 0.72, 0);
    this.addLimb(0.16, 0.72, 0.2, trousers, 0.13, 0.72, Math.PI);
    this.addLimb(0.16, 0.62, 0.18, skin, -0.34, 1.36, Math.PI);
    this.addLimb(0.16, 0.62, 0.18, skin, 0.34, 1.36, 0);

    this.root.visible = false;
    scene.add(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /**
   * @param speed horizontal speed in blocks per second (drives the walk cycle)
   */
  update(
    dt: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    speed: number,
  ): void {
    if (!this.root.visible) return;
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.head.rotation.x = pitch * 0.7;

    this.stride += dt * Math.min(speed, 8) * 2.4;
    const swing = Math.min(1, speed / 4) * 0.8;
    for (const limb of this.limbs) {
      limb.pivot.rotation.x = Math.sin(this.stride + limb.phase) * swing;
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }

  private material(color: number): THREE.MeshLambertMaterial {
    const material = new THREE.MeshLambertMaterial({ color });
    this.materials.push(material);
    return material;
  }

  private box(w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(w, h, d);
    this.geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
  }

  /** Adds a limb that swings around its top end. */
  private addLimb(
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    x: number,
    topY: number,
    phase: number,
  ): void {
    const pivot = new THREE.Group();
    pivot.position.set(x, topY, 0);
    const mesh = this.box(w, h, d, material);
    mesh.position.y = -h / 2;
    pivot.add(mesh);
    this.root.add(pivot);
    this.limbs.push({ pivot, phase });
  }
}
