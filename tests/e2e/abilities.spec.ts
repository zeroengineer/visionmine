import { expect, test, type Page } from '@playwright/test';
import {
  captureMouse,
  clickWorld,
  createWorld,
  game,
  openGame,
  pauseGame,
  resumeGame,
  tid,
  waitForScreen,
} from './helpers';

/** Places one block on the ground a couple of blocks north (-Z) and returns its cell. */
async function placeBlockAhead(page: Page) {
  await game.look(page, 0, -0.55);
  const ground = await game.target(page);
  expect(ground).not.toBeNull();
  await clickWorld(page, 'right');
  const cell = { x: ground!.x + ground!.nx, y: ground!.y + ground!.ny, z: ground!.z + ground!.nz };
  await expect.poll(() => game.getBlock(page, cell.x, cell.y, cell.z)).not.toBe(0);
  return cell;
}

/** Builds a two-block pillar ahead and puts the player on top of it. */
async function standOnPillar(page: Page) {
  const base = await placeBlockAhead(page);
  await game.look(page, 0, -0.2);
  expect(await game.target(page)).toMatchObject({ x: base.x, y: base.y, z: base.z, ny: 1 });
  await clickWorld(page, 'right');
  await expect.poll(() => game.getBlock(page, base.x, base.y + 1, base.z)).not.toBe(0);
  const top = base.y + 2;
  await game.teleport(page, base.x + 0.5, top, base.z + 0.5);
  await expect.poll(async () => (await game.player(page)).onGround).toBe(true);
  expect((await game.player(page)).y).toBe(top);
  return { top, cell: base };
}

/**
 * Drops the player from a height, presses jump in mid-fall and returns how far
 * above the press point the player then rose (0 when the fall just continued).
 * Height is sampled every frame inside the page, so nothing is missed.
 */
async function riseAfterJumpWhileFalling(page: Page): Promise<number> {
  const start = await game.player(page);
  await game.teleport(page, start.x, start.y + 30, start.z);
  await expect.poll(async () => (await game.player(page)).y).toBeLessThan(start.y + 29);
  const sampling = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const first = window.__visionmine.player()!.y;
        let highest = first;
        const began = performance.now();
        const sample = (): void => {
          highest = Math.max(highest, window.__visionmine.player()!.y);
          if (performance.now() - began < 700) requestAnimationFrame(sample);
          else resolve(highest - first);
        };
        requestAnimationFrame(sample);
      }),
  );
  await page.keyboard.down('Space');
  const rise = await sampling;
  await page.keyboard.up('Space');
  return rise;
}

test.describe('movement abilities in creative mode', () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
    await createWorld(page, { seed: 'abilities' });
    await captureMouse(page);
  });

  test('sneaking keeps the player on a ledge', async ({ page }) => {
    const { top, cell } = await standOnPillar(page);
    await game.look(page, 0, 0);

    await page.keyboard.down('KeyC');
    await expect.poll(async () => (await game.player(page)).sneaking).toBe(true);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2500);
    const held = await game.player(page);
    expect(held.y).toBe(top);
    expect(held.onGround).toBe(true);
    // The player moved to the north edge and stopped with the body (half-width
    // 0.3) overhanging as far as it can while still resting on the block.
    expect(held.z).toBeGreaterThan(cell.z - 0.3);
    expect(held.z).toBeLessThan(cell.z - 0.2);

    // Letting go of sneak while still walking steps off.
    await page.keyboard.up('KeyC');
    await expect.poll(async () => (await game.player(page)).y).toBeLessThan(top);
    await page.keyboard.up('KeyW');
  });

  test('a second jump is available in mid-air', async ({ page }) => {
    expect(await riseAfterJumpWhileFalling(page)).toBeGreaterThan(0.5);
    expect((await game.player(page)).flying).toBe(false);
    await expect.poll(async () => (await game.player(page)).onGround).toBe(true);
  });

  test('dash moves the player forward in a burst', async ({ page }) => {
    await game.look(page, Math.PI, 0); // face +Z, away from anything built
    const start = await game.player(page);
    await page.keyboard.press('KeyR');
    await expect.poll(async () => (await game.player(page)).z - start.z).toBeGreaterThan(2);
    // It is a burst, not continuous movement.
    await expect
      .poll(async () => {
        const a = await game.player(page);
        await page.waitForTimeout(200);
        const b = await game.player(page);
        return Math.abs(b.z - a.z);
      })
      .toBeLessThan(0.01);
    expect((await game.player(page)).z - start.z).toBeLessThan(8);
  });

  test('the wheel changes flying speed while sprint is held', async ({ page }) => {
    await page.keyboard.press('KeyF');
    await expect.poll(async () => (await game.player(page)).flying).toBe(true);
    const selected = (await game.inventory(page)).selected;

    await page.keyboard.down('ShiftLeft');
    await page.mouse.wheel(0, -40);
    await expect(page.locator(tid('hud-notice'))).toHaveText('Fly speed 1.25×');
    await page.mouse.wheel(0, 40);
    await page.mouse.wheel(0, 40);
    await expect(page.locator(tid('hud-notice'))).toHaveText('Fly speed 0.75×');
    await page.keyboard.up('ShiftLeft');
    // The hotbar selection was left alone…
    expect((await game.inventory(page)).selected).toBe(selected);

    // …and without sprint the wheel selects slots as before.
    await page.mouse.wheel(0, 40);
    await expect.poll(async () => (await game.inventory(page)).selected).toBe(selected + 1);
  });

  test('auto-jump climbs a block once it is switched on in Settings', async ({ page }) => {
    const block = await placeBlockAhead(page);
    const start = await game.player(page);
    await game.look(page, 0, 0);

    // Off by default: the block stops the player.
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2000);
    await page.keyboard.up('KeyW');
    const blocked = await game.player(page);
    expect(blocked.y).toBe(start.y);
    expect(blocked.z).toBeGreaterThan(block.z + 1);

    await pauseGame(page);
    await page
      .getByRole('dialog', { name: 'Game paused' })
      .getByRole('button', { name: 'Settings' })
      .click();
    await waitForScreen(page, 'settings');
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('tab', { name: 'Controls' }).click();
    await settings.getByRole('switch', { name: /Auto-jump/ }).check();
    await page.click(tid('settings-done'));
    await waitForScreen(page, 'paused');
    await resumeGame(page);

    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await game.player(page)).y).toBe(start.y + 1);
    await page.keyboard.up('KeyW');
    expect((await game.player(page)).flying).toBe(false);
  });
});

test('survival mode has no dash or air jump', async ({ page }) => {
  await openGame(page);
  await createWorld(page, { seed: 'abilities', mode: 'survival' });
  await captureMouse(page);
  const start = await game.player(page);

  await page.keyboard.press('KeyR');
  await page.waitForTimeout(600);
  const afterDash = await game.player(page);
  expect(Math.hypot(afterDash.x - start.x, afterDash.z - start.z)).toBeLessThan(0.01);

  // Pressing jump while falling does nothing: the player only ever goes down.
  expect(await riseAfterJumpWhileFalling(page)).toBeLessThan(0.001);
});
