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
} as const;

export type Tile = (typeof Tile)[keyof typeof Tile];
export const TILE_COUNT = Object.keys(Tile).length;
