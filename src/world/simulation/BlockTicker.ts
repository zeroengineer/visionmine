import { BlockId, getBlockDef, IS_LIQUID, IS_SOLID } from '../blocks/blocks';
import { CHUNK_HEIGHT } from '../constants';
import type { World } from '../World';

/** Simulation steps (at 60 per second) between two ticks: ten ticks a second. */
export const STEPS_PER_TICK = 6;
/** Most block updates run in one tick; the rest wait for the next. */
export const TICK_BUDGET = 512;
/** Ticks before a falling block moves again, and before water spreads again. */
const FALL_DELAY = 1;
const WATER_DELAY = 3;
/** Flowing water thins by one level per block and stops after this many. */
export const MAX_WATER_LEVEL = 7;

const KEY_OFFSET = 524288; // 2^19: positions up to ±524,287 on x and z
const KEY_SPAN = 1048576;

function key(x: number, y: number, z: number): number {
  return ((x + KEY_OFFSET) * KEY_SPAN + (z + KEY_OFFSET)) * CHUNK_HEIGHT + y;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0],
  [0, -1, 0],
];
const SIDES = NEIGHBOURS.slice(0, 4);

/**
 * Runs the rules that make the world move on its own: sand and gravel fall,
 * and water flows downhill and spreads. Nothing is scanned: a block is looked
 * at only when it or a neighbour has just changed, so still terrain costs
 * nothing, and the work per tick is capped.
 *
 * Changes are written with `simulated` set, so undo history can tell them
 * apart from what the player did.
 */
export class BlockTicker {
  /** Cell key → tick at which it is due. */
  private readonly due = new Map<number, number>();
  private readonly positions = new Map<number, readonly [number, number, number]>();
  private readonly batch: number[] = [];
  private tick = 0;
  private steps = 0;
  private readonly unsubscribe: () => void;

  constructor(private readonly world: World) {
    this.unsubscribe = world.events.on('blockChanged', ({ x, y, z }) => {
      this.schedule(x, y, z);
      for (const [dx, dy, dz] of NEIGHBOURS) this.schedule(x + dx, y + dy, z + dz);
    });
  }

  /** Number of cells waiting to be looked at. */
  get pending(): number {
    return this.due.size;
  }

  /** Call once per simulation step; runs a tick every `STEPS_PER_TICK` calls. */
  step(): void {
    if (++this.steps < STEPS_PER_TICK) return;
    this.steps = 0;
    this.runTick();
  }

  /** Runs one tick now. Returns how many cells were updated. */
  runTick(): number {
    this.tick++;
    const batch = this.batch;
    batch.length = 0;
    for (const [cell, when] of this.due) {
      if (when > this.tick) continue;
      batch.push(cell);
      if (batch.length >= TICK_BUDGET) break;
    }
    for (const cell of batch) {
      const position = this.positions.get(cell)!;
      this.due.delete(cell);
      this.positions.delete(cell);
      this.update(position[0], position[1], position[2]);
    }
    return batch.length;
  }

  dispose(): void {
    this.unsubscribe();
    this.due.clear();
    this.positions.clear();
  }

  /** Queues a cell if a rule could apply to what is there. An earlier due time wins. */
  private schedule(x: number, y: number, z: number): void {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    const block = this.world.getBlock(x, y, z);
    const delay = IS_LIQUID[block] === 1 ? WATER_DELAY : getBlockDef(block).falls ? FALL_DELAY : 0;
    if (delay === 0) return;
    const cell = key(x, y, z);
    const when = this.tick + delay;
    const existing = this.due.get(cell);
    if (existing !== undefined && existing <= when) return;
    this.due.set(cell, when);
    if (existing === undefined) this.positions.set(cell, [x, y, z]);
  }

  private update(x: number, y: number, z: number): void {
    const world = this.world;
    // Work stops at the edge of the loaded world; it resumes when something changes there.
    if (!world.isLoadedAt(x, z)) return;
    const block = world.getBlock(x, y, z);
    if (IS_LIQUID[block] === 1) this.updateWater(x, y, z, block);
    else if (getBlockDef(block).falls) this.updateFalling(x, y, z, block);
  }

  /** A cell that a falling block or flowing water may move into. */
  private isOpen(x: number, y: number, z: number): boolean {
    if (y < 0 || !this.world.isLoadedAt(x, z)) return false;
    const block = this.world.getBlock(x, y, z);
    if (block === BlockId.Air) return true;
    // Plants and torches are swept away.
    return IS_SOLID[block] !== 1 && IS_LIQUID[block] !== 1 && getBlockDef(block).needsSupport;
  }

  private updateFalling(x: number, y: number, z: number, block: number): void {
    const world = this.world;
    const below = world.getBlock(x, y - 1, z);
    if (!this.isOpen(x, y - 1, z) && IS_LIQUID[below] !== 1) return;
    // Move down one cell; the change schedules the next step of the fall.
    world.setBlock(x, y, z, BlockId.Air, 0, true);
    world.setBlock(x, y - 1, z, block, 0, true);
  }

  private updateWater(x: number, y: number, z: number, block: number): void {
    const world = this.world;
    let level = world.getMeta(x, y, z);

    if (level !== 0) {
      // Flowing water lasts only while something feeds it: water above, or
      // thicker water beside it.
      let fed = MAX_WATER_LEVEL + 1;
      if (IS_LIQUID[world.getBlock(x, y + 1, z)] === 1) {
        fed = 1;
      } else {
        for (const [dx, , dz] of SIDES) {
          if (IS_LIQUID[world.getBlock(x + dx, y, z + dz)] !== 1) continue;
          fed = Math.min(fed, world.getMeta(x + dx, y, z + dz) + 1);
        }
      }
      if (fed > MAX_WATER_LEVEL) {
        world.setBlock(x, y, z, BlockId.Air, 0, true);
        return;
      }
      if (fed !== level) {
        world.setBlock(x, y, z, block, fed, true);
        level = fed;
      }
    }

    if (this.isOpen(x, y - 1, z)) {
      // Falling water arrives at full strength.
      world.setBlock(x, y - 1, z, block, 1, true);
      return;
    }
    // Over more water there is nothing to spread onto.
    if (IS_LIQUID[world.getBlock(x, y - 1, z)] === 1 || level >= MAX_WATER_LEVEL) return;
    for (const [dx, , dz] of SIDES) {
      if (this.isOpen(x + dx, y, z + dz)) world.setBlock(x + dx, y, z + dz, block, level + 1, true);
    }
  }
}
