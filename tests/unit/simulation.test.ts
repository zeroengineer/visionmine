import { describe, expect, it } from 'vitest';
import { EditHistory } from '@/gameplay/building/EditHistory';
import { installAttachmentRules } from '@/gameplay/interaction/attachments';
import { BlockId, getBlockDef } from '@/world/blocks/blocks';
import { FaceMesher } from '@/world/meshing/FaceMesher';
import { FACE_STRIDE } from '@/world/meshing/types';
import {
  BlockTicker,
  MAX_WATER_LEVEL,
  STEPS_PER_TICK,
  TICK_BUDGET,
} from '@/world/simulation/BlockTicker';
import type { World } from '@/world/World';
import { flatWorld } from './helpers';

/** Stone floor with its top at y = 11, and a ticker watching it. */
function setup(radius = 1) {
  const world = flatWorld(10, radius);
  const ticker = new BlockTicker(world);
  /** Runs ticks until nothing is left to do; returns how many it took. */
  const settle = (limit = 400): number => {
    let ticks = 0;
    while (ticker.pending > 0 && ticks < limit) {
      ticker.runTick();
      ticks++;
    }
    return ticks;
  };
  return { world, ticker, settle };
}

function countBlock(world: World, block: number, y: number, radius = 12): number {
  let n = 0;
  for (let x = 8 - radius; x <= 8 + radius; x++) {
    for (let z = 8 - radius; z <= 8 + radius; z++) {
      if (world.getBlock(x, y, z) === block) n++;
    }
  }
  return n;
}

describe('falling blocks', () => {
  it('are sand and gravel only', () => {
    expect(getBlockDef(BlockId.Sand).falls).toBe(true);
    expect(getBlockDef(BlockId.Gravel).falls).toBe(true);
    expect(getBlockDef(BlockId.Stone).falls).toBe(false);
    expect(getBlockDef(BlockId.Dirt).falls).toBe(false);
  });

  it('drop until they land', () => {
    const { world, ticker, settle } = setup();
    world.setBlock(8, 16, 8, BlockId.Sand);
    ticker.runTick();
    // One cell per tick.
    expect(world.getBlock(8, 16, 8)).toBe(BlockId.Air);
    expect(world.getBlock(8, 15, 8)).toBe(BlockId.Sand);
    settle();
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Sand);
    expect(countBlock(world, BlockId.Sand, 12)).toBe(0);
    expect(ticker.pending).toBe(0);
  });

  it('stay put on solid ground and do nothing without a change nearby', () => {
    const { world, ticker, settle } = setup();
    world.setBlock(8, 11, 8, BlockId.Gravel);
    settle();
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Gravel);
    expect(ticker.runTick()).toBe(0);
  });

  it('come down as a column when the block under them is removed', () => {
    const { world, settle } = setup();
    world.setBlock(8, 11, 8, BlockId.Stone);
    for (let y = 12; y <= 15; y++) world.setBlock(8, y, 8, BlockId.Sand);
    settle();
    expect(world.getBlock(8, 15, 8)).toBe(BlockId.Sand);

    world.setBlock(8, 11, 8, BlockId.Air);
    settle();
    for (let y = 11; y <= 14; y++) expect(world.getBlock(8, y, 8)).toBe(BlockId.Sand);
    expect(world.getBlock(8, 15, 8)).toBe(BlockId.Air);
  });

  it('sink through water and flatten plants', () => {
    const { world, settle } = setup();
    installAttachmentRules(world);
    // A one-block pool with a plant beside it.
    world.setBlock(8, 10, 8, BlockId.Water);
    world.setBlock(9, 11, 8, BlockId.TallGrass);
    settle();
    world.setBlock(8, 14, 8, BlockId.Sand);
    world.setBlock(9, 14, 8, BlockId.Gravel);
    settle();
    expect(world.getBlock(8, 10, 8)).toBe(BlockId.Sand);
    expect(world.getBlock(9, 11, 8)).toBe(BlockId.Gravel);
  });

  it('are not recorded as edits to undo', () => {
    const { world, settle } = setup();
    const history = new EditHistory(world);
    world.setBlock(8, 15, 8, BlockId.Sand);
    history.commit();
    settle();
    history.commit();
    expect(history.undoCount).toBe(1);
    // Undo reverts what the player did: the placement, at the place it was made.
    expect(history.undo()).toBe(1);
  });

  it('wait at the edge of the loaded world', () => {
    const { world, ticker, settle } = setup(0);
    world.setBlock(8, 14, 8, BlockId.Sand);
    const chunk = world.getChunk(0, 0)!;
    world.removeChunk(chunk.key);
    expect(() => settle()).not.toThrow();
    expect(ticker.pending).toBe(0);
  });
});

