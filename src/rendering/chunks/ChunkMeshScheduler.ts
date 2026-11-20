import type { Chunk } from '@/world/chunks/Chunk';
import type { ChunkMesher } from '@/world/meshing/types';
import type { World } from '@/world/World';
import type { ChunkRenderer } from './ChunkRenderer';

/** Soft limit for background meshing per frame, in milliseconds. */
const DEFAULT_BUDGET_MS = 4;

/**
 * Turns dirty chunks into meshes. Player edits are remeshed in the same frame;
 * newly streamed chunks are meshed nearest-first within a per-frame time budget
 * and only once all eight neighbours exist, so border faces are always correct.
 */
export class ChunkMeshScheduler {
  /** Dirty chunk key → urgent flag. */
  private readonly dirty = new Map<number, boolean>();
  private readonly candidates: Array<{ chunk: Chunk; distance: number }> = [];
  private readonly unsubscribers: Array<() => void>;
  private readonly lookup = (cx: number, cz: number): Chunk | undefined =>
    this.world.getChunk(cx, cz);

  constructor(
    private readonly world: World,
    private readonly renderer: ChunkRenderer,
    private readonly mesher: ChunkMesher,
  ) {
    this.unsubscribers = [
      world.events.on('chunkDirty', ({ key, urgent }) => {
        this.dirty.set(key, urgent || this.dirty.get(key) === true);
      }),
      world.events.on('chunkRemoved', ({ key }) => {
        this.dirty.delete(key);
        this.renderer.remove(key);
      }),
    ];
  }

  get pendingCount(): number {
    return this.dirty.size;
  }

  /** Number of meshed chunks within `radius` chunks of the given centre, and how many are required. */
  progress(centerCx: number, centerCz: number, radius: number): { ready: number; total: number } {
    let ready = 0;
    let total = 0;
    const r = Math.ceil(radius);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        total++;
        const chunk = this.world.getChunk(centerCx + dx, centerCz + dz);
        if (chunk && !this.dirty.has(chunk.key)) ready++;
      }
    }
    return { ready, total };
  }

  /**
   * @param centerCx chunk the viewer is in
   * @param meshRadius chunks farther than this are left unmeshed
   */
  update(
    centerCx: number,
    centerCz: number,
    meshRadius: number,
    budgetMs = DEFAULT_BUDGET_MS,
  ): void {
    if (this.dirty.size === 0) return;
    const candidates = this.candidates;
    candidates.length = 0;
    const maxDistance = meshRadius * meshRadius;

    for (const [key, urgent] of this.dirty) {
      const chunk = this.world.getChunkByKey(key);
      if (!chunk) {
        this.dirty.delete(key);
        continue;
      }
      if (urgent) {
        this.build(chunk);
        continue;
      }
      const dx = chunk.cx - centerCx;
      const dz = chunk.cz - centerCz;
      const distance = dx * dx + dz * dz;
      if (distance > maxDistance || !this.hasAllNeighbours(chunk)) continue;
      candidates.push({ chunk, distance });
    }

    if (candidates.length === 0) return;
    candidates.sort((a, b) => a.distance - b.distance);
    const start = performance.now();
    for (let i = 0; i < candidates.length; i++) {
      this.build(candidates[i]!.chunk);
      if (performance.now() - start >= budgetMs) break;
    }
    candidates.length = 0;
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.dirty.clear();
  }

  private build(chunk: Chunk): void {
    this.dirty.delete(chunk.key);
    this.renderer.update(chunk.key, chunk.cx, chunk.cz, this.mesher.mesh(chunk, this.lookup));
  }

  private hasAllNeighbours(chunk: Chunk): boolean {
    const { cx, cz } = chunk;
    const world = this.world;
    return (
      world.hasChunk(cx - 1, cz) &&
      world.hasChunk(cx + 1, cz) &&
      world.hasChunk(cx, cz - 1) &&
      world.hasChunk(cx, cz + 1) &&
      world.hasChunk(cx - 1, cz - 1) &&
      world.hasChunk(cx + 1, cz - 1) &&
      world.hasChunk(cx - 1, cz + 1) &&
      world.hasChunk(cx + 1, cz + 1)
    );
  }
}
