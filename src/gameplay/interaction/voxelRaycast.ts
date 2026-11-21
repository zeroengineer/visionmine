import { blockBoxes, IS_CUBE, IS_LIQUID } from '@/world/blocks/blocks';
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
  /** World position where the ray met the block. */
  px: number;
  py: number;
  pz: number;
}

export function createRaycastHit(): RaycastHit {
  return { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, block: 0, distance: 0, px: 0, py: 0, pz: 0 };
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
      if (IS_CUBE[id] === 1) {
        hit.x = x;
        hit.y = y;
        hit.z = z;
        hit.nx = nx;
        hit.ny = ny;
        hit.nz = nz;
        hit.block = id;
        hit.distance = distance;
        hit.px = ox + dx * distance;
        hit.py = oy + dy * distance;
        hit.pz = oz + dz * distance;
        return true;
      }
      // A shaped block fills only part of its cell: test its boxes exactly.
      const meta = blocks.getMeta?.(x, y, z) ?? 0;
      if (hitBoxes(blockBoxes(id, meta), x, y, z, ox, oy, oz, dx, dy, dz, maxDistance, hit)) {
        hit.x = x;
        hit.y = y;
        hit.z = z;
        hit.block = id;
        return true;
      }
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

/**
 * Ray against the boxes of one block (slab method). Writes distance, hit point
 * and face normal of the nearest box entered within `maxDistance` into `hit`.
 */
function hitBoxes(
  boxes: ReadonlyArray<readonly number[]>,
  bx: number,
  by: number,
  bz: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
  hit: RaycastHit,
): boolean {
  let best = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    let tNear = -Infinity;
    let tFar = Infinity;
    let axis = -1;
    let missed = false;
    for (let a = 0; a < 3 && !missed; a++) {
      const origin = a === 0 ? ox : a === 1 ? oy : oz;
      const dir = a === 0 ? dx : a === 1 ? dy : dz;
      const base = a === 0 ? bx : a === 1 ? by : bz;
      const lo = base + b[a]!;
      const hi = base + b[a + 3]!;
      if (dir === 0) {
        if (origin < lo || origin > hi) missed = true;
        continue;
      }
      let t0 = (lo - origin) / dir;
      let t1 = (hi - origin) / dir;
      if (t0 > t1) [t0, t1] = [t1, t0];
      if (t0 > tNear) {
        tNear = t0;
        axis = a;
      }
      if (t1 < tFar) tFar = t1;
      if (tNear > tFar) missed = true;
    }
    if (missed || tFar < 0) continue;
    // Starting inside a box counts as hitting it at once, with no particular face.
    const t = Math.max(0, tNear);
    if (t >= best || t > maxDistance) continue;
    best = t;
    hit.distance = t;
    hit.px = ox + dx * t;
    hit.py = oy + dy * t;
    hit.pz = oz + dz * t;
    hit.nx = hit.ny = hit.nz = 0;
    if (tNear >= 0 && axis !== -1) {
      if (axis === 0) hit.nx = dx > 0 ? -1 : 1;
      else if (axis === 1) hit.ny = dy > 0 ? -1 : 1;
      else hit.nz = dz > 0 ? -1 : 1;
    } else {
      // Inside the box: face the ray's dominant axis back toward the viewer.
      hit.ny = dy > 0 ? -1 : 1;
    }
  }
  return best !== Infinity;
}
