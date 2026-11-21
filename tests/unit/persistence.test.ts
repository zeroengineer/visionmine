import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorldService } from '@/game/WorldService';
import { BlockId } from '@/world/blocks/blocks';
import { chunkKey } from '@/world/chunks/coords';
import { cellBlock, cellMeta, packCell } from '@/world/World';
import {
  decodeEdits,
  EDIT_FORMAT,
  encodeEdits,
  normalizeWorldName,
  parsePlayerRecord,
  parseWorldRecord,
} from '@/world/persistence/codec';
import { IndexedDbRepository } from '@/world/persistence/IndexedDbRepository';
import { MemoryRepository } from '@/world/persistence/MemoryRepository';
import { openRepository } from '@/world/persistence/openRepository';
import { SAVE_VERSION, type PlayerRecord, type WorldRepository } from '@/world/persistence/types';

let dbCounter = 0;
const freshDbName = (): string => `visionmine-test-${++dbCounter}`;

const player = (worldId: string): PlayerRecord => ({
  worldId,
  x: 12.5,
  y: 64,
  z: -7.25,
  yaw: 1.2,
  pitch: -0.4,
  flying: true,
  inventory: { selected: 2, slots: [{ block: BlockId.Stone, count: 9 }] },
});

describe('save codecs', () => {
  it('round-trips chunk edits', () => {
    const edits = new Map([
      [0, BlockId.Stone],
      [32767, BlockId.Air],
      [1234, BlockId.Tnt],
    ]);
    expect(decodeEdits(encodeEdits(edits))).toEqual(edits);
  });

  it('round-trips block state alongside the block id', () => {
    const edits = new Map([
      [0, packCell(BlockId.Planks, 3)],
      [32767, packCell(BlockId.Glass, 255)],
      [77, packCell(BlockId.Stone, 0)],
    ]);
    const decoded = decodeEdits(encodeEdits(edits));
    expect(decoded).toEqual(edits);
    expect(cellBlock(decoded.get(32767)!)).toBe(BlockId.Glass);
    expect(cellMeta(decoded.get(32767)!)).toBe(255);
    // Without state, a cell is simply the block id.
    expect(decoded.get(77)).toBe(BlockId.Stone);
  });

  it('drops invalid edit entries instead of failing', () => {
    const data = [(5 << 16) | BlockId.Dirt, (40000 << 16) | 1, (6 << 16) | 200, -4, 1.5, 'x'];
    expect(decodeEdits(data)).toEqual(new Map([[5, BlockId.Dirt]]));
    expect(decodeEdits('garbage')).toEqual(new Map());
    expect(decodeEdits(undefined)).toEqual(new Map());
  });

  it('reads edits written in the first save format', () => {
    // Format 1 packed `index << 8 | id` and had no state byte.
    const legacy = new Uint32Array([(5 << 8) | BlockId.Dirt, (32767 << 8) | BlockId.Brick]);
    expect(decodeEdits(legacy, 1)).toEqual(
      new Map([
        [5, BlockId.Dirt],
        [32767, BlockId.Brick],
      ]),
    );
    expect(decodeEdits([(40000 << 8) | 1, (6 << 8) | 200], 1)).toEqual(new Map());
    expect(EDIT_FORMAT).toBe(2);
    expect(SAVE_VERSION).toBe(2);
  });

  it('rejects unusable world records and repairs partial ones', () => {
    expect(parseWorldRecord(null)).toBeNull();
    expect(parseWorldRecord({ id: 'a' })).toBeNull();
    expect(parseWorldRecord({ id: 'a', config: { seed: '' } })).toBeNull();
    expect(parseWorldRecord({ id: 'a', config: { seed: 's' }, version: 999 })).toBeNull();
    const repaired = parseWorldRecord({
      id: 'a',
      name: 7,
      config: { seed: 's', terrain: '?' },
      timeOfDay: 9,
    });
    expect(repaired).toMatchObject({
      id: 'a',
      name: 'Untitled World',
      mode: 'creative',
      timeOfDay: 1,
      config: { seed: 's', terrain: 'standard', treeDensity: 1 },
    });
  });

  it('rejects player records with unusable positions', () => {
    expect(parsePlayerRecord({ x: 1, y: Number.NaN, z: 3 }, 'w')).toBeNull();
    expect(parsePlayerRecord({ x: 1e9, y: 10, z: 3 }, 'w')).toBeNull();
    expect(parsePlayerRecord('nope', 'w')).toBeNull();
    expect(parsePlayerRecord({ x: 1, y: 2, z: 3, pitch: 99 }, 'w')).toMatchObject({
      worldId: 'w',
      pitch: 1.56,
      yaw: 0,
      flying: false,
    });
  });

  it('normalises world names', () => {
    expect(normalizeWorldName('  My   World ')).toBe('My World');
    expect(normalizeWorldName('')).toBe('Untitled World');
    expect(normalizeWorldName('x'.repeat(100))).toHaveLength(32);
  });
});

