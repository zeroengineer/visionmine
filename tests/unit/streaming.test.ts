import { describe, expect, it } from 'vitest';
import { ChunkMeshScheduler } from '@/rendering/chunks/ChunkMeshScheduler';
import type { ChunkRenderer } from '@/rendering/chunks/ChunkRenderer';
import { DayNightCycle, createSkyState } from '@/rendering/environment/DayNightCycle';
import { BlockId } from '@/world/blocks/blocks';
import { ChunkManager, LOAD_MARGIN, UNLOAD_MARGIN } from '@/world/chunks/ChunkManager';
import { chunkKey } from '@/world/chunks/coords';
import { ChunkGeneratorPool } from '@/world/generation/ChunkGeneratorPool';
import { FaceMesher } from '@/world/meshing/FaceMesher';
import { World } from '@/world/World';

const CONFIG = { seed: 'stream', terrain: 'standard', treeDensity: 1 } as const;

function streamingSetup(renderDistance = 2) {
  const world = new World();
  // In Node there is no Worker, so the pool uses its main-thread fallback.
  const pool: ChunkGeneratorPool = new ChunkGeneratorPool(CONFIG, (cx, cz, blocks) =>
    manager.acceptChunk(cx, cz, blocks),
  );
  const manager: ChunkManager = new ChunkManager(world, pool, renderDistance);
  const settle = (x: number, z: number, frames = 400): void => {
    for (let i = 0; i < frames && (i < 2 || manager.isLoading); i++) manager.update(x, z);
  };
  return { world, pool, manager, settle };
}

describe('ChunkManager', () => {
  it('falls back to main-thread generation without Web Workers', () => {
    const { pool } = streamingSetup();
    expect(pool.usingWorkers).toBe(false);
  });

  it('loads every chunk within the load radius, nearest first', () => {
    const { world, manager } = streamingSetup(2);
    const order: number[] = [];
    world.events.on('chunkAdded', ({ chunk }) => order.push(chunk.cx ** 2 + chunk.cz ** 2));
    for (let i = 0; i < 400 && (i < 2 || manager.isLoading); i++) manager.update(8, 8);

    const radius = 2 + LOAD_MARGIN;
    let expected = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        expected++;
        expect(world.hasChunk(dx, dz), `chunk ${dx},${dz}`).toBe(true);
      }
    }
    expect(world.chunkCount).toBe(expected);
    expect(order[0]).toBe(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(manager.isLoading).toBe(false);
  });

  it('unloads chunks that fall behind and loads new ones as the centre moves', () => {
    const { world, settle } = streamingSetup(2);
    settle(8, 8);
    expect(world.hasChunk(-4, 0)).toBe(true);

    settle(8 + 16 * 20, 8);
    expect(world.hasChunk(-4, 0)).toBe(false);
    expect(world.hasChunk(0, 0)).toBe(false);
    expect(world.hasChunk(20, 0)).toBe(true);
    const limit = 2 + UNLOAD_MARGIN;
    for (const chunk of world.loadedChunks()) {
      expect((chunk.cx - 20) ** 2 + chunk.cz ** 2).toBeLessThanOrEqual(limit * limit);
    }
  });

  it('keeps the loaded chunk count bounded during a long journey', () => {
    const { world, manager } = streamingSetup(2);
    let peak = 0;
    for (let step = 0; step < 600; step++) {
      manager.update(step * 4, step * 3);
      peak = Math.max(peak, world.chunkCount);
    }
    const limit = 2 + UNLOAD_MARGIN;
    expect(peak).toBeLessThanOrEqual(Math.ceil(Math.PI * (limit + 1) ** 2));
  });

  it('shrinks and grows with the render distance', () => {
    const { world, manager, settle } = streamingSetup(6);
    settle(8, 8);
    const big = world.chunkCount;
    // Loaded out to 6 + LOAD_MARGIN; dropping to 2 unloads beyond 2 + UNLOAD_MARGIN.
    manager.setRenderDistance(2);
    expect(world.chunkCount).toBeLessThan(big);
    const limit = 2 + UNLOAD_MARGIN;
    for (const chunk of world.loadedChunks()) {
      expect(chunk.cx ** 2 + chunk.cz ** 2).toBeLessThanOrEqual(limit * limit);
    }
    manager.setRenderDistance(6);
    settle(8, 8);
    expect(world.chunkCount).toBe(big);
  });

  it('re-applies player edits when a chunk streams back in', () => {
    const { world, settle } = streamingSetup(2);
    settle(8, 8);
    const y = 120;
    expect(world.setBlock(3, y, 3, BlockId.Brick)).toBe(true);
    settle(8 + 16 * 30, 8);
    expect(world.hasChunk(0, 0)).toBe(false);
    settle(8, 8);
    expect(world.getBlock(3, y, 3)).toBe(BlockId.Brick);
  });
});

