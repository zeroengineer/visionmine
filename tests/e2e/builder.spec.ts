import { expect, test, type Page } from '@playwright/test';
import {
  aimAtGround,
  Block,
  captureMouse,
  clickWorld,
  createWorld,
  ensureCaptured,
  game,
  openGame,
  tid,
  waitForScreen,
} from './helpers';

interface Cell {
  x: number;
  y: number;
  z: number;
}

/** Counts blocks of one kind inside the box spanned by two cells. */
function countBlocks(page: Page, a: Cell, b: Cell, block: number): Promise<number> {
  return page.evaluate(
    ([p, q, id]) => {
      let n = 0;
      for (let x = Math.min(p.x, q.x); x <= Math.max(p.x, q.x); x++) {
        for (let y = Math.min(p.y, q.y); y <= Math.max(p.y, q.y); y++) {
          for (let z = Math.min(p.z, q.z); z <= Math.max(p.z, q.z); z++) {
            if (window.__visionmine.getBlock(x, y, z) === id) n++;
          }
        }
      }
      return n;
    },
    [a, b, block] as const,
  );
}

const volume = (a: Cell, b: Cell): number =>
  (Math.abs(a.x - b.x) + 1) * (Math.abs(a.y - b.y) + 1) * (Math.abs(a.z - b.z) + 1);

const notice = (page: Page) => page.locator(tid('hud-notice'));
const status = (page: Page) => page.locator(tid('build-status'));

async function openBuildMenu(page: Page): Promise<void> {
  await page.keyboard.press('KeyB');
  await waitForScreen(page, 'build');
  await expect(page.getByRole('dialog', { name: 'Build tools' })).toBeVisible();
}

async function closeBuildMenu(page: Page): Promise<void> {
  await page.click(tid('build-close'));
  await waitForScreen(page, 'playing');
  await ensureCaptured(page);
}

/** Marks two ground blocks ahead of the player as the selection corners. */
async function selectGroundStrip(page: Page): Promise<{ a: Cell; b: Cell }> {
  const a = await aimAtGround(page, 0, -0.8);
  await page.keyboard.press('KeyX');
  await expect(notice(page)).toHaveText('First corner set. Mark the opposite corner.');
  const b = await aimAtGround(page, 0.25, -0.35);
  await page.keyboard.press('KeyX');
  await expect(notice(page)).toContainText('Selected ');
  return { a, b };
}

