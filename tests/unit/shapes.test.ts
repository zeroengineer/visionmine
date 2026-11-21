import { describe, expect, it } from 'vitest';
import { boxCollides } from '@/gameplay/collision/aabb';
import { copyRegion, regionFromCorners, rotateClipboard } from '@/gameplay/building/regionOps';
import { placementMeta } from '@/gameplay/interaction/placement';
import { createRaycastHit, raycastVoxels } from '@/gameplay/interaction/voxelRaycast';
import { PlayerController } from '@/gameplay/movement/PlayerController';
import { Player } from '@/gameplay/player/Player';
import {
  blockBoxes,
  BlockId,
  BLOCKS,
  getBlockDef,
  IS_CUBE,
  IS_OPAQUE,
} from '@/world/blocks/blocks';
import {
  directionFromYaw,
  DIRECTIONS,
  META_FLAG,
  rotateMeta,
  shapeBoxes,
} from '@/world/blocks/shapes';
import { FaceMesher } from '@/world/meshing/FaceMesher';
import { FACE_STRIDE } from '@/world/meshing/types';
import type { World } from '@/world/World';
import { FakeInput } from './fakeInput';
import { flatWorld } from './helpers';

const NORTH = 0;
const EAST = 1;
const SOUTH = 2;
const WEST = 3;

describe('shape boxes', () => {
  it('describe slabs as half blocks', () => {
    expect(shapeBoxes('slab', 0)).toEqual([[0, 0, 0, 1, 0.5, 1]]);
    expect(shapeBoxes('slab', META_FLAG)).toEqual([[0, 0.5, 0, 1, 1, 1]]);
    expect(shapeBoxes('cube', 7)).toEqual([[0, 0, 0, 1, 1, 1]]);
  });

  it('describe stairs as a slab plus an upper half on the side they climb toward', () => {
    const upper = (direction: number) => shapeBoxes('stairs', direction)[1];
    expect(shapeBoxes('stairs', NORTH)[0]).toEqual([0, 0, 0, 1, 0.5, 1]);
    expect(upper(NORTH)).toEqual([0, 0.5, 0, 1, 1, 0.5]);
    expect(upper(EAST)).toEqual([0.5, 0.5, 0, 1, 1, 1]);
    expect(upper(SOUTH)).toEqual([0, 0.5, 0.5, 1, 1, 1]);
    expect(upper(WEST)).toEqual([0, 0.5, 0, 0.5, 1, 1]);
  });

  it('keep every box inside its cell', () => {
    for (const block of BLOCKS) {
      for (let meta = 0; meta < 16; meta++) {
        for (const [x0, y0, z0, x1, y1, z1] of blockBoxes(block.id, meta)) {
          for (const [lo, hi] of [
            [x0, x1],
            [y0, y1],
            [z0, z1],
          ] as const) {
            expect(lo).toBeGreaterThanOrEqual(0);
            expect(hi).toBeLessThanOrEqual(1);
            expect(hi).toBeGreaterThan(lo);
          }
        }
      }
    }
  });

  it('turn directions clockwise and map yaw to a direction', () => {
    expect(rotateMeta('stairs', NORTH)).toBe(EAST);
    expect(rotateMeta('stairs', WEST)).toBe(NORTH);
    expect(rotateMeta('slab', META_FLAG)).toBe(META_FLAG);
    expect(rotateMeta('door', META_FLAG | SOUTH)).toBe(META_FLAG | WEST);

    expect(directionFromYaw(0)).toBe(NORTH);
    expect(directionFromYaw(-Math.PI / 2)).toBe(EAST);
    expect(directionFromYaw(Math.PI)).toBe(SOUTH);
    expect(directionFromYaw(Math.PI / 2)).toBe(WEST);
    expect(directionFromYaw(0.3)).toBe(NORTH);
    expect(directionFromYaw(-2 * Math.PI)).toBe(NORTH);
    expect(DIRECTIONS[EAST]).toEqual([1, 0]);
  });

  it('are used by the slab and stairs blocks, which are solid but not opaque', () => {
    for (const id of [BlockId.StoneSlab, BlockId.PlankStairs]) {
      expect(IS_CUBE[id]).toBe(0);
      expect(IS_OPAQUE[id]).toBe(0);
      expect(getBlockDef(id).solid).toBe(true);
      expect(getBlockDef(id).placeable).toBe(true);
    }
    expect(getBlockDef(BlockId.BrickSlab).tiles).toEqual(getBlockDef(BlockId.Brick).tiles);
    expect(getBlockDef(BlockId.CobbleStairs).name).toBe('Cobblestone Stairs');
    expect(IS_CUBE[BlockId.Stone]).toBe(1);
  });
});