describe('ChunkMeshScheduler', () => {
  function schedulerSetup() {
    const setup = streamingSetup(2);
    const updated = new Map<number, number>();
    const removed: number[] = [];
    const renderer = {
      update: (key: number) => updated.set(key, (updated.get(key) ?? 0) + 1),
      remove: (key: number) => removed.push(key),
    } as unknown as ChunkRenderer;
    const scheduler = new ChunkMeshScheduler(setup.world, renderer, new FaceMesher());
    return { ...setup, scheduler, updated, removed };
  }

  it('meshes only chunks whose eight neighbours are loaded', () => {
    const { settle, scheduler, updated, world, manager } = schedulerSetup();
    settle(8, 8);
    for (let i = 0; i < 200; i++) scheduler.update(0, 0, manager.distance + 0.5, 1000);
    expect(updated.size).toBeGreaterThan(0);
    for (const key of updated.keys()) {
      const chunk = world.getChunkByKey(key)!;
      expect(chunk.cx ** 2 + chunk.cz ** 2).toBeLessThanOrEqual(2.5 ** 2);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          expect(world.hasChunk(chunk.cx + dx, chunk.cz + dz)).toBe(true);
        }
      }
    }
    const { ready, total } = scheduler.progress(0, 0, 2);
    expect(ready).toBe(total);
  });

  it('remeshes an edited chunk immediately and border neighbours with it', () => {
    const { settle, scheduler, updated, world, manager } = schedulerSetup();
    settle(8, 8);
    for (let i = 0; i < 200; i++) scheduler.update(0, 0, manager.distance + 0.5, 1000);
    updated.clear();

    world.setBlock(8, 120, 8, BlockId.Stone);
    scheduler.update(0, 0, manager.distance + 0.5, 0);
    expect([...updated.keys()]).toEqual([chunkKey(0, 0)]);

    updated.clear();
    world.setBlock(15, 120, 8, BlockId.Stone);
    scheduler.update(0, 0, manager.distance + 0.5, 0);
    expect(new Set(updated.keys())).toEqual(new Set([chunkKey(0, 0), chunkKey(1, 0)]));
  });

  it('removes meshes when chunks unload', () => {
    const { settle, scheduler, removed, world, manager } = schedulerSetup();
    settle(8, 8);
    for (let i = 0; i < 200; i++) scheduler.update(0, 0, manager.distance + 0.5, 1000);
    settle(8 + 16 * 30, 8);
    expect(removed).toContain(chunkKey(0, 0));
    expect(world.hasChunk(0, 0)).toBe(false);
    scheduler.dispose();
  });
});

describe('DayNightCycle', () => {
  it('advances and wraps the world clock', () => {
    const cycle = new DayNightCycle();
    cycle.dayLengthSeconds = 100;
    cycle.setTime(0.95);
    cycle.update(10);
    expect(cycle.time).toBeCloseTo(0.05, 5);
    cycle.paused = true;
    cycle.update(50);
    expect(cycle.time).toBeCloseTo(0.05, 5);
    cycle.setTime(Number.NaN);
    expect(cycle.time).toBeCloseTo(0.32, 5);
  });

  it('is bright at noon, dark at midnight, and keeps the light above the horizon', () => {
    const cycle = new DayNightCycle();
    const state = createSkyState();
    cycle.setTime(0.5);
    cycle.sample(state);
    expect(state.daylight).toBe(1);
    expect(state.sunDirection.y).toBeGreaterThan(0.9);
    expect(state.starOpacity).toBe(0);
    const noonLight = state.lightIntensity;
    expect(cycle.formatTime()).toBe('12:00');

    cycle.setTime(0);
    cycle.sample(state);
    expect(state.daylight).toBe(0);
    expect(state.starOpacity).toBe(1);
    expect(state.lightIntensity).toBeLessThan(noonLight / 3);
    expect(state.lightIntensity).toBeGreaterThan(0);

    for (let t = 0; t < 1; t += 0.01) {
      cycle.setTime(t);
      cycle.sample(state);
      expect(state.lightDirection.y).toBeGreaterThan(0.1);
      expect(state.lightDirection.length()).toBeCloseTo(1, 5);
    }
  });
});
