import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { clamp, lerp, smoothstep } from '@/utils/math';
import { hash3, hashString, mulberry32 } from '@/utils/rng';
import { BlockId } from '../blocks/blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE, CHUNK_VOLUME, SEA_LEVEL } from '../constants';
import { TERRAIN_PRESETS, type TerrainPreset, type WorldConfig } from './config';

export type Biome = 'ocean' | 'beach' | 'plains' | 'forest' | 'desert' | 'snow' | 'mountain';

export interface ColumnSample {
  /** Y of the topmost solid block. */
  height: number;
  biome: Biome;
  /** Block at `height`. */
  surface: number;
  /** Blocks directly below the surface. */
  filler: number;
  /** Probability (0..1) that a tree cell centred here grows a tree. */
  treeChance: number;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
}

/** Trees are placed on a jittered grid so trunks never touch. */
const TREE_CELL = 4;
/** Leaves reach this far from the trunk; chunks look this far past their border. */
const TREE_RADIUS = 2;
const MAX_TERRAIN_HEIGHT = CHUNK_HEIGHT - 12;

function fbm(
  noise: NoiseFunction2D,
  x: number,
  z: number,
  octaves: number,
  lacunarity = 2,
  gain = 0.5,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * frequency, z * frequency) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}

/**
 * Deterministic terrain generator. Every output is a pure function of the
 * world config and world coordinates, which guarantees that neighbouring
 * chunks line up no matter the order (or thread) in which they are generated.
 */
export class TerrainGenerator {
  readonly seed: number;
  private readonly preset: TerrainPreset;
  private readonly treeDensity: number;
  /** Generator version of this world; newer features are skipped for older worlds. */
  private readonly version: number;
  /** Plant chosen for each column of the chunk being generated (0 = none). */
  private readonly plants = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  private readonly continent: NoiseFunction2D;
  private readonly erosion: NoiseFunction2D;
  private readonly ridge: NoiseFunction2D;
  private readonly hills: NoiseFunction2D;
  private readonly detail: NoiseFunction2D;
  private readonly temperature: NoiseFunction2D;
  private readonly moisture: NoiseFunction2D;
  private readonly scratch: ColumnSample = {
    height: 0,
    biome: 'plains',
    surface: BlockId.Grass,
    filler: BlockId.Dirt,
    treeChance: 0,
  };

  constructor(readonly config: WorldConfig) {
    this.seed = hashString(config.seed);
    this.preset = TERRAIN_PRESETS[config.terrain];
    this.treeDensity = config.treeDensity;
    this.version = config.generator ?? 1;
    const layer = (index: number): NoiseFunction2D =>
      createNoise2D(mulberry32(this.seed + index * 0x9e3779b1));
    this.continent = layer(1);
    this.erosion = layer(2);
    this.ridge = layer(3);
    this.hills = layer(4);
    this.detail = layer(5);
    this.temperature = layer(6);
    this.moisture = layer(7);
  }

  /** Height of the topmost solid block at a world column. */
  getHeight(x: number, z: number): number {
    return this.sampleColumn(x, z, this.scratch).height;
  }

