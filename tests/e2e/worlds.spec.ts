import { expect, test, type Page } from '@playwright/test';
import {
  createWorld,
  game,
  openGame,
  quitToMenu,
  tid,
  waitForScreen,
  waitUntilPlaying,
} from './helpers';

async function openWorldList(page: Page): Promise<void> {
  await page.click(tid('menu-worlds'));
  await waitForScreen(page, 'worlds');
  await expect(page.locator('.world-list__status')).not.toHaveText('Loading worlds…');
}

const rows = (page: Page) => page.locator('.world-list .world');
const row = (page: Page, name: string) => rows(page).filter({ hasText: name });

test.describe('world management', () => {
  test('an empty list explains how to start', async ({ page }) => {
    await openGame(page);
    await openWorldList(page);
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('.world-list__status')).toHaveText(
      'No worlds yet. Create one to get started.',
    );
    await page
      .getByRole('region', { name: 'Worlds' })
      .getByRole('button', { name: 'Back' })
      .click();
    await waitForScreen(page, 'menu');
  });

  test('lists worlds most recently played first and plays the chosen one', async ({ page }) => {
    await openGame(page);
    await createWorld(page, { name: 'Alpha', seed: 'alpha-seed', mode: 'survival' });
    const alphaId = await game.worldId(page);
    await quitToMenu(page);
    await createWorld(page, { name: 'Beta', seed: 'beta-seed', terrain: 'islands' });
    await quitToMenu(page);

    await openWorldList(page);
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(0).locator('.world__name')).toHaveText('Beta');
    await expect(rows(page).nth(1).locator('.world__name')).toHaveText('Alpha');
    await expect(row(page, 'Alpha').locator('.world__meta')).toContainText(
      'Flatlands · Survival · Seed alpha-seed',
    );
    await expect(row(page, 'Beta').locator('.world__meta')).toContainText(
      'Archipelago · Creative · Seed beta-seed',
    );

    await row(page, 'Alpha').locator(tid('world-play')).click();
    await waitUntilPlaying(page);
    expect(await game.worldId(page)).toBe(alphaId);
    expect((await game.stats(page)).seed).toBe('alpha-seed');
    await expect(page.locator('.hud__mode')).toHaveText('Survival');
  });

  test('renames a world and keeps the new name after a reload', async ({ page }) => {
    await openGame(page);
    await createWorld(page, { name: 'Old Name', seed: 'rename' });
    await quitToMenu(page);
    await openWorldList(page);

    // Escape cancels the edit.
    await row(page, 'Old Name').locator(tid('world-rename')).click();
    const input = page.locator(tid('rename-input'));
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('Old Name');
    await input.fill('Discarded');
    await input.press('Escape');
    await expect(rows(page).locator('.world__name')).toHaveText('Old Name');
    // Escape inside the field must not also leave the screen.
    expect(await game.screen(page)).toBe('worlds');

    await row(page, 'Old Name').locator(tid('world-rename')).click();
    await input.fill('  New Name  ');
    await input.press('Enter');
    await expect(rows(page).locator('.world__name')).toHaveText('New Name');

    await page.reload();
    await waitForScreen(page, 'menu');
    await expect(page.locator('.menu__detail')).toHaveText('New Name');
    await openWorldList(page);
    await expect(rows(page).locator('.world__name')).toHaveText('New Name');
  });

  test('deletes a world only after confirmation', async ({ page }) => {
    await openGame(page);
    await createWorld(page, { name: 'Keep', seed: 'keep' });
    await quitToMenu(page);
    await createWorld(page, { name: 'Remove', seed: 'remove' });
    await quitToMenu(page);
    await openWorldList(page);
    await expect(rows(page)).toHaveCount(2);

    const remove = row(page, 'Remove').locator(tid('world-delete'));
    await remove.click();
    await expect(remove).toHaveText('Confirm delete');
    await expect(rows(page)).toHaveCount(2);
    await remove.click();

    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).locator('.world__name')).toHaveText('Keep');
    await expect(page.locator('.toast', { hasText: 'World deleted.' })).toBeVisible();

    await page.reload();
    await waitForScreen(page, 'menu');
    await expect(page.locator('.menu__detail')).toHaveText('Keep');
    await openWorldList(page);
    await expect(rows(page)).toHaveCount(1);

    // Deleting the last world removes the Continue shortcut.
    await row(page, 'Keep').locator(tid('world-delete')).click();
    await row(page, 'Keep').locator(tid('world-delete')).click();
    await expect(rows(page)).toHaveCount(0);
    await page
      .getByRole('region', { name: 'Worlds' })
      .getByRole('button', { name: 'Back' })
      .click();
    await waitForScreen(page, 'menu');
    await expect(page.locator(tid('menu-continue'))).toBeHidden();
  });

  test('a damaged save is listed, cannot be opened and can be deleted', async ({ page }) => {
    await openGame(page);
    await createWorld(page, { name: 'Healthy', seed: 'healthy' });
    await quitToMenu(page);

    // Write a record that fails validation straight into storage.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('visionmine');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('worlds', 'readwrite');
            tx.objectStore('worlds').put({ id: 'broken-1', name: 'Broken', config: 42 });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );

    await openWorldList(page);
    await expect(rows(page)).toHaveCount(2);
    const damaged = page.locator('.world--corrupt');
    await expect(damaged).toContainText('Broken');
    await expect(damaged).toContainText('This save is damaged and cannot be opened.');
    await expect(damaged.getByRole('button', { name: 'Play' })).toHaveCount(0);

    await damaged.getByRole('button', { name: 'Delete' }).click();
    await damaged.getByRole('button', { name: 'Confirm delete' }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).locator('.world__name')).toHaveText('Healthy');
  });
});
