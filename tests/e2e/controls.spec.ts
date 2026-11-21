import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  aimAtGround,
  Block,
  captureMouse,
  clickWorld,
  createWorld,
  game,
  openGame,
  SETTINGS_KEY,
  tid,
  waitForScreen,
} from './helpers';

const settingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Settings' });

/** Opens Settings → Controls from the main menu. */
async function openControls(page: Page): Promise<Locator> {
  await page.click(tid('menu-settings'));
  await waitForScreen(page, 'settings');
  const dialog = settingsDialog(page);
  await dialog.getByRole('tab', { name: 'Controls' }).click();
  await expect(dialog.locator(tid('bindings'))).toBeVisible();
  return dialog;
}

const cap = (dialog: Locator, action: string, slot = 0) =>
  dialog.locator(`.keycap[data-action="${action}"][data-slot="${slot}"]`);

const storedBindings = (page: Page) =>
  page.evaluate(
    (key) =>
      (JSON.parse(localStorage.getItem(key) ?? '{}') as { bindings?: Record<string, string[]> })
        .bindings,
    SETTINGS_KEY,
  );

async function closeSettings(page: Page): Promise<void> {
  await page.click(tid('settings-done'));
  await waitForScreen(page, 'menu');
}

test.describe('controls in settings', () => {
  test('every action is listed with its default keys', async ({ page }) => {
    await openGame(page);
    const dialog = await openControls(page);

    await expect(cap(dialog, 'moveForward')).toHaveText('W');
    await expect(cap(dialog, 'moveForward', 1)).toHaveText('↑');
    await expect(cap(dialog, 'jump')).toHaveText('Space');
    await expect(cap(dialog, 'jump', 1)).toHaveText('—');
    await expect(cap(dialog, 'breakBlock')).toHaveText('Left click');
    await expect(cap(dialog, 'placeBlock')).toHaveText('Right click');
    await expect(cap(dialog, 'inventory')).toHaveText('E');
    await expect(cap(dialog, 'debugOverlay')).toHaveText('F3');
    await expect(dialog.locator('[data-binding-row]')).toHaveCount(15);

    // Controls that cannot be changed are shown but are not buttons.
    const fixed = dialog.locator('.bindings__row--fixed');
    await expect(fixed).toHaveCount(3);
    await expect(fixed.filter({ hasText: 'Pause' })).toContainText('Esc');
    await expect(fixed.locator('button')).toHaveCount(0);
  });

  test('a rebound key takes effect in the game and survives a reload', async ({ page }) => {
    await openGame(page);
    const dialog = await openControls(page);

    await cap(dialog, 'jump').click();
    await expect(cap(dialog, 'jump')).toHaveText('Press a key…');
    await page.keyboard.press('KeyJ');
    await expect(cap(dialog, 'jump')).toHaveText('J');
    await expect(dialog.locator('.bindings__status')).toContainText('is now J');
    expect((await storedBindings(page))?.jump).toEqual(['KeyJ']);

    // The menu's controls list follows the binding.
    await closeSettings(page);
    const menuControls = page.locator(tid('menu-controls'));
    await expect(menuControls.locator('dt', { hasText: /^J$/ })).toHaveCount(1);
    await expect(menuControls.locator('dt', { hasText: /^Space$/ })).toHaveCount(0);

    await page.reload();
    await waitForScreen(page, 'menu');
    await expect(menuControls.locator('dt', { hasText: /^J$/ })).toHaveCount(1);

    await createWorld(page, { seed: 'controls' });
    await captureMouse(page);
    const start = await game.player(page);

    // The old key no longer jumps…
    await page.keyboard.down('Space');
    await page.waitForTimeout(700);
    await page.keyboard.up('Space');
    const afterSpace = await game.player(page);
    expect(afterSpace.y).toBeCloseTo(start.y, 3);
    expect(afterSpace.onGround).toBe(true);

    // …and the new one does.
    await page.keyboard.down('KeyJ');
    await expect.poll(async () => (await game.player(page)).y).toBeGreaterThan(start.y + 0.5);
    await page.keyboard.up('KeyJ');
  });

  test('binding a key that is in use swaps the two actions', async ({ page }) => {
    await openGame(page);
    const dialog = await openControls(page);

    await cap(dialog, 'inventory').click();
    await page.keyboard.press('KeyF');
    await expect(cap(dialog, 'inventory')).toHaveText('F');
    await expect(cap(dialog, 'toggleFly')).toHaveText('E');
    await expect(dialog.locator('.bindings__status')).toContainText('Toggle flying');
    await expect(dialog.locator('.bindings__status')).toContainText('swapped');

    await closeSettings(page);
    await createWorld(page, { seed: 'controls' });
    await captureMouse(page);

    // F now opens the inventory and E toggles flying.
    await page.keyboard.press('KeyE');
    await expect.poll(async () => (await game.player(page)).flying).toBe(true);
    expect(await game.screen(page)).toBe('playing');
    await page.keyboard.press('KeyF');
    await waitForScreen(page, 'inventory');
    await page.keyboard.press('KeyF');
    await waitForScreen(page, 'playing');
  });

  test('mouse buttons and keys can be exchanged', async ({ page }) => {
    await openGame(page);
    const dialog = await openControls(page);

    // Put "break block" on a key: the capture consumes the key press.
    await cap(dialog, 'breakBlock').click();
    await page.keyboard.press('KeyB');
    await expect(cap(dialog, 'breakBlock')).toHaveText('B');

    // Put "jump" on the left mouse button, pressed over an unrelated button:
    // the press becomes the binding and must not activate what is under it.
    await cap(dialog, 'jump').click();
    await dialog.getByRole('button', { name: 'Restore defaults' }).hover();
    await page.mouse.down();
    await page.mouse.up();
    await expect(cap(dialog, 'jump')).toHaveText('Left click');
    await expect(cap(dialog, 'breakBlock')).toHaveText('B');
    expect(await game.screen(page)).toBe('settings');

    await closeSettings(page);
    await createWorld(page, { seed: 'controls' });
    await captureMouse(page);

    const target = await aimAtGround(page);
    await page.keyboard.press('KeyB');
    await expect.poll(() => game.getBlock(page, target.x, target.y, target.z)).toBe(Block.Air);

    // The click that captured the mouse may itself have counted as a jump, so let
    // that settle: two presses close together would toggle flying instead.
    await page.waitForTimeout(600);
    await expect.poll(async () => (await game.player(page)).onGround).toBe(true);
    const start = await game.player(page);
    await page.mouse.down();
    await expect.poll(async () => (await game.player(page)).y).toBeGreaterThan(start.y + 0.5);
    await page.mouse.up();
    expect((await game.player(page)).flying).toBe(false);
    // The left button no longer breaks blocks.
    await expect.poll(async () => (await game.player(page)).onGround).toBe(true);
    const next = await aimAtGround(page);
    await clickWorld(page, 'left');
    await page.waitForTimeout(300);
    expect(await game.getBlock(page, next.x, next.y, next.z)).not.toBe(Block.Air);
  });

  test('Escape cancels, Backspace removes and reserved keys are refused', async ({ page }) => {
    await openGame(page);
    const dialog = await openControls(page);

    await cap(dialog, 'sprint').click();
    await page.keyboard.press('Escape');
    await expect(cap(dialog, 'sprint')).toHaveText('Shift');
    // Escape was consumed by the capture and did not close Settings.
    expect(await game.screen(page)).toBe('settings');

    await cap(dialog, 'sprint').click();
    await page.keyboard.press('Digit4');
    await expect(dialog.locator('.bindings__status')).toContainText('cannot be used');
    await expect(cap(dialog, 'sprint')).toHaveText('Press a key…');
    await page.keyboard.press('Escape');

    await cap(dialog, 'sprint', 1).click();
    await page.keyboard.press('Backspace');
    await expect(cap(dialog, 'sprint', 1)).toHaveText('—');
    await cap(dialog, 'sprint').click();
    await page.keyboard.press('Backspace');
    await expect(cap(dialog, 'sprint')).toHaveText('—');
    await expect(cap(dialog, 'sprint')).toHaveClass(/is-unbound/);
    expect((await storedBindings(page))?.sprint).toEqual([]);

    // Outside a capture, Escape leaves the screen as before.
    await page.keyboard.press('Escape');
    await waitForScreen(page, 'menu');
  });

  test('Reset controls restores the defaults', async ({ page }) => {
    await openGame(page);
    const dialog = await openControls(page);

    await cap(dialog, 'jump').click();
    await page.keyboard.press('KeyJ');
    await cap(dialog, 'inventory').click();
    await page.keyboard.press('KeyI');
    await expect(cap(dialog, 'inventory')).toHaveText('I');

    await dialog.locator(tid('controls-reset')).click();
    await expect(cap(dialog, 'jump')).toHaveText('Space');
    await expect(cap(dialog, 'inventory')).toHaveText('E');
    await expect(dialog.locator('.bindings__status')).toContainText('defaults');
    expect((await storedBindings(page))?.jump).toEqual(['Space']);
  });
});
