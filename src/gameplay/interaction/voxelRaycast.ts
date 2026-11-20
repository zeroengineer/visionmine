import { IS_LIQUID } from '@/world/blocks/blocks';
import type { BlockQuery } from '../collision/aabb';

export interface RaycastHit {
  /** Integer coordinates of the block that was hit. */
  x: number;
  y: number;
  z: number;
  /** Outward normal of the face that was hit (points back toward the ray origin). */
  nx: number;
  ny: number;
  nz: number;
  block: number;
  distance: number;
}

export function createRaycastHit(): RaycastHit {
  return { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, block: 0, distance: 0 };
}

/** Default target test: any block that is neither air nor liquid. */
export function isSelectable(id: number): boolean {
  return id !== 0 && IS_LIQUID[id] !== 1;
}

/**
 * Walks a ray through the voxel grid (Amanatides & Woo DDA), visiting each
 * block the ray passes through exactly once. Cost is proportional to
 * `maxDistance`, independent of world size or mesh complexity.
 *
 * @returns true and fills `hit` when a block satisfying `isTarget` is found.
 */
export function raycastVoxels(
  blocks: BlockQuery,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
  hit: RaycastHit,
  isTarget: (id: number) => boolean = isSelectable,
): boolean {
  const length = Math.hypot(dx, dy, dz);
  if (length === 0) return false;
  dx /= length;
  dy /= length;
  dz /= length;

  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  // Distance along the ray between consecutive grid planes on each axis.
  const deltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const deltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const deltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  // Distance along the ray to the first plane crossing on each axis.
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * deltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * deltaY : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * deltaZ : Infinity;

  let distance = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;

  while (distance <= maxDistance) {
    const id = blocks.getBlock(x, y, z);
    if (isTarget(id)) {
      hit.x = x;
      hit.y = y;
      hit.z = z;
      hit.nx = nx;
      hit.ny = ny;
      hit.nz = nz;
      hit.block = id;
      hit.distance = distance;
      return true;
    }
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      x += stepX;
      distance = tMaxX;
      tMaxX += deltaX;
      nx = -stepX;
      ny = 0;
      nz = 0;
    } else if (tMaxY <= tMaxZ) {
      y += stepY;
      distance = tMaxY;
      tMaxY += deltaY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      z += stepZ;
      distance = tMaxZ;
      tMaxZ += deltaZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }
  }
  return false;
}