  /** Computes terrain height, biome and surface blocks for one world column. */
  sampleColumn(x: number, z: number, out: ColumnSample): ColumnSample {
    const p = this.preset;
    const c = fbm(this.continent, x / p.continentScale, z / p.continentScale, 4) + p.landBias;
    const e = fbm(this.erosion, x / 340, z / 340, 3);
    const h = fbm(this.hills, x / 90, z / 90, 4);
    const d = this.detail(x / 24, z / 24);

    // Continental profile: ocean floor → shelf → beach → inland plateau.
    let base: number;
    if (c < -0.25) base = Math.max(SEA_LEVEL - 30, SEA_LEVEL - 6 - (-0.25 - c) * 40);
    else if (c < 0) base = lerp(SEA_LEVEL - 6, SEA_LEVEL + 1.5, smoothstep(-0.25, 0, c));
    else base = SEA_LEVEL + 1.5 + smoothstep(0, 0.5, c) * 9;

    const landness = smoothstep(-0.05, 0.25, c);
    // Low erosion = flat plains, high erosion = rugged hills and mountains.
    const hillAmp = p.hillAmplitude * (0.3 + 0.7 * smoothstep(-0.6, 0.2, e));
    const mountainMask = smoothstep(p.mountainThreshold, p.mountainThreshold + 0.45, e) * landness;
    let mountain = 0;
    if (mountainMask > 0 && p.mountainAmplitude > 0) {
      const r = 1 - Math.abs(fbm(this.ridge, x / 210, z / 210, 3));
      mountain = mountainMask * r * r * p.mountainAmplitude * (0.65 + 0.35 * (h * 0.5 + 0.5));
    }

    const raw = base + landness * h * hillAmp + mountain + d * 1.2;
    const height = clamp(Math.round(raw), 3, MAX_TERRAIN_HEIGHT);

    const altitude = height - SEA_LEVEL;
    const temp = fbm(this.temperature, x / 700, z / 700, 2) - Math.max(0, altitude) / 85;
    const moist = fbm(this.moisture, x / 480, z / 480, 2);

    out.height = height;
    out.treeChance = 0;
    if (height < SEA_LEVEL) {
      out.biome = 'ocean';
      out.surface = height < SEA_LEVEL - 9 && d > 0.15 ? BlockId.Gravel : BlockId.Sand;
      out.filler = BlockId.Sand;
    } else if (height <= SEA_LEVEL + 1 && c < 0.12) {
      out.biome = 'beach';
      out.surface = BlockId.Sand;
      out.filler = BlockId.Sand;
    } else if (altitude > 48 + d * 4 || temp < -0.48) {
      out.biome = 'snow';
      out.surface = BlockId.Snow;
      out.filler = altitude > 36 ? BlockId.Stone : BlockId.Dirt;
      out.treeChance = altitude > 36 ? 0 : 0.05;
    } else if (altitude > 34 + d * 5) {
      out.biome = 'mountain';
      out.surface = BlockId.Stone;
      out.filler = BlockId.Stone;
    } else if (temp > 0.3 && moist < -0.05) {
      out.biome = 'desert';
      out.surface = BlockId.Sand;
      out.filler = BlockId.Sand;
    } else if (moist > 0.12) {
      out.biome = 'forest';
      out.surface = BlockId.Grass;
      out.filler = BlockId.Dirt;
      out.treeChance = 0.42 + moist * 0.3;
    } else {
      out.biome = 'plains';
      out.surface = BlockId.Grass;
      out.filler = BlockId.Dirt;
      out.treeChance = 0.035;
    }
    return out;
  }

