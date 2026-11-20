import type { WorldConfig } from './config';
import type { GeneratorRequest, GeneratorResponse } from './protocol';
import { TerrainGenerator } from './TerrainGenerator';

export type ChunkReadyHandler = (cx: number, cz: number, blocks: Uint8Array) => void;

interface PoolWorker {
  worker: Worker;
  /** Request currently being generated, or null when idle. */
  job: { cx: number; cz: number } | null;
}

/**
 * Generates chunk data off the main thread using a small pool of Web Workers.
 * The pool has no internal queue: callers ask for the most important chunk
 * whenever `hasCapacity` is true, which keeps requests ordered by current need.
 *
 * If workers are unavailable or fail, generation falls back to the main thread
 * at one chunk per `flush()` call.
 */
export class ChunkGeneratorPool {
  private readonly workers: PoolWorker[] = [];
  private readonly syncQueue: Array<{ cx: number; cz: number }> = [];
  private fallback: TerrainGenerator | null = null;
  private disposed = false;

  constructor(
    private readonly config: WorldConfig,
    private readonly onChunk: ChunkReadyHandler,
    workerCount = defaultWorkerCount(),
  ) {
    for (let i = 0; i < workerCount; i++) {
      const entry = this.spawnWorker();
      if (!entry) break;
      this.workers.push(entry);
    }
    if (this.workers.length === 0) this.fallback = new TerrainGenerator(config);
  }

  get usingWorkers(): boolean {
    return this.workers.length > 0;
  }

  /** Number of requests accepted but not yet delivered. */
  get pending(): number {
    let count = this.syncQueue.length;
    for (const entry of this.workers) if (entry.job) count++;
    return count;
  }

  get hasCapacity(): boolean {
    if (this.disposed) return false;
    if (this.workers.length === 0) return this.syncQueue.length < 1;
    return this.workers.some((entry) => entry.job === null);
  }

  /** Starts generating a chunk. Returns false when no capacity is available. */
  request(cx: number, cz: number): boolean {
    if (this.disposed) return false;
    const idle = this.workers.find((entry) => entry.job === null);
    if (idle) {
      idle.job = { cx, cz };
      idle.worker.postMessage({ type: 'generate', cx, cz } satisfies GeneratorRequest);
      return true;
    }
    if (this.workers.length === 0 && this.syncQueue.length < 1) {
      this.syncQueue.push({ cx, cz });
      return true;
    }
    return false;
  }

  /** Runs main-thread fallback work. Call once per frame. */
  flush(): void {
    if (this.disposed) return;
    const job = this.syncQueue.shift();
    if (!job) return;
    this.fallback ??= new TerrainGenerator(this.config);
    this.onChunk(job.cx, job.cz, this.fallback.generateChunk(job.cx, job.cz));
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.workers) entry.worker.terminate();
    this.workers.length = 0;
    this.syncQueue.length = 0;
    this.fallback = null;
  }

  private spawnWorker(): PoolWorker | null {
    if (typeof Worker === 'undefined') return null;
    try {
      const worker = new Worker(new URL('./generation.worker.ts', import.meta.url), {
        type: 'module',
        name: 'visionmine-terrain',
      });
      const entry: PoolWorker = { worker, job: null };
      worker.onmessage = (event: MessageEvent<GeneratorResponse>) => {
        if (this.disposed) return;
        entry.job = null;
        const { cx, cz, blocks } = event.data;
        this.onChunk(cx, cz, new Uint8Array(blocks));
      };
      worker.onerror = (event) => {
        event.preventDefault();
        this.retireWorker(entry);
      };
      worker.postMessage({ type: 'init', config: this.config } satisfies GeneratorRequest);
      return entry;
    } catch {
      return null;
    }
  }

  /** Removes a failed worker and reroutes its job to the main-thread fallback. */
  private retireWorker(entry: PoolWorker): void {
    if (this.disposed) return;
    const index = this.workers.indexOf(entry);
    if (index === -1) return;
    this.workers.splice(index, 1);
    entry.worker.terminate();
    console.warn('VISIONMINE: a terrain worker failed; continuing with reduced capacity.');
    if (entry.job) this.syncQueue.push(entry.job);
  }
}

function defaultWorkerCount(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 2;
  return Math.max(1, Math.min(4, cores - 2));
}
