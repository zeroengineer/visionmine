import { expect, type Page } from '@playwright/test';
import type { DebugApi } from '@/game/debugHook';

declare global {
  interface Window {
    __visionmine: DebugApi;
  }
}

/** Block ids used in assertions (mirrors `BlockId` in src/world/blocks/blocks.ts). */
export const Block = {
  Air: 0,
  Grass: 1,
  Dirt: 2,
  Stone: 3,
  Sand: 4,
  Water: 5,
  Planks: 8,
  Cobblestone: 9,
  Glass: 10,
  Brick: 11,
  Tnt: 14,
} as const;

export const SETTINGS_KEY = 'visionmine.settings.v1';

/** Small, cheap settings so software-rendered browsers stay responsive. */
const TEST_SETTINGS = {
  quality: 'low',
  renderDistance: 3,
  shadows: false,
  adaptiveQuality: false,
  weather: false,
  volume: 0,
};

export const tid = (id: string): string => `[data-testid="${id}"]`;

/** Console errors and uncaught exceptions seen by a page. */
export interface ErrorLog {
  readonly errors: string[];
}

/** Driver-level noise that does not indicate a defect in the game. */
const IGNORED_MESSAGES = [/GPU stall due to ReadPixels/, /GL Driver Message/];

export function trackErrors(page: Page): ErrorLog {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!IGNORED_MESSAGES.some((pattern) => pattern.test(text))) errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
  return { errors };
}

/** Opens the game with the debug hook enabled and waits for the main menu. */
export async function openGame(page: Page): Promise<ErrorLog> {
  const log = trackErrors(page);
  await page.addInitScript(
    ([key, value]) => {
      // Only seed defaults: a test that changes settings must see them survive a reload.
      if (localStorage.getItem(key!) === null) localStorage.setItem(key!, value!);
    },
    [SETTINGS_KEY, JSON.stringify(TEST_SETTINGS)],
  );
  await page.goto('/?e2e');
  await waitForScreen(page, 'menu');
  return log;
}

export async function waitForScreen(page: Page, screen: string, timeout = 30_000): Promise<void> {
  await page.waitForFunction((expected) => window.__visionmine?.screen() === expected, screen, {
    timeout,
  });
}

export interface CreateWorldOptions {
  name?: string;
  seed?: string;
  terrain?: 'standard' | 'mountains' | 'islands' | 'flatlands';
  trees?: 'none' | 'sparse' | 'normal' | 'dense';
  mode?: 'creative' | 'survival';
}

/** Fills the Create World form from the main menu and waits until the world is playable. */
export async function createWorld(page: Page, options: CreateWorldOptions = {}): Promise<void> {
  await page.click(tid('menu-new'));
  await waitForScreen(page, 'create');
  const form = page.locator('[data-screen="create"]');
  await form.locator(tid('create-name')).fill(options.name ?? 'Test World');
  await form.locator(tid('create-seed')).fill(options.seed ?? 'e2e-seed');
  // Flat, treeless terrain by default so movement and targeting are predictable.
  await form.locator(`[data-value="${options.terrain ?? 'flatlands'}"]`).click();
  await form.locator(`[data-value="${options.trees ?? 'none'}"]`).click();
  await form.locator(`[data-value="${options.mode ?? 'creative'}"]`).click();
  await form.locator(tid('create-submit')).click();
  await waitUntilPlaying(page);
}

/** Waits for the loading screen to finish and the player to be standing in the world. */
export async function waitUntilPlaying(page: Page): Promise<void> {
  await waitForScreen(page, 'playing', 90_000);
  await page.waitForFunction(() => window.__visionmine.player()?.ready === true, null, {
    timeout: 30_000,
  });
}

/**
 * Makes gameplay input live. Uses real pointer lock where the browser grants it
 * to automation and falls back to the debug hook's virtual lock otherwise.
 * Returns true when real pointer lock is active.
 */
