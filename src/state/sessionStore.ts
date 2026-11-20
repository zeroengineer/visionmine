import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import type { GameMode } from '@/gameplay/modes/gameMode';

export interface SessionState {
  mode: GameMode;
  setMode(mode: GameMode): void;
}

/** State of the world currently being played that the UI needs to observe. */
export const sessionStore = createStore<SessionState>()(
  subscribeWithSelector((set) => ({
    mode: 'creative',
    setMode: (mode) => set({ mode }),
  })),
);
