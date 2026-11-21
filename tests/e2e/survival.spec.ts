import { expect, test, type Page } from '@playwright/test';
import {
  Block,
  captureMouse,
  clickWorld,
  createWorld,
  game,
  Item,
  layFlatPad,
  openGame,
  tid,
  waitForScreen,
  waitUntilPlaying,
} from './helpers';

/** Total of an item across the whole inventory. */
async function countItem(page: Page, item: number): Promise<number> {
  const { slots } = await game.inventory(page);
  return slots.reduce((sum, slot) => sum + (slot?.item === item ? slot.count : 0), 0);
}

/** Presses a mouse button on a slot: inventory slots act on mousedown. */
async function press(page: Page, selector: string, right = false): Promise<void> {
  await page.locator(selector).hover();
  await page.mouse.down({ button: right ? 'right' : 'left' });
  await page.mouse.up({ button: right ? 'right' : 'left' });
}

const hotbarSlot = (index: number): string => `.inv__grid--hotbar .slot >> nth=${index}`;
const bagSlot = (index: number): string =>
  `.inv__grid:not(.inv__grid--hotbar) .slot >> nth=${index}`;
const craftCell = (index: number): string => `[data-craft="${index}"]`;

/** Puts a solid block two cells north of the player at foot level and aims at it. */
async function blockAhead(page: Page, block: number) {
  const player = await game.player(page);
  const cell = { x: Math.floor(player.x), y: Math.floor(player.y), z: Math.floor(player.z) - 2 };
  await game.setBlock(page, cell.x, cell.y, cell.z, block);
  await game.look(page, 0, -0.55);
  expect(await game.target(page)).toMatchObject(cell);
  return cell;
}

