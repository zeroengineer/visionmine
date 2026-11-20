import { Emitter } from '@/utils/Emitter';
import { CHUNK_MASK, CHUNK_SIZE } from './constants';
import type { Chunk } from './chunks/Chunk';
import { blockIndex, chunkKey, isValidY, toChunkCoord } from './chunks/coords';

export interface WorldEvents {
  /** A block was changed through `setBlock`. */
  blockChanged: { x: number; y: number; z: number; previous: number; next: number };
  /** A chunk's blocks changed and its mesh is stale. `urgent` = caused by a player edit. */
  chunkDirty: { key: number; urgent: boolean };
  chunkAdded: { chunk: Chunk };
  chunkRemoved: { key: number };
}

/**
 * The voxel world: loaded chunks plus the player's edits. All gameplay code reads
 * and writes blocks through this facade using world coordinates.
 *
 * Edits are stored separately from chunk data (`chunkKey → localIndex → blockId`)
 * so they survive chunk unloading and are the only thing that needs saving.
 */
export class World {
  readonly events = new Emitter<WorldEvents>();
  private readonly chunks = new Map<number, Chunk>();
  private readonly edits = new Map<number, Map<number, number>>();
  /** Chunks whose edits changed since the last save. */
  private readonly unsavedEdits = new Set<number>();

  get chunkCount(): number {
    return this.chunks.size;
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  getChunkByKey(key: number): Chunk | undefined {
    return this.chunks.get(key);
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz));
  }

  loadedChunks(): IterableIterator<Chunk> {
    return this.chunks.values();
  }

  /** True when the chunk containing this world position is loaded. */
  isLoadedAt(x: number, z: number): boolean {
    return this.chunks.has(chunkKey(toChunkCoord(x), toChunkCoord(z)));
  }

  /** Registers a freshly generated chunk and re-applies any stored edits to it. */
  addChunk(chunk: Chunk): void {
    const edits = this.edits.get(chunk.key);
    if (edits) {
      for (const [index, id] of edits) chunk.blocks[index] = id;
    }
    this.chunks.set(chunk.key, chunk);
    this.events.emit('chunkAdded', { chunk });
    this.events.emit('chunkDirty', { key: chunk.key, urgent: false });
  }

  removeChunk(key: number): void {
    if (this.chunks.delete(key)) this.events.emit('chunkRemoved', { key });
  }

  /** Returns the block at a world position; unloaded or out-of-range space reads as air. */
  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= 128) return 0;
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!chunk) return 0;
    return chunk.blocks[(x & CHUNK_MASK) + (z & CHUNK_MASK) * CHUNK_SIZE + y * 256]!;
  }

  /**
   * Sets a block at integer world coordinates. Returns false when nothing changed
   * (unloaded chunk, out of range, or same block).
   */
  setBlock(x: number, y: number, z: number, id: number): boolean {
    if (!isValidY(y)) return false;
    const cx = x >> 4;
    const cz = z >> 4;
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return false;

    const lx = x & CHUNK_MASK;
    const lz = z & CHUNK_MASK;
    const index = blockIndex(lx, y, lz);
    const previous = chunk.blocks[index]!;
    if (previous === id) return false;
    chunk.blocks[index] = id;

    let chunkEdits = this.edits.get(key);
    if (!chunkEdits) {
      chunkEdits = new Map();
      this.edits.set(key, chunkEdits);
    }
    chunkEdits.set(index, id);
    this.unsavedEdits.add(key);

    this.events.emit('chunkDirty', { key, urgent: true });
    // Faces (and ambient occlusion) of neighbouring chunks depend on border blocks.
    const west = lx === 0;
    const east = lx === CHUNK_MASK;
    const north = lz === 0;
    const south = lz === CHUNK_MASK;
    if (west) this.markDirty(cx - 1, cz);
    if (east) this.markDirty(cx + 1, cz);
    if (north) this.markDirty(cx, cz - 1);
    if (south) this.markDirty(cx, cz + 1);
    if (west && north) this.markDirty(cx - 1, cz - 1);
    if (west && south) this.markDirty(cx - 1, cz + 1);
    if (east && north) this.markDirty(cx + 1, cz - 1);
    if (east && south) this.markDirty(cx + 1, cz + 1);

    this.events.emit('blockChanged', { x, y, z, previous, next: id });
    return true;
  }

  // --- Edit persistence -----------------------------------------------------

  /** Replaces all edits (used when loading a save). Loaded chunks are not touched. */
  loadEdits(edits: Map<number, Map<number, number>>): void {
    this.edits.clear();
    for (const [key, chunkEdits] of edits) this.edits.set(key, new Map(chunkEdits));
    this.unsavedEdits.clear();
  }

  getEdits(key: number): ReadonlyMap<number, number> | undefined {
    return this.edits.get(key);
  }

  get editedChunkCount(): number {
    return this.edits.size;
  }

  /** Returns and clears the set of chunk keys whose edits need saving. */
  takeUnsavedEdits(): number[] {
    const keys = [...this.unsavedEdits];
    this.unsavedEdits.clear();
    return keys;
  }

  /** Puts keys back after a failed save so they are retried. */
  restoreUnsavedEdits(keys: readonly number[]): void {
    for (const key of keys) this.unsavedEdits.add(key);
  }

  get hasUnsavedEdits(): boolean {
    return this.unsavedEdits.size > 0;
  }

  /** Drops every chunk and edit. */
  clear(): void {
    for (const key of [...this.chunks.keys()]) this.removeChunk(key);
    this.edits.clear();
    this.unsavedEdits.clear();
  }

  private markDirty(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    if (this.chunks.has(key)) this.events.emit('chunkDirty', { key, urgent: true });
  }
}
