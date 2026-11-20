import { Tile } from './tiles';

export const BlockId = {
  Air: 0,
  Grass: 1,
  Dirt: 2,
  Stone: 3,
  Sand: 4,
  Water: 5,
  Log: 6,
  Leaves: 7,
  Planks: 8,
  Cobblestone: 9,
  Glass: 10,
  Brick: 11,
  Snow: 12,
  Gravel: 13,
  Tnt: 14,
  Bedrock: 15,
} as const;

export type BlockId = (typeof BlockId)[keyof typeof BlockId];

/** Face order used everywhere: +X, -X, +Y, -Y, +Z, -Z. */
export const Face = { PX: 0, NX: 1, PY: 2, NY: 3, PZ: 4, NZ: 5 } as const;

export interface BlockDef {
  readonly id: BlockId;
  readonly key: string;
  readonly name: string;
  /** Blocks movement. */
  readonly solid: boolean;
  /** Fully hides the faces of adjacent blocks. */
  readonly opaque: boolean;
  readonly liquid: boolean;
  /** Atlas tile per face, in `Face` order. */
  readonly tiles: readonly [Tile, Tile, Tile, Tile, Tile, Tile];
  /** Seconds of mining needed in survival mode. */
  readonly hardness: number;
  readonly breakable: boolean;
  /** Can be held in the inventory and placed by the player. */
  readonly placeable: boolean;
  /** Representative colour for particles and UI accents. */
  readonly color: number;
}

type TileSpec = Tile | { top: Tile; side: Tile; bottom: Tile };

function faces(spec: TileSpec): BlockDef['tiles'] {
  if (typeof spec === 'number') return [spec, spec, spec, spec, spec, spec];
  return [spec.side, spec.side, spec.top, spec.bottom, spec.side, spec.side];
}

function def(
  id: BlockId,
  key: string,
  name: string,
  tiles: TileSpec,
  color: number,
  hardness: number,
  overrides: Partial<Omit<BlockDef, 'id' | 'key' | 'name' | 'tiles' | 'color' | 'hardness'>> = {},
): BlockDef {
  return {
    id,
    key,
    name,
    tiles: faces(tiles),
    color,
    hardness,
    solid: true,
    opaque: true,
    liquid: false,
    breakable: true,
    placeable: true,
    ...overrides,
  };
}

export const BLOCKS: readonly BlockDef[] = [
  def(BlockId.Air, 'air', 'Air', Tile.Dirt, 0x000000, 0, {
    solid: false,
    opaque: false,
    breakable: false,
    placeable: false,
  }),
  def(
    BlockId.Grass,
    'grass',
    'Grass',
    { top: Tile.GrassTop, side: Tile.GrassSide, bottom: Tile.Dirt },
    0x6aa84a,
    0.6,
  ),
  def(BlockId.Dirt, 'dirt', 'Dirt', Tile.Dirt, 0x8a5a36, 0.5),
  def(BlockId.Stone, 'stone', 'Stone', Tile.Stone, 0x8b8f94, 1.5),
  def(BlockId.Sand, 'sand', 'Sand', Tile.Sand, 0xe2d39a, 0.5),
  def(BlockId.Water, 'water', 'Water', Tile.Water, 0x3f7fd6, 0, {
    solid: false,
    opaque: false,
    liquid: true,
    breakable: false,
    placeable: true,
  }),
  def(
    BlockId.Log,
    'log',
    'Wood Log',
    { top: Tile.LogTop, side: Tile.LogSide, bottom: Tile.LogTop },
    0x6e4f2e,
    1.2,
  ),
  def(BlockId.Leaves, 'leaves', 'Leaves', Tile.Leaves, 0x3f8a2e, 0.25, { opaque: false }),
  def(BlockId.Planks, 'planks', 'Planks', Tile.Planks, 0xb98d55, 1.0),
  def(BlockId.Cobblestone, 'cobblestone', 'Cobblestone', Tile.Cobblestone, 0x7c7f83, 1.6),
  def(BlockId.Glass, 'glass', 'Glass', Tile.Glass, 0xcfeaf5, 0.3, { opaque: false }),
  def(BlockId.Brick, 'brick', 'Bricks', Tile.Brick, 0xa5503f, 1.8),
  def(BlockId.Snow, 'snow', 'Snow', Tile.Snow, 0xf2f6fa, 0.4),
  def(BlockId.Gravel, 'gravel', 'Gravel', Tile.Gravel, 0x8a8683, 0.6),
  def(
    BlockId.Tnt,
    'tnt',
    'TNT',
    { top: Tile.TntTop, side: Tile.TntSide, bottom: Tile.TntBottom },
    0xc8402f,
    0.2,
  ),
  def(BlockId.Bedrock, 'bedrock', 'Bedrock', Tile.Bedrock, 0x3a3a3f, Infinity, {
    breakable: false,
    placeable: false,
  }),
];

export const BLOCK_COUNT = BLOCKS.length;

// Flat lookup tables for hot paths (meshing, collision, raycasting).
export const IS_SOLID = new Uint8Array(256);
export const IS_OPAQUE = new Uint8Array(256);
export const IS_LIQUID = new Uint8Array(256);
/** `FACE_TILES[id * 6 + face]` → atlas tile index. */
export const FACE_TILES = new Uint8Array(256 * 6);

for (const block of BLOCKS) {
  IS_SOLID[block.id] = block.solid ? 1 : 0;
  IS_OPAQUE[block.id] = block.opaque ? 1 : 0;
  IS_LIQUID[block.id] = block.liquid ? 1 : 0;
  for (let face = 0; face < 6; face++) FACE_TILES[block.id * 6 + face] = block.tiles[face]!;
}

export function isValidBlockId(id: unknown): id is BlockId {
  return typeof id === 'number' && Number.isInteger(id) && id >= 0 && id < BLOCK_COUNT;
}

export function getBlockDef(id: number): BlockDef {
  return BLOCKS[id] ?? BLOCKS[BlockId.Air]!;
}

/** Blocks the player can hold, in palette order. */
export const PLACEABLE_BLOCKS: readonly BlockId[] = BLOCKS.filter((b) => b.placeable).map(
  (b) => b.id,
);
