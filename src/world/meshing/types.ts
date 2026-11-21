import type { Chunk } from '../chunks/Chunk';

/**
 * Floats per face in a `FaceBatch`:
 * `x, y, z` (min corner of the block, chunk-local), `face` (index into `FACE_BASIS`), `tile`,
 * `ao0..ao3` (corner brightness in quad UV order 00, 10, 01, 11), `width`, `height`,
 * `light` (0..1, from torches and other emitting blocks).
 */
export const FACE_STRIDE = 12;

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

const DIAGONAL = Math.SQRT1_2;

/**
 * Orientation of each face's quad: `u` and `v` are the directions of the quad's
 * texture axes and `n` its outward normal. Faces 0–5 follow `Face` order.
 */
export const FACE_BASIS: ReadonlyArray<{
  readonly u: readonly [number, number, number];
  readonly v: readonly [number, number, number];
  readonly n: readonly [number, number, number];
}> = [
  { u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0] },
  { u: [0, 0, 1], v: [0, 1, 0], n: [-1, 0, 0] },
  { u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] },
  { u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] },
  { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  { u: [-1, 0, 0], v: [0, 1, 0], n: [0, 0, -1] },
  // 6–9: the two diagonals of a cell, each seen from both sides (plants).
  { u: [1, 0, 1], v: [0, 1, 0], n: [-DIAGONAL, 0, DIAGONAL] },
  { u: [-1, 0, -1], v: [0, 1, 0], n: [DIAGONAL, 0, -DIAGONAL] },
  { u: [1, 0, -1], v: [0, 1, 0], n: [DIAGONAL, 0, DIAGONAL] },
  { u: [-1, 0, 1], v: [0, 1, 0], n: [-DIAGONAL, 0, -DIAGONAL] },
];

/** Corner of the cell each diagonal quad starts from, for faces 6–9. */
export const DIAGONAL_START: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [1, 0, 1],
  [0, 0, 1],
  [1, 0, 0],
];

/**
 * Where the quad's texture origin sits relative to the `x, y, z` stored for a
 * face, for a quad covering a whole block face.
 */
export const FACE_ORIGIN: ReadonlyArray<readonly [number, number, number]> = FACE_BASIS.map(
  ({ u, v, n }, face) =>
    // Diagonal quads are positioned directly by their starting corner.
    face >= 6
      ? [0, 0, 0]
      : [
          0.5 + n[0] * 0.5 - u[0] * 0.5 - v[0] * 0.5,
          0.5 + n[1] * 0.5 - u[1] * 0.5 - v[1] * 0.5,
          0.5 + n[2] * 0.5 - u[2] * 0.5 - v[2] * 0.5,
        ],
);