describe('collision with shaped blocks', () => {
  it('only the occupied half of a slab collides', () => {
    const world = flatWorld(10);
    world.setBlock(8, 11, 8, BlockId.StoneSlab);
    world.setBlock(9, 11, 8, BlockId.StoneSlab, META_FLAG);
    expect(boxCollides(world, 8.2, 11.1, 8.2, 8.8, 11.4, 8.8)).toBe(true);
    expect(boxCollides(world, 8.2, 11.5, 8.2, 8.8, 11.9, 8.8)).toBe(false);
    expect(boxCollides(world, 9.2, 11.1, 8.2, 9.8, 11.5, 8.8)).toBe(false);
    expect(boxCollides(world, 9.2, 11.6, 8.2, 9.8, 11.9, 8.8)).toBe(true);
  });

  function walker(world: World) {
    const player = new Player();
    player.teleport(8.5, 11, 8.5);
    const input = new FakeInput();
    const controller = new PlayerController(player, world, input.asManager());
    const run = (seconds: number): void => {
      for (let i = 0; i < Math.round(seconds * 60); i++) controller.step(1 / 60);
    };
    run(0.1);
    return { player, input, controller, run };
  }

  it('lets the player land on a slab at half height', () => {
    const world = flatWorld(10);
    world.setBlock(8, 11, 8, BlockId.StoneSlab);
    const { player, run } = walker(world);
    player.teleport(8.5, 14, 8.5);
    run(2);
    expect(player.position.y).toBe(11.5);
    expect(player.onGround).toBe(true);
  });

  it('walks up onto a slab without jumping, and back down', () => {
    const world = flatWorld(10);
    for (let x = 6; x <= 10; x++) world.setBlock(x, 11, 6, BlockId.StoneSlab);
    const { player, input, run } = walker(world);
    input.keys.add('KeyW');
    run(0.6);
    expect(player.position.y).toBe(11.5);
    expect(player.position.z).toBeLessThan(7);
    expect(player.onGround).toBe(true);
    // Carrying on, the player steps off the far side back to the floor.
    run(1.5);
    expect(player.position.y).toBe(11);
    expect(player.position.z).toBeLessThan(6);
  });

  it('is stopped by a slab in the upper half of the cell', () => {
    const world = flatWorld(10);
    for (let x = 6; x <= 10; x++) world.setBlock(x, 11, 6, BlockId.StoneSlab, META_FLAG);
    const { player, input, run } = walker(world);
    input.keys.add('KeyW');
    run(2);
    expect(player.position.y).toBe(11);
    expect(player.position.z).toBeGreaterThan(7.29);
  });

  it('climbs a flight of stairs by walking', () => {
    const world = flatWorld(10);
    // Three stair blocks rising to the north, each one block higher than the last.
    for (let step = 0; step < 3; step++) {
      for (let x = 6; x <= 10; x++) {
        world.setBlock(x, 11 + step, 6 - step, BlockId.StoneStairs, NORTH);
        for (let fill = 11; fill < 11 + step; fill++)
          world.setBlock(x, fill, 6 - step, BlockId.Stone);
      }
    }
    for (let x = 6; x <= 10; x++) {
      for (let z = 0; z <= 3; z++) {
        for (let y = 11; y <= 13; y++) world.setBlock(x, y, z, BlockId.Stone);
      }
    }
    const { player, input, controller } = walker(world);
    input.keys.add('KeyW');
    // Walk until the top landing is reached (it ends at z = 0, so stop there).
    const heights = new Set<number>();
    for (let i = 0; i < 240 && player.position.z > 2; i++) {
      controller.step(1 / 60);
      if (player.onGround) heights.add(player.position.y);
    }
    expect(player.position.y).toBe(14);
    expect(player.position.z).toBeLessThan(4);
    // Every half step was taken on foot: no jump, no flight.
    expect([...heights].sort((a, b) => a - b)).toEqual([11, 11.5, 12, 12.5, 13, 13.5, 14]);
    expect(player.flying).toBe(false);
  });

  it('cannot walk up stairs from their high side', () => {
    const world = flatWorld(10);
    for (let x = 6; x <= 10; x++) world.setBlock(x, 11, 6, BlockId.StoneStairs, SOUTH);
    const { player, input, run } = walker(world);
    input.keys.add('KeyW');
    run(2);
    // The full-height side faces the player: a one-block wall.
    expect(player.position.y).toBe(11);
    expect(player.position.z).toBeGreaterThan(7.29);
  });
});