export async function captureMouse(page: Page): Promise<boolean> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.move(viewport.width / 2, viewport.height / 3);
  await page.mouse.down();
  await page.mouse.up();
  const real = await page
    .waitForFunction(() => document.pointerLockElement !== null, null, { timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  if (!real) await page.evaluate(() => window.__visionmine.virtualLock(true));
  await expect(page.locator(tid('click-to-play'))).toBeHidden();
  return real;
}

export const game = {
  screen: (page: Page) => page.evaluate(() => window.__visionmine.screen()),
  player: async (page: Page) => {
    const player = await page.evaluate(() => window.__visionmine.player());
    if (!player) throw new Error('No world is being played.');
    return player;
  },
  stats: async (page: Page) => {
    const stats = await page.evaluate(() => window.__visionmine.stats());
    if (!stats) throw new Error('No world is being played.');
    return stats;
  },
  target: (page: Page) => page.evaluate(() => window.__visionmine.target()),
  inventory: (page: Page) => page.evaluate(() => window.__visionmine.inventory()),
  worldId: (page: Page) => page.evaluate(() => window.__visionmine.worldId()),
  getBlock: (page: Page, x: number, y: number, z: number) =>
    page.evaluate(([bx, by, bz]) => window.__visionmine.getBlock(bx!, by!, bz!), [x, y, z]),
  look: (page: Page, yaw: number, pitch: number) =>
    page.evaluate(([y, p]) => window.__visionmine.look(y!, p!), [yaw, pitch]),
  teleport: (page: Page, x: number, y: number, z: number) =>
    page.evaluate(([px, py, pz]) => window.__visionmine.teleport(px!, py!, pz!), [x, y, z]),
  save: (page: Page) => page.evaluate(() => window.__visionmine.save()),
};

/** Presses and releases a mouse button with the pointer over the game view. */
export async function clickWorld(
  page: Page,
  button: 'left' | 'right' | 'middle' = 'left',
): Promise<void> {
  await page.mouse.down({ button });
  await page.mouse.up({ button });
}

/**
 * Aims at the ground a little ahead of the player and returns the targeted
 * block. Yaw 0 looks toward -Z; a negative pitch looks down.
 */
export async function aimAtGround(page: Page, yaw = 0, pitch = -0.8) {
  await game.look(page, yaw, pitch);
  const target = await game.target(page);
  if (!target) throw new Error('Expected a block under the crosshair.');
  return target;
}

/** Number of distinct colours in a downscaled copy of the game canvas. */
export function canvasColourCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        // Read back inside an animation frame, right after the game has drawn,
        // because the WebGL drawing buffer is not preserved between frames.
        requestAnimationFrame(() => {
          const source = document.querySelector<HTMLCanvasElement>('#game')!;
          const copy = document.createElement('canvas');
          copy.width = 64;
          copy.height = 36;
          const context = copy.getContext('2d')!;
          context.drawImage(source, 0, 0, copy.width, copy.height);
          const { data } = context.getImageData(0, 0, copy.width, copy.height);
          const colours = new Set<number>();
          for (let i = 0; i < data.length; i += 4) {
            colours.add(((data[i]! >> 3) << 10) | ((data[i + 1]! >> 3) << 5) | (data[i + 2]! >> 3));
          }
          resolve(colours.size);
        });
      }),
  );
}

/** Pauses with Escape and waits for the pause menu. */
export async function pauseGame(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'paused');
}

/** Resumes from the pause menu and makes gameplay input live again. */
export async function resumeGame(page: Page): Promise<void> {
  await page.click(tid('pause-resume'));
  await waitForScreen(page, 'playing');
  await ensureCaptured(page);
}

/**
 * For use after the game itself asked for the mouse (closing a menu): waits for
 * real pointer lock and falls back to the virtual lock, without clicking the
 * world — a click would be a gameplay action.
 */
export async function ensureCaptured(page: Page): Promise<void> {
  const locked = await page
    .waitForFunction(() => document.pointerLockElement !== null, null, { timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  if (!locked) await page.evaluate(() => window.__visionmine.virtualLock(true));
  await expect(page.locator(tid('click-to-play'))).toBeHidden();
}

/** Leaves the current world through the pause menu. */
export async function quitToMenu(page: Page): Promise<void> {
  if ((await game.screen(page)) !== 'paused') await pauseGame(page);
  await page.click(tid('pause-quit'));
  await waitForScreen(page, 'menu');
}
