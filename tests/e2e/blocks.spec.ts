import { expect, test } from '@playwright/test';
import {
  aimAtGround,
  Block,
  captureMouse,
  clickWorld,
  createWorld,
  game,
  openGame,
} from './helpers';

test.describe('block interaction in creative mode', () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
    await createWorld(page, { seed: 'blocks' });
    await captureMouse(page);
  });

  test('breaks the targeted block and places one on the targeted face', async ({ page }) => {
    const target = await aimAtGround(page);
    expect(target.block).not.toBe(Block.Air);
    expect(target.ny).toBe(1);

    await clickWorld(page, 'left');
    await expect.poll(() => game.getBlock(page, target.x, target.y, target.z)).toBe(Block.Air);

    // The crosshair now passes through the hole and reaches a block behind it.
    const below = await aimAtGround(page);
    expect({ x: below.x, y: below.y, z: below.z }).not.toEqual({
      x: target.x,
      y: target.y,
      z: target.z,
    });

    await page.keyboard.press('Digit8');
    await expect.poll(async () => (await game.inventory(page)).selected).toBe(7);
    await clickWorld(page, 'right');
    const placed = { x: below.x + below.nx, y: below.y + below.ny, z: below.z + below.nz };
    await expect.poll(() => game.getBlock(page, placed.x, placed.y, placed.z)).toBe(Block.Brick);

    // Creative mode never uses blocks up.
    const { slots } = await game.inventory(page);
    expect(slots[7]).toEqual({ block: Block.Brick, count: 64 });
  });

  test('each hotbar block can be placed', async ({ page }) => {
    const ground = await aimAtGround(page);
    const cell = { x: ground.x + ground.nx, y: ground.y + ground.ny, z: ground.z + ground.nz };
    const { slots } = await game.inventory(page);

    for (let slot = 0; slot < 8; slot++) {
      const block = slots[slot]!.block;
      await page.keyboard.press(`Digit${slot + 1}`);
      await game.look(page, 0, -0.8);
      // Aim at the ground block again: the previous placement was removed below.
      await clickWorld(page, 'right');
      await expect.poll(() => game.getBlock(page, cell.x, cell.y, cell.z)).toBe(block);
      // Looking at the same spot now targets the new block; break it.
      const target = await game.target(page);
      expect(target).toMatchObject(cell);
      await clickWorld(page, 'left');
      await expect.poll(() => game.getBlock(page, cell.x, cell.y, cell.z)).toBe(Block.Air);
    }
  });

  test('refuses to place a block inside the player', async ({ page }) => {
    const player = await game.player(page);
    // Straight down: the block under the feet; its top face is where the player stands.
    const target = await aimAtGround(page, 0, -1.55);
    expect(target.y).toBe(Math.floor(player.y) - 1);

    await clickWorld(page, 'right');
    await page.waitForTimeout(400);
    expect(await game.getBlock(page, player.x, player.y, player.z)).toBe(Block.Air);
  });

  test('middle click picks the targeted block', async ({ page }) => {
    const ground = await aimAtGround(page);
    await page.keyboard.press('Digit4');
    await clickWorld(page, 'right');
    const cell = { x: ground.x + ground.nx, y: ground.y + ground.ny, z: ground.z + ground.nz };
    await expect.poll(() => game.getBlock(page, cell.x, cell.y, cell.z)).toBe(Block.Cobblestone);

    await page.keyboard.press('Digit1');
    await expect.poll(async () => (await game.inventory(page)).selected).toBe(0);
    expect(await game.target(page)).toMatchObject({ ...cell, block: Block.Cobblestone });
    await clickWorld(page, 'middle');
    // Cobblestone is already on the hotbar, so picking selects that slot.
    await expect.poll(async () => (await game.inventory(page)).selected).toBe(3);
  });

  test('TNT explodes after its fuse and removes surrounding blocks', async ({ page }) => {
    const ground = await aimAtGround(page, 0, -0.45);
    const tnt = { x: ground.x + ground.nx, y: ground.y + ground.ny, z: ground.z + ground.nz };

    await page.keyboard.press('Digit9');
    await clickWorld(page, 'right');
    await expect.poll(() => game.getBlock(page, tnt.x, tnt.y, tnt.z)).toBe(Block.Tnt);

    // Right-clicking TNT lights it instead of placing another block.
    expect(await game.target(page)).toMatchObject({ ...tnt, block: Block.Tnt });
    await clickWorld(page, 'right');
    await page.waitForTimeout(300);
    expect(await game.getBlock(page, tnt.x, tnt.y, tnt.z)).toBe(Block.Tnt);

    await expect
      .poll(() => game.getBlock(page, tnt.x, tnt.y, tnt.z), { timeout: 20_000 })
      .toBe(Block.Air);
    // The blast carves into the ground it was standing on.
    expect(await game.getBlock(page, ground.x, ground.y, ground.z)).toBe(Block.Air);
    expect(await game.getBlock(page, ground.x, ground.y - 1, ground.z)).toBe(Block.Air);
    // Far-away terrain is untouched.
    expect(await game.getBlock(page, ground.x, ground.y - 6, ground.z - 12)).not.toBe(Block.Air);
  });
});

test.describe('block interaction in survival mode', () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
    await createWorld(page, { seed: 'blocks', mode: 'survival' });
    await captureMouse(page);
  });

  test('placing consumes blocks and mining collects them', async ({ page }) => {
    const before = await game.inventory(page);
    expect(before.slots[0]).toEqual({ block: Block.Planks, count: 32 });

    const ground = await aimAtGround(page);
    await clickWorld(page, 'right');
    const cell = { x: ground.x + ground.nx, y: ground.y + ground.ny, z: ground.z + ground.nz };
    await expect.poll(() => game.getBlock(page, cell.x, cell.y, cell.z)).toBe(Block.Planks);
    expect((await game.inventory(page)).slots[0]).toEqual({ block: Block.Planks, count: 31 });

    // A single click does not break a block in survival; it has to be mined.
    await clickWorld(page, 'left');
    await page.waitForTimeout(300);
    expect(await game.getBlock(page, cell.x, cell.y, cell.z)).toBe(Block.Planks);

    await page.mouse.down({ button: 'left' });
    await expect
      .poll(() => game.getBlock(page, cell.x, cell.y, cell.z), { timeout: 20_000 })
      .toBe(Block.Air);
    await page.mouse.up({ button: 'left' });
    await expect
      .poll(async () => (await game.inventory(page)).slots[0])
      .toEqual({ block: Block.Planks, count: 32 });
  });

  test('flying is not available', async ({ page }) => {
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(300);
    expect((await game.player(page)).flying).toBe(false);
    await expect(page.locator('.hud__mode')).toHaveText('Survival');
  });
});
