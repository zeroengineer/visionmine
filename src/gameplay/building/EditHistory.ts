import type { World } from '@/world/World';

interface Change {
  x: number;
  y: number;
  z: number;
  before: number;
  after: number;
  beforeMeta: number;
  afterMeta: number;
}

/** Block changes that are undone and redone together. */
export type EditGroup = readonly Change[];

export const MAX_HISTORY_GROUPS = 100;

/**
 * Undo and redo for block edits. Every change made through `World.setBlock` is
 * recorded; `commit()` closes the current group, so all changes between two
 * commits (one click, one explosion, one fill) are undone as a unit.
 * History lives only for the session and is not saved.
 */
export class EditHistory {
  /** Recording is off while this is false (survival mode). */
  enabled = true;
  private readonly undoStack: EditGroup[] = [];
  private readonly redoStack: EditGroup[] = [];
  /** Open group, keyed by position so repeated edits of one block collapse. */
  private readonly pending = new Map<string, Change>();
  private applying = false;
  private readonly unsubscribe: () => void;

  constructor(private readonly world: World) {
    this.unsubscribe = world.events.on('blockChanged', (event) => {
      // Sand that falls and water that flows are consequences, not edits.
      if (this.applying || !this.enabled || event.simulated) return;
      const { x, y, z } = event;
      const key = `${x},${y},${z}`;
      const existing = this.pending.get(key);
      if (existing) {
        existing.after = event.next;
        existing.afterMeta = event.nextMeta;
      } else {
        this.pending.set(key, {
          x,
          y,
          z,
          before: event.previous,
          after: event.next,
          beforeMeta: event.previousMeta,
          afterMeta: event.nextMeta,
        });
      }
    });
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoCount(): number {
    return this.undoStack.length;
  }

  /** Closes the open group. A new edit also discards everything that could be redone. */
  commit(): void {
    if (this.pending.size === 0) return;
    const group = [...this.pending.values()].filter(
      (change) => change.before !== change.after || change.beforeMeta !== change.afterMeta,
    );
    this.pending.clear();
    if (group.length === 0) return;
    this.undoStack.push(group);
    if (this.undoStack.length > MAX_HISTORY_GROUPS) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /**
   * Reverts the latest group. Returns the number of blocks restored, 0 when
   * there is nothing to undo, or -1 when part of it lies in unloaded chunks
   * (the group is kept so it can be undone after walking back).
   */
  undo(): number {
    this.commit();
    return this.step(this.undoStack, this.redoStack, true);
  }

  redo(): number {
    this.commit();
    return this.step(this.redoStack, this.undoStack, false);
  }

  clear(): void {
    this.pending.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  dispose(): void {
    this.unsubscribe();
    this.clear();
  }

  private step(from: EditGroup[], to: EditGroup[], backwards: boolean): number {
    const group = from[from.length - 1];
    if (!group) return 0;
    if (!group.every((change) => this.world.isLoadedAt(change.x, change.z))) return -1;
    from.pop();
    this.applying = true;
    try {
      for (const change of group) {
        this.world.setBlock(
          change.x,
          change.y,
          change.z,
          backwards ? change.before : change.after,
          backwards ? change.beforeMeta : change.afterMeta,
        );
      }
    } finally {
      this.applying = false;
    }
    to.push(group);
    return group.length;
  }
}