test.describe('survival', () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
    await createWorld(page, { name: 'Survivor', seed: 'survival', mode: 'survival' });
    await captureMouse(page);
    await layFlatPad(page);
  });

  test('health and hunger are shown, and falling hurts in proportion', async ({ page }) => {
    await expect(page.locator(tid('vitals'))).toBeVisible();
    await expect(page.locator(tid('vital-health'))).toHaveAttribute(
      'aria-label',
      'Health 20 of 20',
    );
    await expect(page.locator(tid('vital-hunger'))).toHaveAttribute(
      'aria-label',
      'Hunger 20 of 20',
    );
    await expect(page.locator(tid('vital-air'))).toBeHidden();

    const start = await game.player(page);
    // A drop of two blocks is free.
    await game.teleport(page, start.x, start.y + 2, start.z);
    await expect.poll(async () => (await game.player(page)).onGround).toBe(true);
    expect((await game.vitals(page)).health).toBe(20);

    // Ten blocks costs seven: one for each block beyond three.
    await game.teleport(page, start.x, start.y + 10, start.z);
    await expect.poll(async () => (await game.vitals(page)).health).toBe(13);
    await expect(page.locator(tid('vital-health'))).toHaveAttribute(
      'aria-label',
      'Health 13 of 20',
    );
    expect((await game.player(page)).y).toBe(start.y);
  });

  test('dying returns the player to the spawn point with their things', async ({ page }) => {
    const spawn = await game.player(page);
    const planks = await countItem(page, Block.Planks);
    await game.setVitals(page, 4, 12);
    await game.teleport(page, spawn.x + 3, spawn.y + 14, spawn.z - 3);

    await expect(page.locator('.toast', { hasText: 'You died' })).toBeVisible();
    await expect.poll(async () => (await game.vitals(page)).health).toBe(20);
    expect((await game.vitals(page)).hunger).toBe(20);
    const after = await game.player(page);
    expect(Math.abs(after.x - spawn.x)).toBeLessThan(1);
    expect(Math.abs(after.z - spawn.z)).toBeLessThan(1);
    expect(await countItem(page, Block.Planks)).toBe(planks);
    expect(await game.screen(page)).toBe('playing');
  });

  test('food is eaten with a right-click, only when hungry', async ({ page }) => {
    await game.give(page, Item.Apple, 3);
    // The apples land in the first free hotbar slot.
    const slot = (await game.inventory(page)).slots.findIndex((s) => s?.item === Item.Apple);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(9);
    await page.keyboard.press(`Digit${slot + 1}`);
    await expect(page.locator('.hotbar__label')).toHaveText('Apple');

    // Not hungry: nothing happens.
    await game.look(page, 0, 0.6);
    await clickWorld(page, 'right');
    await page.waitForTimeout(300);
    expect(await countItem(page, Item.Apple)).toBe(3);

    await game.setVitals(page, 20, 9);
    await clickWorld(page, 'right');
    await expect.poll(async () => (await game.vitals(page)).hunger).toBe(13);
    expect(await countItem(page, Item.Apple)).toBe(2);
    await expect(page.locator(tid('vital-hunger'))).toHaveAttribute(
      'aria-label',
      'Hunger 13 of 20',
    );
  });

  test('ore gives its mineral and a pickaxe wears with use', async ({ page }) => {
    await game.hold(page, Item.StonePickaxe);
    const held = (await game.inventory(page)).selected;
    expect((await game.inventory(page)).slots[held]).toEqual({
      item: Item.StonePickaxe,
      count: 1,
      durability: 132,
    });

    const ore = await blockAhead(page, Block.CoalOre);
    await page.mouse.down();
    await expect
      .poll(() => game.getBlock(page, ore.x, ore.y, ore.z), { timeout: 20_000 })
      .toBe(Block.Air);
    await page.mouse.up();

    // Coal, not the ore block, and one use off the pickaxe.
    expect(await countItem(page, Item.Coal)).toBe(1);
    expect(await countItem(page, Block.CoalOre)).toBe(0);
    await expect
      .poll(async () => (await game.inventory(page)).slots[held]?.durability)
      .toBeLessThan(132);
    // The worn tool shows a bar on its hotbar slot.
    await expect(
      page.locator('.hotbar .hotbar__slot').nth(held).locator('.slot__wear'),
    ).toBeVisible();
  });

  test('mining with a tool collects the block', async ({ page }) => {
    await game.hold(page, Item.WoodPickaxe);
    const held = (await game.inventory(page)).selected;
    const stone = await blockAhead(page, Block.Stone);
    await page.mouse.down();
    await expect
      .poll(() => game.getBlock(page, stone.x, stone.y, stone.z), { timeout: 20_000 })
      .toBe(Block.Air);
    await page.mouse.up();
    // At least one use is gone; the button may still have been down for the next block.
    expect((await game.inventory(page)).slots[held]?.durability).toBeLessThan(60);
    expect(await countItem(page, Block.Stone)).toBeGreaterThanOrEqual(1);
  });

  test('planks and sticks are crafted in the inventory', async ({ page }) => {
    await page.evaluate(() => window.__visionmine.give(6, 2)); // two logs
    const logSlot = (await game.inventory(page)).slots.findIndex((s) => s?.item === 6);
    const planksBefore = await countItem(page, Block.Planks);

    await page.keyboard.press('KeyE');
    await waitForScreen(page, 'inventory');
    await expect(page.getByRole('heading', { name: 'Crafting (2 × 2)' })).toBeVisible();
    await expect(page.locator(`${tid('craft-grid')} .slot:visible`)).toHaveCount(4);
    await expect(page.getByRole('heading', { name: 'Block palette' })).toBeHidden();

    // One log makes four planks.
    await press(page, hotbarSlot(logSlot));
    await press(page, craftCell(0), true);
    await expect(page.locator(tid('craft-result'))).toHaveAttribute('title', 'Planks');
    await press(page, hotbarSlot(logSlot)); // put the other log back
    await press(page, tid('craft-result'));
    // Carried planks; set them down in the backpack.
    await press(page, bagSlot(0));
    expect((await game.inventory(page)).slots[9]).toEqual({ item: Block.Planks, count: 4 });
    await expect(page.locator(tid('craft-result'))).not.toHaveAttribute('title', /.+/);

    // Two planks, one above the other, make four sticks.
    await press(page, bagSlot(0));
    await press(page, craftCell(0), true);
    await press(page, craftCell(3), true);
    await expect(page.locator(tid('craft-result'))).toHaveAttribute('title', 'Stick');
    await press(page, bagSlot(0));
    await press(page, tid('craft-result'));
    await press(page, bagSlot(1));

    await page.keyboard.press('KeyE');
    await waitForScreen(page, 'playing');
    expect(await countItem(page, Item.Stick)).toBe(4);
    expect(await countItem(page, 6)).toBe(1);
    // Four planks made, two used.
    expect(await countItem(page, Block.Planks)).toBe(planksBefore + 2);
  });

  test('a crafting table opens a 3 × 3 grid where tools are made', async ({ page }) => {
    await game.give(page, Item.Stick, 2);
    const stickSlot = (await game.inventory(page)).slots.findIndex((s) => s?.item === Item.Stick);
    await blockAhead(page, Block.CraftingTable);
    await clickWorld(page, 'right');
    await waitForScreen(page, 'inventory');
    await expect(page.getByRole('heading', { name: 'Crafting Table' })).toBeVisible();
    await expect(page.locator(`${tid('craft-grid')} .slot:visible`)).toHaveCount(9);

    // Three planks across the top (the starter stack is in hotbar slot 1)…
    await press(page, hotbarSlot(0));
    await press(page, craftCell(0), true);
    await press(page, craftCell(1), true);
    await press(page, craftCell(2), true);
    await press(page, hotbarSlot(0));
    // …and two sticks down the middle.
    await press(page, hotbarSlot(stickSlot));
    await press(page, craftCell(4), true);
    await press(page, craftCell(7), true);
    await expect(page.locator(tid('craft-result'))).toHaveAttribute('title', 'Wooden Pickaxe');

    await press(page, tid('craft-result'));
    await press(page, bagSlot(0));
    await page.keyboard.press('KeyE');
    await waitForScreen(page, 'playing');

    expect((await game.inventory(page)).slots[9]).toEqual({
      item: Item.WoodPickaxe,
      count: 1,
      durability: 60,
    });
    expect(await countItem(page, Block.Planks)).toBe(29);
    expect(await countItem(page, Item.Stick)).toBe(0);
  });

  test('closing the crafting screen gives unused ingredients back', async ({ page }) => {
    const planks = await countItem(page, Block.Planks);
    await page.keyboard.press('KeyE');
    await waitForScreen(page, 'inventory');
    await press(page, hotbarSlot(0));
    await press(page, craftCell(0), true);
    await press(page, craftCell(1), true);
    // Close with planks both in the grid and on the pointer.
    await page.keyboard.press('Escape');
    await waitForScreen(page, 'playing');
    expect(await countItem(page, Block.Planks)).toBe(planks);
  });

  test('health, hunger and tools are saved with the world', async ({ page }) => {
    await game.hold(page, Item.StonePickaxe);
    const stone = await blockAhead(page, Block.Stone);
    await page.mouse.down();
    await expect
      .poll(() => game.getBlock(page, stone.x, stone.y, stone.z), { timeout: 20_000 })
      .toBe(Block.Air);
    await page.mouse.up();
    await game.setVitals(page, 11, 9);
    const before = await game.inventory(page);
    await game.save(page);

    await page.reload();
    await waitForScreen(page, 'menu');
    await page.click(tid('menu-continue'));
    await waitUntilPlaying(page);

    const vitals = await game.vitals(page);
    expect(vitals.health).toBe(11);
    expect(vitals.hunger).toBe(9);
    expect(await game.inventory(page)).toEqual(before);
    // The pickaxe was used, and its wear came back with it.
    const pickaxe = before.slots.find((s) => s?.item === Item.StonePickaxe);
    expect(pickaxe?.durability).toBeLessThan(132);
  });
});

