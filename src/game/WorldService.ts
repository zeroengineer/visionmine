import type { GameMode } from '@/gameplay/modes/gameMode';
import { sanitizeWorldConfig, type TerrainType } from '@/world/generation/config';
import { normalizeWorldName } from '@/world/persistence/codec';
import {
  SAVE_VERSION,
  type WorldRecord,
  type WorldRepository,
  type WorldSummary,
} from '@/world/persistence/types';

export interface CreateWorldOptions {
  name: string;
  seed: string;
  terrain: TerrainType;
  treeDensity: number;
  mode: GameMode;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** World management use cases (create, rename, delete, reset) on top of a repository. */
export class WorldService {
  constructor(readonly repository: WorldRepository) {}

  get persistent(): boolean {
    return this.repository.persistent;
  }

  list(): Promise<WorldSummary[]> {
    return this.repository.listWorlds();
  }

  async create(options: CreateWorldOptions): Promise<WorldRecord> {
    const now = Date.now();
    const record: WorldRecord = {
      id: newId(),
      name: normalizeWorldName(options.name),
      config: sanitizeWorldConfig({
        seed: options.seed.trim(),
        terrain: options.terrain,
        treeDensity: options.treeDensity,
      }),
      mode: options.mode,
      createdAt: now,
      lastPlayedAt: now,
      timeOfDay: 0.32,
      version: SAVE_VERSION,
    };
    await this.repository.putWorld(record);
    return record;
  }

  async rename(id: string, name: string): Promise<WorldRecord | null> {
    const record = await this.repository.getWorld(id);
    if (!record) return null;
    const updated = { ...record, name: normalizeWorldName(name) };
    await this.repository.putWorld(updated);
    return updated;
  }

  delete(id: string): Promise<void> {
    return this.repository.deleteWorld(id);
  }

  /** Discards all edits and the saved player, keeping the same terrain. */
  async reset(id: string): Promise<WorldRecord | null> {
    const record = await this.repository.getWorld(id);
    if (!record) return null;
    await this.repository.clearEdits(id);
    await this.repository.deletePlayer(id);
    const updated = { ...record, timeOfDay: 0.32, lastPlayedAt: Date.now() };
    await this.repository.putWorld(updated);
    return updated;
  }

  /** Gives the world a new seed, which regenerates all terrain and discards edits. */
  async regenerate(id: string, seed: string): Promise<WorldRecord | null> {
    const record = await this.repository.getWorld(id);
    if (!record) return null;
    await this.repository.clearEdits(id);
    await this.repository.deletePlayer(id);
    const updated: WorldRecord = {
      ...record,
      config: sanitizeWorldConfig({ ...record.config, seed: seed.trim() }),
      timeOfDay: 0.32,
      lastPlayedAt: Date.now(),
    };
    await this.repository.putWorld(updated);
    return updated;
  }
}
