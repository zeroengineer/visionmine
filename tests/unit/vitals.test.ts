import { describe, expect, it } from 'vitest';
import { GAME_MODES } from '@/gameplay/modes/gameMode';
import { PlayerController } from '@/gameplay/movement/PlayerController';
import { Player } from '@/gameplay/player/Player';
import {
  fallDamage,
  MAX_AIR,
  MAX_HEALTH,
  MAX_HUNGER,
  SAFE_FALL,
  Vitals,
} from '@/gameplay/player/Vitals';
import { BlockId } from '@/world/blocks/blocks';
import { parsePlayerRecord } from '@/world/persistence/codec';
import { FakeInput } from './fakeInput';
import { flatWorld } from './helpers';

const REST = { headInWater: false, moving: false, sprinting: false };
/** Advances in simulation-sized steps so timers behave as in the game. */
function run(vitals: Vitals, seconds: number, activity = REST): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) vitals.update(1 / 60, activity);
}

describe('vitals', () => {
  it('start full and follow the game mode', () => {
    const vitals = new Vitals();
    expect([vitals.health, vitals.hunger, vitals.air]).toEqual([MAX_HEALTH, MAX_HUNGER, MAX_AIR]);
    expect(vitals.dead).toBe(false);
    expect(GAME_MODES.survival.vitals).toBe(true);
    expect(GAME_MODES.creative.vitals).toBe(false);
  });

  it('do nothing at all when switched off', () => {
    const vitals = new Vitals();
    vitals.enabled = false;
    run(vitals, 600, { headInWater: true, moving: true, sprinting: true });
    expect(vitals.damage(50)).toBe(0);
    vitals.exert(10);
    expect(vitals.eat(4)).toBe(false);
    expect([vitals.health, vitals.hunger, vitals.air]).toEqual([MAX_HEALTH, MAX_HUNGER, MAX_AIR]);
  });

  it('get hungry faster the harder the player works', () => {
    const idle = new Vitals();
    const walking = new Vitals();
    const sprinting = new Vitals();
    // A little over the round figures, so accumulated rounding cannot matter:
    // 0.01, 0.03 and 0.1 hunger per second.
    run(idle, 250);
    run(walking, 210, { ...REST, moving: true });
    run(sprinting, 205, { ...REST, moving: true, sprinting: true });
    expect(idle.hunger).toBe(MAX_HUNGER - 2);
    expect(walking.hunger).toBe(MAX_HUNGER - 6);
    expect(sprinting.hunger).toBe(0);
    // Mining and the like add to it directly.
    const miner = new Vitals();
    miner.exert(2.5);
    expect(miner.hunger).toBe(MAX_HUNGER - 2);
  });

  it('heal slowly while well fed, and not otherwise', () => {
    const fed = new Vitals();
    fed.damage(6);
    run(fed, 9);
    expect(fed.health).toBe(MAX_HEALTH - 4);

    const hungry = new Vitals();
    hungry.hunger = 10;
    hungry.damage(6);
    run(hungry, 30);
    expect(hungry.health).toBe(MAX_HEALTH - 6);
  });

  it('starve down to one health but no further', () => {
    const vitals = new Vitals();
    vitals.hunger = 0;
    run(vitals, 9);
    expect(vitals.health).toBe(MAX_HEALTH - 2);
    run(vitals, 400);
    expect(vitals.health).toBe(1);
    expect(vitals.dead).toBe(false);
  });

  it('run out of breath under water and then drown', () => {
    const vitals = new Vitals();
    const under = { ...REST, headInWater: true };
    run(vitals, 9.5, under);
    expect(vitals.air).toBeLessThan(1);
    expect(vitals.health).toBe(MAX_HEALTH);
    run(vitals, 3, under);
    expect(vitals.air).toBe(0);
    expect(vitals.health).toBe(MAX_HEALTH - 4);
    // Surfacing restores breath quickly and stops the damage.
    run(vitals, 2.5);
    expect(vitals.air).toBe(MAX_AIR);
    const after = vitals.health;
    run(vitals, 1);
    expect(vitals.health).toBeGreaterThanOrEqual(after);
    run(vitals, 60, under);
    expect(vitals.dead).toBe(true);
  });

  it('take a point of damage for each block fallen beyond the safe height', () => {
    expect(fallDamage(SAFE_FALL)).toBe(0);
    expect(fallDamage(3.9)).toBe(0);
    expect(fallDamage(4)).toBe(1);
    expect(fallDamage(10.5)).toBe(7);
    expect(fallDamage(-2)).toBe(0);
    const vitals = new Vitals();
    expect(vitals.land(8)).toBe(5);
    expect(vitals.health).toBe(MAX_HEALTH - 5);
    expect(vitals.land(100)).toBe(MAX_HEALTH - 5);
    expect(vitals.dead).toBe(true);
    // The dead take no more damage and cannot eat.
    expect(vitals.damage(3)).toBe(0);
    expect(vitals.eat(4)).toBe(false);
  });

  it('eat only when hungry, up to full', () => {
    const vitals = new Vitals();
    expect(vitals.eat(4)).toBe(false);
    vitals.hunger = 17;
    expect(vitals.eat(4)).toBe(true);
    expect(vitals.hunger).toBe(MAX_HUNGER);
    expect(vitals.eat(0)).toBe(false);
  });

  it('are restored from a save, ignoring nonsense', () => {
    const vitals = new Vitals();
    vitals.restore({ health: 7, hunger: 3 });
    expect(vitals.snapshot()).toEqual({ health: 7, hunger: 3 });
    vitals.restore({ health: 99, hunger: -4 });
    expect(vitals.snapshot()).toEqual({ health: MAX_HEALTH, hunger: MAX_HUNGER });
    // A player saved at zero health wakes up healed rather than dying on load.
    vitals.restore({ health: 0, hunger: 5 });
    expect(vitals.snapshot()).toEqual({ health: MAX_HEALTH, hunger: 5 });
    vitals.restore(null);
    expect(vitals.snapshot()).toEqual({ health: MAX_HEALTH, hunger: MAX_HUNGER });

    const record = parsePlayerRecord({ x: 1, y: 60, z: 2, health: 11, hunger: 'lots' }, 'w');
    expect(record?.health).toBe(11);
    expect(record?.hunger).toBeUndefined();
    expect(parsePlayerRecord({ x: 1, y: 60, z: 2 }, 'w')?.health).toBeUndefined();
  });
});

