import { describe, expect, it } from 'vitest';
import { moveWithStepUp, type MoveResult } from '@/gameplay/collision/aabb';
import { GAME_MODES } from '@/gameplay/modes/gameMode';
import { PlayerController } from '@/gameplay/movement/PlayerController';
import {
  Player,
  PLAYER_EYE_HEIGHT,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
} from '@/gameplay/player/Player';
import { sanitizeSettings, settingsStore } from '@/state/settingsStore';
import { BlockId } from '@/world/blocks/blocks';
import { FakeInput } from './fakeInput';
import { flatWorld } from './helpers';

/** Player standing on a stone floor whose top is y = 11, facing -Z. */
function setup() {
  const world = flatWorld(10);
  const player = new Player();
  player.teleport(8.5, 11, 8.5);
  const input = new FakeInput();
  const controller = new PlayerController(player, world, input.asManager());
  const run = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) controller.step(1 / 60);
  };
  const tap = (code: string): void => {
    input.keys.add(code);
    controller.step(1 / 60);
    input.keys.delete(code);
    controller.step(1 / 60);
  };
  run(0.1);
  return { world, player, input, controller, run, tap };
}

/** Removes the floor in front of the player, leaving a cliff edge at z = 7. */
function digCliff(world: ReturnType<typeof flatWorld>): void {
  for (let z = 0; z < 7; z++) {
    for (let x = 6; x <= 10; x++) {
      for (let y = 6; y <= 10; y++) world.setBlock(x, y, z, BlockId.Air);
    }
  }
}

describe('sneaking', () => {
  it('is slower than walking and lowers the eyes', () => {
    const walk = setup();
    walk.input.keys.add('KeyW');
    walk.run(1);
    const sneak = setup();
    sneak.input.keys.add('KeyW');
    sneak.input.keys.add('KeyC');
    sneak.run(1);

    const walked = 8.5 - walk.player.position.z;
    const sneaked = 8.5 - sneak.player.position.z;
    expect(sneaked).toBeGreaterThan(0.8);
    expect(sneaked).toBeLessThan(walked / 2);
    expect(sneak.player.sneaking).toBe(true);
    expect(sneak.player.eyeHeight).toBeLessThan(PLAYER_EYE_HEIGHT);
    expect(walk.player.eyeHeight).toBe(PLAYER_EYE_HEIGHT);
  });

  it('cannot be combined with sprinting', () => {
    const { player, input, run } = setup();
    input.keys.add('KeyW');
    input.keys.add('ShiftLeft');
    input.keys.add('KeyC');
    run(0.5);
    expect(player.sprinting).toBe(false);
  });

  it('stops at a ledge instead of walking off', () => {
    const { world, player, input, run } = setup();
    digCliff(world);
    input.keys.add('KeyW');
    input.keys.add('KeyC');
    run(4);
    expect(player.position.y).toBe(11);
    expect(player.onGround).toBe(true);
    // The body may overhang, but part of it stays over the last block (z = 7..8).
    expect(player.position.z + PLAYER_HALF_WIDTH).toBeGreaterThan(7);
    expect(player.position.z).toBeLessThan(7.2);
  });

  it('can still move along the ledge', () => {
    const { world, player, input, run } = setup();
    digCliff(world);
    input.keys.add('KeyW');
    input.keys.add('KeyC');
    run(4);
    input.keys.add('KeyD');
    run(1);
    expect(player.position.x).toBeGreaterThan(9);
    expect(player.position.y).toBe(11);
  });

  it('does not hold back a player who is not sneaking', () => {
    const { world, player, input, run } = setup();
    digCliff(world);
    input.keys.add('KeyW');
    run(3);
    expect(player.position.y).toBeLessThan(11);
  });

  it('descends instead while flying', () => {
    const { player, input, controller, run } = setup();
    controller.toggleFlying();
    player.teleport(8.5, 20, 8.5);
    input.keys.add('KeyC');
    run(0.5);
    expect(player.sneaking).toBe(false);
    expect(player.position.y).toBeLessThan(19);
  });
});

