import type { InputManager } from '@/core/input/InputManager';
import { clamp } from '@/utils/math';
import { BlockId, getBlockDef, IS_CUBE, IS_SOLID } from '@/world/blocks/blocks';
import { CHUNK_HEIGHT } from '@/world/constants';
import type { World } from '@/world/World';
import { bodyCollides, boxCollides, moveWithStepUp, type MoveResult } from '../collision/aabb';
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT, type Player } from '../player/Player';

/** Tunable movement parameters (blocks and seconds). */
export interface MovementConfig {
  walkSpeed: number;
  sprintSpeed: number;
  flySpeed: number;
  flySprintSpeed: number;
  swimSpeed: number;
  climbSpeed: number;
  sneakSpeed: number;
  jumpVelocity: number;
  /** Upward speed of a jump made in mid-air. */
  airJumpVelocity: number;
  dashSpeed: number;
  /** Seconds a dash holds its speed, and seconds before the next one. */
  dashDuration: number;
  dashCooldown: number;
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
  climbSpeed: 3,
  sneakSpeed: 1.4,
  jumpVelocity: 8.7,
  airJumpVelocity: 8.2,
  dashSpeed: 16,
  dashDuration: 0.18,
  dashCooldown: 1,
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
/** Ledges up to this height are climbed without jumping. */
const STEP_HEIGHT = 0.6;
/** With auto-jump on, a full block is climbed the same way. */
const AUTO_JUMP_HEIGHT = 1.05;
/** A sneaking player refuses to step where the ground is further down than this. */
const SNEAK_DROP = 0.6;
export const FLY_SPEED_SCALE = { min: 0.25, max: 3, step: 0.25 } as const;

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
  /** Jumps available in mid-air before landing (game-mode rule). */
  maxAirJumps = 0;
  allowDash = false;
  /** Climb full blocks without jumping (setting). */
  autoJump = false;
  /** The sprint key switches sprinting on and off instead of being held (setting). */
  sprintToggle = false;
  /** Multiplier on flying speed, adjusted by the player. */
  flySpeedScale = 1;
  private readonly result: MoveResult = { onGround: false, hitCeiling: false, hitWall: false };
  private readonly lookDelta = { x: 0, y: 0 };
  private timeSinceGround = 0;
  private jumpHeld = false;
  private airJumpsUsed = 0;
  private sprintHeld = false;
  private sprintLatched = false;
  private dashHeld = false;
  private dashTime = 0;
  private dashCooldown = 0;
  private dashX = 0;
  private dashZ = 0;
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
      ? Number(input.isActionDown('moveForward')) - Number(input.isActionDown('moveBack'))
      : 0;
    const strafe = active
      ? Number(input.isActionDown('moveRight')) - Number(input.isActionDown('moveLeft'))
      : 0;
    // A press is taken from the input queue as well as from the held state, so a
    // tap shorter than one simulation step still counts.
    const jumpTapped = input.consumePress('jump') && active;
    const dashTapped = input.consumePress('dash') && active;
    const jump = active && (input.isActionDown('jump') || jumpTapped);
    const descend = active && input.isActionDown('descend');
    const sprintKey = active && input.isActionDown('sprint');
    const dashKey = active && input.isActionDown('dash');
    const jumpPressed = jumpTapped || (jump && !this.jumpHeld);
    const dashPressed = dashTapped || (dashKey && !this.dashHeld);
    this.dashHeld = dashKey;

    // Double-tap jump toggles flying.
    let toggledFlight = false;
    if (jumpPressed) {
      if (this.clock - this.lastJumpTap < DOUBLE_TAP_WINDOW && this.allowFlying) {
        this.toggleFlying();
        this.lastJumpTap = -Infinity;
        toggledFlight = true;
      } else {
        this.lastJumpTap = this.clock;
      }
    }
    this.jumpHeld = active && input.isActionDown('jump');
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
    player.climbing = !player.flying && !player.inWater && this.isOnLadder();
    player.sneaking = descend && !player.flying && !player.inWater;

    // Sprint is either held, or switched on by a press and kept until the player stops.
    if (this.sprintToggle) {
      if (sprintKey && !this.sprintHeld) this.sprintLatched = !this.sprintLatched;
      if (forward <= 0) this.sprintLatched = false;
    } else {
      this.sprintLatched = false;
    }
    this.sprintHeld = sprintKey;
    const wantsSprint = this.sprintToggle ? this.sprintLatched : sprintKey;
    player.sprinting = wantsSprint && forward > 0 && length > 0 && !player.sneaking;

    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.dashTime = Math.max(0, this.dashTime - dt);
    if (player.flying || player.inWater) this.dashTime = 0;
    if (
      dashPressed &&
      this.allowDash &&
      this.dashCooldown === 0 &&
      !player.flying &&
      !player.inWater
    ) {
      // Dash where the player is steering, or straight ahead when standing still.
      this.dashX = length > 0 ? wishX : -sin;
      this.dashZ = length > 0 ? wishZ : -cos;
      this.dashTime = cfg.dashDuration;
      this.dashCooldown = cfg.dashCooldown;
      if (velocity.y < 0) velocity.y = 0;
    }
    player.viewOffsetY *= 1 - Math.min(1, 14 * dt);
    if (Math.abs(player.viewOffsetY) < 1e-3) player.viewOffsetY = 0;

