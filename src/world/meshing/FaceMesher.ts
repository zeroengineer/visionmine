import { FACE_TILES, IS_LIQUID, IS_OPAQUE } from '../blocks/blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE } from '../constants';
import type { Chunk } from '../chunks/Chunk';
import {
  FACE_STRIDE,
  type ChunkLookup,
  type ChunkMeshData,
  type ChunkMesher,
  type FaceBatch,
} from './types';

const PAD = CHUNK_SIZE + 2;
const PAD_AREA = PAD * PAD;
/** Water surfaces sit slightly below the block top so shorelines read clearly. */
const WATER_SURFACE_DROP = 0.12;
const AO_LEVELS = [0.45, 0.65, 0.82, 1] as const;

/** Per-face basis: normal `n`, and the quad's `u` / `v` axes (see ChunkRenderer). */
const FACE_AXES: ReadonlyArray<{
  n: readonly [number, number, number];
  u: readonly [number, number, number];
  v: readonly [number, number, number];
}> = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

function padOffset(axis: readonly [number, number, number]): number {
  return axis[0] + axis[2] * PAD + axis[1] * PAD_AREA;
}

const N_OFFSET = FACE_AXES.map((f) => padOffset(f.n));
const U_OFFSET = FACE_AXES.map((f) => padOffset(f.u));
const V_OFFSET = FACE_AXES.map((f) => padOffset(f.v));

class GrowableFaceBuffer implements FaceBatch {
  data = new Float32Array(FACE_STRIDE * 2048);
  count = 0;

  reset(): void {
    this.count = 0;
  }

  push(
    x: number,
    y: number,
    z: number,
    face: number,
    tile: number,
    ao0: number,
    ao1: number,
    ao2: number,
    ao3: number,
  ): void {
    let offset = this.count * FACE_STRIDE;
    if (offset + FACE_STRIDE > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    const d = this.data;
    d[offset++] = x;
    d[offset++] = y;
    d[offset++] = z;
    d[offset++] = face;
    d[offset++] = tile;
    d[offset++] = ao0;
    d[offset++] = ao1;
    d[offset++] = ao2;
    d[offset++] = ao3;
    d[offset++] = 1; // quad width in blocks (greedy meshing would emit > 1)
    d[offset] = 1; // quad height in blocks
    this.count++;
  }
}

/**
 * Culled-face mesher: emits one unit quad per block face that borders a
 * non-opaque block, with per-corner ambient occlusion.
 *
 * It is the default `ChunkMesher`. A greedy mesher can replace it by emitting
 * fewer faces with width/height > 1 in the same `FaceBatch` format.
 *
 * The returned batches are views into reusable scratch buffers and are only
 * valid until the next `mesh()` call.
 */
export class FaceMesher implements ChunkMesher {
  /** Chunk blocks plus a one-block border copied from the 8 neighbours. Y is padded too. */
  private readonly padded = new Uint8Array(PAD_AREA * (CHUNK_HEIGHT + 2));
  private readonly opaque = new GrowableFaceBuffer();
  private readonly translucent = new GrowableFaceBuffer();

  mesh(chunk: Chunk, lookup: ChunkLookup): ChunkMeshData {
    const opaque = this.opaque;
    const translucent = this.translucent;
    opaque.reset();
    translucent.reset();

    const top = chunk.highestBlockY();
    if (top < 0) return { opaque, translucent, minY: 0, maxY: 0 };

    this.fillPadded(chunk, lookup, top);
    const pad = this.padded;
    let minY = CHUNK_HEIGHT;
    let maxY = 0;

    for (let y = 0; y <= top; y++) {
      // +1 on every axis: padded coordinates are offset by the border.
      const layer = (y + 1) * PAD_AREA;
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const row = layer + (z + 1) * PAD + 1;
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const center = row + x;
          const id = pad[center]!;
          if (id === 0) continue;
          const liquid = IS_LIQUID[id] === 1;

          for (let face = 0; face < 6; face++) {
            if (face === 3 && y === 0) continue; // underside of the world is never visible
            const front = center + N_OFFSET[face]!;
            const neighbour = pad[front]!;
            if (IS_OPAQUE[neighbour] === 1 || neighbour === id) continue;

            const tile = FACE_TILES[id * 6 + face]!;
            if (liquid) {
              const drop = face === 2 ? WATER_SURFACE_DROP : 0;
              translucent.push(x, y - drop, z, face, tile, 1, 1, 1, 1);
            } else {
              const u = U_OFFSET[face]!;
              const v = V_OFFSET[face]!;
              const uNeg = IS_OPAQUE[pad[front - u]!]!;
              const uPos = IS_OPAQUE[pad[front + u]!]!;
              const vNeg = IS_OPAQUE[pad[front - v]!]!;
              const vPos = IS_OPAQUE[pad[front + v]!]!;
              const ao0 = occlusion(uNeg, vNeg, IS_OPAQUE[pad[front - u - v]!]!);
              const ao1 = occlusion(uPos, vNeg, IS_OPAQUE[pad[front + u - v]!]!);
              const ao2 = occlusion(uNeg, vPos, IS_OPAQUE[pad[front - u + v]!]!);
              const ao3 = occlusion(uPos, vPos, IS_OPAQUE[pad[front + u + v]!]!);
              opaque.push(x, y, z, face, tile, ao0, ao1, ao2, ao3);
            }
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
    }

    if (minY > maxY) minY = maxY = 0;
    return { opaque, translucent, minY, maxY: maxY + 1 };
  }

  private fillPadded(chunk: Chunk, lookup: ChunkLookup, top: number): void {
    const pad = this.padded;
    // Only the layers that can be read need clearing: 0 .. top + 2 (padded index).
    const usedLayers = Math.min(CHUNK_HEIGHT + 2, top + 3);
    pad.fill(0, 0, usedLayers * PAD_AREA);

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const source = dx === 0 && dz === 0 ? chunk : lookup(chunk.cx + dx, chunk.cz + dz);
        if (!source) continue;
        const x0 = dx < 0 ? CHUNK_SIZE - 1 : 0;
        const x1 = dx > 0 ? 0 : CHUNK_SIZE - 1;
        const z0 = dz < 0 ? CHUNK_SIZE - 1 : 0;
        const z1 = dz > 0 ? 0 : CHUNK_SIZE - 1;
        const blocks = source.blocks;
        const maxY = Math.min(CHUNK_HEIGHT - 1, top + 1);
        for (let y = 0; y <= maxY; y++) {
          for (let z = z0; z <= z1; z++) {
            const src = x0 + z * CHUNK_SIZE + y * 256;
            const px = x0 + dx * CHUNK_SIZE + 1;
            const pz = z + dz * CHUNK_SIZE + 1;
            const dst = px + pz * PAD + (y + 1) * PAD_AREA;
            if (x0 === x1) pad[dst] = blocks[src]!;
            else pad.set(blocks.subarray(src, src + CHUNK_SIZE), dst);
          }
        }
      }
    }
  }
}

function occlusion(side1: number, side2: number, corner: number): number {
  if (side1 === 1 && side2 === 1) return AO_LEVELS[0];
  return AO_LEVELS[3 - (side1 + side2 + corner)]!;
}