describe('stepping up', () => {
  function ledge(height: number) {
    const s = setup();
    // A raised terrace covering everything north of z = 7.
    for (let x = 6; x <= 10; x++) {
      for (let z = 0; z <= 6; z++) {
        for (let y = 11; y < 11 + height; y++) s.world.setBlock(x, y, z, BlockId.Stone);
      }
    }
    return s;
  }

  it('does not climb a full block by default', () => {
    const { player, input, run } = ledge(1);
    input.keys.add('KeyW');
    run(2);
    expect(player.position.y).toBe(11);
    expect(player.position.z).toBeGreaterThan(7);
  });

  it('climbs a full block with auto-jump and eases the camera up', () => {
    const { player, input, controller, run } = ledge(1);
    controller.autoJump = true;
    input.keys.add('KeyW');
    let lowest = 0;
    for (let i = 0; i < 120; i++) {
      controller.step(1 / 60);
      lowest = Math.min(lowest, player.viewOffsetY);
    }
    expect(player.position.y).toBe(12);
    expect(player.onGround).toBe(true);
    expect(player.position.z).toBeLessThan(7);
    // The view started a block low and has caught up.
    expect(lowest).toBeLessThan(-0.9);
    run(1);
    expect(player.viewOffsetY).toBe(0);
  });

  it('never climbs a two-block wall', () => {
    const { player, input, controller, run } = ledge(2);
    controller.autoJump = true;
    input.keys.add('KeyW');
    run(2);
    expect(player.position.y).toBe(11);
  });

  it('does not step up where there is no headroom', () => {
    const { world, player, input, controller, run } = ledge(1);
    controller.autoJump = true;
    // A ceiling two blocks above the floor leaves no room to rise.
    for (let x = 6; x <= 10; x++) {
      for (let z = 5; z <= 9; z++) world.setBlock(x, 13, z, BlockId.Stone);
    }
    input.keys.add('KeyW');
    run(2);
    expect(player.position.y).toBe(11);
  });

  it('reports no rise when nothing blocks the way', () => {
    const { world } = setup();
    const position = { x: 8.5, y: 11, z: 8.5 };
    const velocity = { x: 0, y: 0, z: -4 };
    const result: MoveResult = { onGround: false, hitCeiling: false, hitWall: false };
    const rise = moveWithStepUp(
      world,
      position,
      velocity,
      1 / 60,
      PLAYER_HALF_WIDTH,
      PLAYER_HEIGHT,
      result,
      1.05,
    );
    expect(rise).toBe(0);
    expect(position.y).toBe(11);
    expect(position.z).toBeCloseTo(8.5 - 4 / 60, 6);
  });
});

describe('air jump', () => {
  function jumpThenPressAgain(configure: (c: PlayerController) => void) {
    const s = setup();
    s.controller.allowFlying = false;
    configure(s.controller);
    s.input.keys.add('Space');
    s.run(0.1);
    s.input.keys.delete('Space');
    s.run(0.3);
    let peak = s.player.position.y;
    s.input.keys.add('Space');
    for (let i = 0; i < 6; i++) {
      s.controller.step(1 / 60);
      peak = Math.max(peak, s.player.position.y);
    }
    s.input.keys.delete('Space');
    for (let i = 0; i < 90; i++) {
      s.controller.step(1 / 60);
      peak = Math.max(peak, s.player.position.y);
    }
    return { ...s, peak };
  }

  it('gives one extra jump in mid-air when the mode allows it', () => {
    const single = jumpThenPressAgain(() => undefined);
    const double = jumpThenPressAgain((c) => (c.maxAirJumps = 1));
    expect(single.peak - 11).toBeLessThan(1.6);
    expect(double.peak - 11).toBeGreaterThan(2.2);
    expect(double.player.position.y).toBe(11);
  });

  it('is limited to the allowed number until the player lands', () => {
    const s = setup();
    s.controller.allowFlying = false;
    s.controller.maxAirJumps = 1;
    s.input.keys.add('Space');
    s.run(0.1);
    s.input.keys.delete('Space');
    s.run(0.3);
    s.tap('Space');
    s.run(0.3);
    const falling = s.player.velocity.y;
    s.tap('Space');
    // The third press did nothing: the player keeps falling.
    expect(s.player.velocity.y).toBeLessThan(falling);

    // After landing the extra jump is available again.
    s.run(3);
    expect(s.player.onGround).toBe(true);
    s.input.keys.add('Space');
    s.run(0.1);
    s.input.keys.delete('Space');
    s.run(0.3);
    s.tap('Space');
    expect(s.player.velocity.y).toBeGreaterThan(5);
  });

  it('does not fire on a quick double tap, which toggles flying instead', () => {
    const s = setup();
    s.controller.maxAirJumps = 1;
    s.tap('Space');
    s.tap('Space');
    expect(s.player.flying).toBe(true);
  });

  it('follows the game mode', () => {
    expect(GAME_MODES.creative.airJumps).toBe(1);
    expect(GAME_MODES.creative.canDash).toBe(true);
    expect(GAME_MODES.survival.airJumps).toBe(0);
    expect(GAME_MODES.survival.canDash).toBe(false);
  });
});

