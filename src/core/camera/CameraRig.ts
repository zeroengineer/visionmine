import * as THREE from 'three';

/** Owns the perspective camera and keeps its projection in sync with the viewport. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private baseFov: number;
  private fovOffset = 0;

  constructor(fov: number) {
    this.baseFov = fov;
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.08, 1200);
    this.camera.rotation.order = 'YXZ';
  }

  setAspect(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  setFov(fov: number): void {
    this.baseFov = fov;
    this.applyFov();
  }

  /** Temporary additive FOV (sprint kick); cheap to call every frame. */
  setFovOffset(offset: number): void {
    if (Math.abs(offset - this.fovOffset) < 0.01) return;
    this.fovOffset = offset;
    this.applyFov();
  }

  setFar(far: number): void {
    if (this.camera.far === far) return;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }

  /** Places the camera at an eye position with the given view angles. */
  setFirstPerson(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.camera.position.set(x, y, z);
    this.camera.rotation.set(pitch, yaw, 0);
  }

  /**
   * Places the camera `distance` blocks behind an eye position, looking along the
   * same view direction.
   */
  setThirdPerson(
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    distance: number,
  ): void {
    const cosPitch = Math.cos(pitch);
    this.camera.position.set(
      x + Math.sin(yaw) * cosPitch * distance,
      y - Math.sin(pitch) * distance,
      z + Math.cos(yaw) * cosPitch * distance,
    );
    this.camera.rotation.set(pitch, yaw, 0);
  }

  private applyFov(): void {
    this.camera.fov = this.baseFov + this.fovOffset;
    this.camera.updateProjectionMatrix();
  }
}
