import { describe, expect, it } from 'vitest';
import { BuildTools } from '@/gameplay/building/BuildTools';
import { installAttachmentRules, toggleDoor } from '@/gameplay/interaction/attachments';
import { BlockInteraction, type InteractionRules } from '@/gameplay/interaction/BlockInteraction';
import { explode } from '@/gameplay/interaction/explosion';
import { planPlacement, placementMeta } from '@/gameplay/interaction/placement';
import { createRaycastHit } from '@/gameplay/interaction/voxelRaycast';
import { PlayerController } from '@/gameplay/movement/PlayerController';
import { Player } from '@/gameplay/player/Player';
import { mulberry32 } from '@/utils/rng';
import {
  blockBoxes,
  BlockId,
  getBlockDef,
  IS_SOLID,
  PLACEABLE_BLOCKS,
} from '@/world/blocks/blocks';
import { META_FLAG } from '@/world/blocks/shapes';
import { Chunk } from '@/world/chunks/Chunk';
import { blockIndex } from '@/world/chunks/coords';
import { BlockLight } from '@/world/lighting/BlockLight';
import { FaceMesher } from '@/world/meshing/FaceMesher';
import { FACE_STRIDE } from '@/world/meshing/types';
import type { World } from '@/world/World';
import { FakeInput } from './fakeInput';
import { flatWorld } from './helpers';

const NORTH = 0;
const EAST = 1;
const SOUTH = 2;
const WEST = 3;

const hitWith = (overrides: Partial<ReturnType<typeof createRaycastHit>>) => ({
  ...createRaycastHit(),
  ...overrides,
});

/** Player on the stone floor (top at y = 11) with block interaction wired to a log. */
function setup(selected: number) {
  const world = flatWorld(10);
  installAttachmentRules(world);
  const player = new Player();
  player.teleport(8.5, 11, 8.5);
  const input = new FakeInput();
  const log: string[] = [];
  let held = selected;
  const rules: InteractionRules = {
    instantBreak: () => true,
    selectedBlock: () => held,
    onPlaced: (b) => log.push(`placed:${b}`),
    onBroken: (b) => log.push(`broken:${b}`),
    onPicked: (b) => log.push(`picked:${b}`),
    onUse: (hit) => toggleDoor(world, hit.x, hit.y, hit.z),
  };
  const interaction = new BlockInteraction(world, player, input.asManager(), rules);
  const aim = (yaw: number, pitch: number): void => {
    player.yaw = yaw;
    player.pitch = pitch;
    interaction.retarget();
  };
  return { world, player, input, interaction, log, aim, hold: (b: number) => (held = b) };
}

describe('the new blocks', () => {
  it('are all in the palette except the door’s upper half', () => {
    for (const id of [
      BlockId.Door,
      BlockId.Ladder,
      BlockId.GlassPane,
      BlockId.Torch,
      BlockId.FlowerRed,
      BlockId.FlowerYellow,
      BlockId.TallGrass,
    ]) {
      expect(PLACEABLE_BLOCKS, getBlockDef(id).name).toContain(id);
    }
    expect(PLACEABLE_BLOCKS).not.toContain(BlockId.DoorUpper);
    expect(getBlockDef(BlockId.DoorUpper).item).toBe(BlockId.Door);
    expect(getBlockDef(BlockId.Stone).item).toBe(BlockId.Stone);
  });

  it('collide only where they should', () => {
    expect(IS_SOLID[BlockId.Door]).toBe(1);
    expect(IS_SOLID[BlockId.GlassPane]).toBe(1);
    for (const id of [BlockId.Ladder, BlockId.Torch, BlockId.FlowerRed, BlockId.TallGrass]) {
      expect(IS_SOLID[id], getBlockDef(id).name).toBe(0);
    }
    expect(getBlockDef(BlockId.Torch).light).toBe(14);
    expect(getBlockDef(BlockId.Ladder).climbable).toBe(true);
  });
});

