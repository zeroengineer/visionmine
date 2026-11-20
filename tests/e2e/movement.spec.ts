import { expect, test, type Page } from '@playwright/test';
import { captureMouse, createWorld, game, openGame } from './helpers';

/**
 * Finds a compass direction with at least `cells` blocks of level, unobstructed
 * ground ahead of the player. Yaw 0 faces -Z and increases turning left.
 */
async function findOpenYaw(page: Page, cells = 4): Promise<number | null> {
  return page.evaluate((count) => {
    const api = window.__visionmine;
    const player = api.player()!;
    for (let quarter = 0; quarter < 4; quarter++) {
      const yaw = (quarter * Math.PI) / 2;
      const dx = -Math.round(Math.sin(yaw));
      const dz = -Math.round(Math.cos(yaw));
      let open = true;
      for (let i = 1; i <= count && open; i++) {
        const x = player.x + dx * i;
        const z = player.z + dz * i;
        open =
          api.getBlock(x, player.y - 1, z) !== 0 &&
          api.getBlock(x, player.y, z) === 0 &&
          api.getBlock(x, player.y + 1, z) === 0;
      }
      if (open) return yaw;
    }
    return null;
  }, cells);
}

test.describe('player movement', () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
    await createWorld(page, { seed: 'movement' });
  });

  test('walks forward and strafes relative to the view direction', async ({ page }) => {
    await captureMouse(page);
    const yaw = await findOpenYaw(page);
    expect(yaw, 'flat terrain should offer an open direction at spawn').not.toBeNull();
    await game.look(page, yaw!, 0);
    const start = await game.player(page);
    const forwardX = -Math.sin(yaw!);
    const forwardZ = -Math.cos(yaw!);

    await page.keyboard.down('KeyW');
    await expect
      .poll(async () => {
        const p = await game.player(page);
        return (p.x - start.x) * forwardX + (p.z - start.z) * forwardZ;
      })
      .toBeGreaterThan(1.5);
    await page.keyboard.up('KeyW');

    const walked = await game.player(page);
    // Movement is along the view direction, not sideways.
    const sideways = Math.abs((walked.x - start.x) * forwardZ - (walked.z - start.z) * forwardX);
    expect(sideways).toBeLessThan(0.2);

    // The player coasts to a stop once the key is released.
    await expect
      .poll(async () => {
        const a = await game.player(page);
        await page.waitForTimeout(150);
        const b = await game.player(page);
        return Math.hypot(b.x - a.x, b.z - a.z);
      })
      .toBeLessThan(0.01);

    const beforeBack = await game.player(page);
    await page.keyboard.down('KeyS');
    await expect
      .poll(async () => {
        const p = await game.player(page);
        return (p.x - beforeBack.x) * forwardX + (p.z - beforeBack.z) * forwardZ;
      })
      .toBeLessThan(-0.5);
    await page.keyboard.up('KeyS');
  });

  test('jumps and lands back on the ground', async ({ page }) => {
    await captureMouse(page);
    const start = await game.player(page);
    expect(start.onGround).toBe(true);

    await page.keyboard.down('Space');
    await expect.poll(async () => (await game.player(page)).y).toBeGreaterThan(start.y + 0.5);
    await page.keyboard.up('Space');

    await expect.poll(async () => (await game.player(page)).onGround).toBe(true);
    const landed = await game.player(page);
    expect(landed.y).toBeCloseTo(start.y, 3);
    expect(landed.flying).toBe(false);
  });

  test('gravity pulls the player down to the terrain', async ({ page }) => {
    await captureMouse(page);
    const start = await game.player(page);
    await game.teleport(page, start.x, start.y + 12, start.z);
    await expect.poll(async () => (await game.player(page)).onGround).toBe(true);
    const landed = await game.player(page);
    expect(landed.y).toBeCloseTo(start.y, 3);
    expect(landed.x).toBeCloseTo(start.x, 3);
  });

  test('flies in creative mode and falls when flight is turned off', async ({ page }) => {
    await captureMouse(page);
    const start = await game.player(page);

    await page.keyboard.press('KeyF');
    await expect.poll(async () => (await game.player(page)).flying).toBe(true);

    await page.keyboard.down('Space');
    await expect.poll(async () => (await game.player(page)).y).toBeGreaterThan(start.y + 4);
    await page.keyboard.up('Space');

    // Hovering: no gravity while flying.
    await expect
      .poll(async () => {
        const a = await game.player(page);
        await page.waitForTimeout(200);
        const b = await game.player(page);
        return Math.abs(b.y - a.y);
      })
      .toBeLessThan(0.02);
    expect((await game.player(page)).onGround).toBe(false);

    // Flying forward is not blocked by terrain steps.
    await game.look(page, 0, 0);
    const beforeFlight = await game.player(page);
    await page.keyboard.down('KeyW');
    await expect.poll(async () => beforeFlight.z - (await game.player(page)).z).toBeGreaterThan(4);
    await page.keyboard.up('KeyW');

    await page.keyboard.press('KeyF');
    await expect.poll(async () => (await game.player(page)).flying).toBe(false);
    await expect.poll(async () => (await game.player(page)).onGround).toBe(true);
  });

  test('cannot walk through a wall of blocks', async ({ page }) => {
    await captureMouse(page);
    const yaw = await findOpenYaw(page);
    expect(yaw).not.toBeNull();
    const start = await game.player(page);
    const dx = -Math.round(Math.sin(yaw!));
    const dz = -Math.round(Math.cos(yaw!));

    // Build a two-high wall two blocks ahead by placing blocks on the ground there.
    await game.look(page, yaw!, -0.55);
    const ground = await game.target(page);
    expect(ground).not.toBeNull();
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    const wallX = ground!.x + ground!.nx;
    const wallY = ground!.y + ground!.ny;
    const wallZ = ground!.z + ground!.nz;
    await expect.poll(() => game.getBlock(page, wallX, wallY, wallZ)).not.toBe(0);
    // Aim at the top of the new block (this also refreshes the crosshair target).
    await game.look(page, yaw!, -0.2);
    expect(await game.target(page)).toMatchObject({ x: wallX, y: wallY, z: wallZ, ny: 1 });
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await expect.poll(() => game.getBlock(page, wallX, wallY + 1, wallZ)).not.toBe(0);

    await game.look(page, yaw!, 0);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2500);
    await page.keyboard.up('KeyW');

    const stopped = await game.player(page);
    const travelled = (stopped.x - start.x) * dx + (stopped.z - start.z) * dz;
    const wallDistance = (wallX + 0.5 - start.x) * dx + (wallZ + 0.5 - start.z) * dz;
    // The body (0.3 half-width) stops flush against the near face of the wall.
    expect(travelled).toBeGreaterThan(0.1);
    expect(travelled).toBeLessThanOrEqual(wallDistance - 0.5 - 0.3 + 0.001);
  });

  test('mouse movement turns the view', async ({ page }) => {
    const real = await captureMouse(page);
    test.skip(!real, 'this browser does not grant pointer lock to automation');
    const start = await game.player(page);
    const viewport = page.viewportSize()!;

    await page.mouse.move(viewport.width / 2 + 120, viewport.height / 3 + 60, { steps: 6 });
    await expect.poll(async () => (await game.player(page)).yaw).toBeLessThan(start.yaw - 0.05);
    const turned = await game.player(page);
    // Moving the mouse right turns right (yaw decreases); moving it down looks down.
    expect(turned.pitch).toBeLessThan(start.pitch - 0.02);
  });
});
