import { describe, expect, it } from 'vitest';
import { EditHistory } from '@/gameplay/building/EditHistory';
import {
  copyRegion,
  pasteClipboard,
  regionFromCorners,
  rotateClipboard,
} from '@/gameplay/building/regionOps';
import { BlockId } from '@/world/blocks/blocks';
import { Chunk } from '@/world/chunks/Chunk';
import { blockIndex, chunkKey } from '@/world/chunks/coords';
import { cellBlock, cellMeta, packCell, World } from '@/world/World';
import { flatWorld } from './helpers';

describe('block state', () => {
  it('packs a block id and its state into one cell', () => {
    expect(packCell(BlockId.Stone, 0)).toBe(BlockId.Stone);
    const cell = packCell(BlockId.Planks, 5);
    expect(cellBlock(cell)).toBe(BlockId.Planks);
    expect(cellMeta(cell)).toBe(5);
    expect(cellMeta(packCell(1, 0x1ff))).toBe(0xff);
  });

  it('is stored per block and defaults to zero', () => {
    const world = flatWorld(10);
    expect(world.getMeta(8, 10, 8)).toBe(0);
    expect(world.setBlock(8, 11, 8, BlockId.Planks, 3)).toBe(true);
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Planks);
    expect(world.getMeta(8, 11, 8)).toBe(3);
    expect(world.getMeta(9, 11, 8)).toBe(0);
    // Out of range and unloaded space read as zero.
    expect(world.getMeta(8, -1, 8)).toBe(0);
    expect(world.getMeta(8, 200, 8)).toBe(0);
    expect(world.getMeta(500, 11, 500)).toBe(0);
  });

  it('counts a state change on the same block as a change', () => {
    const world = flatWorld(10);
    const events: Array<[number, number, number, number]> = [];
    world.events.on('blockChanged', (e) =>
      events.push([e.previous, e.next, e.previousMeta, e.nextMeta]),
    );
    world.setBlock(8, 11, 8, BlockId.Planks, 1);
    expect(world.setBlock(8, 11, 8, BlockId.Planks, 1)).toBe(false);
    expect(world.setBlock(8, 11, 8, BlockId.Planks, 2)).toBe(true);
    // Setting a block without naming a state resets it.
    expect(world.setBlock(8, 11, 8, BlockId.Planks)).toBe(true);
    expect(world.getMeta(8, 11, 8)).toBe(0);
    expect(events).toEqual([
      [BlockId.Air, BlockId.Planks, 0, 1],
      [BlockId.Planks, BlockId.Planks, 1, 2],
      [BlockId.Planks, BlockId.Planks, 2, 0],
    ]);
  });

  it('allocates the state array only for chunks that need it', () => {
    const chunk = new Chunk(0, 0);
    expect(chunk.meta).toBeNull();
    chunk.setMeta(5, 0);
    expect(chunk.meta).toBeNull();
    chunk.setMeta(5, 9);
    expect(chunk.meta).not.toBeNull();
    expect(chunk.getMeta(5)).toBe(9);
    expect(chunk.getMeta(6)).toBe(0);
  });

  it('survives a chunk being unloaded and loaded again', () => {
    const world = flatWorld(10);
    world.setBlock(8, 11, 8, BlockId.Planks, 7);
    const key = chunkKey(0, 0);
    const index = blockIndex(8, 11, 8);
    expect(world.getEdits(key)?.get(index)).toBe(packCell(BlockId.Planks, 7));

    world.removeChunk(key);
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Air);
    // The chunk comes back freshly generated, without the edit.
    world.addChunk(new Chunk(0, 0));
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Planks);
    expect(world.getMeta(8, 11, 8)).toBe(7);
  });

  it('is restored from loaded edits', () => {
    const world = new World();
    world.loadEdits(new Map([[chunkKey(0, 0), new Map([[blockIndex(1, 2, 3), packCell(11, 4)]])]]));
    world.addChunk(new Chunk(0, 0));
    expect(world.getBlock(1, 2, 3)).toBe(11);
    expect(world.getMeta(1, 2, 3)).toBe(4);
  });

  it('is undone and redone with the block', () => {
    const world = flatWorld(10);
    const history = new EditHistory(world);
    world.setBlock(8, 11, 8, BlockId.Planks, 2);
    history.commit();
    world.setBlock(8, 11, 8, BlockId.Planks, 6); // state only
    history.commit();

    history.undo();
    expect(world.getMeta(8, 11, 8)).toBe(2);
    history.undo();
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Air);
    history.redo();
    history.redo();
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Planks);
    expect(world.getMeta(8, 11, 8)).toBe(6);
  });

  it('is carried by copy, rotate and paste', () => {
    const world = flatWorld(10);
    world.setBlock(2, 11, 6, BlockId.Planks, 9);
    const region = regionFromCorners({ x: 2, y: 11, z: 6 }, { x: 3, y: 11, z: 6 });
    const clipboard = copyRegion(world, region);
    expect([...clipboard.meta]).toEqual([9, 0]);

    pasteClipboard(world, rotateClipboard(clipboard), { x: 10, y: 11, z: 10 });
    expect(world.getBlock(10, 11, 10)).toBe(BlockId.Planks);
    expect(world.getMeta(10, 11, 10)).toBe(9);
  });
});
