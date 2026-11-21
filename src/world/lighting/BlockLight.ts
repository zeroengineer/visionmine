import { IS_OPAQUE, LIGHT_EMISSION } from '../blocks/blocks';
import type { Chunk } from '../chunks/Chunk';
import { CHUNK_HEIGHT, CHUNK_SIZE } from '../constants';

/** Light never travels further than this many blocks from its source. */
export const MAX_LIGHT = 15;

/** The computed area is one chunk plus a margin as wide as light can travel. */
const SPAN = CHUNK_SIZE + MAX_LIGHT * 2;
const LAYER = SPAN * SPAN;

type ChunkLookup = (cx: number, cz: number) => Chunk | undefined;

/**
 * Light from torches and other emitting blocks around one chunk.
 *
 * Light starts at the emitter's level and loses one level per block, spreading
 * through anything that is not opaque (flood fill). Because it reaches at most
 * `MAX_LIGHT` blocks, the chunk and its eight neighbours contain every emitter
 * that can affect it. Nothing is computed when none of them holds an emitter,
 * which is the case for almost every chunk.
 */
export class BlockLight {
  private readonly levels = new Uint8Array(LAYER * CHUNK_HEIGHT);
  private readonly neighbours: Array<Chunk | undefined> = new Array<Chunk | undefined>(9);
  private readonly queue: number[] = [];
  private lit = false;

  /** True when the last `compute` found any light at all. */
  get any(): boolean {
    return this.lit;
  }

  /** Recomputes the light around `chunk`. Returns false when there is none. */
  compute(chunk: Chunk, lookup: ChunkLookup): boolean {
    const neighbours = this.neighbours;
    let emitters = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const source = dx === 0 && dz === 0 ? chunk : lookup(chunk.cx + dx, chunk.cz + dz);
        neighbours[dx + 1 + (dz + 1) * 3] = source;
        emitters += source?.emitters?.size ?? 0;
      }
    }
    if (emitters === 0) {
      this.lit = false;
      return false;
    }

    const levels = this.levels;
    const queue = this.queue;
    levels.fill(0);
    queue.length = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const source = neighbours[dx + 1 + (dz + 1) * 3];
        if (!source?.emitters) continue;
        for (const index of source.emitters) {
          const gx = (index & 15) + dx * CHUNK_SIZE + MAX_LIGHT;
          const gz = ((index >> 4) & 15) + dz * CHUNK_SIZE + MAX_LIGHT;
          if (gx < 0 || gx >= SPAN || gz < 0 || gz >= SPAN) continue;
          const y = index >> 8;
          const cell = gx + gz * SPAN + y * LAYER;
          const level = LIGHT_EMISSION[source.blocks[index]!]!;
          if (level > levels[cell]!) {
            levels[cell] = level;
            queue.push(cell);
          }
        }
      }
    }

    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head]!;
      const next = levels[cell]! - 1;
      if (next <= 0) continue;
      const gx = cell % SPAN;
      const gz = Math.floor(cell / SPAN) % SPAN;
      const y = Math.floor(cell / LAYER);
      if (gx > 0) this.spread(cell - 1, gx - 1, y, gz, next);
      if (gx < SPAN - 1) this.spread(cell + 1, gx + 1, y, gz, next);
      if (gz > 0) this.spread(cell - SPAN, gx, y, gz - 1, next);
      if (gz < SPAN - 1) this.spread(cell + SPAN, gx, y, gz + 1, next);
      if (y > 0) this.spread(cell - LAYER, gx, y - 1, gz, next);
      if (y < CHUNK_HEIGHT - 1) this.spread(cell + LAYER, gx, y + 1, gz, next);
    }
    this.lit = true;
    return true;
  }

  /**
   * Light level (0–15) at a position relative to the chunk's origin. `lx` and
   * `lz` may reach one block outside the chunk, as face lighting needs.
   */
  at(lx: number, y: number, lz: number): number {
    if (!this.lit || y < 0 || y >= CHUNK_HEIGHT) return 0;
    return this.levels[lx + MAX_LIGHT + (lz + MAX_LIGHT) * SPAN + y * LAYER]!;
  }

  private spread(cell: number, gx: number, y: number, gz: number, level: number): void {
    if (this.levels[cell]! >= level) return;
    // Which of the nine chunks holds this cell, and where in it.
    const wx = gx - MAX_LIGHT;
    const wz = gz - MAX_LIGHT;
    const source = this.neighbours[(wx >> 4) + 1 + ((wz >> 4) + 1) * 3];
    // Unloaded space is treated as open air.
    if (source && IS_OPAQUE[source.blocks[(wx & 15) + (wz & 15) * CHUNK_SIZE + y * 256]!] === 1) {
      return;
    }
    this.levels[cell] = level;
    this.queue.push(cell);
  }
}
