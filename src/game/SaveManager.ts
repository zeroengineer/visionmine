import type { Environment } from '@/rendering/environment/Environment';
import { sessionStore } from '@/state/sessionStore';
import type { WorldRecord, WorldRepository } from '@/world/persistence/types';
import type { WorldSession } from './WorldSession';

const AUTOSAVE_INTERVAL = 10;

/**
 * Persists the active world: block edits (only chunks that changed since the
 * last save), player state and world metadata. Saves run one at a time; a
 * request made during a save is coalesced into one follow-up save.
 */
export class SaveManager {
  private timer = AUTOSAVE_INTERVAL;
  private running: Promise<void> | null = null;
  private queued = false;
  private disposed = false;

  constructor(
    private readonly repository: WorldRepository,
    private record: WorldRecord,
    private readonly session: WorldSession,
    private readonly environment: Environment,
  ) {
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
  }

  get worldRecord(): WorldRecord {
    return this.record;
  }

  /** Call every frame; triggers the periodic autosave. */
  update(dt: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = AUTOSAVE_INTERVAL;
      void this.save();
    }
  }

  /** Saves now. Resolves when everything requested so far is stored (or has failed). */
  save(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.running) {
      this.queued = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  dispose(): void {
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
  }

  private async run(): Promise<void> {
    do {
      this.queued = false;
      await this.writeOnce();
    } while (this.queued && !this.disposed);
  }

  private async writeOnce(): Promise<void> {
    const { world } = this.session;
    const store = sessionStore.getState();
    store.setSaveStatus('saving');
    const keys = world.takeUnsavedEdits();
    try {
      const entries = keys.flatMap((chunkKey) => {
        const edits = world.getEdits(chunkKey);
        return edits ? [{ chunkKey, edits }] : [];
      });
      await this.repository.saveEdits(this.record.id, entries);
      if (this.session.isPlayerReady) {
        await this.repository.savePlayer(this.session.capturePlayer(this.record.id));
      }
      this.record = {
        ...this.record,
        lastPlayedAt: Date.now(),
        timeOfDay: this.environment.cycle.time,
        mode: sessionStore.getState().mode,
      };
      await this.repository.putWorld(this.record);
      sessionStore.getState().setSaveStatus(this.repository.persistent ? 'saved' : 'memory');
    } catch (error) {
      // Keep the edits marked as unsaved so the next attempt retries them.
      world.restoreUnsavedEdits(keys);
      console.error('VISIONMINE: saving failed.', error);
      sessionStore.getState().setSaveStatus('error');
    }
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') void this.save();
  };

  private readonly onPageHide = (): void => {
    void this.save();
  };
}
