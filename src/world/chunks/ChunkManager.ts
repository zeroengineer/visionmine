import type { ChunkGeneratorPool } from '../generation/ChunkGeneratorPool';
import type { World } from '../World';
import { Chunk } from './Chunk';
import { chunkKey, toChunkCoord } from './coords';

/** Chunks are generated this far beyond the render distance so border meshes are exact. */
export const LOAD_MARGIN = 2;
/** Extra distance before a chunk is unloaded, to avoid thrashing at the boundary. */
export const UNLOAD_MARGIN = 4;

interface Offset {
  dx: number;
  dz: number;
}

/** Offsets within `radius` chunks (Euclidean), nearest first. */
export function ringOffsets(radius: number): Offset[] {
  const offsets: Array<Offset & { d: number }> = [];
  const r = Math.ceil(radius);
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const d = dx * dx + dz * dz;
      if (d <= radius * radius) offsets.push({ dx, dz, d });
    }
  }
  offsets.sort((a, b) => a.d - b.d);
  return offsets;
}

/**
 * Streams chunks around a moving centre: requests missing chunks nearest-first
 * and unloads those that fall far behind. It only manages world data; meshes
 * follow via `World` events.
 */
export class ChunkManager {
  private renderDistance: number;
  private offsets: Offset[] = [];
  private scanIndex = 0;
  private centerX = Number.NaN;
  private centerZ = Number.NaN;
  private readonly requested = new Set<number>();

  constructor(
    private readonly world: World,
    private readonly pool: ChunkGeneratorPool,
    renderDistance: number,
  ) {
    this.renderDistance = renderDistance;
    this.rebuildOffsets();
  }

  get centerChunkX(): number {
    return this.centerX;
  }

  get centerChunkZ(): number {
    return this.centerZ;
  }

  get distance(): number {
    return this.renderDistance;
  }

  /** True while chunks inside the load radius are still missing. */
  get isLoading(): boolean {
    return this.scanIndex < this.offsets.length || this.requested.size > 0;
  }

  setRenderDistance(distance: number): void {
    if (distance === this.renderDistance) return;
    this.renderDistance = distance;
    this.rebuildOffsets();
    if (!Number.isNaN(this.centerX)) this.unloadDistant();
  }

  /** Call every frame with the position chunks should be centred on. */
  update(x: number, z: number): void {
    const cx = toChunkCoord(x);
    const cz = toChunkCoord(z);
    if (cx !== this.centerX || cz !== this.centerZ) {
      this.centerX = cx;
      this.centerZ = cz;
      this.scanIndex = 0;
      this.unloadDistant();
    }

    this.pool.flush();
    while (this.scanIndex < this.offsets.length) {
      const offset = this.offsets[this.scanIndex]!;
      const tx = cx + offset.dx;
      const tz = cz + offset.dz;
      const key = chunkKey(tx, tz);
      if (!this.world.getChunkByKey(key) && !this.requested.has(key)) {
        if (!this.pool.hasCapacity || !this.pool.request(tx, tz)) break;
        this.requested.add(key);
      }
      this.scanIndex++;
    }
  }

  /** Receives generated data from the pool. */
  acceptChunk(cx: number, cz: number, blocks: Uint8Array): void {
    const key = chunkKey(cx, cz);
    if (!this.requested.delete(key)) return;
    if (this.world.getChunkByKey(key)) return;
    if (this.isBeyond(cx, cz, this.renderDistance + UNLOAD_MARGIN)) {
      // The player moved away while this chunk was generating; a later scan re-requests it if needed.
      return;
    }
    this.world.addChunk(new Chunk(cx, cz, blocks));
  }

  /** Forgets in-flight requests and forces a full rescan (after a world reset). */
  reset(): void {
    this.requested.clear();
    this.scanIndex = 0;
    this.centerX = Number.NaN;
    this.centerZ = Number.NaN;
  }

  private rebuildOffsets(): void {
    this.offsets = ringOffsets(this.renderDistance + LOAD_MARGIN);
    this.scanIndex = 0;
  }

  private isBeyond(cx: number, cz: number, radius: number): boolean {
    const dx = cx - this.centerX;
    const dz = cz - this.centerZ;
    return dx * dx + dz * dz > radius * radius;
  }

  private unloadDistant(): void {
    const limit = this.renderDistance + UNLOAD_MARGIN;
    const stale: number[] = [];
    for (const chunk of this.world.loadedChunks()) {
      if (this.isBeyond(chunk.cx, chunk.cz, limit)) stale.push(chunk.key);
    }
    for (const key of stale) this.world.removeChunk(key);
  }
}
