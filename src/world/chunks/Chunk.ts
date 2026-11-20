import { CHUNK_VOLUME } from '../constants';
import { blockIndex, chunkKey } from './coords';

/**
 * Pure voxel storage for one 16×128×16 column of the world. A chunk knows
 * nothing about rendering; meshes are derived from it elsewhere.
 */
export class Chunk {
  readonly key: number;
  readonly blocks: Uint8Array;

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

  /** Highest Y containing a non-air block, or -1 for an empty chunk. */
  highestBlockY(): number {
    const blocks = this.blocks;
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i] !== 0) return (i / 256) | 0;
    }
    return -1;
  }
}
