import { describe, expect, it } from 'vitest';
import {
  blockIndex,
  chunkKey,
  keyToChunkX,
  keyToChunkZ,
  toChunkCoord,
  toLocalCoord,
} from '@/world/chunks/coords';
import { ringOffsets } from '@/world/chunks/ChunkManager';

describe('chunk coordinates', () => {
  it('maps world coordinates to chunk coordinates, including negatives', () => {
    expect(toChunkCoord(0)).toBe(0);
    expect(toChunkCoord(15.9)).toBe(0);
    expect(toChunkCoord(16)).toBe(1);
    expect(toChunkCoord(-0.1)).toBe(-1);
    expect(toChunkCoord(-16)).toBe(-1);
    expect(toChunkCoord(-16.01)).toBe(-2);
  });

  it('maps world coordinates to local coordinates in 0..15', () => {
    expect(toLocalCoord(0)).toBe(0);
    expect(toLocalCoord(17)).toBe(1);
    expect(toLocalCoord(-1)).toBe(15);
    expect(toLocalCoord(-16)).toBe(0);
    expect(toLocalCoord(-17)).toBe(15);
  });

  it('round-trips chunk keys and keeps them unique', () => {
    const seen = new Set<number>();
    for (let cx = -40; cx <= 40; cx += 7) {
      for (let cz = -40; cz <= 40; cz += 7) {
        const key = chunkKey(cx, cz);
        expect(keyToChunkX(key)).toBe(cx);
        expect(keyToChunkZ(key)).toBe(cz);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('indexes blocks as x + z*16 + y*256', () => {
    expect(blockIndex(0, 0, 0)).toBe(0);
    expect(blockIndex(15, 0, 0)).toBe(15);
    expect(blockIndex(0, 0, 1)).toBe(16);
    expect(blockIndex(0, 1, 0)).toBe(256);
    expect(blockIndex(15, 127, 15)).toBe(16 * 16 * 128 - 1);
  });

  it('lists ring offsets nearest-first within the radius', () => {
    const offsets = ringOffsets(3);
    expect(offsets[0]).toMatchObject({ dx: 0, dz: 0 });
    let last = -1;
    for (const { dx, dz } of offsets) {
      const d = dx * dx + dz * dz;
      expect(d).toBeLessThanOrEqual(9);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
    expect(offsets).toHaveLength(29);
  });
});
