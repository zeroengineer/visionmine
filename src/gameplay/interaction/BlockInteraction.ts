import type { InputManager } from '@/core/input/InputManager';
import { Emitter } from '@/utils/Emitter';
import { BlockId, getBlockDef, IS_LIQUID, IS_SOLID } from '@/world/blocks/blocks';
import { isValidY } from '@/world/chunks/coords';
import type { World } from '@/world/World';
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT, type Player, type Vec3Like } from '../player/Player';
import { planPlacement } from './placement';
import { createRaycastHit, raycastVoxels, type RaycastHit } from './voxelRaycast';

/** Game-mode and inventory decisions the interaction system delegates. */
export interface InteractionRules {
  /** Blocks break on click instead of after `hardness` seconds. */
  instantBreak(): boolean;
  /** How many times faster than by hand the held item mines this block (1 = bare hand). */
  miningSpeed?(block: number): number;
  /**
   * Right-click with the held item itself (eating, for instance), tried before
   * anything is placed. Return true when the item was used.
   */
  useItem?(): boolean;
  /** Block the player would place, or 0 when the hand is empty. */
  selectedBlock(): number;
  /** Called after the selected block was placed. */
  onPlaced(block: number): void;
  /** Called after a block was removed by the player. */
  onBroken(block: number): void;
  /** Called for middle-click on a block. */
  onPicked(block: number): void;
  /** Right-click on an existing block. Return true to suppress placement. */
  onUse(hit: RaycastHit): boolean;
}

export interface InteractionEvents {
  broken: { x: number; y: number; z: number; block: number };
  placed: { x: number; y: number; z: number; block: number };
}

const REPEAT_BREAK_INTERVAL = 0.2;
const REPEAT_PLACE_INTERVAL = 0.22;

/** True when a unit block at (bx, by, bz) overlaps the player's body. */
export function blockIntersectsPlayer(bx: number, by: number, bz: number, feet: Vec3Like): boolean {
  return (
    bx + 1 > feet.x - PLAYER_HALF_WIDTH &&
    bx < feet.x + PLAYER_HALF_WIDTH &&
    by + 1 > feet.y &&
    by < feet.y + PLAYER_HEIGHT &&
    bz + 1 > feet.z - PLAYER_HALF_WIDTH &&
    bz < feet.z + PLAYER_HALF_WIDTH
  );
}

/** Whether `block` may be placed at the given cell right now. */
export function canPlaceBlock(
  world: World,
  x: number,
  y: number,
  z: number,
  block: number,
  feet: Vec3Like,
): boolean {
  if (block === BlockId.Air || !isValidY(y)) return false;
  if (!world.isLoadedAt(x, z)) return false;
  const existing = world.getBlock(x, y, z);
  if (existing !== BlockId.Air && IS_LIQUID[existing] !== 1) return false;
  if (existing === block) return false;
  if (IS_SOLID[block] === 1 && blockIntersectsPlayer(x, y, z, feet)) return false;
  return true;
}

/**
 * Targets the block under the crosshair and performs break / place / pick
 * actions. It changes the world only through `World.setBlock`.
 */
