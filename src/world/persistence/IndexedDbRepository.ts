import {
  decodeEdits,
  EDIT_FORMAT,
  encodeEdits,
  parsePlayerRecord,
  parseWorldRecord,
} from './codec';
import type {
  ChunkEditsEntry,
  PlayerRecord,
  WorldEdits,
  WorldRecord,
  WorldRepository,
  WorldSummary,
} from './types';

export const DB_NAME = 'visionmine';
const DB_VERSION = 1;
const WORLDS = 'worlds';
const CHUNKS = 'chunks';
const PLAYERS = 'players';
const OPEN_TIMEOUT_MS = 4000;

interface ChunkRow {
  /** `${worldId}:${chunkKey}` */
  key: string;
  worldId: string;
  chunkKey: number;
  data: Uint32Array;
  /** Layout of `data`; rows written before block state existed have none (format 1). */
  format?: number;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** World storage backed by IndexedDB. Only block edits are stored, never whole chunks. */
export class IndexedDbRepository implements WorldRepository {
  readonly persistent = true;

  private constructor(private readonly db: IDBDatabase) {}

  /** Opens (and if needed creates) the database. Rejects when IndexedDB cannot be used. */
  static open(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<IndexedDbRepository> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const timer = setTimeout(() => fail(new Error('IndexedDB open timed out')), OPEN_TIMEOUT_MS);

      let request: IDBOpenDBRequest;
      try {
        request = factory.open(name, DB_VERSION);
      } catch (error) {
        clearTimeout(timer);
        fail(error);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(WORLDS)) db.createObjectStore(WORLDS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(CHUNKS)) {
          db.createObjectStore(CHUNKS, { keyPath: 'key' }).createIndex('worldId', 'worldId');
        }
        if (!db.objectStoreNames.contains(PLAYERS)) {
          db.createObjectStore(PLAYERS, { keyPath: 'worldId' });
        }
      };
      request.onerror = () => {
        clearTimeout(timer);
        fail(request.error ?? new Error('IndexedDB could not be opened'));
      };
      request.onblocked = () => {
        clearTimeout(timer);
        fail(new Error('IndexedDB is blocked by another tab'));
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        const db = request.result;
        // Another tab upgrading the schema must not be blocked by this one.
        db.onversionchange = () => db.close();
        resolve(new IndexedDbRepository(db));
      };
    });
  }

  close(): void {
    this.db.close();
  }

  async listWorlds(): Promise<WorldSummary[]> {
    const tx = this.db.transaction(WORLDS, 'readonly');
    const store = tx.objectStore(WORLDS);
    const [rows, keys] = await Promise.all([
      requestToPromise(store.getAll() as IDBRequest<unknown[]>),
      requestToPromise(store.getAllKeys()),
    ]);
    const summaries: WorldSummary[] = rows.map((row, i) => {
      const record = parseWorldRecord(row);
      if (record) return { id: record.id, corrupt: false, record };
      const name = (row as { name?: unknown } | null)?.name;
      return {
        id: String(keys[i]),
        corrupt: true,
        name: typeof name === 'string' && name ? name.slice(0, 32) : 'Unreadable world',
      };
    });
    return summaries.sort((a, b) => {
      if (a.corrupt !== b.corrupt) return a.corrupt ? 1 : -1;
      if (a.corrupt || b.corrupt) return 0;
      return b.record.lastPlayedAt - a.record.lastPlayedAt;
    });
  }

  async getWorld(id: string): Promise<WorldRecord | null> {
    const tx = this.db.transaction(WORLDS, 'readonly');
    return parseWorldRecord(await requestToPromise(tx.objectStore(WORLDS).get(id)));
  }

  async putWorld(record: WorldRecord): Promise<void> {
    const tx = this.db.transaction(WORLDS, 'readwrite');
    tx.objectStore(WORLDS).put(record);
    await transactionDone(tx);
  }

  async deleteWorld(id: string): Promise<void> {
    const tx = this.db.transaction([WORLDS, CHUNKS, PLAYERS], 'readwrite');
    tx.objectStore(WORLDS).delete(id);
    tx.objectStore(PLAYERS).delete(id);
    this.deleteChunkRows(tx, id);
    await transactionDone(tx);
  }

  async loadEdits(worldId: string): Promise<WorldEdits> {
    const tx = this.db.transaction(CHUNKS, 'readonly');
    const rows = await requestToPromise(
      tx.objectStore(CHUNKS).index('worldId').getAll(IDBKeyRange.only(worldId)) as IDBRequest<
        unknown[]
      >,
    );
    const result: WorldEdits = new Map();
    for (const row of rows) {
      const chunkKey = (row as Partial<ChunkRow> | null)?.chunkKey;
      if (typeof chunkKey !== 'number' || !Number.isInteger(chunkKey)) continue;
      const { data, format } = row as Partial<ChunkRow>;
      const edits = decodeEdits(data, format === EDIT_FORMAT ? EDIT_FORMAT : 1);
      if (edits.size > 0) result.set(chunkKey, edits);
    }
    return result;
  }

  async saveEdits(worldId: string, entries: readonly ChunkEditsEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const tx = this.db.transaction(CHUNKS, 'readwrite');
    const store = tx.objectStore(CHUNKS);
    for (const entry of entries) {
      const row: ChunkRow = {
        key: `${worldId}:${entry.chunkKey}`,
        worldId,
        chunkKey: entry.chunkKey,
        data: encodeEdits(entry.edits),
        format: EDIT_FORMAT,
      };
      store.put(row);
    }
    await transactionDone(tx);
  }

  async clearEdits(worldId: string): Promise<void> {
    const tx = this.db.transaction(CHUNKS, 'readwrite');
    this.deleteChunkRows(tx, worldId);
    await transactionDone(tx);
  }

  async loadPlayer(worldId: string): Promise<PlayerRecord | null> {
    const tx = this.db.transaction(PLAYERS, 'readonly');
    return parsePlayerRecord(await requestToPromise(tx.objectStore(PLAYERS).get(worldId)), worldId);
  }

  async savePlayer(record: PlayerRecord): Promise<void> {
    const tx = this.db.transaction(PLAYERS, 'readwrite');
    tx.objectStore(PLAYERS).put(record);
    await transactionDone(tx);
  }

  async deletePlayer(worldId: string): Promise<void> {
    const tx = this.db.transaction(PLAYERS, 'readwrite');
    tx.objectStore(PLAYERS).delete(worldId);
    await transactionDone(tx);
  }

  private deleteChunkRows(tx: IDBTransaction, worldId: string): void {
    const request = tx
      .objectStore(CHUNKS)
      .index('worldId')
      .openKeyCursor(IDBKeyRange.only(worldId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      tx.objectStore(CHUNKS).delete(cursor.primaryKey);
      cursor.continue();
    };
  }
}
