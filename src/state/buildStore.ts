import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';

export interface Size3 {
  sx: number;
  sy: number;
  sz: number;
}

export interface BuildState {
  /** Build tools exist in the current game mode. */
  available: boolean;
  /** Number of selection corners marked: 0, 1 or 2. */
  corners: number;
  /** Size of the selection once both corners are marked. */
  selection: Size3 | null;
  clipboard: Size3 | null;
  canUndo: boolean;
  canRedo: boolean;
  update(patch: Partial<Omit<BuildState, 'update'>>): void;
}

/** What the build menu needs to know about the builder tools of the active world. */
export const buildStore = createStore<BuildState>()(
  subscribeWithSelector((set) => ({
    available: false,
    corners: 0,
    selection: null,
    clipboard: null,
    canUndo: false,
    canRedo: false,
    update: (patch) => set(patch),
  })),
);