describe('targeting shaped blocks', () => {
  it('hits the top of a slab at half height', () => {
    const world = flatWorld(10);
    world.setBlock(8, 11, 8, BlockId.StoneSlab);
    const hit = createRaycastHit();
    expect(raycastVoxels(world, 8.5, 13, 8.5, 0, -1, 0, 6, hit)).toBe(true);
    expect([hit.x, hit.y, hit.z]).toEqual([8, 11, 8]);
    expect([hit.nx, hit.ny, hit.nz]).toEqual([0, 1, 0]);
    expect(hit.block).toBe(BlockId.StoneSlab);
    expect(hit.distance).toBeCloseTo(1.5, 6);
    expect(hit.py).toBeCloseTo(11.5, 6);
  });

  it('passes through the empty half of a slab cell', () => {
    const world = flatWorld(10);
    world.setBlock(8, 11, 8, BlockId.StoneSlab);
    world.setBlock(8, 11, 5, BlockId.Brick);
    const hit = createRaycastHit();
    // Level ray through the upper, empty half of the slab's cell.
    expect(raycastVoxels(world, 8.5, 11.75, 10.5, 0, 0, -1, 8, hit)).toBe(true);
    expect(hit.block).toBe(BlockId.Brick);
    // The same ray a little lower meets the slab's side.
    expect(raycastVoxels(world, 8.5, 11.25, 10.5, 0, 0, -1, 8, hit)).toBe(true);
    expect(hit.block).toBe(BlockId.StoneSlab);
    expect([hit.nx, hit.ny, hit.nz]).toEqual([0, 0, 1]);
    expect(hit.pz).toBeCloseTo(9, 6);
  });

  it('reports the hit point on ordinary blocks too', () => {
    const world = flatWorld(10);
    const hit = createRaycastHit();
    expect(raycastVoxels(world, 8.25, 12, 8.75, 0, -1, 0, 6, hit)).toBe(true);
    expect([hit.px, hit.py, hit.pz]).toEqual([8.25, 11, 8.75]);
  });

  it('respects the reach limit on shaped blocks', () => {
    const world = flatWorld(10);
    world.setBlock(8, 11, 8, BlockId.StoneSlab);
    const hit = createRaycastHit();
    // The slab's cell is entered within reach, but its box lies beyond it.
    expect(raycastVoxels(world, 8.5, 13.2, 8.5, 0, -1, 0, 1.5, hit)).toBe(false);
  });
});

