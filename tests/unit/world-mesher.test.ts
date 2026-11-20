import { describe, expect, it } from 'vitest';
import { BlockId, Face } from '@/world/blocks/blocks';
import { Chunk } from '@/world/chunks/Chunk';
import { chunkKey } from '@/world/chunks/coords';
import { FaceMesher } from '@/world/meshing/FaceMesher';
import { FACE_STRIDE, type ChunkMeshData } from '@/world/meshing/types';
import { World } from '@/world/World';
import { emptyWorld } from './helpers';

function meshOf(world: World, cx = 0, cz = 0): ChunkMeshData {
  return new FaceMesher().mesh(world.getChunk(cx, cz)!, (x, z) => world.getChunk(x, z));
}

function faces(
  data: ChunkMeshData['opaque'],
): Array<{ x: number; y: number; z: number; face: number; ao: number[] }> {
  const out = [];
  for (let i = 0; i < data.count; i++) {
    const s = i * FACE_STRIDE;
    out.push({
      x: data.data[s]!,
      y: data.data[s + 1]!,
      z: data.data[s + 2]!,
      face: data.data[s + 3]!,
      ao: [...data.data.subarray(s + 5, s + 9)],
    });
  }
  return out;
}

describe('World', () => {
  it('reads air for unloaded chunks and out-of-range heights', () => {
    const world = emptyWorld(0);
    expect(world.getBlock(100, 10, 100)).toBe(BlockId.Air);
    expect(world.getBlock(0, -1, 0)).toBe(BlockId.Air);
    expect(world.getBlock(0, 128, 0)).toBe(BlockId.Air);
    expect(world.setBlock(100, 10, 100, BlockId.Stone)).toBe(false);
    expect(world.setBlock(0, 200, 0, BlockId.Stone)).toBe(false);
  });

  it('sets and gets blocks at negative coordinates', () => {
    const world = emptyWorld(1);
    expect(world.setBlock(-1, 5, -1, BlockId.Brick)).toBe(true);
    expect(world.getBlock(-1, 5, -1)).toBe(BlockId.Brick);
    expect(world.getChunk(-1, -1)!.get(15, 5, 15)).toBe(BlockId.Brick);
    expect(world.setBlock(-1, 5, -1, BlockId.Brick)).toBe(false); // unchanged
  });

  it('marks only the edited chunk dirty for interior edits', () => {
    const world = emptyWorld(1);
    const dirty: number[] = [];
    world.events.on('chunkDirty', ({ key }) => dirty.push(key));
    world.setBlock(8, 5, 8, BlockId.Stone);
    expect(dirty).toEqual([chunkKey(0, 0)]);
  });

  it('marks neighbouring chunks dirty for border and corner edits', () => {
    const world = emptyWorld(1);
    const dirty = new Set<number>();
    world.events.on('chunkDirty', ({ key }) => dirty.add(key));
    world.setBlock(15, 5, 8, BlockId.Stone);
    expect(dirty).toEqual(new Set([chunkKey(0, 0), chunkKey(1, 0)]));

    dirty.clear();
    world.setBlock(0, 5, 0, BlockId.Stone);
    expect(dirty).toEqual(
      new Set([chunkKey(0, 0), chunkKey(-1, 0), chunkKey(0, -1), chunkKey(-1, -1)]),
    );
  });

  it('records edits and re-applies them when a chunk is reloaded', () => {
    const world = emptyWorld(0);
    world.setBlock(3, 7, 4, BlockId.Glass);
    expect(world.takeUnsavedEdits()).toEqual([chunkKey(0, 0)]);
    expect(world.hasUnsavedEdits).toBe(false);

    world.removeChunk(chunkKey(0, 0));
    expect(world.getBlock(3, 7, 4)).toBe(BlockId.Air);
    world.addChunk(new Chunk(0, 0));
    expect(world.getBlock(3, 7, 4)).toBe(BlockId.Glass);
  });

  it('applies loaded edits to chunks added later', () => {
    const world = new World();
    world.loadEdits(
      new Map([[chunkKey(2, -1), new Map([[5 + 3 * 16 + 9 * 256, BlockId.Planks]])]]),
    );
    world.addChunk(new Chunk(2, -1));
    expect(world.getBlock(2 * 16 + 5, 9, -16 + 3)).toBe(BlockId.Planks);
    expect(world.hasUnsavedEdits).toBe(false);
  });
});

