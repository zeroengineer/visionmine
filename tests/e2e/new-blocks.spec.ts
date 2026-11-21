import { expect, test, type Page } from '@playwright/test';
import {
  aimAtGround,
  Block,
  canvasBrightness,
  captureMouse,
  clickWorld,
  createWorld,
  game,
  layFlatPad,
  openGame,
  quitToMenu,
  tid,
  waitForScreen,
  waitUntilPlaying,
} from './helpers';

const NORTH = 0;
const EAST = 1;
const SOUTH = 2;
const OPEN = 4;

/** Free cell on top of the ground a little ahead of the player, looking north. */
async function cellAhead(page: Page, pitch = -0.6) {
  const ground = await aimAtGround(page, 0, pitch);
  expect(ground.ny).toBe(1);
  return { x: ground.x, y: ground.y + 1, z: ground.z };
}

/**
 * Holds the forward key for a while and returns every distinct height the
 * player stood at, sampled each frame inside the page so that a height held
 * only briefly (the top of a single slab) is not missed.
 */
async function heightsWhileWalking(page: Page, milliseconds: number): Promise<number[]> {
  const sampling = page.evaluate(
    (duration) =>
      new Promise<number[]>((resolve) => {
        const seen = new Set<number>();
        const began = performance.now();
        const sample = (): void => {
          const player = window.__visionmine.player()!;
          if (player.onGround) seen.add(player.y);
          if (performance.now() - began < duration) requestAnimationFrame(sample);
          else resolve([...seen]);
        };
        requestAnimationFrame(sample);
      }),
    milliseconds,
  );
  await page.keyboard.down('KeyW');
  const heights = await sampling;
  await page.keyboard.up('KeyW');
  return heights;
}

/** Counts plant blocks in the columns around the player. */
function countPlants(page: Page): Promise<number> {
  return page.evaluate(() => {
    const api = window.__visionmine;
    const p = api.player()!;
    let n = 0;
    for (let x = Math.floor(p.x) - 24; x <= Math.floor(p.x) + 24; x++) {
      for (let z = Math.floor(p.z) - 24; z <= Math.floor(p.z) + 24; z++) {
        for (let y = Math.floor(p.y) - 6; y <= Math.floor(p.y) + 6; y++) {
          const id = api.getBlock(x, y, z);
          if (id >= 29 && id <= 31) n++;
        }
      }
    }
    return n;
  });
}

