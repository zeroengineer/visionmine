import { BlockId, getBlockDef } from '@/world/blocks/blocks';
import { CHUNK_HEIGHT } from '@/world/constants';
import type { World } from '@/world/World';

export interface Cell {
  x: number;
  y: number;
  z: number;
}

/** Axis-aligned block region; all bounds are inclusive block coordinates. */
export interface Region {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** A copied region. Blocks are indexed `x + z * sx + y * sx * sz`. */
export interface Clipboard {
  sx: number;
  sy: number;
  sz: number;
  blocks: Uint8Array;
  /** State byte of each copied block, in the same order. */
  meta: Uint8Array;
}

/** Largest region a single operation may touch (32 × 32 × 32). */
export const MAX_REGION_BLOCKS = 32768;

/** Skips a cell during a write, e.g. because the player is standing in it. */
export type CellFilter = (x: number, y: number, z: number) => boolean;

export function regionFromCorners(a: Cell, b: Cell): Region {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.max(0, Math.min(a.y, b.y)),
    minZ: Math.min(a.z, b.z),
    maxX: Math.max(a.x, b.x),
    maxY: Math.min(CHUNK_HEIGHT - 1, Math.max(a.y, b.y)),
    maxZ: Math.max(a.z, b.z),
  };
}

export function regionSize(region: Region): { sx: number; sy: number; sz: number } {
  return {
    sx: region.maxX - region.minX + 1,
    sy: region.maxY - region.minY + 1,
    sz: region.maxZ - region.minZ + 1,
  };
}

export function regionVolume(region: Region): number {
  const { sx, sy, sz } = regionSize(region);
  return Math.max(0, sx) * Math.max(0, sy) * Math.max(0, sz);
}

/** True when every chunk the region touches is loaded, so no write can be silently dropped. */
export function isRegionLoaded(world: World, region: Region): boolean {
  for (let cz = region.minZ >> 4; cz <= region.maxZ >> 4; cz++) {
    for (let cx = region.minX >> 4; cx <= region.maxX >> 4; cx++) {
      if (!world.hasChunk(cx, cz)) return false;
    }
  }
  return true;
}

function forEachCell(region: Region, visit: (x: number, y: number, z: number) => void): void {
  for (let y = region.minY; y <= region.maxY; y++) {
    for (let z = region.minZ; z <= region.maxZ; z++) {
      for (let x = region.minX; x <= region.maxX; x++) visit(x, y, z);
    }
  }
}

const isProtected = (block: number): boolean =>
  block !== BlockId.Air && !getBlockDef(block).breakable;

/** Sets every cell to `block`, leaving unbreakable blocks alone. Returns the number changed. */
export function fillRegion(world: World, region: Region, block: number, skip?: CellFilter): number {
  let changed = 0;
  forEachCell(region, (x, y, z) => {
    if (skip?.(x, y, z) || isProtected(world.getBlock(x, y, z))) return;
    if (world.setBlock(x, y, z, block)) changed++;
  });
  return changed;
}

/** Turns every existing block into `block`, keeping air as air. Returns the number changed. */
export function replaceRegion(world: World, region: Region, block: number): number {
  let changed = 0;
  forEachCell(region, (x, y, z) => {
    const existing = world.getBlock(x, y, z);
    if (existing === BlockId.Air || isProtected(existing)) return;
    if (world.setBlock(x, y, z, block)) changed++;
  });
  return changed;
}

export function clearRegion(world: World, region: Region): number {
  return fillRegion(world, region, BlockId.Air);
}

export function copyRegion(world: World, region: Region): Clipboard {
  const { sx, sy, sz } = regionSize(region);
  const blocks = new Uint8Array(sx * sy * sz);
  const meta = new Uint8Array(blocks.length);
  let i = 0;
  forEachCell(region, (x, y, z) => {
    blocks[i] = world.getBlock(x, y, z);
    meta[i++] = world.getMeta(x, y, z);
  });
  return { sx, sy, sz, blocks, meta };
}

/** Returns the clipboard turned a quarter turn clockwise, seen from above. */
export function rotateClipboard(clipboard: Clipboard): Clipboard {
  const { sx, sy, sz, blocks, meta } = clipboard;
  const rotated = new Uint8Array(blocks.length);
  const rotatedMeta = new Uint8Array(meta.length);
  // After the turn the footprint is sz wide and sx deep.
  for (let y = 0; y < sy; y++) {
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const nx = sz - 1 - z;
        const nz = x;
        const from = x + z * sx + y * sx * sz;
        const to = nx + nz * sz + y * sz * sx;
        rotated[to] = blocks[from]!;
        rotatedMeta[to] = meta[from]!;
      }
    }
  }
  return { sx: sz, sy, sz: sx, blocks: rotated, meta: rotatedMeta };
}

/** Region a clipboard would occupy with its lowest corner at `origin`. */
export function pasteRegion(clipboard: Clipboard, origin: Cell): Region {
  return regionFromCorners(origin, {
    x: origin.x + clipboard.sx - 1,
    y: origin.y + clipboard.sy - 1,
    z: origin.z + clipboard.sz - 1,
  });
}

/**
 * Writes the clipboard with its lowest corner at `origin`. Air in the clipboard
 * is not pasted, so a copied shape does not carve out what is already there.
 */
export function pasteClipboard(
  world: World,
  clipboard: Clipboard,
  origin: Cell,
  skip?: CellFilter,
): number {
  const { sx, sy, sz, blocks, meta } = clipboard;
  let changed = 0;
  for (let y = 0; y < sy; y++) {
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const index = x + z * sx + y * sx * sz;
        const block = blocks[index]!;
        if (block === BlockId.Air) continue;
        const wx = origin.x + x;
        const wy = origin.y + y;
        const wz = origin.z + z;
        if (skip?.(wx, wy, wz) || isProtected(world.getBlock(wx, wy, wz))) continue;
        if (world.setBlock(wx, wy, wz, block, meta[index])) changed++;
      }
    }
  }
  return changed;
}
