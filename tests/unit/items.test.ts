import { describe, expect, it } from 'vitest';
import { BlockInteraction, type InteractionRules } from '@/gameplay/interaction/BlockInteraction';
import {
  addItem,
  clickSlot,
  createInventory,
  makeStack,
  sanitizeInventory,
  selectedBlock,
  setSlot,
  wearSelectedTool,
} from '@/gameplay/inventory/inventory';
import {
  getItemDef,
  isBlockItem,
  isValidItem,
  ItemId,
  miningSpeed,
  NON_BLOCK_ITEMS,
} from '@/gameplay/items/items';
import { Player } from '@/gameplay/player/Player';
import { BlockId, BLOCKS, getBlockDef } from '@/world/blocks/blocks';
import { TILE_COUNT } from '@/world/blocks/tiles';
import { TerrainGenerator } from '@/world/generation/TerrainGenerator';
import { FakeInput } from './fakeInput';
import { flatWorld } from './helpers';

describe('items', () => {
  it('treat every placeable block as an item of the same id', () => {
    expect(isValidItem(BlockId.Stone)).toBe(true);
    expect(isBlockItem(BlockId.Stone)).toBe(true);
    expect(getItemDef(BlockId.Stone).name).toBe('Stone');
    expect(getItemDef(BlockId.Stone).maxStack).toBe(64);
    // Air, bedrock and a door's upper half cannot be held.
    expect(isValidItem(BlockId.Air)).toBe(false);
    expect(isValidItem(BlockId.Bedrock)).toBe(false);
    expect(isValidItem(BlockId.DoorUpper)).toBe(false);
  });

  it('add tools, materials and food that are not blocks', () => {
    expect(isValidItem(ItemId.Stick)).toBe(true);
    expect(isBlockItem(ItemId.Stick)).toBe(false);
    expect(getItemDef(ItemId.Apple).food).toBeGreaterThan(0);
    expect(getItemDef(ItemId.StonePickaxe).tool).toEqual({
      kind: 'pickaxe',
      speed: 4,
      durability: 132,
    });
    expect(getItemDef(ItemId.IronAxe).maxStack).toBe(1);
    for (const value of [255, 300, -1, 1.5, '260', null]) {
      expect(isValidItem(value), String(value)).toBe(false);
    }
  });

  it('do not collide with block ids and each have a sprite', () => {
    const ids = new Set<number>();
    for (const item of NON_BLOCK_ITEMS) {
      expect(item.id).toBeGreaterThanOrEqual(256);
      expect(ids.has(item.id)).toBe(false);
      ids.add(item.id);
      expect(item.tile).not.toBeNull();
      expect(item.tile!).toBeLessThan(TILE_COUNT);
      expect(item.name.length).toBeGreaterThan(0);
    }
    // 64 tiles fit in the 8 × 8 atlas.
    expect(TILE_COUNT).toBeLessThanOrEqual(64);
  });

  it('refer to real items from block drops', () => {
    for (const block of BLOCKS) {
      if (block.drop) expect(isValidItem(block.drop.item), block.name).toBe(true);
    }
    expect(getBlockDef(BlockId.CoalOre).drop).toEqual({ item: ItemId.Coal, count: 1 });
    expect(getBlockDef(BlockId.IronOre).drop).toEqual({ item: ItemId.Iron, count: 1 });
  });
});

