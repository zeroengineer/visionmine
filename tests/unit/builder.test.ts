import { describe, expect, it } from 'vitest';
import { BuildTools } from '@/gameplay/building/BuildTools';
import { EditHistory, MAX_HISTORY_GROUPS } from '@/gameplay/building/EditHistory';
import {
  clearRegion,
  copyRegion,
  fillRegion,
  isRegionLoaded,
  MAX_REGION_BLOCKS,
  pasteClipboard,
  regionFromCorners,
  regionSize,
  regionVolume,
  replaceRegion,
  rotateClipboard,
  type Region,
} from '@/gameplay/building/regionOps';
import { explode } from '@/gameplay/interaction/explosion';
import { mulberry32 } from '@/utils/rng';
import { BlockId } from '@/world/blocks/blocks';
import type { World } from '@/world/World';
import { flatWorld } from './helpers';

/** Counts blocks of one kind in a region. */
function count(world: World, region: Region, block: number): number {
  let n = 0;
  for (let y = region.minY; y <= region.maxY; y++) {
    for (let z = region.minZ; z <= region.maxZ; z++) {
      for (let x = region.minX; x <= region.maxX; x++) {
        if (world.getBlock(x, y, z) === block) n++;
      }
    }
  }
  return n;
}

/** A 3 × 2 × 4 box of air sitting on the stone floor (top at y = 10). */
const BOX = regionFromCorners({ x: 4, y: 11, z: 9 }, { x: 2, y: 12, z: 6 });

describe('regions', () => {
  it('are normalised from any two corners', () => {
    expect(BOX).toEqual({ minX: 2, minY: 11, minZ: 6, maxX: 4, maxY: 12, maxZ: 9 });
    expect(regionSize(BOX)).toEqual({ sx: 3, sy: 2, sz: 4 });
    expect(regionVolume(BOX)).toBe(24);
    const single = regionFromCorners({ x: 1, y: 5, z: 1 }, { x: 1, y: 5, z: 1 });
    expect(regionVolume(single)).toBe(1);
  });

  it('are clamped to the height of the world', () => {
    const tall = regionFromCorners({ x: 0, y: -20, z: 0 }, { x: 0, y: 500, z: 0 });
    expect(tall.minY).toBe(0);
    expect(tall.maxY).toBe(127);
  });

  it('know whether all their chunks are loaded', () => {
    const world = flatWorld(10, 1);
    expect(isRegionLoaded(world, BOX)).toBe(true);
    const outside = regionFromCorners({ x: 30, y: 11, z: 0 }, { x: 40, y: 11, z: 0 });
    expect(isRegionLoaded(world, outside)).toBe(false);
  });
});

describe('region operations', () => {
  it('fill every cell and report how many changed', () => {
    const world = flatWorld(10);
    expect(fillRegion(world, BOX, BlockId.Brick)).toBe(24);
    expect(count(world, BOX, BlockId.Brick)).toBe(24);
    // Filling again changes nothing.
    expect(fillRegion(world, BOX, BlockId.Brick)).toBe(0);
    // Nothing outside the region was touched.
    expect(world.getBlock(5, 11, 6)).toBe(BlockId.Air);
    expect(world.getBlock(2, 13, 6)).toBe(BlockId.Air);
  });

  it('skip cells the caller excludes', () => {
    const world = flatWorld(10);
    const changed = fillRegion(world, BOX, BlockId.Brick, (x, _y, z) => x === 3 && z === 7);
    expect(changed).toBe(22);
    expect(world.getBlock(3, 11, 7)).toBe(BlockId.Air);
    expect(world.getBlock(3, 12, 7)).toBe(BlockId.Air);
  });

  it('replace existing blocks but not air', () => {
    const world = flatWorld(10);
    world.setBlock(2, 11, 6, BlockId.Planks);
    world.setBlock(3, 11, 6, BlockId.Glass);
    expect(replaceRegion(world, BOX, BlockId.Brick)).toBe(2);
    expect(count(world, BOX, BlockId.Brick)).toBe(2);
    expect(count(world, BOX, BlockId.Air)).toBe(22);
  });

  it('clear to air and never remove bedrock', () => {
    const world = flatWorld(10);
    fillRegion(world, BOX, BlockId.Brick);
    world.setBlock(2, 11, 6, BlockId.Bedrock);
    expect(clearRegion(world, BOX)).toBe(23);
    expect(world.getBlock(2, 11, 6)).toBe(BlockId.Bedrock);
    expect(fillRegion(world, BOX, BlockId.Planks)).toBe(23);
    expect(world.getBlock(2, 11, 6)).toBe(BlockId.Bedrock);
  });

  it('copy and paste a shape, leaving existing blocks where the copy has air', () => {
    const world = flatWorld(10);
    world.setBlock(2, 11, 6, BlockId.Brick);
    world.setBlock(4, 12, 9, BlockId.Glass);
    const clipboard = copyRegion(world, BOX);
    expect([clipboard.sx, clipboard.sy, clipboard.sz]).toEqual([3, 2, 4]);

    world.setBlock(11, 11, 3, BlockId.Planks);
    expect(pasteClipboard(world, clipboard, { x: 10, y: 11, z: 2 })).toBe(2);
    expect(world.getBlock(10, 11, 2)).toBe(BlockId.Brick);
    expect(world.getBlock(12, 12, 5)).toBe(BlockId.Glass);
    expect(world.getBlock(11, 11, 3)).toBe(BlockId.Planks);
  });

  it('rotate a copy a quarter turn at a time and return to the start after four', () => {
    const world = flatWorld(10);
    world.setBlock(2, 11, 6, BlockId.Brick); // corner (0, 0, 0) of the copy
    world.setBlock(4, 11, 6, BlockId.Glass); // corner (2, 0, 0)
    const original = copyRegion(world, BOX);
    const turned = rotateClipboard(original);
    expect([turned.sx, turned.sy, turned.sz]).toEqual([4, 2, 3]);
    const at = (c: typeof turned, x: number, z: number): number => c.blocks[x + z * c.sx]!;
    // Clockwise from above: +X becomes +Z, so (0,0) moves to the far X edge.
    expect(at(turned, 3, 0)).toBe(BlockId.Brick);
    expect(at(turned, 3, 2)).toBe(BlockId.Glass);

    let full = original;
    for (let i = 0; i < 4; i++) full = rotateClipboard(full);
    expect(full).toEqual(original);
  });
});