describe('the tick budget', () => {
  it('spreads a large collapse over several ticks', () => {
    const { world, ticker } = setup();
    // A 30 × 30 sheet of sand two blocks above the floor.
    for (let x = -7; x <= 22; x++) {
      for (let z = -7; z <= 22; z++) world.setBlock(x, 13, z, BlockId.Sand);
    }
    expect(ticker.pending).toBe(900);
    expect(ticker.runTick()).toBe(TICK_BUDGET);
    let ticks = 1;
    while (ticker.pending > 0 && ticks < 100) {
      expect(ticker.runTick()).toBeLessThanOrEqual(TICK_BUDGET);
      ticks++;
    }
    expect(ticks).toBeGreaterThan(2);
    let landed = 0;
    for (let x = -7; x <= 22; x++) {
      for (let z = -7; z <= 22; z++) if (world.getBlock(x, 11, z) === BlockId.Sand) landed++;
    }
    expect(landed).toBe(900);
  });

  it('runs a tick every few simulation steps', () => {
    const { world, ticker } = setup();
    world.setBlock(8, 14, 8, BlockId.Sand);
    for (let i = 0; i < STEPS_PER_TICK - 1; i++) ticker.step();
    expect(world.getBlock(8, 14, 8)).toBe(BlockId.Sand);
    ticker.step();
    expect(world.getBlock(8, 13, 8)).toBe(BlockId.Sand);
  });
});

