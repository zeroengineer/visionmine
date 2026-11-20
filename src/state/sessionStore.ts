import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import type { GameMode } from '@/gameplay/modes/gameMode';

export interface SessionState {
  mode: GameMode;
  /** The camera is below the water surface. */
  underwater: boolean;
  setMode(mode: GameMode): void;
  setUnderwater(underwater: boolean): void;
}

/** State of the world currently being played that the UI needs to observe. */
export const sessionStore = createStore<SessionState>()(
  subscribeWithSelector((set) => ({
    mode: 'creative',
    underwater: false,
    setMode: (mode) => set({ mode }),
    setUnderwater: (underwater) => set({ underwater }),
  })),
);
