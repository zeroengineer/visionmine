import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import type { GameMode } from '@/gameplay/modes/gameMode';

/** `memory` = saved only for this page session (IndexedDB unavailable). */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'memory' | 'error';

export interface SessionState {
  worldId: string | null;
  worldName: string;
  seed: string;
  mode: GameMode;
  /** The camera is below the water surface. */
  underwater: boolean;
  saveStatus: SaveStatus;
  setWorld(world: { id: string; name: string; seed: string; mode: GameMode } | null): void;
  setMode(mode: GameMode): void;
  setUnderwater(underwater: boolean): void;
  setSaveStatus(status: SaveStatus): void;
}

/** State of the world currently being played that the UI needs to observe. */
export const sessionStore = createStore<SessionState>()(
  subscribeWithSelector((set) => ({
    worldId: null,
    worldName: '',
    seed: '',
    mode: 'creative',
    underwater: false,
    saveStatus: 'idle',
    setWorld(world) {
      if (!world) set({ worldId: null, worldName: '', seed: '', saveStatus: 'idle' });
      else set({ worldId: world.id, worldName: world.name, seed: world.seed, mode: world.mode });
    },
    setMode: (mode) => set({ mode }),
    setUnderwater: (underwater) => set({ underwater }),
    setSaveStatus: (saveStatus) => set({ saveStatus }),
  })),
);
