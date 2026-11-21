import { CHUNK_VOLUME } from '../constants';
import { blockIndex, chunkKey } from './coords';

/**
 * Pure voxel storage for one 16×128×16 column of the world. A chunk knows
 * nothing about rendering; meshes are derived from it elsewhere.
 */
export class Chunk {
  readonly key: number;
  readonly blocks: Uint8Array;
  /**
   * One state byte per block (orientation, open/closed, level…), parallel to
   * `blocks`. Allocated on first use: most chunks never hold a stateful block.
   */
  meta: Uint8Array | null = null;

  constructor(
    readonly cx: number,
    readonly cz: number,
    blocks?: Uint8Array,
  ) {
    if (blocks && blocks.length !== CHUNK_VOLUME) {
      throw new Error(`Chunk data has ${blocks.length} blocks, expected ${CHUNK_VOLUME}.`);
    }
    this.key = chunkKey(cx, cz);
    this.blocks = blocks ?? new Uint8Array(CHUNK_VOLUME);
  }

  get(lx: number, y: number, lz: number): number {
    return this.blocks[blockIndex(lx, y, lz)]!;
  }

  set(lx: number, y: number, lz: number, id: number): void {
    this.blocks[blockIndex(lx, y, lz)] = id;
  }

  /** State byte of the block at a flat index (0 when the chunk has none). */
  getMeta(index: number): number {
    return this.meta ? this.meta[index]! : 0;
  }

  setMeta(index: number, value: number): void {
    if (!this.meta) {
      if (value === 0) return;
      this.meta = new Uint8Array(CHUNK_VOLUME);
    }
    this.meta[index] = value;
  }

  /** Highest Y containing a non-air block, or -1 for an empty chunk. */
  highestBlockY(): number {
    const blocks = this.blocks;
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i] !== 0) return (i / 256) | 0;
    }
    return -1;
  }
}