function repositoryContract(name: string, create: () => Promise<WorldRepository>): void {
  describe(name, () => {
    let repo: WorldRepository;
    let service: WorldService;
    beforeEach(async () => {
      repo = await create();
      service = new WorldService(repo);
    });

    const makeWorld = (label = 'Alpha') =>
      service.create({
        name: label,
        seed: 'seed-1',
        terrain: 'islands',
        treeDensity: 0.5,
        mode: 'survival',
      });

    it('creates, lists and reads worlds', async () => {
      expect(await service.list()).toEqual([]);
      const record = await makeWorld();
      expect(record).toMatchObject({
        name: 'Alpha',
        mode: 'survival',
        config: { seed: 'seed-1', terrain: 'islands', treeDensity: 0.5 },
      });
      const list = await service.list();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: record.id, corrupt: false });
      expect(await repo.getWorld(record.id)).toEqual(record);
      expect(await repo.getWorld('missing')).toBeNull();
    });

    it('lists the most recently played world first', async () => {
      const a = await makeWorld('A');
      const b = await makeWorld('B');
      await repo.putWorld({ ...a, lastPlayedAt: 2000 });
      await repo.putWorld({ ...b, lastPlayedAt: 1000 });
      expect((await service.list()).map((w) => w.id)).toEqual([a.id, b.id]);
    });

    it('renames worlds', async () => {
      const record = await makeWorld();
      const renamed = await service.rename(record.id, '  Castle   Town ');
      expect(renamed?.name).toBe('Castle Town');
      expect((await repo.getWorld(record.id))?.name).toBe('Castle Town');
      expect(await service.rename('missing', 'x')).toBeNull();
    });

    it('saves and loads block edits per chunk, overwriting on re-save', async () => {
      const { id } = await makeWorld();
      const k1 = chunkKey(0, 0);
      const k2 = chunkKey(-3, 7);
      await repo.saveEdits(id, [
        { chunkKey: k1, edits: new Map([[10, BlockId.Stone]]) },
        {
          chunkKey: k2,
          edits: new Map([
            [99, BlockId.Glass],
            [100, BlockId.Air],
          ]),
        },
      ]);
      await repo.saveEdits(id, [
        {
          chunkKey: k1,
          edits: new Map([
            [10, BlockId.Stone],
            [11, BlockId.Brick],
          ]),
        },
      ]);
      const loaded = await repo.loadEdits(id);
      expect(loaded.size).toBe(2);
      expect(loaded.get(k1)).toEqual(
        new Map([
          [10, BlockId.Stone],
          [11, BlockId.Brick],
        ]),
      );
      expect(loaded.get(k2)).toEqual(
        new Map([
          [99, BlockId.Glass],
          [100, BlockId.Air],
        ]),
      );
      expect(await repo.loadEdits('other-world')).toEqual(new Map());
    });

    it('saves and loads the player with inventory', async () => {
      const { id } = await makeWorld();
      expect(await repo.loadPlayer(id)).toBeNull();
      await repo.savePlayer(player(id));
      expect(await repo.loadPlayer(id)).toEqual(player(id));
    });

    it('keeps worlds isolated and deletes a world with all of its data', async () => {
      const a = await makeWorld('A');
      const b = await makeWorld('B');
      const key = chunkKey(1, 1);
      await repo.saveEdits(a.id, [{ chunkKey: key, edits: new Map([[1, BlockId.Dirt]]) }]);
      await repo.saveEdits(b.id, [{ chunkKey: key, edits: new Map([[2, BlockId.Sand]]) }]);
      await repo.savePlayer(player(a.id));
      await repo.savePlayer(player(b.id));

      await service.delete(a.id);
      expect((await service.list()).map((w) => w.id)).toEqual([b.id]);
      expect(await repo.loadEdits(a.id)).toEqual(new Map());
      expect(await repo.loadPlayer(a.id)).toBeNull();
      expect((await repo.loadEdits(b.id)).get(key)).toEqual(new Map([[2, BlockId.Sand]]));
      expect(await repo.loadPlayer(b.id)).not.toBeNull();
    });

    it('resets a world: edits and player are cleared, seed is kept', async () => {
      const { id } = await makeWorld();
      await repo.saveEdits(id, [{ chunkKey: 5, edits: new Map([[1, BlockId.Dirt]]) }]);
      await repo.savePlayer(player(id));
      const reset = await service.reset(id);
      expect(reset?.config.seed).toBe('seed-1');
      expect(await repo.loadEdits(id)).toEqual(new Map());
      expect(await repo.loadPlayer(id)).toBeNull();
    });

    it('regenerates a world with a new seed', async () => {
      const { id } = await makeWorld();
      await repo.saveEdits(id, [{ chunkKey: 5, edits: new Map([[1, BlockId.Dirt]]) }]);
      const regenerated = await service.regenerate(id, 'fresh-seed');
      expect(regenerated?.config).toMatchObject({ seed: 'fresh-seed', terrain: 'islands' });
      expect(await repo.loadEdits(id)).toEqual(new Map());
      expect((await repo.getWorld(id))?.config.seed).toBe('fresh-seed');
    });
  });
}