describe('doors', () => {
  it('are placed as two blocks on the edge of the cell nearest the player', () => {
    const { world, interaction, aim, log } = setup(BlockId.Door);
    aim(0, -0.5); // looking north at the floor a few blocks ahead
    const target = interaction.target!;
    expect(interaction.tryPlace()).toBe(true);
    const { x, z } = target;
    expect(world.getBlock(x, 11, z)).toBe(BlockId.Door);
    expect(world.getBlock(x, 12, z)).toBe(BlockId.DoorUpper);
    // Facing north, the near edge of the cell is its south side.
    expect(world.getMeta(x, 11, z)).toBe(SOUTH);
    expect(world.getMeta(x, 12, z)).toBe(SOUTH);
    expect(blockBoxes(BlockId.Door, SOUTH)[0]![2]).toBeCloseTo(1 - 3 / 16);
    expect(log).toEqual([`placed:${BlockId.Door}`]);
  });

  it('need two free cells', () => {
    const { world, interaction, aim } = setup(BlockId.Door);
    aim(0, -0.5);
    const { x, z } = interaction.target!;
    world.setBlock(x, 12, z, BlockId.Stone);
    expect(interaction.tryPlace()).toBe(false);
    expect(world.getBlock(x, 11, z)).toBe(BlockId.Air);
  });

  it('open and close as a pair, swinging onto the next side', () => {
    const { world, interaction, aim } = setup(BlockId.Door);
    aim(0, -0.5);
    const { x, z } = interaction.target!;
    interaction.tryPlace();

    // Right-clicking either half uses the door instead of placing another block.
    aim(0, -0.5);
    expect(
      interaction.target!.block === BlockId.Door || interaction.target!.block === BlockId.DoorUpper,
    ).toBe(true);
    expect(interaction.tryPlace()).toBe(true);
    expect(world.getMeta(x, 11, z)).toBe(SOUTH | META_FLAG);
    expect(world.getMeta(x, 12, z)).toBe(SOUTH | META_FLAG);
    // Open, the panel lies against the west side.
    expect(blockBoxes(BlockId.Door, SOUTH | META_FLAG)).toEqual(blockBoxes(BlockId.Door, WEST));

    expect(toggleDoor(world, x, 12, z)).toBe(true);
    expect(world.getMeta(x, 11, z)).toBe(SOUTH);
    expect(toggleDoor(world, x, 10, z)).toBe(false);
  });

  it('block the way when closed and let the player through when open', () => {
    const run = (open: boolean): number => {
      const world = flatWorld(10);
      // A wall across the path with a doorway in it.
      for (let x = 4; x <= 12; x++) {
        for (let y = 11; y <= 13; y++) world.setBlock(x, y, 6, BlockId.Stone);
      }
      world.setBlock(8, 11, 6, BlockId.Door, open ? SOUTH | META_FLAG : SOUTH);
      world.setBlock(8, 12, 6, BlockId.DoorUpper, open ? SOUTH | META_FLAG : SOUTH);
      const player = new Player();
      player.teleport(8.6, 11, 8.5);
      const input = new FakeInput();
      const controller = new PlayerController(player, world, input.asManager());
      input.keys.add('KeyW');
      for (let i = 0; i < 180; i++) controller.step(1 / 60);
      return player.position.z;
    };
    expect(run(false)).toBeGreaterThan(7);
    expect(run(true)).toBeLessThan(5);
  });

  it('lose both halves together and give back one door', () => {
    const { world, interaction, aim, log } = setup(BlockId.Door);
    aim(0, -0.5);
    const { x, z } = interaction.target!;
    interaction.tryPlace();
    log.length = 0;

    aim(0, -0.5);
    expect(interaction.breakTarget()).toBe(true);
    expect(world.getBlock(x, 11, z)).toBe(BlockId.Air);
    expect(world.getBlock(x, 12, z)).toBe(BlockId.Air);
    expect(log).toEqual([`broken:${BlockId.Door}`]);
  });

  it('do not leave half a door behind after an explosion or an undo', () => {
    const world = flatWorld(10);
    installAttachmentRules(world);
    const build = new BuildTools(world);
    world.setBlock(8, 11, 8, BlockId.Door, NORTH);
    world.setBlock(8, 12, 8, BlockId.DoorUpper, NORTH);
    build.history.commit();

    // Removing only the lower half takes the upper with it…
    world.setBlock(8, 11, 8, BlockId.Air);
    expect(world.getBlock(8, 12, 8)).toBe(BlockId.Air);
    build.history.commit();
    // …and undoing brings both back, redoing removes both again.
    build.undo();
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Door);
    expect(world.getBlock(8, 12, 8)).toBe(BlockId.DoorUpper);
    build.redo();
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Air);
    expect(world.getBlock(8, 12, 8)).toBe(BlockId.Air);

    build.undo();
    explode(world, 8, 10, 8, 1.2, 0, mulberry32(2));
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Air);
    expect(world.getBlock(8, 12, 8)).toBe(BlockId.Air);
  });
});

