import type { Chunk } from '../chunks/Chunk';

/**
 * Floats per face in a `FaceBatch`:
 * `x, y, z` (min corner of the block, chunk-local), `face` (0..5), `tile`,
 * `ao0..ao3` (corner brightness in quad UV order 00, 10, 01, 11), `width`, `height`.
 */
export const FACE_STRIDE = 11;

export interface FaceBatch {
  readonly data: Float32Array;
  readonly count: number;
}

export interface ChunkMeshData {
  /** Opaque and alpha-tested faces. */
  readonly opaque: FaceBatch;
  /** Blended faces (water). */
  readonly translucent: FaceBatch;
  /** Vertical extent of the emitted faces, for culling bounds. */
  readonly minY: number;
  readonly maxY: number;
}

export type ChunkLookup = (cx: number, cz: number) => Chunk | undefined;

/**
 * Converts chunk voxel data into renderable face batches. The renderer only
 * depends on this interface, so meshing strategies are interchangeable.
 */
export interface ChunkMesher {
  mesh(chunk: Chunk, lookup: ChunkLookup): ChunkMeshData;
}