describe('flowing water', () => {
  it('spreads from a source, thinning by one level per block, and then stops', () => {
    const { world, ticker, settle } = setup();
    world.setBlock(8, 11, 8, BlockId.Water);
    settle();
    expect(ticker.pending).toBe(0);

    expect(world.getMeta(8, 11, 8)).toBe(0);
    expect(world.getBlock(9, 11, 8)).toBe(BlockId.Water);
    expect(world.getMeta(9, 11, 8)).toBe(1);
    expect(world.getMeta(8, 11, 13)).toBe(5);
    expect(world.getMeta(15, 11, 8)).toBe(MAX_WATER_LEVEL);
    expect(world.getBlock(16, 11, 8)).toBe(BlockId.Air);
    // Levels count steps along the axes, so the pool is a diamond: 1 + 4·(1+…+7) cells.
    expect(world.getMeta(10, 11, 10)).toBe(4);
    expect(world.getBlock(12, 11, 12)).toBe(BlockId.Air);
    expect(countBlock(world, BlockId.Water, 11)).toBe(1 + 4 * 28);
    // Nothing climbed.
    expect(countBlock(world, BlockId.Water, 12)).toBe(0);
  });

  it('drains away when its source is removed', () => {
    const { world, settle } = setup();
    world.setBlock(8, 11, 8, BlockId.Water);
    settle();
    world.setBlock(8, 11, 8, BlockId.Stone);
    settle();
    expect(countBlock(world, BlockId.Water, 11)).toBe(0);
  });

  it('is held back by walls and flows around them', () => {
    const { world, settle } = setup();
    for (let z = 7; z <= 9; z++) world.setBlock(10, 11, z, BlockId.Stone);
    world.setBlock(8, 11, 8, BlockId.Water);
    settle();
    expect(world.getBlock(10, 11, 8)).toBe(BlockId.Stone);
    // Directly behind the wall the water arrived the long way round, so it is thinner.
    expect(world.getBlock(11, 11, 8)).toBe(BlockId.Water);
    // Straight through it would be level 3; round the end of the wall it is 7.
    expect(world.getMeta(11, 11, 8)).toBe(MAX_WATER_LEVEL);
  });

  it('falls off a ledge at full strength and spreads again below', () => {
    const { world, settle } = setup();
    // A platform three blocks up with the source at its edge.
    for (let x = 6; x <= 8; x++) {
      for (let z = 6; z <= 10; z++) world.setBlock(x, 13, z, BlockId.Stone);
    }
    world.setBlock(8, 14, 8, BlockId.Water);
    settle();
    // Over the edge the water drops…
    expect(world.getBlock(9, 14, 8)).toBe(BlockId.Water);
    for (let y = 11; y <= 13; y++) {
      expect(world.getBlock(9, y, 8)).toBe(BlockId.Water);
      expect(world.getMeta(9, y, 8)).toBe(1);
    }
    // …and at the bottom spreads from level 1, not from where it left off.
    expect(world.getMeta(10, 11, 8)).toBe(2);
    // It does not spread sideways in mid-air.
    expect(world.getBlock(10, 13, 8)).toBe(BlockId.Air);
  });

  it('fills a pit and washes away plants and torches', () => {
    const { world, settle } = setup();
    installAttachmentRules(world);
    world.setBlock(10, 10, 8, BlockId.Air);
    world.setBlock(9, 11, 8, BlockId.Torch);
    world.setBlock(8, 11, 9, BlockId.FlowerRed);
    world.setBlock(8, 11, 8, BlockId.Water);
    settle();
    expect(world.getBlock(10, 10, 8)).toBe(BlockId.Water);
    expect(world.getBlock(9, 11, 8)).toBe(BlockId.Water);
    expect(world.getBlock(8, 11, 9)).toBe(BlockId.Water);
  });

  it('leaves still water alone and lets it into a new opening', () => {
    const { world, ticker, settle } = setup();
    // A filled basin of source water, as the generator makes lakes.
    for (let x = 4; x <= 8; x++) world.setBlock(x, 10, 8, BlockId.Water);
    settle();
    expect(countBlock(world, BlockId.Water, 11)).toBe(0);
    expect(ticker.pending).toBe(0);

    // Dig a channel from its end: the water follows.
    world.setBlock(9, 10, 8, BlockId.Air);
    world.setBlock(10, 10, 8, BlockId.Air);
    settle();
    expect(world.getMeta(9, 10, 8)).toBe(1);
    expect(world.getMeta(10, 10, 8)).toBe(2);
  });

  it('is not recorded as edits to undo', () => {
    const { world, settle } = setup();
    const history = new EditHistory(world);
    world.setBlock(8, 11, 8, BlockId.Water);
    history.commit();
    settle();
    history.commit();
    expect(history.undoCount).toBe(1);
    // Undoing the placement removes the source, and the rest then drains.
    history.undo();
    settle();
    expect(countBlock(world, BlockId.Water, 11)).toBe(0);
  });

  it('is drawn shallower the further it has flowed', () => {
    const { world, settle } = setup();
    world.setBlock(8, 11, 8, BlockId.Water);
    settle();
    const data = new FaceMesher().mesh(world.getChunk(0, 0)!, (cx, cz) => world.getChunk(cx, cz));
    const tops = new Map<string, number>();
    for (let i = 0; i < data.translucent.count; i++) {
      const s = i * FACE_STRIDE;
      const d = data.translucent.data;
      if (d[s + 3] === 2) tops.set(`${Math.round(d[s]!)},${Math.round(d[s + 2]!)}`, d[s + 1]!);
    }
    const source = tops.get('8,8')!;
    const near = tops.get('9,8')!;
    const far = tops.get('14,8')!;
    expect(source).toBeLessThan(11);
    expect(near).toBeLessThan(source);
    expect(far).toBeLessThan(near);
    expect(far).toBeGreaterThan(10);
  });
});
