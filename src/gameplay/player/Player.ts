export const PLAYER_WIDTH = 0.6;
export const PLAYER_HALF_WIDTH = PLAYER_WIDTH / 2;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE_HEIGHT = 1.62;
/** How far the eyes drop while sneaking. */
export const SNEAK_EYE_DROP = 0.22;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Plain player state. `position` is the centre of the feet. */
export class Player {
  readonly position: Vec3Like = { x: 0, y: 0, z: 0 };
  /** Position at the previous simulation step, for render interpolation. */
  readonly previous: Vec3Like = { x: 0, y: 0, z: 0 };
  readonly velocity: Vec3Like = { x: 0, y: 0, z: 0 };
  /** Rotation around +Y in radians; 0 looks toward -Z. */
  yaw = 0;
  /** Rotation around the local X axis; positive looks up. */
  pitch = 0;
  onGround = false;
  flying = false;
  sprinting = false;
  /** Moving carefully: slower, eyes lowered, will not walk off edges. */
  sneaking = false;
  /**
   * Vertical offset applied to the camera only. A step up moves the body at
   * once; this starts at minus the step height and eases back to zero.
   */
  viewOffsetY = 0;
  /** Lower body is in water. */
  inWater = false;
  /** Eyes are in water. */
  headInWater = false;

  /** Height of the eyes above the feet right now. */
  get eyeHeight(): number {
    return this.sneaking ? PLAYER_EYE_HEIGHT - SNEAK_EYE_DROP : PLAYER_EYE_HEIGHT;
  }

  teleport(x: number, y: number, z: number): void {
    this.position.x = this.previous.x = x;
    this.position.y = this.previous.y = y;
    this.position.z = this.previous.z = z;
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
    this.onGround = false;
    this.viewOffsetY = 0;
  }

  /** Unit view direction written into `out`. */
  getLookDirection(out: Vec3Like): Vec3Like {
    const cosPitch = Math.cos(this.pitch);
    out.x = -Math.sin(this.yaw) * cosPitch;
    out.y = Math.sin(this.pitch);
    out.z = -Math.cos(this.yaw) * cosPitch;
    return out;
  }
}
