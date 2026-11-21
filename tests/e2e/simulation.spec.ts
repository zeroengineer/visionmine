import { expect, test } from '@playwright/test';
import {
  aimAtGround,
  Block,
  captureMouse,
  clickWorld,
  createWorld,
  game,
  layFlatPad,
  openGame,
  waitForScreen,
  waitUntilPlaying,
  tid,
} from './helpers';

test.describe('world simulation', () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
    await createWorld(page, { name: 'Simulated', seed: 'simulation' });
    await captureMouse(page);
    await layFlatPad(page);
  });

  test('sand placed in mid-air falls to the ground', async ({ page }) => {
    const ground = await aimAtGround(page, 0, -0.6);
    const { x, z } = ground;
    const floor = ground.y + 1;
    await game.setBlock(page, x, floor + 5, z, Block.Sand);
    await expect.poll(() => game.getBlock(page, x, floor, z)).toBe(Block.Sand);
    expect(await game.getBlock(page, x, floor + 5, z)).toBe(Block.Air);
    for (let y = floor + 1; y <= floor + 5; y++) {
      expect(await game.getBlock(page, x, y, z)).toBe(Block.Air);
    }
  });

  test('sand comes down when the block holding it up is mined', async ({ page }) => {
    await page.keyboard.press('Digit3'); // stone
    const ground = await aimAtGround(page, 0, -0.6);
    const support = { x: ground.x, y: ground.y + 1, z: ground.z };
    await clickWorld(page, 'right');
    await expect.poll(() => game.getBlock(page, support.x, support.y, support.z)).toBe(Block.Stone);
    await game.setBlock(page, support.x, support.y + 1, support.z, Block.Sand);
    await game.setBlock(page, support.x, support.y + 2, support.z, Block.Sand);
    // Supported sand stays where it is.
    await page.waitForTimeout(500);
    expect(await game.getBlock(page, support.x, support.y + 2, support.z)).toBe(Block.Sand);

    await game.look(page, 0, -0.6);
    expect(await game.target(page)).toMatchObject(support);
    await clickWorld(page, 'left');
    await expect.poll(() => game.getBlock(page, support.x, support.y, support.z)).toBe(Block.Sand);
    await expect
      .poll(() => game.getBlock(page, support.x, support.y + 2, support.z))
      .toBe(Block.Air);
    expect(await game.getBlock(page, support.x, support.y + 1, support.z)).toBe(Block.Sand);
  });

  test('water spreads from where it is placed, stops, and drains when the source goes', async ({
    page,
  }) => {
    await game.hold(page, Block.Water);
    const ground = await aimAtGround(page, 0, -0.45);
    const source = { x: ground.x, y: ground.y + 1, z: ground.z };
    await clickWorld(page, 'right');
    await expect.poll(() => game.getBlock(page, source.x, source.y, source.z)).toBe(Block.Water);

    // Three blocks along it has thinned to level 3.
    await expect
      .poll(() => game.getBlock(page, source.x, source.y, source.z - 3), { timeout: 20_000 })
      .toBe(Block.Water);
    expect(await game.getMeta(page, source.x, source.y, source.z - 3)).toBe(3);
    expect(await game.getMeta(page, source.x, source.y, source.z)).toBe(0);

    // It reaches seven blocks and no further, and never climbs.
    await expect
      .poll(() => game.getBlock(page, source.x, source.y, source.z - 7), { timeout: 30_000 })
      .toBe(Block.Water);
    await page.waitForTimeout(1500);
    expect(await game.getBlock(page, source.x, source.y, source.z - 8)).toBe(Block.Air);
    expect(await game.getBlock(page, source.x, source.y + 1, source.z - 1)).toBe(Block.Air);

    // Plug the source and the rest runs dry.
    await game.setBlock(page, source.x, source.y, source.z, Block.Stone);
    await expect
      .poll(() => game.getBlock(page, source.x, source.y, source.z - 3), { timeout: 30_000 })
      .toBe(Block.Air);
    await expect
      .poll(() => game.getBlock(page, source.x, source.y, source.z - 1), { timeout: 30_000 })
      .toBe(Block.Air);
  });

  test('water that has flowed is still there after a reload', async ({ page }) => {
    await game.hold(page, Block.Water);
    const ground = await aimAtGround(page, 0, -0.45);
    const source = { x: ground.x, y: ground.y + 1, z: ground.z };
    await clickWorld(page, 'right');
    await expect
      .poll(() => game.getBlock(page, source.x, source.y, source.z + 2), { timeout: 20_000 })
      .toBe(Block.Water);
    // Let it finish spreading, then save.
    await expect
      .poll(() => game.getBlock(page, source.x, source.y, source.z - 7), { timeout: 30_000 })
      .toBe(Block.Water);
    await game.save(page);

    await page.reload();
    await waitForScreen(page, 'menu');
    await page.click(tid('menu-continue'));
    await waitUntilPlaying(page);
    expect(await game.getBlock(page, source.x, source.y, source.z)).toBe(Block.Water);
    expect(await game.getBlock(page, source.x, source.y, source.z - 3)).toBe(Block.Water);
    expect(await game.getMeta(page, source.x, source.y, source.z - 3)).toBe(3);
  });
});
