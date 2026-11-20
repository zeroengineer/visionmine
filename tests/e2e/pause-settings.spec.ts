import { expect, test, type Page } from '@playwright/test';
import {
  captureMouse,
  createWorld,
  game,
  openGame,
  pauseGame,
  resumeGame,
  SETTINGS_KEY,
  tid,
  waitForScreen,
} from './helpers';

const storedSettings = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>,
    SETTINGS_KEY,
  );

test.describe('pause menu', () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
    await createWorld(page, { name: 'Pause World', seed: 'pause' });
    await captureMouse(page);
  });

  test('Escape pauses, freezes the simulation and Resume continues it', async ({ page }) => {
    // Start a fall so that a frozen simulation is observable.
    const start = await game.player(page);
    await page.keyboard.press('KeyF');
    await expect.poll(async () => (await game.player(page)).flying).toBe(true);
    await game.teleport(page, start.x, start.y + 60, start.z);
    await page.keyboard.press('KeyF');
    await expect.poll(async () => (await game.player(page)).y).toBeLessThan(start.y + 59.5);

    await pauseGame(page);
    await expect(page.getByRole('dialog', { name: 'Game paused' })).toBeVisible();
    await expect(page.locator('.pause__world')).toHaveText('Pause World · seed pause');
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();

    const frozen = await game.player(page);
    const frozenTime = (await game.stats(page)).timeOfDay;
    expect(frozen.onGround).toBe(false);
    await page.waitForTimeout(1500);
    const still = await game.player(page);
    expect(still.y).toBe(frozen.y);
    // The world clock stops too (one in-game minute is half a real second).
    expect((await game.stats(page)).timeOfDay).toBe(frozenTime);

    await resumeGame(page);
    await expect(page.getByRole('dialog', { name: 'Game paused' })).toBeHidden();
    await expect.poll(async () => (await game.player(page)).onGround).toBe(true);
  });

  test('Escape on the pause menu resumes', async ({ page }) => {
    await pauseGame(page);
    // An Escape that arrives immediately after pausing is ignored (debounce).
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await waitForScreen(page, 'playing');
  });

  test('Save Now stores the world and reports it', async ({ page }) => {
    await pauseGame(page);
    await page.click(tid('pause-save'));
    await expect(page.locator('.toast', { hasText: 'World saved.' })).toBeVisible();
    await expect(page.locator('.pause__save')).toHaveText('All changes saved');
  });

  test('the game mode can be switched while paused', async ({ page }) => {
    await page.keyboard.press('KeyF');
    await expect.poll(async () => (await game.player(page)).flying).toBe(true);

    await pauseGame(page);
    const dialog = page.getByRole('dialog', { name: 'Game paused' });
    await dialog.getByRole('radio', { name: 'Survival' }).click();
    await expect(dialog.getByRole('radio', { name: 'Survival' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await resumeGame(page);

    await expect(page.locator('.hud__mode')).toHaveText('Survival');
    // Survival has no flight: the player drops out of it.
    expect((await game.player(page)).flying).toBe(false);
  });

  test('Save & Quit returns to the menu and offers to continue', async ({ page }) => {
    const id = await game.worldId(page);
    await pauseGame(page);
    await page.click(tid('pause-quit'));
    await waitForScreen(page, 'menu');

    await expect(page.locator(tid('hud'))).toBeHidden();
    await expect(page.locator(tid('menu-continue'))).toBeVisible();
    await expect(page.locator('.menu__detail')).toHaveText('Pause World');

    await page.click(tid('menu-continue'));
    await waitForScreen(page, 'playing', 90_000);
    expect(await game.worldId(page)).toBe(id);
  });
});

test.describe('settings', () => {
  test('changes apply immediately and survive a reload', async ({ page }) => {
    await openGame(page);
    await createWorld(page, { seed: 'settings' });
    await captureMouse(page);
    // Let the initial area finish streaming so chunk counts are comparable.
    await expect
      .poll(async () => (await game.stats(page)).loadedChunks, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(81);
    const loadedAtThree = (await game.stats(page)).loadedChunks;

    await pauseGame(page);
    await page
      .getByRole('dialog', { name: 'Game paused' })
      .getByRole('button', { name: 'Settings' })
      .click();
    await waitForScreen(page, 'settings');
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible();

    await settings.getByLabel('Render distance').fill('5');
    await settings.getByLabel('Field of view').fill('90');
    await settings.getByLabel('Invert vertical look').check();
    await settings.getByLabel(/Debug overlay/).check();
    await expect(settings.locator('output', { hasText: '5 chunks' })).toBeVisible();
    await expect(settings.locator('output', { hasText: '90°' })).toBeVisible();

    expect(await storedSettings(page)).toMatchObject({
      renderDistance: 5,
      fov: 90,
      invertY: true,
      showDebug: true,
    });

    await page.click(tid('settings-done'));
    await waitForScreen(page, 'paused');
    await resumeGame(page);

    // A longer render distance streams in the chunks of the wider radius
    // (149 chunks lie within 5 + 2 of the player).
    await expect
      .poll(async () => (await game.stats(page)).loadedChunks, { timeout: 60_000 })
      .toBeGreaterThanOrEqual(149);
    expect(loadedAtThree).toBeLessThan(149);
    await expect(page.locator(tid('debug'))).toBeVisible();
    await expect(page.locator(tid('debug'))).toContainText('Seed settings');

    await page.reload();
    await waitForScreen(page, 'menu');
    await page.click(tid('menu-settings'));
    await waitForScreen(page, 'settings');
    await expect(settings.getByLabel('Render distance')).toHaveValue('5');
    await expect(settings.getByLabel('Field of view')).toHaveValue('90');
    await expect(settings.getByLabel('Invert vertical look')).toBeChecked();

    // Restore defaults clears the stored settings.
    await settings.getByRole('button', { name: 'Restore defaults' }).click();
    await expect(settings.getByLabel('Field of view')).toHaveValue('75');
    await expect(settings.getByLabel('Invert vertical look')).not.toBeChecked();
    expect(await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY)).toBeNull();

    await page.click(tid('settings-done'));
    await waitForScreen(page, 'menu');
  });

  test('F3 toggles the debug overlay', async ({ page }) => {
    await openGame(page);
    await createWorld(page, { seed: 'settings' });
    await captureMouse(page);

    await expect(page.locator(tid('debug'))).toBeHidden();
    await page.keyboard.press('F3');
    await expect(page.locator(tid('debug'))).toBeVisible();
    await expect(page.locator(tid('debug'))).toContainText(/\d+ fps/);
    await expect(page.locator(tid('debug'))).toContainText('XYZ');
    await page.keyboard.press('F3');
    await expect(page.locator(tid('debug'))).toBeHidden();
  });
});
