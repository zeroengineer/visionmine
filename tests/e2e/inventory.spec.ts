import { expect, test, type Page } from '@playwright/test';
import { Block, captureMouse, createWorld, game, openGame, waitForScreen } from './helpers';

const hotbarSlots = (page: Page) => page.locator('.hotbar .hotbar__slot');
const bagSlots = (page: Page) => page.locator('.inv__grid:not(.inv__grid--hotbar) .slot');
const inventoryHotbarSlots = (page: Page) => page.locator('.inv__grid--hotbar .slot');

/** Inventory slots react to mousedown, so press and release without waiting for a click. */
async function pressSlot(page: Page, slot: ReturnType<typeof bagSlots>, right = false) {
  await slot.hover();
  await page.mouse.down({ button: right ? 'right' : 'left' });
  await page.mouse.up({ button: right ? 'right' : 'left' });
}

async function openInventory(page: Page): Promise<void> {
  await page.keyboard.press('KeyE');
  await waitForScreen(page, 'inventory');
  await expect(page.getByRole('dialog', { name: 'Inventory' })).toBeVisible();
}

test.describe('hotbar and inventory', () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
    await createWorld(page, { seed: 'inventory' });
    await captureMouse(page);
  });

  test('number keys and the mouse wheel select hotbar slots', async ({ page }) => {
    await expect(hotbarSlots(page)).toHaveCount(9);
    await expect(hotbarSlots(page).nth(0)).toHaveClass(/is-selected/);

    await page.keyboard.press('Digit5');
    await expect.poll(async () => (await game.inventory(page)).selected).toBe(4);
    await expect(hotbarSlots(page).nth(4)).toHaveClass(/is-selected/);
    await expect(hotbarSlots(page).nth(0)).not.toHaveClass(/is-selected/);
    await expect(page.locator('.hotbar__label')).toHaveText('Planks');

    // One wheel notch moves one slot; scrolling down goes to the next slot.
    await page.mouse.wheel(0, 40);
    await expect.poll(async () => (await game.inventory(page)).selected).toBe(5);
    await page.mouse.wheel(0, -40);
    await page.mouse.wheel(0, -40);
    await expect.poll(async () => (await game.inventory(page)).selected).toBe(3);

    // Selection wraps around both ends.
    await page.keyboard.press('Digit9');
    await page.mouse.wheel(0, 40);
    await expect.poll(async () => (await game.inventory(page)).selected).toBe(0);
    await page.mouse.wheel(0, -40);
    await expect.poll(async () => (await game.inventory(page)).selected).toBe(8);
  });

  test('E opens and closes the inventory and releases the mouse', async ({ page }) => {
    await openInventory(page);
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
    await expect(page.locator('.inv .badge')).toHaveText('Creative');
    await expect(bagSlots(page)).toHaveCount(27);
    await expect(inventoryHotbarSlots(page)).toHaveCount(9);

    // Gameplay input is suspended while the inventory is open.
    const before = await game.player(page);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(500);
    await page.keyboard.up('KeyW');
    const after = await game.player(page);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.01);

    await page.keyboard.press('KeyE');
    await waitForScreen(page, 'playing');
    await expect(page.getByRole('dialog', { name: 'Inventory' })).toBeHidden();
  });

  test('Escape and the close button also close the inventory', async ({ page }) => {
    await openInventory(page);
    await page.keyboard.press('Escape');
    await waitForScreen(page, 'playing');

    await captureMouse(page);
    await openInventory(page);
    await page.getByRole('button', { name: /Close/ }).click();
    await waitForScreen(page, 'playing');
  });

  test('palette blocks can be placed in slots and stacks moved between slots', async ({ page }) => {
    await openInventory(page);

    // Palette → empty backpack slot.
    await page.getByRole('button', { name: 'Sand', exact: true }).click();
    await expect(page.locator('.slot--cursor')).toBeVisible();
    await pressSlot(page, bagSlots(page).nth(0));
    await expect
      .poll(async () => (await game.inventory(page)).slots[9])
      .toEqual({ block: Block.Sand, count: 64 });
    await expect(page.locator('.slot--cursor')).toBeHidden();

    // Pick the stack up and swap it with hotbar slot 1.
    await pressSlot(page, bagSlots(page).nth(0));
    await expect.poll(async () => (await game.inventory(page)).slots[9]).toBeNull();
    await pressSlot(page, inventoryHotbarSlots(page).nth(0));
    await expect
      .poll(async () => (await game.inventory(page)).slots[0])
      .toEqual({ block: Block.Sand, count: 64 });
    // The grass that was there is now carried; drop it in another backpack slot.
    await pressSlot(page, bagSlots(page).nth(5));
    await expect
      .poll(async () => (await game.inventory(page)).slots[14])
      .toEqual({ block: Block.Grass, count: 64 });

    // Right-click takes half of a stack.
    await pressSlot(page, bagSlots(page).nth(5), true);
    await expect
      .poll(async () => (await game.inventory(page)).slots[14])
      .toEqual({ block: Block.Grass, count: 32 });
    // Right-click with a carried stack drops a single item.
    await pressSlot(page, bagSlots(page).nth(6), true);
    await expect
      .poll(async () => (await game.inventory(page)).slots[15])
      .toEqual({ block: Block.Grass, count: 1 });

    // Closing with a stack still on the pointer returns it to the inventory.
    await page.keyboard.press('KeyE');
    await waitForScreen(page, 'playing');
    const { slots } = await game.inventory(page);
    const grass = slots.reduce(
      (sum, slot) => sum + (slot?.block === Block.Grass ? slot.count : 0),
      0,
    );
    expect(grass).toBe(64);

    // The hotbar on the HUD shows the new block.
    await expect(hotbarSlots(page).nth(0)).toHaveAttribute('title', 'Sand');
  });

  test('the backpack can be expanded up to its maximum', async ({ page }) => {
    await openInventory(page);
    const expand = page.getByRole('button', { name: /backpack/i });
    await expect(page.locator('.inv__capacity')).toHaveText('27 slots');

    await expand.click();
    await expect(page.locator('.inv__capacity')).toHaveText('36 slots');
    await expect(bagSlots(page)).toHaveCount(36);
    expect((await game.inventory(page)).slots).toHaveLength(45);

    for (let i = 0; i < 6 && (await expand.isEnabled()); i++) await expand.click();
    await expect(expand).toBeDisabled();
    await expect(expand).toHaveText('Backpack at max size');
  });
});

test('survival inventory hides the creative palette and shows counts', async ({ page }) => {
  await openGame(page);
  await createWorld(page, { seed: 'inventory', mode: 'survival' });
  await captureMouse(page);

  await expect(page.locator('.hotbar .hotbar__slot').nth(0).locator('.slot__count')).toHaveText(
    '32',
  );
  await openInventory(page);
  await expect(page.locator('.inv .badge')).toHaveText('Survival');
  await expect(page.getByRole('heading', { name: 'Block palette' })).toBeHidden();
});