export class BlockInteraction {
  readonly events = new Emitter<InteractionEvents>();
  /** Maximum distance at which blocks can be targeted. */
  reach = 6;
  /** Mining progress on the current target, 0..1 (survival mode). */
  breakProgress = 0;
  private readonly hit = createRaycastHit();
  private hasTarget = false;
  private readonly direction: Vec3Like = { x: 0, y: 0, z: 0 };
  private breakCooldown = 0;
  private placeCooldown = 0;
  private miningX = 0;
  private miningY = 0;
  private miningZ = 0;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly world: World,
    private readonly player: Player,
    private readonly input: InputManager,
    private readonly rules: InteractionRules,
  ) {
    this.unsubscribe = input.events.on('action', ({ action }) => {
      if (!input.isLocked) return;
      if (action === 'breakBlock') {
        this.breakCooldown = 0;
        this.tryInstantBreak();
      } else if (action === 'placeBlock') {
        this.placeCooldown = REPEAT_PLACE_INTERVAL;
        this.tryPlace();
      } else if (action === 'pickBlock' && this.hasTarget) {
        this.rules.onPicked(getBlockDef(this.hit.block).item);
      }
    });
  }

  /** The block currently under the crosshair, or null. */
  get target(): Readonly<RaycastHit> | null {
    return this.hasTarget ? this.hit : null;
  }

  update(dt: number): void {
    this.retarget();
    const input = this.input;
    if (!input.isLocked) {
      this.breakProgress = 0;
      return;
    }

    if (input.isActionDown('breakBlock') && this.hasTarget) {
      if (this.rules.instantBreak()) {
        this.breakCooldown -= dt;
        if (this.breakCooldown <= 0) this.tryInstantBreak();
      } else {
        this.mine(dt);
      }
    } else {
      this.breakProgress = 0;
    }

    if (input.isActionDown('placeBlock')) {
      this.placeCooldown -= dt;
      if (this.placeCooldown <= 0) {
        this.placeCooldown = REPEAT_PLACE_INTERVAL;
        this.tryPlace();
      }
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.events.clear();
  }

  /** Re-runs the crosshair raycast from the player's eyes. */
  retarget(): void {
    const { position } = this.player;
    const dir = this.player.getLookDirection(this.direction);
    this.hasTarget = raycastVoxels(
      this.world,
      position.x,
      position.y + this.player.eyeHeight,
      position.z,
      dir.x,
      dir.y,
      dir.z,
      this.reach,
      this.hit,
    );
  }

  /** Removes the targeted block if it is breakable. Returns true on success. */
  breakTarget(): boolean {
    if (!this.hasTarget) return false;
    const { x, y, z, block } = this.hit;
    if (!getBlockDef(block).breakable) return false;
    if (!this.world.setBlock(x, y, z, BlockId.Air)) return false;
    this.breakProgress = 0;
    this.events.emit('broken', { x, y, z, block });
    // The upper half of a door counts as the door, not as itself.
    this.rules.onBroken(getBlockDef(block).item);
    this.retarget();
    return true;
  }

  /** Places the selected block against the targeted face. Returns true on success. */
  tryPlace(): boolean {
    // Using the block under the crosshair comes first, then the held item, then placing.
    if (this.hasTarget && this.rules.onUse(this.hit)) return true;
    if (this.rules.useItem?.()) return true;
    if (!this.hasTarget) return false;
    const block = this.rules.selectedBlock();
    const plan = planPlacement(block, this.hit, this.player.yaw);
    if (!plan) return false;
    // Every part must fit (a door needs both of its cells free).
    for (const part of plan) {
      if (!canPlaceBlock(this.world, part.x, part.y, part.z, part.block, this.player.position)) {
        return false;
      }
    }
    for (const part of plan) this.world.setBlock(part.x, part.y, part.z, part.block, part.meta);
    const { x, y, z } = plan[0]!;
    this.events.emit('placed', { x, y, z, block });
    this.rules.onPlaced(block);
    this.retarget();
    return true;
  }

  private tryInstantBreak(): void {
    if (!this.rules.instantBreak()) return;
    this.breakCooldown = REPEAT_BREAK_INTERVAL;
    this.breakTarget();
  }

  private mine(dt: number): void {
    const { x, y, z, block } = this.hit;
    if (x !== this.miningX || y !== this.miningY || z !== this.miningZ) {
      this.miningX = x;
      this.miningY = y;
      this.miningZ = z;
      this.breakProgress = 0;
    }
    const def = getBlockDef(block);
    if (!def.breakable) {
      this.breakProgress = 0;
      return;
    }
    const speed = this.rules.miningSpeed?.(block) ?? 1;
    this.breakProgress += (dt * speed) / Math.max(0.05, def.hardness);
    if (this.breakProgress >= 1) this.breakTarget();
  }
}