test.describe('creative mode and new worlds', () => {
  test('creative players have no vitals and take no damage', async ({ page }) => {
    await openGame(page);
    await createWorld(page, { seed: 'survival' });
    await captureMouse(page);
    await expect(page.locator(tid('vitals'))).toBeHidden();

    const start = await game.player(page);
    await game.teleport(page, start.x, start.y + 30, start.z);
    await expect
      .poll(async () => (await game.player(page)).onGround, { timeout: 20_000 })
      .toBe(true);
    expect((await game.vitals(page)).health).toBe(20);
    await expect(page.locator('.toast', { hasText: 'You died' })).toHaveCount(0);
  });

  test('new worlds contain coal and iron ore underground', async ({ page }) => {
    await openGame(page);
    await createWorld(page, { seed: 'survival', terrain: 'standard', trees: 'normal' });
    const ores = await page.evaluate(() => {
      const api = window.__visionmine;
      const p = api.player()!;
      let coal = 0;
      let iron = 0;
      for (let x = Math.floor(p.x) - 16; x < Math.floor(p.x) + 16; x++) {
        for (let z = Math.floor(p.z) - 16; z < Math.floor(p.z) + 16; z++) {
          for (let y = 1; y < 60; y++) {
            const id = api.getBlock(x, y, z);
            if (id === 32) coal++;
            else if (id === 33) iron++;
          }
        }
      }
      return { coal, iron };
    });
    expect(ores.coal).toBeGreaterThan(50);
    expect(ores.iron).toBeGreaterThan(5);
  });
});
