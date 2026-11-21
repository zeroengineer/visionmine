import { inventoryStore } from '@/state/inventoryStore';
import { sessionStore } from '@/state/sessionStore';
import { uiStore } from '@/state/uiStore';
import type { DebugInfo } from '@/ui/GameCommands';
import type { Game } from './Game';

/**
 * Inspection and control surface for automated browser tests and manual
 * debugging, installed as `window.__visionmine`. Only available in development
 * builds or when the page URL contains `?e2e`.
 */
export interface DebugApi {
  screen(): string;
  worldId(): string | null;
  saveStatus(): string;
  player(): {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    onGround: boolean;
    flying: boolean;
    sneaking: boolean;
    sprinting: boolean;
    ready: boolean;
  } | null;
  getBlock(x: number, y: number, z: number): number;
  /** State byte of a block (orientation, open/closed…). */
  getMeta(x: number, y: number, z: number): number;
  target(): {
    x: number;
    y: number;
    z: number;
    nx: number;
    ny: number;
    nz: number;
    block: number;
  } | null;
  look(yaw: number, pitch: number): void;
  teleport(x: number, y: number, z: number): void;
  inventory(): { selected: number; slots: Array<{ block: number; count: number } | null> };
  stats(): DebugInfo | null;
  /** Makes gameplay input live without real pointer lock (headless browsers). */
  virtualLock(locked: boolean): void;
  save(): Promise<void>;
  setTime(time: number): void;
  /** Forces the weather immediately (it otherwise changes on a random timer). */
  setWeather(kind: 'clear' | 'rain' | 'snow'): void;
}

export function shouldInstallDebugHook(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return new URLSearchParams(window.location.search).has('e2e');
  } catch {
    return false;
  }
}

export function installDebugHook(game: Game): void {
  const playing = () => {
    const session = game.activeSession;
    return session && !session.attract ? session : null;
  };
  const api: DebugApi = {
    screen: () => uiStore.getState().screen,
    worldId: () => sessionStore.getState().worldId,
    saveStatus: () => sessionStore.getState().saveStatus,
    player() {
      const session = playing();
      if (!session) return null;
      const { position, yaw, pitch, onGround, flying, sneaking, sprinting } = session.player;
      return {
        x: position.x,
        y: position.y,
        z: position.z,
        yaw,
        pitch,
        onGround,
        flying,
        sneaking,
        sprinting,
        ready: session.isPlayerReady,
      };
    },
    getBlock: (x, y, z) =>
      playing()?.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) ?? 0,
    getMeta: (x, y, z) =>
      playing()?.world.getMeta(Math.floor(x), Math.floor(y), Math.floor(z)) ?? 0,
    target() {
      const session = playing();
      if (!session) return null;
      session.interaction.retarget();
      const hit = session.interaction.target;
      return hit
        ? { x: hit.x, y: hit.y, z: hit.z, nx: hit.nx, ny: hit.ny, nz: hit.nz, block: hit.block }
        : null;
    },
    look(yaw, pitch) {
      const session = playing();
      if (!session) return;
      session.player.yaw = yaw;
      session.player.pitch = pitch;
    },
    teleport(x, y, z) {
      playing()?.player.teleport(x, y, z);
    },
    inventory() {
      const { selected, slots } = inventoryStore.getState();
      return { selected, slots: slots.map((slot) => (slot ? { ...slot } : null)) };
    },
    stats: () => game.debugInfo(),
    virtualLock: (locked) => game.input.setLockOverride(locked),
    save: () => game.saveNow(),
    setTime: (time) => game.environment.cycle.setTime(time),
    setWeather: (kind) => game.environment.weather.set(kind, true),
  };
  (window as unknown as { __visionmine: DebugApi }).__visionmine = api;
}