describe('ladders and panes', () => {
  it('hang a ladder on the wall it was placed against', () => {
    // A wall to the north: clicking its south face puts the ladder on that wall.
    const hit = hitWith({ x: 8, y: 11, z: 5, nz: 1, block: BlockId.Stone });
    expect(placementMeta(BlockId.Ladder, hit, 0)).toBe(NORTH);
    expect(placementMeta(BlockId.Ladder, hitWith({ nx: -1 }), 0)).toBe(EAST);
    expect(placementMeta(BlockId.Ladder, hitWith({ nz: -1 }), 0)).toBe(SOUTH);
    expect(placementMeta(BlockId.Ladder, hitWith({ nx: 1 }), 0)).toBe(WEST);
    // On a floor there is no wall: use the far side of the cell.
    expect(placementMeta(BlockId.Ladder, hitWith({ ny: 1 }), -Math.PI / 2)).toBe(EAST);
    expect(blockBoxes(BlockId.Ladder, NORTH)).toEqual([[0, 0, 0, 1, 1, 2 / 16]]);
  });

  it('let the player climb a wall and stay put while sneaking', () => {
    const world = flatWorld(10);
    // A cliff five blocks high filling everything north of z = 7, with a ladder up its face.
    for (let y = 11; y <= 15; y++) {
      for (let x = 6; x <= 10; x++) {
        for (let z = 0; z <= 6; z++) world.setBlock(x, y, z, BlockId.Stone);
      }
      world.setBlock(8, y, 7, BlockId.Ladder, NORTH);
    }
    const player = new Player();
    player.teleport(8.5, 11, 8.5);
    const input = new FakeInput();
    const controller = new PlayerController(player, world, input.asManager());
    const run = (seconds: number): void => {
      for (let i = 0; i < Math.round(seconds * 60); i++) controller.step(1 / 60);
    };

    input.keys.add('KeyW');
    run(1.2);
    expect(player.climbing).toBe(true);
    expect(player.position.y).toBeGreaterThan(12.5);

    // Holding sneak keeps the player where they are.
    input.keys.delete('KeyW');
    input.keys.add('KeyC');
    run(0.2);
    const held = player.position.y;
    run(0.5);
    expect(player.position.y).toBeCloseTo(held, 5);

    // Letting go slides down slowly rather than falling.
    input.keys.delete('KeyC');
    run(0.5);
    expect(player.position.y).toBeLessThan(held);
    expect(player.velocity.y).toBeGreaterThan(-3);

    // Pushing forward again carries the player over the top of the wall.
    input.keys.add('KeyW');
    run(2.5);
    expect(player.position.y).toBe(16);
    expect(player.position.z).toBeLessThan(7);
    expect(player.climbing).toBe(false);
  });

  it('run a pane across the player’s view', () => {
    expect(placementMeta(BlockId.GlassPane, hitWith({ ny: 1 }), 0)).toBe(0);
    expect(placementMeta(BlockId.GlassPane, hitWith({ ny: 1 }), Math.PI)).toBe(0);
    expect(placementMeta(BlockId.GlassPane, hitWith({ ny: 1 }), Math.PI / 2)).toBe(1);
    // East–west pane: thin in z, full width in x.
    expect(blockBoxes(BlockId.GlassPane, 0)).toEqual([[0, 0, 7 / 16, 1, 1, 9 / 16]]);
    expect(blockBoxes(BlockId.GlassPane, 1)).toEqual([[7 / 16, 0, 0, 9 / 16, 1, 1]]);
  });
});

