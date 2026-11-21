/** Texture atlas layout shared by the block registry, the atlas painter and the chunk shader. */
export const ATLAS_TILES_PER_ROW = 8;
export const TILE_PIXELS = 16;

export const Tile = {
  GrassTop: 0,
  GrassSide: 1,
  Dirt: 2,
  Stone: 3,
  Sand: 4,
  Water: 5,
  LogSide: 6,
  LogTop: 7,
  Leaves: 8,
  Planks: 9,
  Cobblestone: 10,
  Glass: 11,
  Brick: 12,
  Snow: 13,
  Gravel: 14,
  TntSide: 15,
  TntTop: 16,
  TntBottom: 17,
  Bedrock: 18,
  DoorTop: 19,
  DoorBottom: 20,
  Ladder: 21,
  TorchSide: 22,
  TorchTop: 23,
  FlowerRed: 24,
  FlowerYellow: 25,
  TallGrass: 26,
  CoalOre: 27,
  IronOre: 28,
  CraftingTop: 29,
  CraftingSide: 30,
  // Sprites of items that are not blocks.
  ItemStick: 31,
  ItemCoal: 32,
  ItemIron: 33,
  ItemApple: 34,
  ItemWoodPickaxe: 35,
  ItemWoodAxe: 36,
  ItemWoodShovel: 37,
  ItemStonePickaxe: 38,
  ItemStoneAxe: 39,
  ItemStoneShovel: 40,
  ItemIronPickaxe: 41,
  ItemIronAxe: 42,
  ItemIronShovel: 43,
} as const;

export type Tile = (typeof Tile)[keyof typeof Tile];
export const TILE_COUNT = Object.keys(Tile).length;
