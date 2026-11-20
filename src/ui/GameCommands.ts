import type { GameMode } from '@/gameplay/modes/gameMode';
import type { TerrainType } from '@/world/generation/config';
import type { WorldSummary } from '@/world/persistence/types';

export interface NewWorldOptions {
  name: string;
  seed: string;
  terrain: TerrainType;
  treeDensity: number;
  mode: GameMode;
}

export interface DebugInfo {
  fps: number;
  frameMs: number;
  position: { x: number; y: number; z: number };
  facing: string;
  chunk: { x: number; z: number };
  loadedChunks: number;
  meshedChunks: number;
  pendingMeshes: number;
  faces: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  pixelRatio: number;
  timeOfDay: string;
  weather: string;
  seed: string;
  flying: boolean;
  workers: boolean;
}

/**
 * The only surface the UI uses to act on the game. The UI never touches the
 * scene, the world or storage directly.
 */
export interface GameCommands {
  /** False when worlds are kept in memory only (IndexedDB unavailable). */
  readonly storagePersistent: boolean;
  listWorlds(): Promise<WorldSummary[]>;
  createWorld(options: NewWorldOptions): Promise<void>;
  playWorld(id: string): Promise<void>;
  renameWorld(id: string, name: string): Promise<void>;
  deleteWorld(id: string): Promise<void>;
  resume(): void;
  closeInventory(): void;
  saveNow(): Promise<void>;
  /** Discards all edits of the current world and respawns the player. */
  resetWorld(): Promise<void>;
  /** Regenerates the current world's terrain from a new seed. */
  regenerateWorld(seed: string): Promise<void>;
  quitToMenu(): Promise<void>;
  setMode(mode: GameMode): void;
  playClick(): void;
  debugInfo(): DebugInfo | null;
}
