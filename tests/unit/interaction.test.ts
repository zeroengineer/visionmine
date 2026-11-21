import { describe, expect, it } from 'vitest';
import { actionForCode, defaultBindings, type ActionId } from '@/core/input/actions';
import type { InputManager, InputEvents } from '@/core/input/InputManager';
import {
  BlockInteraction,
  blockIntersectsPlayer,
  canPlaceBlock,
  type InteractionRules,
} from '@/gameplay/interaction/BlockInteraction';
import { explode } from '@/gameplay/interaction/explosion';
import { TntManager } from '@/gameplay/interaction/TntManager';
import { PlayerController } from '@/gameplay/movement/PlayerController';
import { Player } from '@/gameplay/player/Player';
import { Emitter } from '@/utils/Emitter';
import { mulberry32 } from '@/utils/rng';
import { BlockId } from '@/world/blocks/blocks';
import { flatWorld } from './helpers';

/** Stands in for InputManager with the default bindings. */
class FakeInput {
  readonly events = new Emitter<InputEvents>();
  isLocked = true;
  /** Held codes: keyboard codes and `Mouse0`–`Mouse2`. */
  readonly keys = new Set<string>();
  private readonly bindings = defaultBindings();
  isDown = (code: string): boolean => this.keys.has(code);
  isActionDown = (action: ActionId): boolean =>
    this.bindings[action].some((code) => this.keys.has(code));
  /** A momentary press: fires the bound action without holding the code. */
  press(code: string): void {
    const action = actionForCode(this.bindings, code);
    if (action) this.events.emit('action', { action });
  }
  consumeLook(out: { x: number; y: number }): void {
    out.x = 0;
    out.y = 0;
  }
  asManager(): InputManager {
    return this as unknown as InputManager;
  }
}

function setup(instant = true, selected: number = BlockId.Planks) {
  const world = flatWorld(10);
  const player = new Player();
  player.teleport(8.5, 11, 8.5);
  const input = new FakeInput();
  const log: string[] = [];
  const rules: InteractionRules = {
    instantBreak: () => instant,
    selectedBlock: () => selected,
    onPlaced: (b) => log.push(`placed:${b}`),
    onBroken: (b) => log.push(`broken:${b}`),
    onPicked: (b) => log.push(`picked:${b}`),
    onUse: () => false,
  };
  const interaction = new BlockInteraction(world, player, input.asManager(), rules);
  return { world, player, input, interaction, log };
}

describe('block placement rules', () => {
  it('detects blocks overlapping the player body', () => {
    const feet = { x: 8.5, y: 11, z: 8.5 };
    expect(blockIntersectsPlayer(8, 11, 8, feet)).toBe(true);
    expect(blockIntersectsPlayer(8, 12, 8, feet)).toBe(true);
    expect(blockIntersectsPlayer(8, 13, 8, feet)).toBe(false);
    expect(blockIntersectsPlayer(8, 10, 8, feet)).toBe(false);
    expect(blockIntersectsPlayer(9, 11, 8, feet)).toBe(false);
    expect(blockIntersectsPlayer(8, 11, 8, { x: 8.95, y: 11, z: 8.5 })).toBe(true);
    expect(blockIntersectsPlayer(9, 11, 8, { x: 8.95, y: 11, z: 8.5 })).toBe(true);
  });

  it('refuses placement inside the player, in occupied cells and out of range', () => {
    const { world, player } = setup();
    const feet = player.position;
    expect(canPlaceBlock(world, 8, 11, 8, BlockId.Stone, feet)).toBe(false);
    expect(canPlaceBlock(world, 8, 12, 8, BlockId.Stone, feet)).toBe(false);
    expect(canPlaceBlock(world, 8, 10, 8, BlockId.Stone, feet)).toBe(false); // occupied
    expect(canPlaceBlock(world, 8, 128, 8, BlockId.Stone, feet)).toBe(false);
    expect(canPlaceBlock(world, 8, 11, 8, BlockId.Air, feet)).toBe(false);
    expect(canPlaceBlock(world, 500, 11, 500, BlockId.Stone, feet)).toBe(false); // unloaded
    expect(canPlaceBlock(world, 10, 11, 8, BlockId.Stone, feet)).toBe(true);
    // Non-solid blocks may share the player's cell; liquids are replaceable.
    expect(canPlaceBlock(world, 8, 11, 8, BlockId.Water, feet)).toBe(true);
    world.setBlock(10, 11, 8, BlockId.Water);
    expect(canPlaceBlock(world, 10, 11, 8, BlockId.Stone, feet)).toBe(true);
  });
});

