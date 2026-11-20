import { expect, test, type Page } from '@playwright/test';
import {
  aimAtGround,
  Block,
  captureMouse,
  clickWorld,
  createWorld,
  game,
  openGame,
  pauseGame,
  quitToMenu,
  tid,
  waitForScreen,
  waitUntilPlaying,
} from './helpers';

interface Cell {
  x: number;
  y: number;
  z: number;
}

/** Breaks one ground block and places a brick two blocks further on. Returns both cells. */
async function makeEdits(page: Page): Promise<{ broken: Cell; placed: Cell }> {
  const first = await aimAtGround(page, 0, -0.8);
  await clickWorld(page, 'left');
  const broken = { x: first.x, y: first.y, z: first.z };
  await expect.poll(() => game.getBlock(page, broken.x, broken.y, broken.z)).toBe(Block.Air);

  await page.keyboard.press('Digit8');
  const second = await aimAtGround(page, 0, -0.4);
  await clickWorld(page, 'right');
  const placed = { x: second.x + second.nx, y: second.y + second.ny, z: second.z + second.nz };
  await expect.poll(() => game.getBlock(page, placed.x, placed.y, placed.z)).toBe(Block.Brick);
  return { broken, placed };
}

test.describe('saving and loading', () => {
  test('edits, player and inventory are restored after a page reload', async ({ page }) => {
    const log = await openGame(page);
    await createWorld(page, { name: 'Saved World', seed: 'persist' });
    await captureMouse(page);
    const worldId = await game.worldId(page);
    const { broken, placed } = await makeEdits(page);

    // Move somewhere recognisable, facing a recognisable way, holding slot 6.
    const spawn = await game.player(page);
    await page.keyboard.press('KeyF');
    await expect.poll(async () => (await game.player(page)).flying).toBe(true);
    await game.teleport(page, spawn.x + 5, spawn.y + 9, spawn.z - 7);
    await game.look(page, 1.25, -0.4);
    await page.keyboard.press('Digit6');
    await expect.poll(async () => (await game.inventory(page)).selected).toBe(5);
    const inventoryBefore = await game.inventory(page);

    await game.save(page);
    expect(await page.evaluate(() => window.__visionmine.saveStatus())).toBe('saved');

    await page.reload();
    await waitForScreen(page, 'menu');
    await expect(page.locator(tid('menu-continue'))).toBeVisible();
    await expect(page.locator('.menu__detail')).toHaveText('Saved World');
    await page.click(tid('menu-continue'));
    await waitUntilPlaying(page);

    expect(await game.worldId(page)).toBe(worldId);
    expect((await game.stats(page)).seed).toBe('persist');
    expect(await game.getBlock(page, broken.x, broken.y, broken.z)).toBe(Block.Air);
    expect(await game.getBlock(page, placed.x, placed.y, placed.z)).toBe(Block.Brick);

    const restored = await game.player(page);
    expect(restored.x).toBeCloseTo(spawn.x + 5, 3);
    expect(restored.y).toBeCloseTo(spawn.y + 9, 3);
    expect(restored.z).toBeCloseTo(spawn.z - 7, 3);
    expect(restored.yaw).toBeCloseTo(1.25, 5);
    expect(restored.pitch).toBeCloseTo(-0.4, 5);
    expect(restored.flying).toBe(true);
    expect(await game.inventory(page)).toEqual(inventoryBefore);
    expect(log.errors).toEqual([]);
  });

  test('leaving a world saves it without an explicit save', async ({ page }) => {
    await openGame(page);
    await createWorld(page, { name: 'Autosaved', seed: 'persist' });
    await captureMouse(page);
    const { broken, placed } = await makeEdits(page);

    await quitToMenu(page);
    await page.reload();
    await waitForScreen(page, 'menu');
    await page.click(tid('menu-continue'));
    await waitUntilPlaying(page);

    expect(await game.getBlock(page, broken.x, broken.y, broken.z)).toBe(Block.Air);
    expect(await game.getBlock(page, placed.x, placed.y, placed.z)).toBe(Block.Brick);
  });

  test('the game mode and survival inventory are saved', async ({ page }) => {
    await openGame(page);
    await createWorld(page, { name: 'Survivor', seed: 'persist', mode: 'survival' });
    await captureMouse(page);
    await aimAtGround(page);
    await clickWorld(page, 'right');
    await expect
      .poll(async () => (await game.inventory(page)).slots[0])
      .toEqual({ block: Block.Planks, count: 31 });

    await quitToMenu(page);
    await page.reload();
    await waitForScreen(page, 'menu');
    await page.click(tid('menu-continue'));
    await waitUntilPlaying(page);

    await expect(page.locator('.hud__mode')).toHaveText('Survival');
    expect((await game.inventory(page)).slots[0]).toEqual({ block: Block.Planks, count: 31 });
  });

  test('Reset World discards edits but keeps the terrain', async ({ page }) => {
    await openGame(page);
    await createWorld(page, { name: 'Resettable', seed: 'persist' });
    await captureMouse(page);
    const original = await aimAtGround(page, 0, -0.8);
    const { broken, placed } = await makeEdits(page);
    const worldId = await game.worldId(page);

    await pauseGame(page);
    const reset = page.locator(tid('pause-reset'));
    await reset.click();
    // Destructive actions ask for a second click.
    await expect(reset).toHaveText('Discard all changes?');
    expect(await game.screen(page)).toBe('paused');
    await reset.click();
    await waitUntilPlaying(page);

    expect(await game.worldId(page)).toBe(worldId);
    expect((await game.stats(page)).seed).toBe('persist');
    expect(await game.getBlock(page, broken.x, broken.y, broken.z)).toBe(original.block);
    expect(await game.getBlock(page, placed.x, placed.y, placed.z)).toBe(Block.Air);
  });

  test('New Terrain regenerates the world from a different seed', async ({ page }) => {
    await openGame(page);
    await createWorld(page, { name: 'Regenerated', seed: 'persist' });
    await captureMouse(page);
    const { placed } = await makeEdits(page);
    const worldId = await game.worldId(page);

    await pauseGame(page);
    const regenerate = page.locator(tid('pause-regenerate'));
    await regenerate.click();
    await expect(regenerate).toHaveText('Replace with new seed?');
    await regenerate.click();
    await waitUntilPlaying(page);

    expect(await game.worldId(page)).toBe(worldId);
    const seed = (await game.stats(page)).seed;
    expect(seed).not.toBe('persist');
    expect(seed.length).toBeGreaterThan(0);

    // The new seed is what gets saved.
    await quitToMenu(page);
    await page.click(tid('menu-worlds'));
    await waitForScreen(page, 'worlds');
    await expect(page.locator('.world__meta')).toContainText(`Seed ${seed}`);
    // Edits from the old terrain are gone from storage.
    await page.click(tid('world-play'));
    await waitUntilPlaying(page);
    const column = await page.evaluate(
      ([x, y, z]) => window.__visionmine.getBlock(x!, y!, z!),
      [placed.x, placed.y, placed.z],
    );
    expect(column).not.toBe(Block.Brick);
  });
});
