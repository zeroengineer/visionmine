import { CHUNK_AREA, CHUNK_HEIGHT, CHUNK_MASK, CHUNK_SHIFT, CHUNK_SIZE } from '../constants';

const KEY_OFFSET = 0x8000;
const KEY_SPAN = 0x10000;

/** Packs chunk coordinates (±32767) into a single number usable as a Map key. */
export function chunkKey(cx: number, cz: number): number {
  return (cx + KEY_OFFSET) * KEY_SPAN + (cz + KEY_OFFSET);
}

export function keyToChunkX(key: number): number {
  return Math.floor(key / KEY_SPAN) - KEY_OFFSET;
}

export function keyToChunkZ(key: number): number {
  return (key % KEY_SPAN) - KEY_OFFSET;
}

/** World block coordinate → chunk coordinate (correct for negatives). */
export function toChunkCoord(worldCoord: number): number {
  return Math.floor(worldCoord) >> CHUNK_SHIFT;
}

/** World block coordinate → coordinate inside its chunk (0..15, correct for negatives). */
export function toLocalCoord(worldCoord: number): number {
  return Math.floor(worldCoord) & CHUNK_MASK;
}

/** Index of a block inside a chunk's flat array. Layout: x + z * 16 + y * 256. */
export function blockIndex(lx: number, y: number, lz: number): number {
  return lx + lz * CHUNK_SIZE + y * CHUNK_AREA;
}

export function isValidY(y: number): boolean {
  return y >= 0 && y < CHUNK_HEIGHT;
}