describe('tools', () => {
  it('speed up only the kind of block they are for', () => {
    expect(miningSpeed(ItemId.WoodPickaxe, 'pickaxe')).toBe(2);
    expect(miningSpeed(ItemId.IronPickaxe, 'pickaxe')).toBe(6);
    expect(miningSpeed(ItemId.IronPickaxe, 'axe')).toBe(1);
    expect(miningSpeed(ItemId.StoneShovel, 'shovel')).toBe(4);
    expect(miningSpeed(ItemId.StoneShovel, null)).toBe(1);
    // A bare hand, a block or food is never faster.
    expect(miningSpeed(0, 'pickaxe')).toBe(1);
    expect(miningSpeed(BlockId.Stone, 'pickaxe')).toBe(1);
    expect(miningSpeed(ItemId.Apple, 'axe')).toBe(1);
  });

  it('match the blocks that name them', () => {
    expect(getBlockDef(BlockId.Stone).tool).toBe('pickaxe');
    expect(getBlockDef(BlockId.Log).tool).toBe('axe');
    expect(getBlockDef(BlockId.Dirt).tool).toBe('shovel');
    expect(getBlockDef(BlockId.Glass).tool).toBeNull();
    // Slabs and stairs take after the block they are cut from.
    expect(getBlockDef(BlockId.PlankStairs).tool).toBe('axe');
    expect(getBlockDef(BlockId.StoneSlab).tool).toBe('pickaxe');
  });

  function miningTime(held: number): number {
    const world = flatWorld(10);
    const player = new Player();
    player.teleport(8.5, 11, 8.5);
    player.pitch = -1.2;
    const input = new FakeInput();
    const rules: InteractionRules = {
      instantBreak: () => false,
      selectedBlock: () => 0,
      miningSpeed: (block) => miningSpeed(held, getBlockDef(block).tool),
      onPlaced: () => undefined,
      onBroken: () => undefined,
      onPicked: () => undefined,
      onUse: () => false,
    };
    const interaction = new BlockInteraction(world, player, input.asManager(), rules);
    interaction.retarget();
    const { x, y, z } = interaction.target!;
    input.keys.add('Mouse0');
    let seconds = 0;
    while (world.getBlock(x, y, z) !== BlockId.Air && seconds < 10) {
      interaction.update(1 / 60);
      seconds += 1 / 60;
    }
    return seconds;
  }

  it('make mining faster in proportion', () => {
    const hand = miningTime(0);
    const wood = miningTime(ItemId.WoodPickaxe);
    const iron = miningTime(ItemId.IronPickaxe);
    const shovel = miningTime(ItemId.IronShovel);
    // Stone has hardness 1.5 seconds.
    expect(hand).toBeCloseTo(1.5, 1);
    expect(wood).toBeCloseTo(0.75, 1);
    expect(iron).toBeCloseTo(0.25, 1);
    // The wrong tool is no better than a hand.
    expect(shovel).toBeCloseTo(hand, 1);
  });

  it('wear out with use and then break', () => {
    let inventory = setSlot(createInventory(), 0, makeStack(ItemId.WoodPickaxe, 1));
    expect(inventory.slots[0]).toEqual({ item: ItemId.WoodPickaxe, count: 1, durability: 60 });
    for (let i = 0; i < 59; i++) {
      const result = wearSelectedTool(inventory);
      expect(result.broke).toBe(false);
      inventory = result.inventory;
    }
    expect(inventory.slots[0]?.durability).toBe(1);
    const last = wearSelectedTool(inventory);
    expect(last.broke).toBe(true);
    expect(last.inventory.slots[0]).toBeNull();

    // Blocks and an empty hand are untouched.
    const blocks = setSlot(createInventory(), 0, { item: BlockId.Stone, count: 5 });
    expect(wearSelectedTool(blocks)).toEqual({ inventory: blocks, broke: false });
    expect(wearSelectedTool(createInventory()).broke).toBe(false);
  });
});

