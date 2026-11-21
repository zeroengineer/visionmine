import { describe, expect, it } from 'vitest';
import { BlockId } from '@/world/blocks/blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE, CHUNK_VOLUME, SEA_LEVEL } from '@/world/constants';
import {
  GENERATOR_VERSION,
  sanitizeWorldConfig,
  type WorldConfig,
} from '@/world/generation/config';
import { TerrainGenerator } from '@/world/generation/TerrainGenerator';

const config = (overrides: Partial<WorldConfig> = {}): WorldConfig => ({
  seed: 'unit-test',
  terrain: 'standard',
  treeDensity: 1,
  ...overrides,
});

function count(blocks: Uint8Array, id: number): number {
  let n = 0;
  for (const b of blocks) if (b === id) n++;
  return n;
}

describe('TerrainGenerator', () => {
  it('produces a full chunk with bedrock at the bottom', () => {
    const blocks = new TerrainGenerator(config()).generateChunk(0, 0);
    expect(blocks).toHaveLength(CHUNK_VOLUME);
    for (let i = 0; i < 256; i++) expect(blocks[i]).toBe(BlockId.Bedrock);
  });

  it('is deterministic for a seed and independent of generation order', () => {
    const a = new TerrainGenerator(config());
    const b = new TerrainGenerator(config());
    b.generateChunk(5, -3); // different history must not matter
    expect(a.generateChunk(2, 1)).toEqual(b.generateChunk(2, 1));
    expect(a.generateChunk(-4, -7)).toEqual(b.generateChunk(-4, -7));
  });

  it('produces different terrain for different seeds', () => {
    const a = new TerrainGenerator(config({ seed: 'alpha' })).generateChunk(0, 0);
    const b = new TerrainGenerator(config({ seed: 'beta' })).generateChunk(0, 0);
    expect(a).not.toEqual(b);
  });

  it('matches getHeight for every column and fills water up to sea level', () => {
    const generator = new TerrainGenerator(config());
    for (const [cx, cz] of [
      [0, 0],
      [-3, 2],
      [9, -6],
    ] as const) {
      const blocks = generator.generateChunk(cx, cz);
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const height = generator.getHeight(cx * 16 + lx, cz * 16 + lz);
          const at = (y: number): number => blocks[lx + lz * 16 + y * 256]!;
          expect(at(height)).not.toBe(BlockId.Air);
          expect(at(height)).not.toBe(BlockId.Water);
          if (height < SEA_LEVEL) {
            expect(at(SEA_LEVEL)).toBe(BlockId.Water);
            expect(at(SEA_LEVEL + 1)).toBe(BlockId.Air);
          }
          expect(height).toBeGreaterThanOrEqual(3);
          expect(height).toBeLessThan(CHUNK_HEIGHT - 8);
        }
      }
    }
  });

  it('keeps terrain continuous across chunk borders', () => {
    const generator = new TerrainGenerator(config({ terrain: 'mountains' }));
    let maxStep = 0;
    for (let cz = -2; cz <= 2; cz++) {
      for (let z = 0; z < 16; z++) {
        // Columns x = 15 and x = 16 live in different chunks.
        const step = Math.abs(
          generator.getHeight(15, cz * 16 + z) - generator.getHeight(16, cz * 16 + z),
        );
        maxStep = Math.max(maxStep, step);
      }
    }
    expect(maxStep).toBeLessThanOrEqual(6);
  });

  it('generates grass, dirt, stone, sand and water over a region', () => {
    const generator = new TerrainGenerator(config());
    const totals = new Map<number, number>();
    for (let cz = -6; cz <= 6; cz++) {
      for (let cx = -6; cx <= 6; cx++) {
        const blocks = generator.generateChunk(cx, cz);
        for (const id of [
          BlockId.Grass,
          BlockId.Dirt,
          BlockId.Stone,
          BlockId.Sand,
          BlockId.Water,
          BlockId.Log,
          BlockId.Leaves,
        ]) {
          totals.set(id, (totals.get(id) ?? 0) + count(blocks, id));
        }
      }
    }
    for (const id of [BlockId.Grass, BlockId.Dirt, BlockId.Stone, BlockId.Sand, BlockId.Water]) {
      expect(totals.get(id), `block ${id}`).toBeGreaterThan(0);
    }
    expect(totals.get(BlockId.Log)).toBeGreaterThan(0);
    expect(totals.get(BlockId.Leaves)).toBeGreaterThan(0);
  });

  it('grows tree canopies across chunk borders consistently', () => {
    const generator = new TerrainGenerator(config({ treeDensity: 2 }));
    let checked = 0;
    let leaves = 0;
    for (let cz = -8; cz <= 8 && checked < 5; cz++) {
      for (let cx = -8; cx <= 8 && checked < 5; cx++) {
        const a = generator.generateChunk(cx, cz);
        // Trunks sit at offsets 0..2 of a 4-wide cell, so the closest a trunk gets to the
        // east border is local x = 14. Its radius-2 canopy must spill into x = 0 next door.
        for (let lz = 2; lz < 14 && checked < 5; lz++) {
          let top = -1;
          for (let y = CHUNK_HEIGHT - 1; y > 0; y--) {
            if (a[14 + lz * 16 + y * 256] === BlockId.Log) {
              top = y;
              break;
            }
          }
          if (top < 0) continue;
          // The same canopy inside chunk A proves which layers are wide.
          expect(a[15 + lz * 16 + top * 256]).toBe(BlockId.Leaves);
          const b = generator.generateChunk(cx + 1, cz);
          for (const y of [top - 1, top]) {
            const block = b[0 + lz * 16 + y * 256]!;
            // Leaves, unless terrain or another tree already occupies the cell.
            expect(block, `chunk ${cx + 1},${cz} z=${lz} y=${y}`).not.toBe(BlockId.Air);
            if (block === BlockId.Leaves) leaves++;
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(leaves).toBeGreaterThan(0);
  });

  it('respects tree density and terrain presets', () => {
    const none = new TerrainGenerator(config({ treeDensity: 0 }));
    let logs = 0;
    for (let c = -4; c <= 4; c++) logs += count(none.generateChunk(c, c), BlockId.Log);
    expect(logs).toBe(0);

    const flat = new TerrainGenerator(config({ terrain: 'flatlands' }));
    const hilly = new TerrainGenerator(config({ terrain: 'mountains' }));
    const range = (g: TerrainGenerator): number => {
      let min = Infinity;
      let max = -Infinity;
      for (let x = -200; x <= 200; x += 8) {
        for (let z = -200; z <= 200; z += 8) {
          const h = g.getHeight(x, z);
          min = Math.min(min, h);
          max = Math.max(max, h);
        }
      }
      return max - min;
    };
    expect(range(flat)).toBeLessThan(range(hilly));
  });

  it('finds a dry spawn point above the ground', () => {
    for (const terrain of ['standard', 'mountains', 'islands', 'flatlands'] as const) {
      const generator = new TerrainGenerator(config({ terrain, seed: `spawn-${terrain}` }));
      const spawn = generator.findSpawn();
      const ground = generator.getHeight(Math.floor(spawn.x), Math.floor(spawn.z));
      expect(spawn.y).toBeGreaterThan(ground);
      expect(spawn.y).toBeGreaterThan(SEA_LEVEL);
      expect(generator.findSpawn()).toEqual(spawn);
    }
  });

  it('sanitises malformed world configs', () => {
    expect(sanitizeWorldConfig(null)).toEqual({
      seed: 'visionmine',
      terrain: 'standard',
      treeDensity: 1,
      generator: 1,
    });
    expect(sanitizeWorldConfig({ seed: 'x', terrain: 'lava', treeDensity: 99 })).toEqual({
      seed: 'x',
      terrain: 'standard',
      treeDensity: 2,
      generator: 1,
    });
  });

  it('keeps a valid generator version and treats anything else as the first', () => {
    const version = (generator: unknown) =>
      sanitizeWorldConfig({ seed: 'x', terrain: 'standard', treeDensity: 1, generator }).generator;
    expect(version(GENERATOR_VERSION)).toBe(GENERATOR_VERSION);
    expect(version(1)).toBe(1);
    // A save from before versions existed, or a damaged value, is version 1.
    expect(version(undefined)).toBe(1);
    expect(version(0)).toBe(1);
    expect(version(1.5)).toBe(1);
    expect(version('2')).toBe(1);
    expect(version(GENERATOR_VERSION + 1)).toBe(1);
  });
});

describe('generator versions', () => {
  const PLANTS = new Set<number>([BlockId.TallGrass, BlockId.FlowerRed, BlockId.FlowerYellow]);

  function chunkPair(cx: number, cz: number) {
    const base = { seed: 'versions', terrain: 'flatlands', treeDensity: 1 } as const;
    return {
      v1: new TerrainGenerator({ ...base }).generateChunk(cx, cz),
      v2: new TerrainGenerator({ ...base, generator: 2 }).generateChunk(cx, cz),
    };
  }

  it('adds plants in version 2 and changes nothing else', () => {
    let plants = 0;
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        const { v1, v2 } = chunkPair(cx, cz);
        for (let i = 0; i < v1.length; i++) {
          if (v1[i] === v2[i]) continue;
          // The only difference allowed: air became a plant standing on grass.
          expect(v1[i]).toBe(BlockId.Air);
          expect(PLANTS.has(v2[i]!)).toBe(true);
          expect(v2[i - 256]).toBe(BlockId.Grass);
          plants++;
        }
        expect([...v1].some((id) => PLANTS.has(id))).toBe(false);
      }
    }
    expect(plants).toBeGreaterThan(50);
  });

  it('is deterministic for a given version', () => {
    const a = chunkPair(3, -4).v2;
    const b = chunkPair(3, -4).v2;
    expect(a).toEqual(b);
  });
});