repositoryContract('MemoryRepository', async () => new MemoryRepository());
repositoryContract('IndexedDbRepository', () => IndexedDbRepository.open(indexedDB, freshDbName()));

describe('IndexedDbRepository resilience', () => {
  function rawPut(dbName: string, store: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }

  it('persists across connections', async () => {
    const name = freshDbName();
    const first = await IndexedDbRepository.open(indexedDB, name);
    const record = await new WorldService(first).create({
      name: 'Persistent',
      seed: 's',
      terrain: 'standard',
      treeDensity: 1,
      mode: 'creative',
    });
    await first.saveEdits(record.id, [{ chunkKey: 3, edits: new Map([[7, BlockId.Planks]]) }]);
    first.close();

    const second = await IndexedDbRepository.open(indexedDB, name);
    expect(second.persistent).toBe(true);
    expect((await second.listWorlds())[0]).toMatchObject({ id: record.id, corrupt: false });
    expect((await second.loadEdits(record.id)).get(3)).toEqual(new Map([[7, BlockId.Planks]]));
    second.close();
  });

  it('lists corrupted worlds without throwing and lets them be deleted', async () => {
    const name = freshDbName();
    const repo = await IndexedDbRepository.open(indexedDB, name);
    const good = await new WorldService(repo).create({
      name: 'Good',
      seed: 's',
      terrain: 'standard',
      treeDensity: 1,
      mode: 'creative',
    });
    await rawPut(name, 'worlds', { id: 'broken', name: 'Broken One', config: 'not-an-object' });

    const list = await repo.listWorlds();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: good.id, corrupt: false });
    expect(list[1]).toEqual({ id: 'broken', corrupt: true, name: 'Broken One' });
    expect(await repo.getWorld('broken')).toBeNull();

    await repo.deleteWorld('broken');
    expect(await repo.listWorlds()).toHaveLength(1);
    repo.close();
  });

  it('stores block state and still reads rows saved before it existed', async () => {
    const name = freshDbName();
    const repo = await IndexedDbRepository.open(indexedDB, name);
    await repo.saveEdits('w', [
      { chunkKey: 1, edits: new Map([[4, packCell(BlockId.Planks, 2)]]) },
    ]);
    // A row exactly as the first release wrote it: no `format`, 8-bit layout.
    await rawPut(name, 'chunks', {
      key: 'w:2',
      worldId: 'w',
      chunkKey: 2,
      data: new Uint32Array([(9 << 8) | BlockId.Brick, (300 << 8) | BlockId.Glass]),
    });

    const edits = await repo.loadEdits('w');
    expect(edits.get(1)).toEqual(new Map([[4, packCell(BlockId.Planks, 2)]]));
    expect(edits.get(2)).toEqual(
      new Map([
        [9, BlockId.Brick],
        [300, BlockId.Glass],
      ]),
    );

    // Saving that chunk again rewrites it in the current format.
    await repo.saveEdits('w', [{ chunkKey: 2, edits: edits.get(2)! }]);
    expect((await repo.loadEdits('w')).get(2)).toEqual(edits.get(2));
    repo.close();
  });

  it('opens a world record from the previous save version', async () => {
    const name = freshDbName();
    const repo = await IndexedDbRepository.open(indexedDB, name);
    await rawPut(name, 'worlds', {
      id: 'old',
      name: 'Old World',
      config: { seed: 'abc', terrain: 'standard', treeDensity: 1 },
      mode: 'creative',
      createdAt: 1,
      lastPlayedAt: 2,
      timeOfDay: 0.4,
      version: 1,
    });
    await rawPut(name, 'worlds', { id: 'future', config: { seed: 'x' }, version: 99 });

    const old = await repo.getWorld('old');
    expect(old?.name).toBe('Old World');
    expect(old?.version).toBe(SAVE_VERSION);
    // A save from a newer release than this one is not guessed at.
    expect(await repo.getWorld('future')).toBeNull();
    repo.close();
  });

  it('ignores corrupted edit and player rows', async () => {
    const name = freshDbName();
    const repo = await IndexedDbRepository.open(indexedDB, name);
    await repo.saveEdits('w', [{ chunkKey: 1, edits: new Map([[4, BlockId.Stone]]) }]);
    await rawPut(name, 'chunks', { key: 'w:2', worldId: 'w', chunkKey: 2, data: 'corrupt' });
    await rawPut(name, 'chunks', { key: 'w:3', worldId: 'w', chunkKey: 'three', data: [1] });
    await rawPut(name, 'players', { worldId: 'w', x: 'left', y: 1, z: 2 });

    const edits = await repo.loadEdits('w');
    expect([...edits.keys()]).toEqual([1]);
    expect(await repo.loadPlayer('w')).toBeNull();
    repo.close();
  });

  it('falls back to memory storage when IndexedDB cannot be opened', async () => {
    const failing = {
      open() {
        throw new Error('SecurityError');
      },
    } as unknown as IDBFactory;
    await expect(IndexedDbRepository.open(failing, 'x')).rejects.toThrow('SecurityError');

    const original = globalThis.indexedDB;
    Object.defineProperty(globalThis, 'indexedDB', { value: failing, configurable: true });
    try {
      const repo = await openRepository();
      expect(repo.persistent).toBe(false);
      expect(await repo.listWorlds()).toEqual([]);
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', { value: original, configurable: true });
    }
  });
});