describe('plants and torches', () => {
  it('can only be placed on top of a solid block', () => {
    const floor = hitWith({ x: 8, y: 10, z: 6, ny: 1, block: BlockId.Stone });
    expect(planPlacement(BlockId.Torch, floor, 0)).toEqual([
      { x: 8, y: 11, z: 6, block: BlockId.Torch, meta: 0 },
    ]);
    expect(planPlacement(BlockId.FlowerRed, { ...floor, ny: 0, nz: 1 }, 0)).toBeNull();
    expect(planPlacement(BlockId.TallGrass, { ...floor, ny: -1 }, 0)).toBeNull();
    // Not on top of something that is not solid, such as another plant.
    expect(planPlacement(BlockId.Torch, { ...floor, block: BlockId.TallGrass }, 0)).toBeNull();
    // Ordinary blocks have no such rule.
    expect(planPlacement(BlockId.Stone, { ...floor, ny: 0, nz: 1 }, 0)).toHaveLength(1);
  });

  it('do not block the player', () => {
    const world = flatWorld(10);
    for (let x = 6; x <= 10; x++) {
      world.setBlock(x, 11, 6, BlockId.TallGrass);
      world.setBlock(x, 11, 5, BlockId.Torch);
    }
    const player = new Player();
    player.teleport(8.5, 11, 8.5);
    const input = new FakeInput();
    const controller = new PlayerController(player, world, input.asManager());
    input.keys.add('KeyW');
    for (let i = 0; i < 90; i++) controller.step(1 / 60);
    expect(player.position.z).toBeLessThan(4.5);
  });

  it('disappear when the block under them is removed, by any means', () => {
    const { world, interaction, aim } = setup(BlockId.FlowerRed);
    aim(0, -0.5);
    const ground = { ...interaction.target! };
    expect(interaction.tryPlace()).toBe(true);
    expect(world.getBlock(ground.x, 11, ground.z)).toBe(BlockId.FlowerRed);

    // Dig the ground out from under it.
    world.setBlock(ground.x, 10, ground.z, BlockId.Air);
    expect(world.getBlock(ground.x, 11, ground.z)).toBe(BlockId.Air);

    // Replacing the ground with another solid block leaves a plant alone.
    world.setBlock(ground.x, 10, ground.z, BlockId.Stone);
    world.setBlock(ground.x, 11, ground.z, BlockId.Torch);
    world.setBlock(ground.x, 10, ground.z, BlockId.Brick);
    expect(world.getBlock(ground.x, 11, ground.z)).toBe(BlockId.Torch);
    // An explosion underneath takes it.
    explode(world, ground.x, 9, ground.z, 1.5, 0, mulberry32(3));
    expect(world.getBlock(ground.x, 11, ground.z)).toBe(BlockId.Air);
  });

  it('are drawn as crossed quads, seen from both sides', () => {
    const plain = flatWorld(10);
    const mesher = new FaceMesher();
    const lookup = (w: World) => (cx: number, cz: number) => w.getChunk(cx, cz);
    const before = mesher.mesh(plain.getChunk(0, 0)!, lookup(plain)).opaque.count;

    const world = flatWorld(10);
    world.setBlock(8, 11, 8, BlockId.FlowerRed);
    const data = mesher.mesh(world.getChunk(0, 0)!, lookup(world)).opaque;
    expect(data.count).toBe(before + 4);
    const diagonal = new Set<number>();
    for (let i = 0; i < data.count; i++) {
      const face = data.data[i * FACE_STRIDE + 3]!;
      if (face >= 6) diagonal.add(face);
    }
    expect([...diagonal].sort()).toEqual([6, 7, 8, 9]);
  });
});