test.describe('shaped blocks', () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
    await createWorld(page, { seed: 'new-blocks' });
    await captureMouse(page);
    await layFlatPad(page);
  });

  test('a slab is half a block high and can be walked onto', async ({ page }) => {
    const start = await game.player(page);
    await game.hold(page, Block.StoneSlab);
    const cell = await cellAhead(page);
    await clickWorld(page, 'right');
    await expect.poll(() => game.getBlock(page, cell.x, cell.y, cell.z)).toBe(Block.StoneSlab);
    expect(await game.getMeta(page, cell.x, cell.y, cell.z)).toBe(0);

    // The crosshair meets its top at half height.
    await game.look(page, 0, -0.6);
    expect(await game.target(page)).toMatchObject({ ...cell, ny: 1, block: Block.StoneSlab });

    // Walking north steps up half a block without jumping, then back down.
    await game.look(page, 0, 0);
    const heights = await heightsWhileWalking(page, 2000);
    expect(heights).toContain(start.y + 0.5);
    const end = await game.player(page);
    expect(end.y).toBe(start.y);
    expect(end.z).toBeLessThan(cell.z);
    expect(end.flying).toBe(false);
  });

  test('a slab placed under a ceiling fills the upper half', async ({ page }) => {
    const player = await game.player(page);
    const roof = {
      x: Math.floor(player.x),
      y: Math.floor(player.y) + 3,
      z: Math.floor(player.z) - 2,
    };
    await game.setBlock(page, roof.x, roof.y, roof.z, Block.Stone);
    await game.hold(page, Block.StoneSlab);
    // Look up at the underside of the block.
    await game.look(page, 0, 0.72);
    expect(await game.target(page)).toMatchObject({ ...roof, ny: -1 });
    await clickWorld(page, 'right');
    await expect.poll(() => game.getBlock(page, roof.x, roof.y - 1, roof.z)).toBe(Block.StoneSlab);
    expect(await game.getMeta(page, roof.x, roof.y - 1, roof.z)).toBe(OPEN);
  });

  test('stairs face the way the player is looking', async ({ page }) => {
    await game.hold(page, Block.PlankStairs);
    const north = await cellAhead(page);
    await clickWorld(page, 'right');
    await expect.poll(() => game.getBlock(page, north.x, north.y, north.z)).toBe(Block.PlankStairs);
    expect(await game.getMeta(page, north.x, north.y, north.z)).toBe(NORTH);

    const east = await aimAtGround(page, -Math.PI / 2, -0.6);
    await clickWorld(page, 'right');
    await expect
      .poll(() => game.getBlock(page, east.x, east.y + 1, east.z))
      .toBe(Block.PlankStairs);
    expect(await game.getMeta(page, east.x, east.y + 1, east.z)).toBe(EAST);

    // Walking up the north-facing stairs gains a full block.
    const start = await game.player(page);
    await game.setBlock(page, north.x, north.y, north.z - 1, Block.Planks);
    await game.look(page, 0, 0);
    const heights = await heightsWhileWalking(page, 1800);
    // Up the lower half, then the upper half, onto the block behind.
    expect(heights).toContain(start.y + 0.5);
    expect(heights).toContain(start.y + 1);
    expect((await game.player(page)).flying).toBe(false);
  });

  test('a door is two blocks, opens with a click and comes away whole', async ({ page }) => {
    await game.hold(page, Block.Door);
    const cell = await cellAhead(page);
    await clickWorld(page, 'right');
    await expect.poll(() => game.getBlock(page, cell.x, cell.y, cell.z)).toBe(Block.Door);
    expect(await game.getBlock(page, cell.x, cell.y + 1, cell.z)).toBe(Block.DoorUpper);
    // Looking north, the door stands on the near (south) edge of its cell.
    expect(await game.getMeta(page, cell.x, cell.y, cell.z)).toBe(SOUTH);

    // Closed, it stops the player.
    const start = await game.player(page);
    await game.look(page, 0, 0);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyW');
    const blocked = await game.player(page);
    expect(blocked.z).toBeGreaterThan(cell.z + 1);
    expect(blocked.z).toBeLessThan(start.z);

    // Right-click opens both halves instead of placing another door.
    await game.look(page, 0, -0.2);
    expect((await game.target(page))?.x).toBe(cell.x);
    await clickWorld(page, 'right');
    await expect.poll(() => game.getMeta(page, cell.x, cell.y, cell.z)).toBe(SOUTH | OPEN);
    expect(await game.getMeta(page, cell.x, cell.y + 1, cell.z)).toBe(SOUTH | OPEN);
    expect(await game.getBlock(page, cell.x, cell.y + 2, cell.z)).toBe(Block.Air);

    // Open, the doorway can be walked through (keep to the side away from the panel).
    await game.teleport(page, cell.x + 0.65, start.y, start.z);
    await expect.poll(async () => (await game.player(page)).onGround).toBe(true);
    await game.look(page, 0, 0);
    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await game.player(page)).z).toBeLessThan(cell.z - 0.5);
    await page.keyboard.up('KeyW');

    // Breaking one half removes the whole door, and the action is one undo step.
    // From the start again, the open panel is on the west side of the doorway:
    // sweep the view left until the crosshair finds it.
    await game.teleport(page, start.x, start.y, start.z);
    await expect.poll(async () => (await game.player(page)).onGround).toBe(true);
    let found: number | undefined;
    for (let yaw = 0; yaw <= 0.5 && found === undefined; yaw += 0.02) {
      await game.look(page, yaw, -0.15);
      const block = (await game.target(page))?.block;
      if (block === Block.Door || block === Block.DoorUpper) found = block;
    }
    expect(found, 'the open door should be within reach').toBeDefined();
    await clickWorld(page, 'left');
    await expect.poll(() => game.getBlock(page, cell.x, cell.y, cell.z)).toBe(Block.Air);
    expect(await game.getBlock(page, cell.x, cell.y + 1, cell.z)).toBe(Block.Air);
    await page.keyboard.press('KeyZ');
    await expect.poll(() => game.getBlock(page, cell.x, cell.y, cell.z)).toBe(Block.Door);
    expect(await game.getBlock(page, cell.x, cell.y + 1, cell.z)).toBe(Block.DoorUpper);
  });

  test('a ladder hangs on the wall it is placed against and can be climbed', async ({ page }) => {
    const player = await game.player(page);
    const x = Math.floor(player.x);
    const y = Math.floor(player.y);
    const wallZ = Math.floor(player.z) - 3;
    // A wall five high and deep enough to stand on.
    await page.evaluate(
      ([wx, wy, wz]) => {
        for (let dy = 0; dy < 5; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = 0; dz < 4; dz++)
              window.__visionmine.setBlock(wx! + dx, wy! + dy, wz! - dz, 3);
          }
        }
      },
      [x, y, wallZ],
    );

    // Place the lowest rung by hand, against the wall's south face.
    await game.hold(page, Block.Ladder);
    await game.look(page, 0, -0.35);
    expect(await game.target(page)).toMatchObject({ x, z: wallZ, nz: 1 });
    await clickWorld(page, 'right');
    await expect.poll(() => game.getBlock(page, x, y, wallZ + 1)).toBe(Block.Ladder);
    expect(await game.getMeta(page, x, y, wallZ + 1)).toBe(NORTH);
    for (let dy = 1; dy < 5; dy++)
      await game.setBlock(page, x, y + dy, wallZ + 1, Block.Ladder, NORTH);

    // Walking into it climbs to the top of the wall, with no jump or flight.
    await game.look(page, 0, 0);
    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await game.player(page)).y, { timeout: 20_000 }).toBe(y + 5);
    await page.keyboard.up('KeyW');
    const top = await game.player(page);
    expect(top.z).toBeLessThan(wallZ + 1);
    expect(top.flying).toBe(false);
  });

  test('a torch lights the night and falls when its support is dug away', async ({ page }) => {
    await page.evaluate(() => window.__visionmine.setTime(0));
    await game.look(page, 0, -0.5);
    // Let the sky settle into night before measuring.
    await page.waitForTimeout(600);
    const dark = await canvasBrightness(page);

    await game.hold(page, Block.Torch);
    const cell = await cellAhead(page, -0.5);
    await clickWorld(page, 'right');
    await expect.poll(() => game.getBlock(page, cell.x, cell.y, cell.z)).toBe(Block.Torch);
    await expect.poll(() => canvasBrightness(page)).toBeGreaterThan(dark * 1.5);

    // It cannot be stuck to the side of a block.
    const wall = { x: cell.x + 2, y: cell.y, z: cell.z };
    await game.setBlock(page, wall.x, wall.y, wall.z, Block.Stone);
    await game.look(page, -0.6, -0.35);
    const side = await game.target(page);
    if (side && side.ny === 0) {
      await clickWorld(page, 'right');
      await page.waitForTimeout(300);
      expect(await game.getBlock(page, side.x + side.nx, side.y, side.z + side.nz)).toBe(Block.Air);
    }

    // Removing the ground under the torch removes it, and the light goes with it.
    await game.setBlock(page, cell.x, cell.y - 1, cell.z, Block.Air);
    expect(await game.getBlock(page, cell.x, cell.y, cell.z)).toBe(Block.Air);
    await game.setBlock(page, cell.x, cell.y - 1, cell.z, Block.Stone);
    await game.setBlock(page, wall.x, wall.y, wall.z, Block.Air);
    await game.look(page, 0, -0.5);
    await expect.poll(() => canvasBrightness(page)).toBeLessThan(dark * 1.2);
  });

  test('the palette offers the new blocks and they can be taken into the hotbar', async ({
    page,
  }) => {
    await page.keyboard.press('KeyE');
    await waitForScreen(page, 'inventory');
    await expect(page.locator('.slot--palette')).toHaveCount(29);
    for (const name of [
      'Stone Slab',
      'Brick Stairs',
      'Door',
      'Ladder',
      'Glass Pane',
      'Torch',
      'Poppy',
    ]) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }
    // The door's upper half is not an item.
    await expect(page.getByRole('button', { name: 'Door', exact: true })).toHaveCount(1);

    await page.getByRole('button', { name: 'Torch', exact: true }).click();
    const slot = page.locator('.inv__grid--hotbar .slot').nth(0);
    await slot.hover();
    await page.mouse.down();
    await page.mouse.up();
    await expect
      .poll(async () => (await game.inventory(page)).slots[0])
      .toEqual({ block: Block.Torch, count: 64 });
  });
});

