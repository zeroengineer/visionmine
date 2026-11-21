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
  test('a save written before block state existed still loads', async ({ page }) => {
    await openGame(page);
    await createWorld(page, { name: 'Legacy', seed: 'persist' });
    const worldId = (await game.worldId(page))!;
    const player = await game.player(page);
    // A free cell a few blocks above the player's head.
    const cell = { x: Math.floor(player.x), y: Math.floor(player.y) + 4, z: Math.floor(player.z) };
    expect(await game.getBlock(page, cell.x, cell.y, cell.z)).toBe(Block.Air);
    await quitToMenu(page);

    // Rewrite storage the way the first release left it: world record at
    // version 1 and a chunk row without `format`, packed as `index << 8 | id`.
    await page.evaluate(
      ([id, c, brick]) =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('visionmine');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction(['worlds', 'chunks'], 'readwrite');
            const worlds = tx.objectStore('worlds');
            const get = worlds.get(id);
            get.onsuccess = () => worlds.put({ ...get.result, version: 1 });
            const chunkKey = ((c.x >> 4) + 0x8000) * 0x10000 + ((c.z >> 4) + 0x8000);
            const index = (c.x & 15) + (c.z & 15) * 16 + c.y * 256;
            tx.objectStore('chunks').put({
              key: `${id}:${chunkKey}`,
              worldId: id,
              chunkKey,
              data: new Uint32Array([(index << 8) | brick]),
            });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      [worldId, cell, Block.Brick] as const,
    );

    await page.reload();
    await waitForScreen(page, 'menu');
    await page.click(tid('menu-continue'));
    await waitUntilPlaying(page);
    expect(await game.worldId(page)).toBe(worldId);
    expect(await game.getBlock(page, cell.x, cell.y, cell.z)).toBe(Block.Brick);
    expect(
      await page.evaluate(
        ([x, y, z]) => window.__visionmine.getMeta(x!, y!, z!),
        [cell.x, cell.y, cell.z],
      ),
    ).toBe(0);

    // New edits are saved in the current format. The old row is rewritten only
    // when its own chunk is next saved, so it may still be in the old layout.
    await captureMouse(page);
    await makeEdits(page);
    await game.save(page);
    const rows = await page.evaluate(
      (id) =>
        new Promise<Array<{ format?: number; entries: number }>>((resolve, reject) => {
          const open = indexedDB.open('visionmine');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const request = db
              .transaction('chunks', 'readonly')
              .objectStore('chunks')
              .index('worldId')
              .getAll(id);
            request.onsuccess = () => {
              db.close();
              resolve(
                (request.result as Array<{ format?: number; data: Uint32Array }>).map((row) => ({
                  format: row.format,
                  entries: row.data.length,
                })),
              );
            };
            request.onerror = () => reject(request.error);
          };
        }),
      worldId,
    );
    expect(rows.some((row) => row.format === 2)).toBe(true);
    expect(rows.every((row) => row.format === 2 || row.format === undefined)).toBe(true);
    // The old edit plus the two new ones, none lost or duplicated.
    expect(rows.reduce((sum, row) => sum + row.entries, 0)).toBe(3);

    await page.reload();
    await waitForScreen(page, 'menu');
    await page.click(tid('menu-continue'));
    await waitUntilPlaying(page);
    expect(await game.getBlock(page, cell.x, cell.y, cell.z)).toBe(Block.Brick);
  });
});
