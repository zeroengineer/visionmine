import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';

export type Screen =
  'menu' | 'create' | 'worlds' | 'settings' | 'loading' | 'playing' | 'paused' | 'inventory';

export interface UiState {
  screen: Screen;
  /** Screen to return to when a nested screen (settings) is closed. */
  previous: Screen;
  setScreen(screen: Screen): void;
  back(): void;
}

/** Which interface layer is active. Gameplay input is only live while `playing`. */
export const uiStore = createStore<UiState>()(
  subscribeWithSelector((set, get) => ({
    screen: 'playing',
    previous: 'playing',
    setScreen(screen) {
      if (screen === get().screen) return;
      set({ previous: get().screen, screen });
    },
    back() {
      set({ screen: get().previous, previous: get().screen });
    },
  })),
);
