import type { InputManager } from '@/core/input/InputManager';
import { clamp } from '@/utils/math';
import { BlockId, IS_SOLID } from '@/world/blocks/blocks';
import { CHUNK_HEIGHT } from '@/world/constants';
import type { World } from '@/world/World';
import { bodyCollides, moveAndCollide, type MoveResult } from '../collision/aabb';
import { PLAYER_EYE_HEIGHT, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, type Player } from '../player/Player';

/** Tunable movement parameters (blocks and seconds). */
export interface MovementConfig {
  walkSpeed: number;
  sprintSpeed: number;
  flySpeed: number;
  flySprintSpeed: number;
  swimSpeed: number;
  jumpVelocity: number;
  gravity: number;
  terminalVelocity: number;
  groundAcceleration: number;
  airAcceleration: number;
  flyAcceleration: number;
  /** Radians of rotation per pixel of mouse movement at sensitivity 1. */
  lookSpeed: number;
}

export const DEFAULT_MOVEMENT: MovementConfig = {
  walkSpeed: 4.4,
  sprintSpeed: 6.8,
  flySpeed: 11,
  flySprintSpeed: 24,
  swimSpeed: 2.6,
  jumpVelocity: 8.7,
  gravity: 30,
  terminalVelocity: 56,
  groundAcceleration: 14,
  airAcceleration: 3.2,
  flyAcceleration: 9,
  lookSpeed: 0.0022,
};

const MAX_PITCH = Math.PI / 2 - 0.01;
const COYOTE_TIME = 0.1;
const DOUBLE_TAP_WINDOW = 0.28;

/**
 * Translates input into player motion and integrates physics against the voxel
 * world. `step` runs at the fixed simulation rate; `look` runs every frame so
 * the camera stays responsive.
 */
export class PlayerController {
  readonly config: MovementConfig;
  /** Whether the player may toggle flying (creative mode). */
  allowFlying = true;
  sensitivity = 1;
  invertY = false;
  private readonly result: MoveResult = { onGround: false, hitCeiling: false, hitWall: false };
  private readonly lookDelta = { x: 0, y: 0 };
  private timeSinceGround = 0;
  private jumpHeld = false;
  private lastJumpTap = -Infinity;
  private clock = 0;

  constructor(
    private readonly player: Player,
    private readonly world: World,
    private readonly input: InputManager,
    config: Partial<MovementConfig> = {},
  ) {
    this.config = { ...DEFAULT_MOVEMENT, ...config };
  }

  /** Applies accumulated mouse movement to the view angles. */
  look(): void {
    this.input.consumeLook(this.lookDelta);
    if (!this.input.isLocked) return;
    const scale = this.config.lookSpeed * this.sensitivity;
    const player = this.player;
    player.yaw -= this.lookDelta.x * scale;
    player.pitch = clamp(
      player.pitch - this.lookDelta.y * scale * (this.invertY ? -1 : 1),
      -MAX_PITCH,
      MAX_PITCH,
    );
  }

  toggleFlying(): void {
    if (!this.allowFlying) return;
    this.setFlying(!this.player.flying);
  }

  setFlying(flying: boolean): void {
    this.player.flying = flying && this.allowFlying;
    if (this.player.flying) this.player.velocity.y = 0;
  }

