import { BLOCK_COUNT, getBlockDef, type ToolKind } from '@/world/blocks/blocks';
import { Tile } from '@/world/blocks/tiles';

/**
 * Everything that can sit in an inventory slot. A block is an item with the
 * same id as the block; items that are not blocks start at 256.
 */
export const ItemId = {
  Stick: 256,
  Coal: 257,
  Iron: 258,
  Apple: 259,
  WoodPickaxe: 260,
  WoodAxe: 261,
  WoodShovel: 262,
  StonePickaxe: 263,
  StoneAxe: 264,
  StoneShovel: 265,
  IronPickaxe: 266,
  IronAxe: 267,
  IronShovel: 268,
} as const;

export interface ToolSpec {
  readonly kind: ToolKind;
  /** How many times faster than a bare hand on blocks of its kind. */
  readonly speed: number;
  /** Blocks it can mine before it breaks. */
  readonly durability: number;
}

export interface ItemDef {
  readonly id: number;
  readonly name: string;
  /** Largest stack; tools do not stack. */
  readonly maxStack: number;
  /** Set for items that are not blocks: the sprite drawn for them. */
  readonly tile: Tile | null;
  readonly tool: ToolSpec | null;
  /** Hunger restored by eating it, or 0. */
  readonly food: number;
}

const TIERS = {
  wood: { speed: 2, durability: 60 },
  stone: { speed: 4, durability: 132 },
  iron: { speed: 6, durability: 251 },
} as const;

function plain(id: number, name: string, tile: Tile, food = 0): ItemDef {
  return { id, name, maxStack: 64, tile, tool: null, food };
}

function tool(
  id: number,
  name: string,
  tile: Tile,
  kind: ToolKind,
  tier: keyof typeof TIERS,
): ItemDef {
  return { id, name, maxStack: 1, tile, tool: { kind, ...TIERS[tier] }, food: 0 };
}

const ITEMS: readonly ItemDef[] = [
  plain(ItemId.Stick, 'Stick', Tile.ItemStick),
  plain(ItemId.Coal, 'Coal', Tile.ItemCoal),
  plain(ItemId.Iron, 'Iron', Tile.ItemIron),
  plain(ItemId.Apple, 'Apple', Tile.ItemApple, 4),
  tool(ItemId.WoodPickaxe, 'Wooden Pickaxe', Tile.ItemWoodPickaxe, 'pickaxe', 'wood'),
  tool(ItemId.WoodAxe, 'Wooden Axe', Tile.ItemWoodAxe, 'axe', 'wood'),
  tool(ItemId.WoodShovel, 'Wooden Shovel', Tile.ItemWoodShovel, 'shovel', 'wood'),
  tool(ItemId.StonePickaxe, 'Stone Pickaxe', Tile.ItemStonePickaxe, 'pickaxe', 'stone'),
  tool(ItemId.StoneAxe, 'Stone Axe', Tile.ItemStoneAxe, 'axe', 'stone'),
  tool(ItemId.StoneShovel, 'Stone Shovel', Tile.ItemStoneShovel, 'shovel', 'stone'),
  tool(ItemId.IronPickaxe, 'Iron Pickaxe', Tile.ItemIronPickaxe, 'pickaxe', 'iron'),
  tool(ItemId.IronAxe, 'Iron Axe', Tile.ItemIronAxe, 'axe', 'iron'),
  tool(ItemId.IronShovel, 'Iron Shovel', Tile.ItemIronShovel, 'shovel', 'iron'),
];

const BY_ID = new Map<number, ItemDef>(ITEMS.map((item) => [item.id, item]));
const blockItems = new Map<number, ItemDef>();

/** True for ids of items that are placed as blocks. */
export function isBlockItem(id: number): boolean {
  return id >= 0 && id < BLOCK_COUNT;
}

/** Whether a value names something that may be held: a placeable block or any other item. */
export function isValidItem(id: unknown): id is number {
  if (typeof id !== 'number' || !Number.isInteger(id)) return false;
  if (BY_ID.has(id)) return true;
  return id > 0 && id < BLOCK_COUNT && getBlockDef(id).placeable;
}

/** Definition of an item. Unknown ids are described as air, which nothing can hold. */
export function getItemDef(id: number): ItemDef {
  const item = BY_ID.get(id);
  if (item) return item;
  let cached = blockItems.get(id);
  if (!cached) {
    cached = { id, name: getBlockDef(id).name, maxStack: 64, tile: null, tool: null, food: 0 };
    blockItems.set(id, cached);
  }
  return cached;
}

/** Items that are not blocks, in display order. */
export const NON_BLOCK_ITEMS: readonly ItemDef[] = ITEMS;

/**
 * How much faster than by hand the held item mines a block that calls for
 * `kind`. A tool only helps on its own kind of block.
 */
export function miningSpeed(heldItem: number, kind: ToolKind | null): number {
  const held = BY_ID.get(heldItem)?.tool;
  return held && kind !== null && held.kind === kind ? held.speed : 1;
}
