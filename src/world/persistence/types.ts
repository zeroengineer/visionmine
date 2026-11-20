import type { WorldConfig } from '../generation/config';

export const SAVE_VERSION = 1;

export type SavedGameMode = 'creative' | 'survival';

/** Metadata and settings of one saved world. */
export interface WorldRecord {
  id: string;
  name: string;
  config: WorldConfig;
  mode: SavedGameMode;
  createdAt: number;
  lastPlayedAt: number;
  /** World clock, 0..1 (see DayNightCycle). */
  timeOfDay: number;
  version: number;
}

/** Player state for one world. `inventory` is validated by the inventory module on load. */
export interface PlayerRecord {
  worldId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flying: boolean;
  inventory: unknown;
}

/** Entry in the world list. Corrupt saves are listed so they can be deleted. */
export type WorldSummary =
  { id: string; corrupt: false; record: WorldRecord } | { id: string; corrupt: true; name: string };

/** Block edits of all chunks in a world: `chunkKey → (blockIndex → blockId)`. */
export type WorldEdits = Map<number, Map<number, number>>;

export interface ChunkEditsEntry {
  chunkKey: number;
  edits: ReadonlyMap<number, number>;
}

/** Storage backend for worlds. All methods reject on storage failure. */
export interface WorldRepository {
  /** False when data only lives in memory for this page session. */
  readonly persistent: boolean;
  listWorlds(): Promise<WorldSummary[]>;
  getWorld(id: string): Promise<WorldRecord | null>;
  putWorld(record: WorldRecord): Promise<void>;
  /** Removes the world together with its edits and player state. */
  deleteWorld(id: string): Promise<void>;
  loadEdits(worldId: string): Promise<WorldEdits>;
  saveEdits(worldId: string, entries: readonly ChunkEditsEntry[]): Promise<void>;
  clearEdits(worldId: string): Promise<void>;
  loadPlayer(worldId: string): Promise<PlayerRecord | null>;
  savePlayer(record: PlayerRecord): Promise<void>;
  deletePlayer(worldId: string): Promise<void>;
}