describe('edit history', () => {
  it('undoes and redoes a group of changes as one step', () => {
    const world = flatWorld(10);
    const history = new EditHistory(world);
    world.setBlock(8, 11, 8, BlockId.Brick);
    world.setBlock(9, 11, 8, BlockId.Glass);
    history.commit();
    expect(history.canUndo).toBe(true);

    expect(history.undo()).toBe(2);
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Air);
    expect(world.getBlock(9, 11, 8)).toBe(BlockId.Air);
    expect(history.canUndo).toBe(false);

    expect(history.redo()).toBe(2);
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Brick);
    expect(world.getBlock(9, 11, 8)).toBe(BlockId.Glass);
    expect(history.canRedo).toBe(false);
  });

  it('keeps separate commits as separate steps, newest first', () => {
    const world = flatWorld(10);
    const history = new EditHistory(world);
    world.setBlock(8, 11, 8, BlockId.Brick);
    history.commit();
    world.setBlock(8, 12, 8, BlockId.Glass);
    history.commit();

    history.undo();
    expect(world.getBlock(8, 12, 8)).toBe(BlockId.Air);
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Brick);
    history.undo();
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Air);
    expect(history.undo()).toBe(0);
  });

  it('collapses repeated edits of one block and drops changes that cancel out', () => {
    const world = flatWorld(10);
    const history = new EditHistory(world);
    world.setBlock(8, 10, 8, BlockId.Brick); // was stone
    world.setBlock(8, 10, 8, BlockId.Glass);
    world.setBlock(9, 11, 8, BlockId.Brick);
    world.setBlock(9, 11, 8, BlockId.Air); // back to what it was
    history.commit();
    expect(history.undo()).toBe(1);
    expect(world.getBlock(8, 10, 8)).toBe(BlockId.Stone);
  });

  it('discards the redo stack when a new edit is made', () => {
    const world = flatWorld(10);
    const history = new EditHistory(world);
    world.setBlock(8, 11, 8, BlockId.Brick);
    history.commit();
    history.undo();
    expect(history.canRedo).toBe(true);
    world.setBlock(9, 11, 8, BlockId.Glass);
    history.commit();
    expect(history.canRedo).toBe(false);
  });

  it('undoes an explosion in one step', () => {
    const world = flatWorld(10);
    const history = new EditHistory(world);
    const removed = explode(world, 8, 10, 8, 3, 0.25, mulberry32(1)).removed.length;
    expect(removed).toBeGreaterThan(10);
    history.commit();
    expect(history.undo()).toBe(removed);
    expect(world.getBlock(8, 10, 8)).toBe(BlockId.Stone);
    expect(world.getBlock(8, 8, 8)).toBe(BlockId.Stone);
  });

  it('is bounded and does not record its own undo or while disabled', () => {
    const world = flatWorld(10);
    const history = new EditHistory(world);
    for (let i = 0; i < MAX_HISTORY_GROUPS + 20; i++) {
      world.setBlock(8, 11, 8, i % 2 === 0 ? BlockId.Brick : BlockId.Air);
      history.commit();
    }
    expect(history.undoCount).toBe(MAX_HISTORY_GROUPS);
    history.undo();
    history.commit();
    expect(history.undoCount).toBe(MAX_HISTORY_GROUPS - 1);

    history.clear();
    history.enabled = false;
    world.setBlock(9, 11, 9, BlockId.Brick);
    history.commit();
    expect(history.canUndo).toBe(false);
  });

  it('refuses to undo changes in chunks that are no longer loaded', () => {
    const world = flatWorld(10);
    const history = new EditHistory(world);
    world.setBlock(8, 11, 8, BlockId.Brick);
    history.commit();
    const chunk = world.getChunk(0, 0)!;
    world.removeChunk(chunk.key);
    expect(history.undo()).toBe(-1);
    // Still available once the chunk is back.
    world.addChunk(chunk);
    expect(history.undo()).toBe(1);
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Air);
  });
});