  /** Generates the full block data for one chunk. */
  generateChunk(cx: number, cz: number): Uint8Array {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const column = this.scratch;
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        this.sampleColumn(x0 + lx, z0 + lz, column);
        const base = lx + lz * CHUNK_SIZE;
        const height = column.height;
        const fillerStart = height - 3;
        blocks[base] = BlockId.Bedrock;
        for (let y = 1; y < fillerStart; y++) blocks[base + y * 256] = BlockId.Stone;
        for (let y = Math.max(1, fillerStart); y < height; y++)
          blocks[base + y * 256] = column.filler;
        blocks[base + height * 256] = column.surface;
        for (let y = height + 1; y <= SEA_LEVEL; y++) blocks[base + y * 256] = BlockId.Water;
        this.plants[base] = this.version >= 2 ? this.choosePlant(x0 + lx, z0 + lz, column) : 0;
      }
    }

    this.placeTrees(blocks, x0, z0);
    if (this.version >= 2) this.placePlants(blocks);
    return blocks;
  }

  /**
   * Finds a dry, reasonably flat place to start, searching outward from the origin.
   * `y` is the feet position one block above the ground.
   */
  findSpawn(): SpawnPoint {
    const sample = this.scratch;
    let best: SpawnPoint | null = null;
    let bestHeight = -Infinity;
    const step = 6;
    for (let ring = 0; ring <= 60; ring++) {
      const r = ring * step;
      for (let dz = -r; dz <= r; dz += step) {
        for (let dx = -r; dx <= r; dx += step) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const { height, biome } = this.sampleColumn(dx, dz, sample);
          if (height > bestHeight) {
            bestHeight = height;
            best = { x: dx + 0.5, y: Math.max(height, SEA_LEVEL) + 1, z: dz + 0.5 };
          }
          const dry = height > SEA_LEVEL && biome !== 'ocean';
          if (!dry || height > SEA_LEVEL + 34) continue;
          const slope =
            Math.abs(this.getHeight(dx + 2, dz) - height) +
            Math.abs(this.getHeight(dx, dz + 2) - height);
          if (slope <= 2) return { x: dx + 0.5, y: height + 1, z: dz + 0.5 };
        }
      }
    }
    return best ?? { x: 0.5, y: SEA_LEVEL + 2, z: 0.5 };
  }

  /** Flower or grass tuft growing on this column's surface, or 0. */
  private choosePlant(x: number, z: number, column: ColumnSample): number {
    if (column.surface !== BlockId.Grass || column.height <= SEA_LEVEL) return 0;
    if (column.height + 1 >= CHUNK_HEIGHT) return 0;
    const roll = hash3(this.seed, x, z, 91);
    // Plants follow the vegetation setting: none at 0, full density from 1 up.
    const density = Math.min(1, this.treeDensity);
    if (density <= 0) return 0;
    const meadow = column.biome === 'plains';
    const grass = (meadow ? 0.1 : 0.04) * density;
    const flower = (meadow ? 0.02 : 0.008) * density;
    if (roll < grass) return BlockId.TallGrass;
    if (roll < grass + flower) return BlockId.FlowerRed;
    if (roll < grass + flower * 2) return BlockId.FlowerYellow;
    return 0;
  }

  /** Puts the chosen plants on top of their columns, wherever a tree did not take the spot. */
  private placePlants(blocks: Uint8Array): void {
    const plants = this.plants;
    for (let base = 0; base < plants.length; base++) {
      const plant = plants[base]!;
      if (plant === 0) continue;
      // The surface is the highest grass block of the column, found from the top down.
      for (let y = CHUNK_HEIGHT - 2; y > SEA_LEVEL; y--) {
        const below = blocks[base + y * 256]!;
        if (below === BlockId.Air) continue;
        if (below === BlockId.Grass && blocks[base + (y + 1) * 256] === BlockId.Air) {
          blocks[base + (y + 1) * 256] = plant;
        }
        break;
      }
    }
  }

  private placeTrees(blocks: Uint8Array, x0: number, z0: number): void {
    if (this.treeDensity <= 0) return;
    const column = this.scratch;
    const minCellX = Math.floor((x0 - TREE_RADIUS) / TREE_CELL);
    const maxCellX = Math.floor((x0 + CHUNK_SIZE - 1 + TREE_RADIUS) / TREE_CELL);
    const minCellZ = Math.floor((z0 - TREE_RADIUS) / TREE_CELL);
    const maxCellZ = Math.floor((z0 + CHUNK_SIZE - 1 + TREE_RADIUS) / TREE_CELL);

    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        // Trunk offset 0..2 inside a 4-wide cell keeps neighbouring trunks apart.
        const tx = cellX * TREE_CELL + Math.floor(hash3(this.seed, cellX, cellZ, 11) * 3);
        const tz = cellZ * TREE_CELL + Math.floor(hash3(this.seed, cellX, cellZ, 23) * 3);
        if (
          tx < x0 - TREE_RADIUS ||
          tx > x0 + CHUNK_SIZE - 1 + TREE_RADIUS ||
          tz < z0 - TREE_RADIUS ||
          tz > z0 + CHUNK_SIZE - 1 + TREE_RADIUS
        ) {
          continue;
        }
        this.sampleColumn(tx, tz, column);
        if (column.treeChance <= 0 || column.height <= SEA_LEVEL) continue;
        if (hash3(this.seed, cellX, cellZ, 37) >= column.treeChance * this.treeDensity) continue;
        const trunk = 4 + Math.floor(hash3(this.seed, cellX, cellZ, 41) * 3);
        this.growTree(blocks, x0, z0, tx, column.height + 1, tz, trunk);
      }
    }
  }

  private growTree(
    blocks: Uint8Array,
    x0: number,
    z0: number,
    tx: number,
    baseY: number,
    tz: number,
    trunk: number,
  ): void {
    const topY = baseY + trunk - 1;
    if (topY + 2 >= CHUNK_HEIGHT) return;

    // Canopy: two wide layers around the top of the trunk, two narrow layers above.
    for (let y = topY - 1; y <= topY + 2; y++) {
      const radius = y <= topY ? 2 : 1;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
          if (corner) {
            // Rounded canopy: thin out the corners, and always trim them on the cap.
            const roll = hash3(this.seed, tx + dx, y, tz + dz);
            if (radius === 2 ? roll < 0.6 : y === topY + 2 || roll < 0.5) continue;
          }
          const lx = tx + dx - x0;
          const lz = tz + dz - z0;
          if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
          const index = lx + lz * CHUNK_SIZE + y * 256;
          if (blocks[index] === BlockId.Air) blocks[index] = BlockId.Leaves;
        }
      }
    }

    const lx = tx - x0;
    const lz = tz - z0;
    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
      for (let y = baseY; y <= topY; y++) blocks[lx + lz * CHUNK_SIZE + y * 256] = BlockId.Log;
    }
  }
}
