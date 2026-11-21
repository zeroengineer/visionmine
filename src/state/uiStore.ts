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
  | 'inventory'
  | 'build';

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
  /** Brief message shown on the HUD; `id` changes with every message. */
  notice: { id: number; text: string };
  /** The player switched the HUD off (screenshots, sightseeing). */
  hudHidden: boolean;
  setScreen(screen: Screen): void;
  back(): void;
  setLoadProgress(progress: number): void;
  setPointerLocked(locked: boolean): void;
  notify(text: string, kind?: ToastKind): void;
  dismissToast(id: number): void;
  flash(text: string): void;
  toggleHud(): void;
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
    notice: { id: 0, text: '' },
    hudHidden: false,
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
    flash: (text) => set({ notice: { id: get().notice.id + 1, text } }),
    toggleHud: () => set({ hudHidden: !get().hudHidden }),
    dismissToast(id) {
      set({ toasts: get().toasts.filter((toast) => toast.id !== id) });
    },
  })),
);

/** Screens during which a world is being played (HUD visible). */
export function isInGame(screen: Screen): boolean {
  return (
    screen === 'playing' || screen === 'paused' || screen === 'inventory' || screen === 'build'
  );
}