describe('FaceMesher', () => {
  it('emits six faces for an isolated block', () => {
    const world = emptyWorld(1);
    world.setBlock(8, 10, 8, BlockId.Stone);
    const mesh = meshOf(world);
    expect(mesh.opaque.count).toBe(6);
    expect(mesh.translucent.count).toBe(0);
    expect(new Set(faces(mesh.opaque).map((f) => f.face))).toEqual(new Set([0, 1, 2, 3, 4, 5]));
    expect(mesh.minY).toBe(10);
    expect(mesh.maxY).toBe(11);
  });

  it('never emits the underside of the world', () => {
    const world = emptyWorld(1);
    world.setBlock(8, 0, 8, BlockId.Stone);
    const list = faces(meshOf(world).opaque);
    expect(list).toHaveLength(5);
    expect(list.some((f) => f.face === Face.NY)).toBe(false);
  });

  it('culls faces between adjacent opaque blocks', () => {
    const world = emptyWorld(1);
    world.setBlock(8, 10, 8, BlockId.Stone);
    world.setBlock(9, 10, 8, BlockId.Dirt);
    expect(meshOf(world).opaque.count).toBe(10);
  });

  it('culls faces across chunk borders using neighbour data', () => {
    const world = emptyWorld(1);
    world.setBlock(15, 10, 8, BlockId.Stone); // chunk (0,0), east edge
    world.setBlock(16, 10, 8, BlockId.Stone); // chunk (1,0), west edge
    const a = faces(meshOf(world, 0, 0).opaque);
    const b = faces(meshOf(world, 1, 0).opaque);
    expect(a).toHaveLength(5);
    expect(b).toHaveLength(5);
    expect(a.some((f) => f.face === Face.PX)).toBe(false);
    expect(b.some((f) => f.face === Face.NX)).toBe(false);
  });

  it('keeps faces next to transparent blocks and culls same-type transparent faces', () => {
    const world = emptyWorld(1);
    world.setBlock(8, 10, 8, BlockId.Stone);
    world.setBlock(9, 10, 8, BlockId.Glass);
    world.setBlock(10, 10, 8, BlockId.Glass);
    // Stone keeps all 6 faces (glass does not hide it). The first glass block loses the
    // face against the opaque stone and the one shared with the other glass (4 left);
    // the second loses only the shared face (5 left).
    const mesh = meshOf(world);
    expect(mesh.opaque.count).toBe(15);
    const stoneFaces = faces(mesh.opaque).filter((f) => f.x === 8);
    expect(stoneFaces).toHaveLength(6);
  });

  it('puts water in the translucent batch with a lowered surface', () => {
    const world = emptyWorld(1);
    world.setBlock(8, 10, 8, BlockId.Stone);
    world.setBlock(8, 11, 8, BlockId.Water);
    const mesh = meshOf(world);
    const water = faces(mesh.translucent);
    expect(water).toHaveLength(5); // no face toward the stone below
    const top = water.find((f) => f.face === Face.PY)!;
    expect(top.y).toBeLessThan(11);
    expect(top.y).toBeGreaterThan(10.5);
    // The stone's top face is hidden from nothing: water is not opaque.
    expect(faces(mesh.opaque).some((f) => f.face === Face.PY)).toBe(true);
  });

  it('darkens corners next to occluding blocks', () => {
    const world = emptyWorld(1);
    world.setBlock(8, 10, 8, BlockId.Stone);
    const open = faces(meshOf(world).opaque).find((f) => f.face === Face.PY)!;
    expect(open.ao).toEqual([1, 1, 1, 1]);

    world.setBlock(9, 11, 8, BlockId.Stone); // wall beside the top face
    const shaded = faces(meshOf(world).opaque).find((f) => f.face === Face.PY && f.x === 8)!;
    expect(Math.min(...shaded.ao)).toBeLessThan(1);
    expect(Math.max(...shaded.ao)).toBe(1);
  });

  it('returns no faces for an empty chunk', () => {
    const mesh = meshOf(emptyWorld(1));
    expect(mesh.opaque.count + mesh.translucent.count).toBe(0);
  });
});