describe('block light', () => {
  const lookup = (world: World) => (cx: number, cz: number) => world.getChunk(cx, cz);

  it('is absent, and costs nothing, without a light source', () => {
    const world = flatWorld(10);
    const light = new BlockLight();
    expect(light.compute(world.getChunk(0, 0)!, lookup(world))).toBe(false);
    expect(light.any).toBe(false);
    expect(light.at(8, 11, 8)).toBe(0);
  });

  it('falls off by one level per block from a torch', () => {
    const world = flatWorld(10);
    world.setBlock(8, 11, 8, BlockId.Torch);
    const light = new BlockLight();
    expect(light.compute(world.getChunk(0, 0)!, lookup(world))).toBe(true);
    expect(light.at(8, 11, 8)).toBe(14);
    expect(light.at(9, 11, 8)).toBe(13);
    expect(light.at(8, 14, 8)).toBe(11);
    // Distance is counted in steps along the axes.
    expect(light.at(10, 12, 9)).toBe(14 - 4);
    expect(light.at(8, 11, 15)).toBe(7);
    // Nothing gets into solid stone.
    expect(light.at(8, 9, 8)).toBe(0);
  });

  it('does not pass through walls but does go around them', () => {
    const world = flatWorld(10);
    world.setBlock(8, 11, 8, BlockId.Torch);
    // A wall two blocks east of the torch, three high and five wide.
    for (let z = 6; z <= 10; z++) {
      for (let y = 11; y <= 13; y++) world.setBlock(10, y, z, BlockId.Stone);
    }
    const light = new BlockLight();
    light.compute(world.getChunk(0, 0)!, lookup(world));
    expect(light.at(9, 11, 8)).toBe(13);
    expect(light.at(10, 11, 8)).toBe(0);
    // Behind the wall the light arrives the long way round, so it is dimmer
    // than the straight-line distance of 3 would give.
    const behind = light.at(11, 11, 8);
    expect(behind).toBeGreaterThan(0);
    expect(behind).toBeLessThan(14 - 3);
    // Glass lets it straight through.
    world.setBlock(10, 11, 8, BlockId.Glass);
    light.compute(world.getChunk(0, 0)!, lookup(world));
    expect(light.at(11, 11, 8)).toBe(14 - 3);
  });

  it('crosses chunk borders', () => {
    const world = flatWorld(10, 1);
    world.setBlock(17, 11, 8, BlockId.Torch); // in the chunk to the east
    const light = new BlockLight();
    expect(light.compute(world.getChunk(0, 0)!, lookup(world))).toBe(true);
    expect(light.at(15, 11, 8)).toBe(12);
    expect(light.at(8, 11, 8)).toBe(5);
    expect(light.at(16, 11, 8)).toBe(13); // one block outside, as face lighting needs
  });

  it('is tracked as torches are placed, removed and restored from edits', () => {
    const world = flatWorld(10);
    const chunk = world.getChunk(0, 0)!;
    expect(chunk.emitters).toBeNull();
    world.setBlock(8, 11, 8, BlockId.Torch);
    expect([...chunk.emitters!]).toEqual([blockIndex(8, 11, 8)]);
    world.setBlock(8, 11, 8, BlockId.Air);
    expect(chunk.emitters!.size).toBe(0);

    world.setBlock(3, 11, 3, BlockId.Torch);
    world.removeChunk(chunk.key);
    const fresh = new Chunk(0, 0);
    world.addChunk(fresh);
    expect([...fresh.emitters!]).toEqual([blockIndex(3, 11, 3)]);
  });

  it('marks the surrounding chunks for remeshing when a light changes', () => {
    const world = flatWorld(10, 1);
    const dirty = new Set<number>();
    world.events.on('chunkDirty', ({ key }) => dirty.add(key));
    world.setBlock(8, 11, 8, BlockId.Stone); // middle of the chunk, no light anywhere
    expect(dirty.size).toBe(1);

    dirty.clear();
    world.setBlock(8, 12, 8, BlockId.Torch);
    expect(dirty.size).toBe(9);

    // With a light nearby, building or removing an opaque block matters too.
    dirty.clear();
    world.setBlock(6, 11, 8, BlockId.Stone);
    expect(dirty.size).toBe(9);
    // A see-through block does not change where light goes.
    dirty.clear();
    world.setBlock(5, 11, 8, BlockId.Glass);
    expect(dirty.size).toBe(1);
  });

  it('reaches the faces the mesher emits', () => {
    const world = flatWorld(10);
    world.setBlock(8, 11, 8, BlockId.Torch);
    const data = new FaceMesher().mesh(world.getChunk(0, 0)!, lookup(world)).opaque;
    let brightest = 0;
    let lit = 0;
    for (let i = 0; i < data.count; i++) {
      const light = data.data[i * FACE_STRIDE + 11]!;
      expect(light).toBeGreaterThanOrEqual(0);
      expect(light).toBeLessThanOrEqual(1);
      if (light > 0) lit++;
      brightest = Math.max(brightest, light);
    }
    // The torch's own faces sit in the brightest cell.
    expect(brightest).toBeCloseTo(14 / 15, 6);
    expect(lit).toBeGreaterThan(100);

    const dark = new FaceMesher().mesh(flatWorld(10).getChunk(0, 0)!, lookup(flatWorld(10))).opaque;
    for (let i = 0; i < dark.count; i++) expect(dark.data[i * FACE_STRIDE + 11]).toBe(0);
  });
});