describe('BlockInteraction', () => {
  it('targets the block under the crosshair', () => {
    const { interaction, player } = setup();
    player.pitch = -Math.PI / 2 + 0.01;
    interaction.retarget();
    expect(interaction.target).toMatchObject({ x: 8, y: 10, z: 8, ny: 1 });
    player.pitch = Math.PI / 2 - 0.01;
    interaction.retarget();
    expect(interaction.target).toBeNull();
  });

  it('breaks the targeted block on left click and notifies listeners', () => {
    const { world, interaction, input, player, log } = setup();
    const events: string[] = [];
    interaction.events.on('broken', (e) => events.push(`${e.x},${e.y},${e.z}:${e.block}`));
    player.pitch = -Math.PI / 2 + 0.01;
    interaction.update(1 / 60);
    input.press('Mouse0');
    expect(world.getBlock(8, 10, 8)).toBe(BlockId.Air);
    expect(events).toEqual([`8,10,8:${BlockId.Stone}`]);
    expect(log).toEqual([`broken:${BlockId.Stone}`]);
    // The next block down becomes the target immediately.
    expect(interaction.target).toMatchObject({ y: 9 });
  });

  it('places the selected block against the targeted face on right click', () => {
    const { world, interaction, input, player, log } = setup();
    world.setBlock(8, 12, 5, BlockId.Stone);
    player.yaw = 0;
    player.pitch = 0;
    interaction.update(1 / 60);
    expect(interaction.target).toMatchObject({ x: 8, y: 12, z: 5, nz: 1 });
    input.press('Mouse2');
    expect(world.getBlock(8, 12, 6)).toBe(BlockId.Planks);
    expect(log).toEqual([`placed:${BlockId.Planks}`]);
  });

  it('does not place a block inside the player', () => {
    const { world, interaction, input, player, log } = setup();
    player.pitch = -Math.PI / 2 + 0.01; // looking at own feet; target face is the floor top
    interaction.update(1 / 60);
    input.press('Mouse2');
    expect(world.getBlock(8, 11, 8)).toBe(BlockId.Air);
    expect(log).toEqual([]);
  });

  it('does nothing with an empty hand and ignores input while unlocked', () => {
    const empty = setup(true, 0);
    empty.player.pitch = -1;
    empty.interaction.update(1 / 60);
    empty.input.press('Mouse2');
    expect(empty.log).toEqual([]);

    const { world, interaction, input, player } = setup();
    player.pitch = -Math.PI / 2 + 0.01;
    interaction.update(1 / 60);
    input.isLocked = false;
    input.press('Mouse0');
    expect(world.getBlock(8, 10, 8)).toBe(BlockId.Stone);
  });

  it('takes time to mine in survival and never breaks bedrock', () => {
    const { world, interaction, input, player } = setup(false);
    player.pitch = -Math.PI / 2 + 0.01;
    input.keys.add('Mouse0');
    interaction.update(0.5);
    expect(world.getBlock(8, 10, 8)).toBe(BlockId.Stone); // stone hardness is 1.5 s
    expect(interaction.breakProgress).toBeGreaterThan(0);
    for (let i = 0; i < 80; i++) interaction.update(1 / 60);
    expect(world.getBlock(8, 10, 8)).toBe(BlockId.Air);

    world.setBlock(8, 9, 8, BlockId.Bedrock);
    for (let i = 0; i < 600; i++) interaction.update(1 / 60);
    expect(world.getBlock(8, 9, 8)).toBe(BlockId.Bedrock);
  });

  it('picks the targeted block on middle click', () => {
    const { interaction, input, player, log } = setup();
    player.pitch = -Math.PI / 2 + 0.01;
    interaction.update(1 / 60);
    input.press('Mouse1');
    expect(log).toEqual([`picked:${BlockId.Stone}`]);
  });
});