describe('build tools', () => {
  const context = { heldBlock: BlockId.Brick as number, pasteOrigin: null };

  function tools() {
    const world = flatWorld(10);
    return { world, build: new BuildTools(world) };
  }

  it('builds a selection from two marked corners and starts over on the third', () => {
    const { build } = tools();
    expect(build.markCorner(null).ok).toBe(false);
    expect(build.markCorner({ x: 4, y: 11, z: 9 }).ok).toBe(true);
    expect(build.selection).toBeNull();
    expect(build.markCorner({ x: 2, y: 12, z: 6 }).message).toBe('Selected 3 × 2 × 4.');
    expect(build.selection).toEqual(BOX);
    build.markCorner({ x: 0, y: 11, z: 0 });
    expect(build.selection).toBeNull();
    expect(build.corners.a).toEqual({ x: 0, y: 11, z: 0 });
  });

  it('fills, undoes and redoes the selection', () => {
    const { world, build } = tools();
    build.markCorner({ x: 4, y: 11, z: 9 });
    build.markCorner({ x: 2, y: 12, z: 6 });

    expect(build.run('fill', context)).toEqual({
      ok: true,
      message: 'Filled 24 blocks with Bricks.',
    });
    expect(count(world, BOX, BlockId.Brick)).toBe(24);
    expect(build.undo().message).toBe('Undid 24 blocks.');
    expect(count(world, BOX, BlockId.Air)).toBe(24);
    expect(build.redo().message).toBe('Redid 24 blocks.');
    expect(count(world, BOX, BlockId.Brick)).toBe(24);
    expect(build.run('clear', context).message).toBe('Cleared 24 blocks.');
    expect(build.undo().ok).toBe(true);
    expect(count(world, BOX, BlockId.Brick)).toBe(24);
  });

  it('keeps an earlier edit as its own undo step', () => {
    const { world, build } = tools();
    world.setBlock(8, 11, 8, BlockId.Glass); // a normal click, not yet committed
    build.markCorner({ x: 4, y: 11, z: 9 });
    build.markCorner({ x: 2, y: 12, z: 6 });
    build.run('fill', context);
    build.undo();
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Glass);
    build.undo();
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Air);
  });

  it('copies, rotates and pastes', () => {
    const { world, build } = tools();
    world.setBlock(2, 11, 6, BlockId.Planks);
    build.markCorner({ x: 4, y: 11, z: 9 });
    build.markCorner({ x: 2, y: 12, z: 6 });
    expect(build.run('paste', context).ok).toBe(false);
    expect(build.run('copy', context).message).toBe('Copied 24 blocks.');
    expect(build.run('paste', context).message).toBe('Look at a block to paste against.');
    expect(build.run('rotate', context).message).toBe('Copy rotated: 4 × 2 × 3.');

    const pasted = build.run('paste', { ...context, pasteOrigin: { x: 10, y: 11, z: 10 } });
    expect(pasted.message).toBe('Pasted 1 block.');
    expect(world.getBlock(13, 11, 10)).toBe(BlockId.Planks);
    build.undo();
    expect(world.getBlock(13, 11, 10)).toBe(BlockId.Air);
  });

  it('refuses work without a selection, a held block, or within limits', () => {
    const { build } = tools();
    expect(build.run('fill', context).message).toBe('Mark two corners first.');
    build.markCorner({ x: 0, y: 11, z: 0 });
    build.markCorner({ x: 2, y: 11, z: 2 });
    expect(build.run('fill', { ...context, heldBlock: 0 }).message).toBe(
      'Hold a block to build with.',
    );

    build.markCorner({ x: -16, y: 0, z: -16 });
    build.markCorner({ x: 31, y: 40, z: 31 });
    const tooBig = build.run('fill', context);
    expect(tooBig.ok).toBe(false);
    expect(tooBig.message).toContain(MAX_REGION_BLOCKS.toLocaleString('en-US'));

    build.markCorner({ x: 30, y: 11, z: 0 });
    build.markCorner({ x: 40, y: 11, z: 0 });
    expect(build.run('fill', context).message).toBe(
      'Part of that area is not loaded. Move closer.',
    );
  });

  it('does nothing and forgets everything when the mode does not allow it', () => {
    const { world, build } = tools();
    build.markCorner({ x: 4, y: 11, z: 9 });
    build.markCorner({ x: 2, y: 12, z: 6 });
    build.run('copy', context);
    world.setBlock(8, 11, 8, BlockId.Glass);
    build.history.commit();

    build.enabled = false;
    expect(build.selection).toBeNull();
    expect(build.clipboard).toBeNull();
    expect(build.undo().ok).toBe(false);
    expect(build.markCorner({ x: 0, y: 11, z: 0 }).ok).toBe(false);
    expect(build.run('fill', context).ok).toBe(false);
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Glass);
  });
});