test.describe('builder tools', () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
    await createWorld(page, { seed: 'builder' });
    await captureMouse(page);
  });

  test('fills a selection and undoes and redoes it', async ({ page }) => {
    await page.keyboard.press('Digit8');
    const { a, b } = await selectGroundStrip(page);
    const cells = volume(a, b);
    expect(cells).toBeGreaterThan(3);
    expect(await countBlocks(page, a, b, Block.Brick)).toBe(0);

    await openBuildMenu(page);
    const size = `${Math.abs(a.x - b.x) + 1} × ${Math.abs(a.y - b.y) + 1} × ${Math.abs(a.z - b.z) + 1}`;
    await expect(page.locator(tid('build-selection'))).toContainText(`Selection: ${size}`);
    await expect(page.getByText('Holding: Bricks')).toBeVisible();
    await expect(page.locator(tid('build-undo'))).toBeDisabled();

    await page.click(tid('build-fill'));
    await expect(status(page)).toHaveText(`Filled ${cells} blocks with Bricks.`);
    expect(await countBlocks(page, a, b, Block.Brick)).toBe(cells);

    await page.click(tid('build-undo'));
    await expect(status(page)).toHaveText(`Undid ${cells} blocks.`);
    expect(await countBlocks(page, a, b, Block.Brick)).toBe(0);
    await expect(page.locator(tid('build-undo'))).toBeDisabled();

    await page.click(tid('build-redo'));
    await expect(status(page)).toHaveText(`Redid ${cells} blocks.`);
    expect(await countBlocks(page, a, b, Block.Brick)).toBe(cells);

    // Back in the world, the undo and redo keys do the same.
    await closeBuildMenu(page);
    await page.keyboard.press('KeyZ');
    await expect(notice(page)).toHaveText(`Undid ${cells} blocks.`);
    expect(await countBlocks(page, a, b, Block.Brick)).toBe(0);
    await page.keyboard.press('KeyY');
    await expect(notice(page)).toHaveText(`Redid ${cells} blocks.`);
    expect(await countBlocks(page, a, b, Block.Brick)).toBe(cells);
  });

  test('clear, replace and deselect work on the selection', async ({ page }) => {
    const { a, b } = await selectGroundStrip(page);
    const cells = volume(a, b);

    await page.keyboard.press('Digit3');
    await openBuildMenu(page);
    await page.click(tid('build-replace'));
    await expect(status(page)).toHaveText(`Replaced ${cells} blocks with Stone.`);
    expect(await countBlocks(page, a, b, Block.Stone)).toBe(cells);

    await page.click(tid('build-clear'));
    await expect(status(page)).toHaveText(`Cleared ${cells} blocks.`);
    expect(await countBlocks(page, a, b, Block.Air)).toBe(cells);
    // Nothing is left to replace.
    await page.click(tid('build-replace'));
    await expect(status(page)).toHaveText('Replaced 0 blocks with Stone.');

    await page.click(tid('build-deselect'));
    await expect(page.locator(tid('build-selection'))).toContainText('No selection');
    await expect(page.locator(tid('build-fill'))).toBeDisabled();
    await expect(page.locator(tid('build-deselect'))).toBeDisabled();
  });

  test('copies a block and pastes it somewhere else', async ({ page }) => {
    // Put a brick on the ground and select just that block.
    await page.keyboard.press('Digit8');
    const ground = await aimAtGround(page, 0, -0.8);
    await clickWorld(page, 'right');
    const brick = { x: ground.x + ground.nx, y: ground.y + ground.ny, z: ground.z + ground.nz };
    await expect.poll(() => game.getBlock(page, brick.x, brick.y, brick.z)).toBe(Block.Brick);
    expect(await game.target(page)).toMatchObject(brick);
    await page.keyboard.press('KeyX');
    await expect(notice(page)).toContainText('First corner');
    await page.keyboard.press('KeyX');
    await expect(notice(page)).toHaveText('Selected 1 × 1 × 1.');

    await openBuildMenu(page);
    await expect(page.locator(tid('build-paste'))).toBeDisabled();
    await page.click(tid('build-copy'));
    await expect(status(page)).toHaveText('Copied 1 block.');
    await expect(page.locator(tid('build-clipboard'))).toHaveText('Copy: 1 × 1 × 1');
    await page.click(tid('build-rotate'));
    await expect(status(page)).toHaveText('Copy rotated: 1 × 1 × 1.');
    await closeBuildMenu(page);

    // Paste against the ground on the other side of the player.
    const elsewhere = await aimAtGround(page, Math.PI, -0.8);
    const spot = {
      x: elsewhere.x + elsewhere.nx,
      y: elsewhere.y + elsewhere.ny,
      z: elsewhere.z + elsewhere.nz,
    };
    expect(await game.getBlock(page, spot.x, spot.y, spot.z)).toBe(Block.Air);
    await openBuildMenu(page);
    await page.click(tid('build-paste'));
    await expect(status(page)).toHaveText('Pasted 1 block.');
    expect(await game.getBlock(page, spot.x, spot.y, spot.z)).toBe(Block.Brick);
    // The original is still there.
    expect(await game.getBlock(page, brick.x, brick.y, brick.z)).toBe(Block.Brick);
  });

  test('ordinary edits and explosions can be undone one step at a time', async ({ page }) => {
    const target = await aimAtGround(page);
    await clickWorld(page, 'left');
    await expect.poll(() => game.getBlock(page, target.x, target.y, target.z)).toBe(Block.Air);

    await page.keyboard.press('Digit8');
    const next = await aimAtGround(page, 0, -0.5);
    await clickWorld(page, 'right');
    const placed = { x: next.x + next.nx, y: next.y + next.ny, z: next.z + next.nz };
    await expect.poll(() => game.getBlock(page, placed.x, placed.y, placed.z)).toBe(Block.Brick);

    await page.keyboard.press('KeyZ');
    await expect(notice(page)).toHaveText('Undid 1 block.');
    expect(await game.getBlock(page, placed.x, placed.y, placed.z)).toBe(Block.Air);
    expect(await game.getBlock(page, target.x, target.y, target.z)).toBe(Block.Air);

    await page.keyboard.press('KeyZ');
    expect(await game.getBlock(page, target.x, target.y, target.z)).toBe(target.block);
    await page.keyboard.press('KeyZ');
    await expect(notice(page)).toHaveText('Nothing to undo.');
  });

  test('Q returns to the previously selected hotbar slot', async ({ page }) => {
    await page.keyboard.press('Digit3');
    await page.keyboard.press('Digit7');
    await expect.poll(async () => (await game.inventory(page)).selected).toBe(6);
    await page.keyboard.press('KeyQ');
    await expect.poll(async () => (await game.inventory(page)).selected).toBe(2);
    await page.keyboard.press('KeyQ');
    await expect.poll(async () => (await game.inventory(page)).selected).toBe(6);
  });

  test('F1 hides the interface and F2 saves a screenshot', async ({ page }) => {
    await expect(page.locator(tid('hud'))).toBeVisible();
    await page.keyboard.press('F1');
    await expect(page.locator(tid('hud'))).toBeHidden();
    await page.keyboard.press('F1');
    await expect(page.locator(tid('hud'))).toBeVisible();

    const download = page.waitForEvent('download');
    await page.keyboard.press('F2');
    const file = await download;
    expect(file.suggestedFilename()).toMatch(
      /^visionmine-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.png$/,
    );
    const path = await file.path();
    const { statSync, readFileSync } = await import('node:fs');
    // A real image of the scene, not an empty canvas: PNG signature and a plausible size.
    expect(readFileSync(path).subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(statSync(path).size).toBeGreaterThan(8000);
    await expect(notice(page)).toHaveText('Screenshot saved');
  });
});

test('survival mode has no builder tools', async ({ page }) => {
  await openGame(page);
  await createWorld(page, { seed: 'builder', mode: 'survival' });
  await captureMouse(page);

  await page.keyboard.press('KeyB');
  await expect(notice(page)).toHaveText('Build tools are available in Creative mode.');
  expect(await game.screen(page)).toBe('playing');

  await aimAtGround(page);
  await page.keyboard.press('KeyX');
  await expect(notice(page)).toHaveText('Build tools are available in Creative mode.');

  await clickWorld(page, 'right');
  await page.keyboard.press('KeyZ');
  await expect(notice(page)).toHaveText('Undo is available in Creative mode.');
});