  /**
   * Places the player on the highest solid block of their current column.
   * Returns false when that column is not loaded yet.
   */
  placeOnGround(): boolean {
    const { position } = this.player;
    if (!this.world.isLoadedAt(position.x, position.z)) return false;
    const x = Math.floor(position.x);
    const z = Math.floor(position.z);
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      const id = this.world.getBlock(x, y, z);
      if (IS_SOLID[id] === 1 || id === BlockId.Water) {
        this.player.teleport(position.x, y + 1, position.z);
        this.freeFromBlocks();
        return true;
      }
    }
    this.player.teleport(position.x, CHUNK_HEIGHT, position.z);
    return true;
  }

  /** Nudges the player upward until their body no longer intersects solid blocks. */
  freeFromBlocks(): void {
    const { position } = this.player;
    let guard = CHUNK_HEIGHT;
    while (guard-- > 0 && bodyCollides(this.world, position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)) {
      position.y = Math.floor(position.y) + 1;
    }
    this.player.previous.y = position.y;
  }

  /** Advances the simulation by one fixed step. */
  step(dt: number): void {
    const player = this.player;
    const { position, velocity, previous } = player;
    previous.x = position.x;
    previous.y = position.y;
    previous.z = position.z;
    this.clock += dt;

    // Never simulate inside terrain that has not streamed in yet.
    if (!this.world.isLoadedAt(position.x, position.z)) {
      velocity.x = velocity.y = velocity.z = 0;
      return;
    }

    const cfg = this.config;
    const active = this.input.isLocked;
    const input = this.input;
    const forward = active
      ? Number(input.isDown('KeyW') || input.isDown('ArrowUp')) -
        Number(input.isDown('KeyS') || input.isDown('ArrowDown'))
      : 0;
    const strafe = active
      ? Number(input.isDown('KeyD') || input.isDown('ArrowRight')) -
        Number(input.isDown('KeyA') || input.isDown('ArrowLeft'))
      : 0;
    const jump = active && input.isDown('Space');
    const descend = active && (input.isDown('KeyC') || input.isDown('ControlLeft'));
    const sprintKey = active && (input.isDown('ShiftLeft') || input.isDown('ShiftRight'));

    // Double-tap jump toggles flying.
    if (jump && !this.jumpHeld) {
      if (this.clock - this.lastJumpTap < DOUBLE_TAP_WINDOW && this.allowFlying) {
        this.toggleFlying();
        this.lastJumpTap = -Infinity;
      } else {
        this.lastJumpTap = this.clock;
      }
    }
    this.jumpHeld = jump;
    if (player.flying && !this.allowFlying) player.flying = false;

    this.updateWaterState();

    // Wish direction on the horizontal plane, relative to yaw.
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    let wishX = -sin * forward + cos * strafe;
    let wishZ = -cos * forward - sin * strafe;
    const length = Math.hypot(wishX, wishZ);
    if (length > 0) {
      wishX /= length;
      wishZ /= length;
    }
    player.sprinting = sprintKey && forward > 0 && length > 0;

    if (player.flying) {
      const speed = player.sprinting ? cfg.flySprintSpeed : cfg.flySpeed;
      const blend = Math.min(1, cfg.flyAcceleration * dt);
      const vertical = (Number(jump) - Number(descend)) * speed * 0.75;
      velocity.x += (wishX * speed - velocity.x) * blend;
      velocity.z += (wishZ * speed - velocity.z) * blend;
      velocity.y += (vertical - velocity.y) * blend;
    } else if (player.inWater) {
      const speed = cfg.swimSpeed * (player.sprinting ? 1.4 : 1);
      const blend = Math.min(1, 6 * dt);
      velocity.x += (wishX * speed - velocity.x) * blend;
      velocity.z += (wishZ * speed - velocity.z) * blend;
      // Buoyancy: sink slowly, swim up while jump is held.
      const targetY = jump ? 3.4 : -2.2;
      velocity.y += (targetY - velocity.y) * Math.min(1, 5 * dt);
    } else {
      const speed = player.sprinting ? cfg.sprintSpeed : cfg.walkSpeed;
      const accel = player.onGround ? cfg.groundAcceleration : cfg.airAcceleration;
      const blend = Math.min(1, accel * dt);
      // In the air, only steer when there is input so momentum is preserved.
      if (player.onGround || length > 0) {
        velocity.x += (wishX * speed - velocity.x) * blend;
        velocity.z += (wishZ * speed - velocity.z) * blend;
      }
      velocity.y = Math.max(velocity.y - cfg.gravity * dt, -cfg.terminalVelocity);

      this.timeSinceGround = player.onGround ? 0 : this.timeSinceGround + dt;
      if (jump && this.timeSinceGround <= COYOTE_TIME && velocity.y <= 0.01) {
        velocity.y = cfg.jumpVelocity;
        this.timeSinceGround = Infinity;
      }
    }

    moveAndCollide(
      this.world,
      position,
      velocity,
      dt,
      PLAYER_HALF_WIDTH,
      PLAYER_HEIGHT,
      this.result,
    );
    player.onGround = this.result.onGround;

    // Falling out of the world: put the player back on top of it.
    if (position.y < -16) {
      this.placeOnGround();
    }
  }

  private updateWaterState(): void {
    const { position } = this.player;
    const x = Math.floor(position.x);
    const z = Math.floor(position.z);
    const world = this.world;
    this.player.inWater = world.getBlock(x, Math.floor(position.y + 0.4), z) === BlockId.Water;
    this.player.headInWater =
      world.getBlock(x, Math.floor(position.y + PLAYER_EYE_HEIGHT), z) === BlockId.Water;
  }
}