describe('fall distance', () => {
  function setup(height: number) {
    const world = flatWorld(10);
    const player = new Player();
    player.teleport(8.5, 11 + height, 8.5);
    const input = new FakeInput();
    const controller = new PlayerController(player, world, input.asManager());
    const run = (seconds: number): void => {
      for (let i = 0; i < Math.round(seconds * 60); i++) controller.step(1 / 60);
    };
    return { world, player, input, controller, run };
  }

  it('is reported once when the player lands', () => {
    const { controller, run, player } = setup(12);
    run(3);
    expect(player.onGround).toBe(true);
    const landing = controller.consumeLanding();
    expect(landing).toBeGreaterThan(11.8);
    expect(landing).toBeLessThanOrEqual(12);
    expect(controller.consumeLanding()).toBe(0);
    run(1);
    expect(controller.consumeLanding()).toBe(0);
  });

  it('counts from the top of a jump, so an ordinary jump is harmless', () => {
    const { controller, run, input } = setup(0);
    run(0.2);
    controller.consumeLanding();
    input.keys.add('Space');
    run(0.1);
    input.keys.delete('Space');
    run(1.5);
    const landing = controller.consumeLanding();
    expect(landing).toBeGreaterThan(1);
    expect(landing).toBeLessThan(1.6);
    expect(fallDamage(landing)).toBe(0);
  });

  it('is forgotten in water, on a ladder and while flying', () => {
    const wet = setup(20);
    // A two-deep pool to land in.
    for (let x = 7; x <= 9; x++) {
      for (let z = 7; z <= 9; z++) {
        wet.world.setBlock(x, 11, z, BlockId.Water);
        wet.world.setBlock(x, 12, z, BlockId.Water);
      }
    }
    wet.run(5);
    expect(wet.controller.consumeLanding()).toBe(0);

    const flier = setup(20);
    flier.controller.toggleFlying();
    flier.input.keys.add('KeyC');
    flier.run(4);
    flier.input.keys.delete('KeyC');
    flier.controller.toggleFlying();
    flier.run(2);
    // Only the short drop after flight was switched off counts.
    expect(flier.controller.consumeLanding()).toBeLessThan(3);

    const climber = setup(20);
    for (let y = 11; y <= 30; y++) climber.world.setBlock(8, y, 8, BlockId.Ladder, 0);
    climber.run(12);
    expect(climber.player.onGround).toBe(true);
    expect(climber.controller.consumeLanding()).toBe(0);
  });
});
