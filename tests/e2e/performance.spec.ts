import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  captureMouse,
  createWorld,
  game,
  openGame,
  quitToMenu,
  tid,
  waitUntilPlaying,
} from './helpers';

/** Chunks within render distance 3 + 2 (loaded) and 3.5 (meshed) of a stationary player. */
const WINDOW_LOADED = 81;
const WINDOW_MESHED = 37;

/**
 * Waits until the whole chunk window around the player is loaded and meshed and
 * the counts have stopped changing.
 */
async function settle(page: Page): Promise<void> {
  let previous = '';
  await expect
    .poll(
      async () => {
        const s = await game.stats(page);
        const current = `${s.loadedChunks}/${s.meshedChunks}/${s.faces}`;
        const complete = s.loadedChunks >= WINDOW_LOADED && s.meshedChunks >= WINDOW_MESHED;
        const stable = complete && current === previous;
        previous = current;
        return stable;
      },
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe(true);
}

async function snapshot(page: Page, label: string) {
  const s = await game.stats(page);
  const heapMb = await page.evaluate(() => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return memory ? Math.round(memory.usedJSHeapSize / 1048576) : null;
  });
  return {
    label,
    fps: Math.round(s.fps),
    frameMs: Number(s.frameMs.toFixed(1)),
    loadedChunks: s.loadedChunks,
    meshedChunks: s.meshedChunks,
    faces: s.faces,
    drawCalls: s.drawCalls,
    triangles: s.triangles,
    geometries: s.geometries,
    textures: s.textures,
    heapMb,
  };
}

test.describe('performance and memory', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'measured once, on Chromium');
  test.setTimeout(300_000);

  test('resources stay bounded while travelling and are released on leaving', async ({ page }) => {
    const log = await openGame(page);
    await createWorld(page, { name: 'Perf', seed: 'perf', terrain: 'standard', trees: 'normal' });
    await captureMouse(page);
    await game.look(page, 0, -0.3);
    await settle(page);
    const results = [await snapshot(page, 'spawn')];
    const spawn = await game.player(page);

    // Fly away in a straight line so chunks behind the player are unloaded.
    await page.keyboard.press('KeyF');
    await expect.poll(async () => (await game.player(page)).flying).toBe(true);
    for (let leg = 1; leg <= 6; leg++) {
      await game.teleport(page, spawn.x, 90, spawn.z - leg * 96);
      await settle(page);
      results.push(await snapshot(page, `travelled ${leg * 96} blocks`));
    }

    await game.teleport(page, spawn.x, spawn.y, spawn.z);
    await settle(page);
    results.push(await snapshot(page, 'back at spawn'));

    // Leave and re-enter: everything the session owned must have been released.
    await quitToMenu(page);
    await page.click(tid('menu-continue'));
    await waitUntilPlaying(page);
    await captureMouse(page);
    await game.look(page, 0, -0.3);
    await settle(page);
    results.push(await snapshot(page, 're-entered world'));

    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/performance.json', JSON.stringify(results, null, 2));
    console.info(JSON.stringify(results, null, 2));

    const [first] = results;
    const travelled = results.filter((r) => r.label.startsWith('travelled'));
    const back = results.find((r) => r.label === 'back at spawn')!;
    const reentered = results.find((r) => r.label === 're-entered world')!;

    // Streaming keeps a bounded window: chunks load within render distance + 2 and
    // are dropped beyond render distance + 4 (149 chunks at render distance 3).
    for (const r of results) {
      expect(r.loadedChunks, r.label).toBeLessThanOrEqual(149);
      expect(r.meshedChunks, r.label).toBeLessThanOrEqual(r.loadedChunks);
      // GPU geometries follow the meshed chunks (two layers each) plus a few fixed objects.
      expect(r.geometries, r.label).toBeLessThanOrEqual(r.meshedChunks * 2 + 16);
      expect(r.textures, r.label).toBe(first!.textures);
    }
    // The window reaches a plateau instead of growing with distance travelled.
    expect(new Set(travelled.slice(1).map((r) => r.loadedChunks)).size).toBe(1);
    expect(new Set(travelled.slice(1).map((r) => r.meshedChunks)).size).toBe(1);
    // Returning to the same place, or reloading the world, gives the same footprint.
    for (const r of [back, reentered]) {
      expect(r.loadedChunks, r.label).toBe(first!.loadedChunks);
      expect(r.meshedChunks, r.label).toBe(first!.meshedChunks);
      expect(r.faces, r.label).toBe(first!.faces);
      expect(r.geometries, r.label).toBeLessThanOrEqual(first!.geometries + 2);
    }
    expect(log.errors).toEqual([]);
  });
});