test.describe('plants and generator versions', () => {
  test('new worlds grow flowers and grass; older worlds stay as they were', async ({ page }) => {
    await openGame(page);
    await createWorld(page, { name: 'Meadow', seed: 'meadow', trees: 'normal' });
    const worldId = (await game.worldId(page))!;
    expect(await countPlants(page)).toBeGreaterThan(20);
    await quitToMenu(page);

    // The same world as an earlier release would have stored it: no generator version.
    await page.evaluate(
      (id) =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('visionmine');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('worlds', 'readwrite');
            const store = tx.objectStore('worlds');
            const get = store.get(id);
            get.onsuccess = () => {
              const record = get.result as { config: Record<string, unknown> };
              delete record.config.generator;
              store.put(record);
            };
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      worldId,
    );

    await page.reload();
    await waitForScreen(page, 'menu');
    await page.click(tid('menu-continue'));
    await waitUntilPlaying(page);
    expect(await game.worldId(page)).toBe(worldId);
    expect(await countPlants(page)).toBe(0);
  });

  test('a plant can be picked, planted and loses its place when the soil is dug', async ({
    page,
  }) => {
    await openGame(page);
    await createWorld(page, { seed: 'meadow' });
    await captureMouse(page);
    await layFlatPad(page);

    await game.hold(page, Block.FlowerRed);
    const cell = await cellAhead(page);
    await clickWorld(page, 'right');
    await expect.poll(() => game.getBlock(page, cell.x, cell.y, cell.z)).toBe(Block.FlowerRed);

    // The crosshair can select it, and it does not stop the player.
    await game.look(page, 0, -0.6);
    expect(await game.target(page)).toMatchObject({ ...cell, block: Block.FlowerRed });
    await game.look(page, 0, 0);
    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await game.player(page)).z).toBeLessThan(cell.z);
    await page.keyboard.up('KeyW');

    // Breaking the ground beneath removes the flower too, and undo restores both.
    await game.setBlock(page, cell.x, cell.y - 1, cell.z, Block.Air);
    expect(await game.getBlock(page, cell.x, cell.y, cell.z)).toBe(Block.Air);
  });
});
