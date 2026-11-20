import { expect, test } from '@playwright/test';
import {
  canvasColourCount,
  captureMouse,
  createWorld,
  game,
  openGame,
  tid,
  waitForScreen,
} from './helpers';

test.describe('startup and world creation', () => {
  test('boots to the main menu with a rendered backdrop', async ({ page }) => {
    const log = await openGame(page);

    await expect(page.getByRole('heading', { name: 'VISIONMINE' })).toBeVisible();
    await expect(page.locator(tid('menu-new'))).toBeVisible();
    await expect(page.locator(tid('menu-worlds'))).toBeVisible();
    await expect(page.locator(tid('menu-settings'))).toBeVisible();
    // No saved world yet, so there is nothing to continue.
    await expect(page.locator(tid('menu-continue'))).toBeHidden();
    await expect(page.locator('.fatal-error')).toHaveCount(0);

    // The attract-mode terrain behind the menu streams in and is drawn.
    await expect.poll(() => canvasColourCount(page), { timeout: 30_000 }).toBeGreaterThan(12);
    expect(log.errors).toEqual([]);
  });

  test('creates a world and reaches gameplay', async ({ page, browserName }) => {
    const log = await openGame(page);

    await page.click(tid('menu-new'));
    await waitForScreen(page, 'create');
    await page.locator(tid('create-name')).fill('First World');
    await page.locator(tid('create-seed')).fill('flow-seed');
    await page.click(tid('create-submit'));

    // The loading screen is shown while terrain streams in.
    await waitForScreen(page, 'loading');
    await expect(page.locator('[data-screen="loading"]')).toBeVisible();
    await waitForScreen(page, 'playing', 90_000);
    await page.waitForFunction(() => window.__visionmine.player()?.ready === true);

    await expect(page.locator(tid('hud'))).toBeVisible();
    await expect(page.locator('.hud__mode')).toHaveText('Creative');
    await expect(page.locator(tid('click-to-play'))).toBeVisible();
    expect(await game.worldId(page)).toBeTruthy();

    const player = await game.player(page);
    expect(player.onGround).toBe(true);
    // The player stands on a solid block with free space for the body.
    expect(await game.getBlock(page, player.x, player.y - 1, player.z)).not.toBe(0);
    expect(await game.getBlock(page, player.x, player.y, player.z)).toBe(0);
    expect(await game.getBlock(page, player.x, player.y + 1, player.z)).toBe(0);

    const stats = await game.stats(page);
    expect(stats.seed).toBe('flow-seed');
    expect(stats.meshedChunks).toBeGreaterThan(0);
    expect(stats.drawCalls).toBeGreaterThan(0);
    expect(stats.triangles).toBeGreaterThan(0);
    // Terrain is generated off the main thread wherever module workers exist.
    if (browserName === 'chromium') expect(stats.workers).toBe(true);
    expect(await canvasColourCount(page)).toBeGreaterThan(12);

    await captureMouse(page);
    await expect(page.locator('.crosshair')).toBeVisible();
    expect(log.errors).toEqual([]);
  });

  test('the same seed produces the same terrain', async ({ page }) => {
    await openGame(page);
    await createWorld(page, {
      name: 'A',
      seed: 'repeatable',
      terrain: 'standard',
      trees: 'normal',
    });
    const first = await game.player(page);
    const sample = (): Promise<number[]> =>
      page.evaluate(() => {
        const out: number[] = [];
        for (let x = -12; x <= 12; x += 3) {
          for (let z = -12; z <= 12; z += 3) {
            for (let y = 40; y < 70; y += 2) out.push(window.__visionmine.getBlock(x, y, z));
          }
        }
        return out;
      });
    const blocksA = await sample();

    await page.keyboard.press('Escape');
    await waitForScreen(page, 'paused');
    await page.click(tid('pause-quit'));
    await waitForScreen(page, 'menu');
    await createWorld(page, {
      name: 'B',
      seed: 'repeatable',
      terrain: 'standard',
      trees: 'normal',
    });
    const second = await game.player(page);

    expect(await sample()).toEqual(blocksA);
    expect(second.x).toBe(first.x);
    expect(second.y).toBe(first.y);
    expect(second.z).toBe(first.z);
    expect(blocksA.some((id) => id !== 0)).toBe(true);
  });

  test('the create screen can be cancelled', async ({ page }) => {
    await openGame(page);
    await page.click(tid('menu-new'));
    await waitForScreen(page, 'create');
    await page.getByRole('button', { name: 'Back' }).click();
    await waitForScreen(page, 'menu');
    await expect(page.locator(tid('menu-new'))).toBeVisible();
  });
});
