import { blockBoxes, FACE_TILES, IS_CUBE, IS_LIQUID, IS_OPAQUE } from '../blocks/blocks';
import type { Box } from '../blocks/shapes';
import { CHUNK_HEIGHT, CHUNK_SIZE } from '../constants';
import type { Chunk } from '../chunks/Chunk';
import {
  FACE_BASIS,
  FACE_ORIGIN,
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

const FACE_AXES = FACE_BASIS;
/** Brightness of shaped blocks, which get no per-corner ambient occlusion. */
const SHAPE_SHADE = 0.92;

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
    width = 1,
    height = 1,
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
    d[offset++] = width; // quad size in blocks: below 1 for shaped blocks,
    d[offset] = height; // above 1 if a greedy mesher ever merges faces
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
          if (IS_CUBE[id] !== 1) {
            const meta = chunk.getMeta(x + z * CHUNK_SIZE + y * 256);
            this.emitShape(blockBoxes(id, meta), id, x, y, z, center);
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            continue;
          }
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

  /**
   * Emits the faces of a shaped block's boxes. A face lying on the cell
   * boundary is skipped when the neighbouring block hides it.
   */
  private emitShape(
    boxes: readonly Box[],
    id: number,
    x: number,
    y: number,
    z: number,
    center: number,
  ): void {
    const pad = this.padded;
    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b]!;
      for (let face = 0; face < 6; face++) {
        const { u, v, n } = FACE_AXES[face]!;
        const nAxis = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
        const positive = n[nAxis]! > 0;
        const plane = positive ? box[nAxis + 3]! : box[nAxis]!;
        if (plane === (positive ? 1 : 0) && IS_OPAQUE[pad[center + N_OFFSET[face]!]!] === 1) {
          continue;
        }
        const uAxis = u[0] !== 0 ? 0 : u[1] !== 0 ? 1 : 2;
        const vAxis = v[0] !== 0 ? 0 : v[1] !== 0 ? 1 : 2;
        // Corner of the face where the quad's texture origin goes.
        const corner = [0, 0, 0];
        corner[nAxis] = plane;
        corner[uAxis] = u[uAxis]! > 0 ? box[uAxis]! : box[uAxis + 3]!;
        corner[vAxis] = v[vAxis]! > 0 ? box[vAxis]! : box[vAxis + 3]!;
        const origin = FACE_ORIGIN[face]!;
        this.opaque.push(
          x + corner[0]! - origin[0],
          y + corner[1]! - origin[1],
          z + corner[2]! - origin[2],
          face,
          FACE_TILES[id * 6 + face]!,
          SHAPE_SHADE,
          SHAPE_SHADE,
          SHAPE_SHADE,
          SHAPE_SHADE,
          box[uAxis + 3]! - box[uAxis]!,
          box[vAxis + 3]! - box[vAxis]!,
        );
      }
    }
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