    if (player.flying) {
      const speed = (player.sprinting ? cfg.flySprintSpeed : cfg.flySpeed) * this.flySpeedScale;
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
    } else if (player.climbing) {
      // On a ladder: steer freely, climb with jump or by pushing forward, hold
      // still with sneak, and otherwise slide down slowly.
      const blend = Math.min(1, cfg.groundAcceleration * dt);
      velocity.x += (wishX * cfg.sneakSpeed * 1.6 - velocity.x) * blend;
      velocity.z += (wishZ * cfg.sneakSpeed * 1.6 - velocity.z) * blend;
      velocity.y = jump || forward > 0 ? cfg.climbSpeed : descend ? 0 : -cfg.climbSpeed * 0.7;
      this.timeSinceGround = 0;
    } else {
      const speed = player.sneaking
        ? cfg.sneakSpeed
        : player.sprinting
          ? cfg.sprintSpeed
          : cfg.walkSpeed;
      const accel = player.onGround ? cfg.groundAcceleration : cfg.airAcceleration;
      const blend = Math.min(1, accel * dt);
      // In the air, only steer when there is input so momentum is preserved.
      if (player.onGround || length > 0) {
        velocity.x += (wishX * speed - velocity.x) * blend;
        velocity.z += (wishZ * speed - velocity.z) * blend;
      }
      velocity.y = Math.max(velocity.y - cfg.gravity * dt, -cfg.terminalVelocity);

      if (this.dashTime > 0) {
        velocity.x = this.dashX * cfg.dashSpeed;
        velocity.z = this.dashZ * cfg.dashSpeed;
      }

      this.timeSinceGround = player.onGround ? 0 : this.timeSinceGround + dt;
      if (jump && this.timeSinceGround <= COYOTE_TIME && velocity.y <= 0.01) {
        velocity.y = cfg.jumpVelocity;
        this.timeSinceGround = Infinity;
      } else if (
        jumpPressed &&
        !toggledFlight &&
        !player.onGround &&
        this.timeSinceGround > COYOTE_TIME &&
        this.airJumpsUsed < this.maxAirJumps
      ) {
        velocity.y = cfg.airJumpVelocity;
        this.airJumpsUsed++;
      }
    }
    if (player.onGround || player.flying || player.inWater || player.climbing) {
      this.airJumpsUsed = 0;
    }

    const walking = player.onGround && !player.flying && !player.inWater && velocity.y <= 0;
    if (walking && player.sneaking) this.guardEdges(dt);
    const rise = moveWithStepUp(
      this.world,
      position,
      velocity,
      dt,
      PLAYER_HALF_WIDTH,
      PLAYER_HEIGHT,
      this.result,
      walking ? (this.autoJump ? AUTO_JUMP_HEIGHT : STEP_HEIGHT) : 0,
    );
    // The body moves up at once; the camera catches up smoothly.
    if (rise > 0) player.viewOffsetY -= rise;
    player.onGround = this.result.onGround;

    // Falling out of the world: put the player back on top of it.
    if (position.y < -16) {
      this.placeOnGround();
    }
  }

  /** Cancels horizontal movement that would carry a sneaking player off a ledge. */
  private guardEdges(dt: number): void {
    const { position, velocity } = this.player;
    if (velocity.x !== 0 && !this.hasGroundAt(position.x + velocity.x * dt, position.z)) {
      velocity.x = 0;
    }
    if (
      velocity.z !== 0 &&
      !this.hasGroundAt(position.x + velocity.x * dt, position.z + velocity.z * dt)
    ) {
      velocity.z = 0;
    }
  }

  /** True when some part of the body's footprint would rest on a block near the current height. */
  private hasGroundAt(x: number, z: number): boolean {
    const y = this.player.position.y;
    return boxCollides(
      this.world,
      x - PLAYER_HALF_WIDTH,
      y - SNEAK_DROP,
      z - PLAYER_HALF_WIDTH,
      x + PLAYER_HALF_WIDTH,
      y,
      z + PLAYER_HALF_WIDTH,
    );
  }

  /** True when the player's body is in a cell holding something climbable. */
  private isOnLadder(): boolean {
    const { position } = this.player;
    const x = Math.floor(position.x);
    const z = Math.floor(position.z);
    for (const height of [0.1, 1]) {
      const id = this.world.getBlock(x, Math.floor(position.y + height), z);
      // Skip the lookup for ordinary cubes, which are never climbable.
      if (IS_CUBE[id] !== 1 && getBlockDef(id).climbable) return true;
    }
    return false;
  }

  private updateWaterState(): void {
    const { position } = this.player;
    const x = Math.floor(position.x);
    const z = Math.floor(position.z);
    const world = this.world;
    this.player.inWater = world.getBlock(x, Math.floor(position.y + 0.4), z) === BlockId.Water;
    this.player.headInWater =
      world.getBlock(x, Math.floor(position.y + this.player.eyeHeight), z) === BlockId.Water;
  }
}