describe('PlayerController', () => {
  function controllerSetup() {
    const world = flatWorld(10);
    const player = new Player();
    player.teleport(8.5, 20, 8.5);
    const input = new FakeInput();
    const controller = new PlayerController(player, world, input.asManager());
    const run = (seconds: number): void => {
      for (let i = 0; i < Math.round(seconds * 60); i++) controller.step(1 / 60);
    };
    return { world, player, input, controller, run };
  }

  it('falls under gravity and lands on the ground', () => {
    const { player, run } = controllerSetup();
    run(2);
    expect(player.position.y).toBe(11);
    expect(player.onGround).toBe(true);
  });

  it('walks forward along the view direction and sprints faster', () => {
    const walk = controllerSetup();
    walk.run(1.5);
    walk.input.keys.add('KeyW');
    walk.run(1);
    const walked = 8.5 - walk.player.position.z; // yaw 0 faces -Z
    expect(walked).toBeGreaterThan(3);
    expect(Math.abs(walk.player.position.x - 8.5)).toBeLessThan(0.001);

    const sprint = controllerSetup();
    sprint.run(1.5);
    sprint.input.keys.add('KeyW');
    sprint.input.keys.add('ShiftLeft');
    sprint.run(1);
    expect(8.5 - sprint.player.position.z).toBeGreaterThan(walked + 1);
    expect(sprint.player.sprinting).toBe(true);
  });

  it('jumps a little over one block and returns to the ground', () => {
    const { player, input, run, controller } = controllerSetup();
    run(1.5);
    input.keys.add('Space');
    let peak = player.position.y;
    for (let i = 0; i < 20; i++) {
      controller.step(1 / 60);
      peak = Math.max(peak, player.position.y);
    }
    input.keys.delete('Space');
    for (let i = 0; i < 60; i++) {
      controller.step(1 / 60);
      peak = Math.max(peak, player.position.y);
    }
    expect(peak - 11).toBeGreaterThan(1.05);
    expect(peak - 11).toBeLessThan(1.6);
    expect(player.position.y).toBe(11);
  });

  it('is blocked by walls and does not move without pointer lock', () => {
    const blocked = controllerSetup();
    for (let y = 11; y <= 13; y++) blocked.world.setBlock(8, y, 6, BlockId.Stone);
    blocked.run(1.5);
    blocked.input.keys.add('KeyW');
    blocked.run(2);
    expect(blocked.player.position.z).toBeGreaterThan(7);

    const idle = controllerSetup();
    idle.run(1.5);
    idle.input.isLocked = false;
    idle.input.keys.add('KeyW');
    idle.run(1);
    expect(idle.player.position.z).toBeCloseTo(8.5, 5);
  });

  it('flies when allowed and stays grounded when not', () => {
    const { player, input, run, controller } = controllerSetup();
    run(1.5);
    controller.toggleFlying();
    expect(player.flying).toBe(true);
    input.keys.add('Space');
    run(1);
    expect(player.position.y).toBeGreaterThan(14);
    input.keys.delete('Space');
    run(1);
    const hover = player.position.y;
    run(0.5);
    expect(player.position.y).toBeCloseTo(hover, 1);

    controller.allowFlying = false;
    run(0.1);
    expect(player.flying).toBe(false);
    controller.toggleFlying();
    expect(player.flying).toBe(false);
  });

  it('freezes inside unloaded terrain and can be placed on the surface', () => {
    const { player, controller, run } = controllerSetup();
    player.teleport(900.5, 50, 900.5);
    run(1);
    expect(player.position.y).toBe(50);
    expect(controller.placeOnGround()).toBe(false);
    player.teleport(3.5, 90, 3.5);
    expect(controller.placeOnGround()).toBe(true);
    expect(player.position.y).toBe(11);
  });
});

describe('explosions', () => {
  it('removes a sphere of breakable blocks but keeps bedrock and water', () => {
    const world = flatWorld(20);
    world.setBlock(8, 0, 8, BlockId.Bedrock);
    world.setBlock(8, 15, 9, BlockId.Bedrock);
    world.setBlock(9, 15, 8, BlockId.Water);
    const result = explode(world, 8, 15, 8, 3, 0, () => 0);
    expect(world.getBlock(8, 15, 8)).toBe(BlockId.Air);
    expect(world.getBlock(8, 17, 8)).toBe(BlockId.Air);
    expect(world.getBlock(8, 15, 9)).toBe(BlockId.Bedrock);
    expect(world.getBlock(9, 15, 8)).toBe(BlockId.Water);
    expect(world.getBlock(8, 15, 12)).toBe(BlockId.Stone); // outside the radius
    expect(result.removed.length).toBeGreaterThan(90);
    expect(result.removed.every((b) => Math.hypot(b.x - 8, b.y - 15, b.z - 8) <= 3)).toBe(true);
  });

  it('counts down fuses and chains to neighbouring TNT', () => {
    const world = flatWorld(20);
    world.setBlock(8, 21, 8, BlockId.Tnt);
    world.setBlock(10, 21, 8, BlockId.Tnt);
    const tnt = new TntManager(world, mulberry32(7));
    const explosions: number[] = [];
    tnt.events.on('exploded', (e) => explosions.push(e.x));

    expect(tnt.ignite(8, 20, 8)).toBe(false); // not TNT
    expect(tnt.ignite(8, 21, 8)).toBe(true);
    expect(tnt.ignite(8, 21, 8)).toBe(false); // already lit
    tnt.update(1);
    expect(explosions).toEqual([]);
    tnt.update(0.7);
    expect(explosions).toEqual([8]);
    expect(world.getBlock(8, 21, 8)).toBe(BlockId.Air);
    expect(world.getBlock(10, 21, 8)).toBe(BlockId.Tnt); // primed, not yet exploded
    expect(tnt.active).toHaveLength(1);
    tnt.update(0.5);
    expect(explosions).toEqual([8, 10]);
    expect(tnt.active).toHaveLength(0);
  });
});
