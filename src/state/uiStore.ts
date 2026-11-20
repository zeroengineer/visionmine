import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';

export type Screen =
  | 'boot'
  | 'menu'
  | 'create'
  | 'worlds'
  | 'settings'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'inventory';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
}

export interface UiState {
  screen: Screen;
  /** Screen to return to when a nested screen (settings) is closed. */
  previous: Screen;
  /** 0..1 while a world is loading. */
  loadProgress: number;
  /** Mouse capture is active (gameplay input is live). */
  pointerLocked: boolean;
  toasts: readonly Toast[];
  setScreen(screen: Screen): void;
  back(): void;
  setLoadProgress(progress: number): void;
  setPointerLocked(locked: boolean): void;
  notify(text: string, kind?: ToastKind): void;
  dismissToast(id: number): void;
}

let nextToastId = 1;
const MAX_TOASTS = 4;

/** Which interface layer is active, plus transient UI state. */
export const uiStore = createStore<UiState>()(
  subscribeWithSelector((set, get) => ({
    screen: 'boot',
    previous: 'boot',
    loadProgress: 0,
    pointerLocked: false,
    toasts: [],
    setScreen(screen) {
      if (screen === get().screen) return;
      set({ previous: get().screen, screen });
    },
    back() {
      set({ screen: get().previous, previous: get().screen });
    },
    setLoadProgress: (loadProgress) => set({ loadProgress }),
    setPointerLocked: (pointerLocked) => set({ pointerLocked }),
    notify(text, kind = 'info') {
      const toast: Toast = { id: nextToastId++, text, kind };
      set({ toasts: [...get().toasts, toast].slice(-MAX_TOASTS) });
    },
    dismissToast(id) {
      set({ toasts: get().toasts.filter((toast) => toast.id !== id) });
    },
  })),
);

/** Screens during which a world is being played (HUD visible). */
export function isInGame(screen: Screen): boolean {
  return screen === 'playing' || screen === 'paused' || screen === 'inventory';
}
