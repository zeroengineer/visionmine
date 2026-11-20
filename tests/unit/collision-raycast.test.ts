import { describe, expect, it } from 'vitest';
import {
  bodyCollides,
  boxCollides,
  moveAndCollide,
  type MoveResult,
} from '@/gameplay/collision/aabb';
import { createRaycastHit, raycastVoxels } from '@/gameplay/interaction/voxelRaycast';
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from '@/gameplay/player/Player';
import { BlockId } from '@/world/blocks/blocks';
import { flatWorld } from './helpers';

const H = PLAYER_HALF_WIDTH;
const result = (): MoveResult => ({ onGround: false, hitCeiling: false, hitWall: false });

describe('AABB collision', () => {
  it('detects overlap with solid blocks only', () => {
    const world = flatWorld(10);
    expect(boxCollides(world, 0.2, 11, 0.2, 0.8, 12.8, 0.8)).toBe(false);
    expect(boxCollides(world, 0.2, 10.5, 0.2, 0.8, 12, 0.8)).toBe(true);
    world.setBlock(0, 11, 0, BlockId.Water);
    expect(boxCollides(world, 0.2, 11, 0.2, 0.8, 12.8, 0.8)).toBe(false);
  });

  it('lands on the floor and reports ground contact', () => {
    const world = flatWorld(10);
    const position = { x: 8.5, y: 14, z: 8.5 };
    const velocity = { x: 0, y: 0, z: 0 };
    const r = result();
    for (let i = 0; i < 240 && !r.onGround; i++) {
      velocity.y -= 30 / 60;
      moveAndCollide(world, position, velocity, 1 / 60, H, PLAYER_HEIGHT, r);
    }
    expect(r.onGround).toBe(true);
    expect(position.y).toBe(11);
    expect(velocity.y).toBe(0);
  });

  it('stops at walls in both directions on each horizontal axis', () => {
    const world = flatWorld(10);
    for (let y = 11; y <= 13; y++) {
      world.setBlock(11, y, 8, BlockId.Stone);
      world.setBlock(5, y, 8, BlockId.Stone);
      world.setBlock(8, y, 11, BlockId.Stone);
      world.setBlock(8, y, 5, BlockId.Stone);
    }
    const run = (vx: number, vz: number) => {
      const position = { x: 8.5, y: 11, z: 8.5 };
      const velocity = { x: vx, y: 0, z: vz };
      const r = result();
      let hit = false;
      for (let i = 0; i < 120; i++) {
        moveAndCollide(world, position, velocity, 1 / 60, H, PLAYER_HEIGHT, r);
        hit ||= r.hitWall;
      }
      return { position, hit };
    };
    const east = run(5, 0);
    expect(east.hit).toBe(true);
    expect(east.position.x).toBeCloseTo(11 - H, 3);
    const west = run(-5, 0);
    expect(west.position.x).toBeCloseTo(6 + H, 3);
    const south = run(0, 5);
    expect(south.position.z).toBeCloseTo(11 - H, 3);
    const north = run(0, -5);
    expect(north.position.z).toBeCloseTo(6 + H, 3);
    for (const { position } of [east, west, south, north]) {
      expect(bodyCollides(world, position, H, PLAYER_HEIGHT)).toBe(false);
    }
  });

  it('stops at ceilings', () => {
    const world = flatWorld(10);
    world.setBlock(8, 13, 8, BlockId.Stone);
    const position = { x: 8.5, y: 11, z: 8.5 };
    const velocity = { x: 0, y: 8, z: 0 };
    const r = result();
    let hit = false;
    for (let i = 0; i < 30; i++) {
      moveAndCollide(world, position, velocity, 1 / 60, H, PLAYER_HEIGHT, r);
      hit ||= r.hitCeiling;
    }
    expect(hit).toBe(true);
    expect(position.y + PLAYER_HEIGHT).toBeLessThanOrEqual(13);
    expect(position.y + PLAYER_HEIGHT).toBeGreaterThan(12.99);
  });

  it('never tunnels through a one-block layer at extreme speed', () => {
    const world = flatWorld(2);
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++) world.setBlock(x, 60, z, BlockId.Stone);
    const position = { x: 8.5, y: 100, z: 8.5 };
    const velocity = { x: 0, y: -400, z: 0 };
    const r = result();
    moveAndCollide(world, position, velocity, 0.1, H, PLAYER_HEIGHT, r);
    expect(r.onGround).toBe(true);
    expect(position.y).toBe(61);

    for (let y = 11; y <= 13; y++) world.setBlock(12, y, 8, BlockId.Stone);
    const p2 = { x: 8.5, y: 61, z: 8.5 };
    const wallWorld = flatWorld(10);
    for (let y = 11; y <= 13; y++) wallWorld.setBlock(12, y, 8, BlockId.Stone);
    p2.y = 11;
    moveAndCollide(wallWorld, p2, { x: 300, y: 0, z: 0 }, 0.1, H, PLAYER_HEIGHT, r);
    expect(p2.x).toBeLessThan(12);
  });

  it('slides along a wall instead of sticking', () => {
    const world = flatWorld(10);
    for (let z = 0; z < 16; z++)
      for (let y = 11; y <= 13; y++) world.setBlock(11, y, z, BlockId.Stone);
    const position = { x: 10.5, y: 11, z: 4.5 };
    const velocity = { x: 4, y: 0, z: 4 };
    const r = result();
    for (let i = 0; i < 60; i++) {
      velocity.x = 4;
      moveAndCollide(world, position, velocity, 1 / 60, H, PLAYER_HEIGHT, r);
    }
    expect(position.x).toBeLessThan(11 - H + 0.001);
    expect(position.z).toBeGreaterThan(8);
  });
});

