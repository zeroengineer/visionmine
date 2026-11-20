import { parsePlayerRecord, parseWorldRecord } from './codec';
import type {
  ChunkEditsEntry,
  PlayerRecord,
  WorldEdits,
  WorldRecord,
  WorldRepository,
  WorldSummary,
} from './types';

/**
 * In-memory repository used when IndexedDB is unavailable (and in tests).
 * Worlds work normally but are lost when the page closes.
 */
export class MemoryRepository implements WorldRepository {
  readonly persistent = false;
  private readonly worlds = new Map<string, WorldRecord>();
  private readonly edits = new Map<string, WorldEdits>();
  private readonly players = new Map<string, PlayerRecord>();

  async listWorlds(): Promise<WorldSummary[]> {
    return [...this.worlds.values()]
      .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
      .map((record) => ({ id: record.id, corrupt: false, record: structuredClone(record) }));
  }

  async getWorld(id: string): Promise<WorldRecord | null> {
    return parseWorldRecord(structuredClone(this.worlds.get(id) ?? null));
  }

  async putWorld(record: WorldRecord): Promise<void> {
    this.worlds.set(record.id, structuredClone(record));
  }

  async deleteWorld(id: string): Promise<void> {
    this.worlds.delete(id);
    this.edits.delete(id);
    this.players.delete(id);
  }

  async loadEdits(worldId: string): Promise<WorldEdits> {
    const result: WorldEdits = new Map();
    for (const [key, edits] of this.edits.get(worldId) ?? []) result.set(key, new Map(edits));
    return result;
  }

  async saveEdits(worldId: string, entries: readonly ChunkEditsEntry[]): Promise<void> {
    let world = this.edits.get(worldId);
    if (!world) {
      world = new Map();
      this.edits.set(worldId, world);
    }
    for (const entry of entries) world.set(entry.chunkKey, new Map(entry.edits));
  }

  async clearEdits(worldId: string): Promise<void> {
    this.edits.delete(worldId);
  }

  async loadPlayer(worldId: string): Promise<PlayerRecord | null> {
    return parsePlayerRecord(structuredClone(this.players.get(worldId) ?? null), worldId);
  }

  async savePlayer(record: PlayerRecord): Promise<void> {
    this.players.set(record.worldId, structuredClone(record));
  }

  async deletePlayer(worldId: string): Promise<void> {
    this.players.delete(worldId);
  }
}