describe('dash', () => {
  it('bursts forward without a movement key and then has a cooldown', () => {
    const { player, controller, run, tap } = setup();
    controller.allowDash = true;
    tap('KeyR');
    run(0.5);
    const first = 8.5 - player.position.z;
    expect(first).toBeGreaterThan(2.5);
    expect(first).toBeLessThan(6);
    expect(Math.abs(player.position.x - 8.5)).toBeLessThan(0.001);

    // Still cooling down: a second press does nothing.
    const before = player.position.z;
    tap('KeyR');
    run(0.3);
    expect(before - player.position.z).toBeLessThan(0.2);

    run(1);
    const ready = player.position.z;
    tap('KeyR');
    run(0.5);
    expect(ready - player.position.z).toBeGreaterThan(2.5);
  });

  it('goes where the player is steering', () => {
    const { player, input, controller, run } = setup();
    controller.allowDash = true;
    input.keys.add('KeyD');
    input.keys.add('KeyR');
    run(0.3);
    expect(player.position.x - 8.5).toBeGreaterThan(2);
    expect(Math.abs(player.position.z - 8.5)).toBeLessThan(0.01);
  });

  it('is stopped by walls and unavailable when the mode forbids it', () => {
    const walled = setup();
    walled.controller.allowDash = true;
    for (let y = 11; y <= 13; y++) walled.world.setBlock(8, y, 6, BlockId.Stone);
    walled.tap('KeyR');
    walled.run(0.5);
    expect(walled.player.position.z).toBeGreaterThan(7.29);

    const forbidden = setup();
    forbidden.tap('KeyR');
    forbidden.run(0.5);
    expect(forbidden.player.position.z).toBeCloseTo(8.5, 5);
  });
});

describe('sprint toggle and fly speed', () => {
  it('keeps sprinting after one press until the player stops', () => {
    const { player, input, controller, run, tap } = setup();
    controller.sprintToggle = true;
    input.keys.add('KeyW');
    run(0.2);
    expect(player.sprinting).toBe(false);
    tap('ShiftLeft');
    run(0.5);
    expect(player.sprinting).toBe(true);
    tap('ShiftLeft');
    run(0.1);
    expect(player.sprinting).toBe(false);

    tap('ShiftLeft');
    run(0.1);
    expect(player.sprinting).toBe(true);
    input.keys.delete('KeyW');
    run(0.1);
    input.keys.add('KeyW');
    run(0.1);
    expect(player.sprinting).toBe(false);
  });

  it('holds to sprint when the toggle is off', () => {
    const { player, input, run, tap } = setup();
    input.keys.add('KeyW');
    tap('ShiftLeft');
    run(0.2);
    expect(player.sprinting).toBe(false);
  });

  it('scales flying speed', () => {
    const distance = (scale: number): number => {
      const { player, input, controller, run } = setup();
      controller.toggleFlying();
      controller.flySpeedScale = scale;
      input.keys.add('KeyW');
      run(1);
      return 8.5 - player.position.z;
    };
    const normal = distance(1);
    expect(distance(2)).toBeGreaterThan(normal * 1.7);
    expect(distance(0.5)).toBeLessThan(normal * 0.6);
  });

  it('stores the two movement settings', () => {
    const base = sanitizeSettings({}, settingsStore.getState());
    expect(base.autoJump).toBe(false);
    expect(base.sprintToggle).toBe(false);
    const changed = sanitizeSettings({ autoJump: true, sprintToggle: 'yes' }, base);
    expect(changed.autoJump).toBe(true);
    expect(changed.sprintToggle).toBe(false);
  });
});

describe('quick taps', () => {
  it('count even when the key is released before the next simulation step', () => {
    const jumper = setup();
    jumper.controller.allowFlying = false;
    // Pressed and released between two steps: never seen as held.
    jumper.input.press('Space');
    jumper.controller.step(1 / 60);
    expect(jumper.player.velocity.y).toBeGreaterThan(5);

    const dasher = setup();
    dasher.controller.allowDash = true;
    dasher.input.press('KeyR');
    dasher.run(0.5);
    expect(8.5 - dasher.player.position.z).toBeGreaterThan(2.5);
  });

  it('are ignored while input is not captured', () => {
    const { player, input, controller } = setup();
    input.isLocked = false;
    input.press('Space');
    controller.step(1 / 60);
    input.isLocked = true;
    controller.step(1 / 60);
    expect(player.position.y).toBe(11);
  });
});