describe('voxel raycast', () => {
  it('hits the first solid block and reports the entered face', () => {
    const world = flatWorld(10);
    world.setBlock(8, 12, 4, BlockId.Brick);
    const hit = createRaycastHit();
    expect(raycastVoxels(world, 8.5, 12.5, 8.5, 0, 0, -1, 8, hit)).toBe(true);
    expect([hit.x, hit.y, hit.z]).toEqual([8, 12, 4]);
    expect([hit.nx, hit.ny, hit.nz]).toEqual([0, 0, 1]);
    expect(hit.block).toBe(BlockId.Brick);
    expect(hit.distance).toBeCloseTo(3.5, 5);
  });

  it('hits the ground looking down and reports an upward normal', () => {
    const world = flatWorld(10);
    const hit = createRaycastHit();
    expect(raycastVoxels(world, 3.3, 12.62, 4.7, 0.2, -1, 0.1, 6, hit)).toBe(true);
    expect(hit.y).toBe(10);
    expect([hit.nx, hit.ny, hit.nz]).toEqual([0, 1, 0]);
  });

  it('misses beyond the reach and in empty space', () => {
    const world = flatWorld(10);
    world.setBlock(8, 12, 0, BlockId.Brick);
    const hit = createRaycastHit();
    expect(raycastVoxels(world, 8.5, 12.5, 8.5, 0, 0, -1, 5, hit)).toBe(false);
    expect(raycastVoxels(world, 8.5, 12.5, 8.5, 0, 1, 0, 50, hit)).toBe(false);
    expect(raycastVoxels(world, 8.5, 12.5, 8.5, 0, 0, 0, 50, hit)).toBe(false);
  });

  it('passes through water by default but can target it with a custom predicate', () => {
    const world = flatWorld(10);
    world.setBlock(8, 12, 6, BlockId.Water);
    world.setBlock(8, 12, 4, BlockId.Stone);
    const hit = createRaycastHit();
    raycastVoxels(world, 8.5, 12.5, 8.5, 0, 0, -1, 8, hit);
    expect(hit.z).toBe(4);
    raycastVoxels(world, 8.5, 12.5, 8.5, 0, 0, -1, 8, hit, (id) => id !== 0);
    expect(hit.z).toBe(6);
  });

  it('works across chunk borders and negative coordinates', () => {
    const world = flatWorld(10);
    world.setBlock(-3, 12, -2, BlockId.Planks);
    const hit = createRaycastHit();
    expect(raycastVoxels(world, 2.5, 12.5, -1.5, -1, 0, 0, 8, hit)).toBe(true);
    expect([hit.x, hit.y, hit.z]).toEqual([-3, 12, -2]);
    expect([hit.nx, hit.ny, hit.nz]).toEqual([1, 0, 0]);
  });
});
