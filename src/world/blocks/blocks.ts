import { shapeBoxes, type Box, type Shape } from './shapes';
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
  StoneSlab: 16,
  PlankSlab: 17,
  CobbleSlab: 18,
  BrickSlab: 19,
  StoneStairs: 20,
  PlankStairs: 21,
  CobbleStairs: 22,
  BrickStairs: 23,
  Door: 24,
  /** Upper half of a door; exists only above a `Door` block. */
  DoorUpper: 25,
  Ladder: 26,
  GlassPane: 27,
  Torch: 28,
  FlowerRed: 29,
  FlowerYellow: 30,
  TallGrass: 31,
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
  /** Geometry; anything but `cube` is described by boxes in shapes.ts. */
  readonly shape: Shape;
  readonly breakable: boolean;
  /** Can be held in the inventory and placed by the player. */
  readonly placeable: boolean;
  /** Representative colour for particles and UI accents. */
  readonly color: number;
  /** Light given off, 0–15. */
  readonly light: number;
  /** Can be climbed like a ladder. */
  readonly climbable: boolean;
  /** Drops when nothing is underneath (sand, gravel). */
  readonly falls: boolean;
  /** Breaks when the block underneath is removed (plants, torches). */
  readonly needsSupport: boolean;
  /** Block the player receives for this one, when it is not itself (a door's upper half). */
  readonly item: BlockId;
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
  const block: BlockDef = {
    id,
    key,
    name,
    tiles: faces(tiles),
    color,
    hardness,
    solid: true,
    opaque: true,
    liquid: false,
    shape: 'cube',
    breakable: true,
    placeable: true,
    light: 0,
    climbable: false,
    falls: false,
    needsSupport: false,
    item: id,
    ...overrides,
  };
  BLOCKS_BY_ID.set(id, block);
  return block;
}

/** Filled as definitions are created, so later ones can derive from earlier ones. */
const BLOCKS_BY_ID = new Map<number, BlockDef>();

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
  def(BlockId.Sand, 'sand', 'Sand', Tile.Sand, 0xe2d39a, 0.5, { falls: true }),
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
  def(BlockId.Gravel, 'gravel', 'Gravel', Tile.Gravel, 0x8a8683, 0.6, { falls: true }),
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
  shaped(BlockId.StoneSlab, 'stone_slab', 'Stone Slab', BlockId.Stone, 'slab'),
  shaped(BlockId.PlankSlab, 'plank_slab', 'Plank Slab', BlockId.Planks, 'slab'),
  shaped(BlockId.CobbleSlab, 'cobble_slab', 'Cobblestone Slab', BlockId.Cobblestone, 'slab'),
  shaped(BlockId.BrickSlab, 'brick_slab', 'Brick Slab', BlockId.Brick, 'slab'),
  shaped(BlockId.StoneStairs, 'stone_stairs', 'Stone Stairs', BlockId.Stone, 'stairs'),
  shaped(BlockId.PlankStairs, 'plank_stairs', 'Plank Stairs', BlockId.Planks, 'stairs'),
  shaped(
    BlockId.CobbleStairs,
    'cobble_stairs',
    'Cobblestone Stairs',
    BlockId.Cobblestone,
    'stairs',
  ),
  shaped(BlockId.BrickStairs, 'brick_stairs', 'Brick Stairs', BlockId.Brick, 'stairs'),
  def(BlockId.Door, 'door', 'Door', Tile.DoorBottom, 0x9a7446, 0.8, {
    shape: 'door',
    opaque: false,
  }),
  def(BlockId.DoorUpper, 'door_upper', 'Door', Tile.DoorTop, 0x9a7446, 0.8, {
    shape: 'door',
    opaque: false,
    placeable: false,
    item: BlockId.Door,
  }),
  def(BlockId.Ladder, 'ladder', 'Ladder', Tile.Ladder, 0x9a7446, 0.4, {
    shape: 'ladder',
    solid: false,
    opaque: false,
    climbable: true,
  }),
  def(BlockId.GlassPane, 'glass_pane', 'Glass Pane', Tile.Glass, 0xcfeaf5, 0.3, {
    shape: 'pane',
    opaque: false,
  }),
  def(
    BlockId.Torch,
    'torch',
    'Torch',
    { top: Tile.TorchTop, side: Tile.TorchSide, bottom: Tile.TorchTop },
    0xffc45a,
    0.05,
    { shape: 'post', solid: false, opaque: false, light: 14, needsSupport: true },
  ),
  plant(BlockId.FlowerRed, 'flower_red', 'Poppy', Tile.FlowerRed, 0xd8342c),
  plant(BlockId.FlowerYellow, 'flower_yellow', 'Dandelion', Tile.FlowerYellow, 0xf2d024),
  plant(BlockId.TallGrass, 'tall_grass', 'Tall Grass', Tile.TallGrass, 0x6aaa3a),
];

function plant(id: BlockId, key: string, name: string, tile: Tile, color: number): BlockDef {
  return def(id, key, name, tile, color, 0.05, {
    shape: 'cross',
    solid: false,
    opaque: false,
    needsSupport: true,
  });
}

/** A slab or stairs cut from an existing block: same look and hardness, different geometry. */
function shaped(id: BlockId, key: string, name: string, base: BlockId, shape: Shape): BlockDef {
  const source = BLOCKS_BY_ID.get(base)!;
  return { ...source, id, key, name, shape, opaque: false, item: id };
}

export const BLOCK_COUNT = BLOCKS.length;

// Flat lookup tables for hot paths (meshing, collision, raycasting).
export const IS_SOLID = new Uint8Array(256);
export const IS_OPAQUE = new Uint8Array(256);
export const IS_LIQUID = new Uint8Array(256);
/** Light emitted by each block, 0–15. */
export const LIGHT_EMISSION = new Uint8Array(256);
/** 1 for full cubes; everything else needs `blockBoxes`. Air counts as a cube. */
export const IS_CUBE = new Uint8Array(256).fill(1);
/** `FACE_TILES[id * 6 + face]` → atlas tile index. */
export const FACE_TILES = new Uint8Array(256 * 6);

for (const block of BLOCKS) {
  IS_SOLID[block.id] = block.solid ? 1 : 0;
  IS_OPAQUE[block.id] = block.opaque ? 1 : 0;
  IS_LIQUID[block.id] = block.liquid ? 1 : 0;
  LIGHT_EMISSION[block.id] = block.light;
  IS_CUBE[block.id] = block.shape === 'cube' ? 1 : 0;
  for (let face = 0; face < 6; face++) FACE_TILES[block.id * 6 + face] = block.tiles[face]!;
}

export function isValidBlockId(id: unknown): id is BlockId {
  return typeof id === 'number' && Number.isInteger(id) && id >= 0 && id < BLOCK_COUNT;
}

/** Boxes occupied by a block in a given state, in block-local coordinates. */
export function blockBoxes(id: number, meta: number): readonly Box[] {
  return shapeBoxes(getBlockDef(id).shape, meta);
}

export function getBlockDef(id: number): BlockDef {
  return BLOCKS[id] ?? BLOCKS[BlockId.Air]!;
}

/** Blocks the player can hold, in palette order. */
export const PLACEABLE_BLOCKS: readonly BlockId[] = BLOCKS.filter((b) => b.placeable).map(
  (b) => b.id,
);