describe('placing shaped blocks', () => {
  const hitWith = (overrides: Partial<ReturnType<typeof createRaycastHit>>) => ({
    ...createRaycastHit(),
    ...overrides,
  });

  it('puts a slab in the half the player aimed at', () => {
    expect(placementMeta(BlockId.StoneSlab, hitWith({ ny: 1, py: 11 }), 0)).toBe(0);
    expect(placementMeta(BlockId.StoneSlab, hitWith({ ny: -1, py: 12 }), 0)).toBe(META_FLAG);
    expect(placementMeta(BlockId.StoneSlab, hitWith({ nz: 1, py: 11.8 }), 0)).toBe(META_FLAG);
    expect(placementMeta(BlockId.StoneSlab, hitWith({ nz: 1, py: 11.2 }), 0)).toBe(0);
    // Negative heights use the same lower/upper rule.
    expect(placementMeta(BlockId.StoneSlab, hitWith({ nz: 1, py: -3.2 }), 0)).toBe(META_FLAG);
  });

  it('makes stairs climb away from the player', () => {
    expect(placementMeta(BlockId.PlankStairs, hitWith({ ny: 1 }), 0)).toBe(NORTH);
    expect(placementMeta(BlockId.PlankStairs, hitWith({ ny: 1 }), -Math.PI / 2)).toBe(EAST);
    expect(placementMeta(BlockId.PlankStairs, hitWith({ ny: 1 }), Math.PI)).toBe(SOUTH);
  });

  it('gives ordinary blocks no state', () => {
    expect(placementMeta(BlockId.Stone, hitWith({ ny: -1, py: 3.9 }), 1)).toBe(0);
  });

  it('turns stairs with a rotated copy', () => {
    const world = flatWorld(10);
    world.setBlock(2, 11, 6, BlockId.PlankStairs, NORTH);
    world.setBlock(3, 11, 6, BlockId.StoneSlab, META_FLAG);
    const copy = copyRegion(world, regionFromCorners({ x: 2, y: 11, z: 6 }, { x: 3, y: 11, z: 6 }));
    const turned = rotateClipboard(copy);
    // After a clockwise quarter turn the row runs north–south and the stairs face east.
    expect([...turned.blocks]).toEqual([BlockId.PlankStairs, BlockId.StoneSlab]);
    expect([...turned.meta]).toEqual([EAST, META_FLAG]);
  });
});

describe('meshing shaped blocks', () => {
  function faces(world: World) {
    const mesher = new FaceMesher();
    const data = mesher.mesh(world.getChunk(0, 0)!, (cx, cz) => world.getChunk(cx, cz));
    const out: Array<{ x: number; y: number; z: number; face: number; w: number; h: number }> = [];
    for (let i = 0; i < data.opaque.count; i++) {
      const s = i * FACE_STRIDE;
      const d = data.opaque.data;
      out.push({
        x: d[s]!,
        y: d[s + 1]!,
        z: d[s + 2]!,
        face: d[s + 3]!,
        w: d[s + 9]!,
        h: d[s + 10]!,
      });
    }
    return out;
  }

  it('emits half-height sides for a slab and hides the face resting on the ground', () => {
    const plain = flatWorld(10);
    const before = faces(plain).length;
    const world = flatWorld(10);
    world.setBlock(8, 11, 8, BlockId.StoneSlab);
    const all = faces(world);
    // Top and four sides are added; the bottom rests on opaque stone and is
    // skipped. The stone's own top stays, since a slab does not hide it.
    expect(all.length).toBe(before + 5);
    const sides = all.filter((f) => f.h === 0.5);
    expect(sides).toHaveLength(4);
    for (const side of sides) expect(side.w).toBe(1);
  });

  it('emits both boxes of a stair block', () => {
    const plain = flatWorld(10);
    const before = faces(plain).length;
    const world = flatWorld(10);
    world.setBlock(8, 11, 8, BlockId.StoneStairs, NORTH);
    // Two boxes of six faces, minus the lower box's hidden bottom.
    expect(faces(world).length).toBe(before + 11);
  });
});