describe('inventory with items', () => {
  it('never stacks tools', () => {
    let inventory = createInventory();
    inventory = addItem(inventory, ItemId.StoneAxe, 2).inventory;
    expect(inventory.slots[0]).toEqual({ item: ItemId.StoneAxe, count: 1, durability: 132 });
    expect(inventory.slots[1]).toEqual({ item: ItemId.StoneAxe, count: 1, durability: 132 });
    expect(inventory.slots[2]).toBeNull();
  });

  it('keeps a used tool’s wear when it is added', () => {
    const inventory = addItem(createInventory(), ItemId.StoneAxe, 1, 17).inventory;
    expect(inventory.slots[0]?.durability).toBe(17);
  });

  it('stacks materials like blocks', () => {
    let inventory = addItem(createInventory(), ItemId.Coal, 70).inventory;
    expect(inventory.slots[0]).toEqual({ item: ItemId.Coal, count: 64 });
    expect(inventory.slots[1]).toEqual({ item: ItemId.Coal, count: 6 });
    inventory = addItem(inventory, ItemId.Coal, 3).inventory;
    expect(inventory.slots[1]).toEqual({ item: ItemId.Coal, count: 9 });
  });

  it('swaps two tools of the same kind instead of merging them', () => {
    const worn = { item: ItemId.WoodShovel, count: 1, durability: 5 };
    const inventory = setSlot(createInventory(), 0, makeStack(ItemId.WoodShovel, 1));
    const result = clickSlot(inventory, worn, 0);
    expect(result.inventory.slots[0]).toEqual(worn);
    expect(result.cursor).toEqual({ item: ItemId.WoodShovel, count: 1, durability: 60 });
  });

  it('places blocks only: a tool in the hand places nothing', () => {
    const withTool = setSlot(createInventory(), 0, makeStack(ItemId.IronPickaxe, 1));
    expect(selectedBlock(withTool)).toBe(0);
    const withBlock = setSlot(createInventory(), 0, { item: BlockId.Brick, count: 3 });
    expect(selectedBlock(withBlock)).toBe(BlockId.Brick);
    expect(selectedBlock(createInventory())).toBe(0);
  });

  it('restores saved items, including saves that predate them', () => {
    const restored = sanitizeInventory({
      selected: 2,
      slots: [
        { block: BlockId.Planks, count: 12 }, // field name used by older saves
        { item: ItemId.Coal, count: 500 },
        { item: ItemId.StonePickaxe, count: 9, durability: 40 },
        { item: ItemId.IronAxe, count: 1 }, // no durability stored: treated as new
        { item: ItemId.WoodAxe, count: 1, durability: 0 }, // already worn out
        { item: ItemId.WoodAxe, count: 1, durability: 9999 },
        { item: 9999, count: 1 },
        { item: BlockId.Bedrock, count: 1 },
      ],
    });
    expect(restored.selected).toBe(2);
    expect(restored.slots[0]).toEqual({ item: BlockId.Planks, count: 12 });
    expect(restored.slots[1]).toEqual({ item: ItemId.Coal, count: 64 });
    expect(restored.slots[2]).toEqual({ item: ItemId.StonePickaxe, count: 1, durability: 40 });
    expect(restored.slots[3]).toEqual({ item: ItemId.IronAxe, count: 1, durability: 251 });
    expect(restored.slots[4]).toBeNull();
    expect(restored.slots[5]).toEqual({ item: ItemId.WoodAxe, count: 1, durability: 60 });
    expect(restored.slots[6]).toBeNull();
    expect(restored.slots[7]).toBeNull();
  });
});

describe('ore generation', () => {
  const base = { seed: 'ores', terrain: 'standard', treeDensity: 1 } as const;
  const count = (blocks: Uint8Array, id: number): number =>
    blocks.reduce((n, b) => n + (b === id ? 1 : 0), 0);

  it('adds coal and iron in version 3, only where stone was', () => {
    const v2 = new TerrainGenerator({ ...base, generator: 2 });
    const v3 = new TerrainGenerator({ ...base, generator: 3 });
    let coal = 0;
    let iron = 0;
    let stone = 0;
    for (let cx = 0; cx < 3; cx++) {
      const before = v2.generateChunk(cx, 0);
      const after = v3.generateChunk(cx, 0);
      for (let i = 0; i < before.length; i++) {
        if (before[i] === after[i]) continue;
        expect(before[i]).toBe(BlockId.Stone);
        expect([BlockId.CoalOre, BlockId.IronOre]).toContain(after[i]);
        // Iron lies deep.
        if (after[i] === BlockId.IronOre) expect(i >> 8).toBeLessThan(44);
      }
      coal += count(after, BlockId.CoalOre);
      iron += count(after, BlockId.IronOre);
      stone += count(after, BlockId.Stone);
      expect(count(before, BlockId.CoalOre)).toBe(0);
    }
    expect(coal).toBeGreaterThan(100);
    expect(iron).toBeGreaterThan(20);
    // Coal is the commoner of the two, and ore stays a small share of the rock.
    expect(coal).toBeGreaterThan(iron);
    expect((coal + iron) / stone).toBeLessThan(0.08);
  });

  it('lines up across chunk borders', () => {
    const generator = new TerrainGenerator({ ...base, generator: 3 });
    const west = generator.generateChunk(0, 0);
    const east = generator.generateChunk(1, 0);
    // A pocket is 2 × 2 × 2 in world coordinates, so a pocket ending at the
    // border (x = 14, 15) never continues into the next chunk, and one that
    // starts at x = 16 is whole there.
    let pockets = 0;
    for (let y = 2; y < 40; y += 2) {
      for (let z = 0; z < 16; z += 2) {
        if (east[0 + z * 16 + y * 256] === BlockId.CoalOre) {
          pockets++;
          expect(east[1 + z * 16 + y * 256]).toBe(BlockId.CoalOre);
        }
        if (west[14 + z * 16 + y * 256] === BlockId.CoalOre) {
          expect(west[15 + z * 16 + y * 256]).toBe(BlockId.CoalOre);
        }
      }
    }
    expect(pockets).toBeGreaterThan(0);
  });
});
