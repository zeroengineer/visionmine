import { blockBoxes, IS_CUBE, IS_SOLID } from '@/world/blocks/blocks';

/** Anything that can answer "which block is at this integer position". */
export interface BlockQuery {
  getBlock(x: number, y: number, z: number): number;
  /** State byte of the block; needed only for blocks that are not full cubes. */
  getMeta?(x: number, y: number, z: number): number;
}

export interface MoveResult {
  onGround: boolean;
  hitCeiling: boolean;
  hitWall: boolean;
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

const EPSILON = 1e-4;
/** Largest displacement resolved in a single pass; keeps snapping exact for 1-block cells. */
const MAX_STEP = 0.45;

/** Boxes that merely touch do not overlap. */
const TOUCH = 1e-9;

/**
 * Visits every solid box overlapping the query box and returns, over all of
 * them, the largest upper bound (`wantMax`) or smallest lower bound on `axis`
 * (0 = x, 1 = y, 2 = z). Returns NaN when nothing overlaps.
 */
function overlapBound(
  blocks: BlockQuery,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  axis: number,
  wantMax: boolean,
): number {
  const x0 = Math.floor(minX);
  const x1 = Math.floor(maxX - TOUCH);
  const y0 = Math.floor(minY);
  const y1 = Math.floor(maxY - TOUCH);
  const z0 = Math.floor(minZ);
  const z1 = Math.floor(maxZ - TOUCH);
  let bound = Number.NaN;
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const id = blocks.getBlock(x, y, z);
        if (IS_SOLID[id] !== 1) continue;
        if (IS_CUBE[id] === 1) {
          const cell = axis === 0 ? x : axis === 1 ? y : z;
          const value = wantMax ? cell + 1 : cell;
          if (!(wantMax ? value <= bound : value >= bound)) bound = value;
          continue;
        }
        const boxes = blockBoxes(id, blocks.getMeta?.(x, y, z) ?? 0);
        for (let i = 0; i < boxes.length; i++) {
          const b = boxes[i]!;
          if (
            minX >= x + b[3] - TOUCH ||
            maxX <= x + b[0] + TOUCH ||
            minY >= y + b[4] - TOUCH ||
            maxY <= y + b[1] + TOUCH ||
            minZ >= z + b[5] - TOUCH ||
            maxZ <= z + b[2] + TOUCH
          ) {
            continue;
          }
          const origin = axis === 0 ? x : axis === 1 ? y : z;
          const value = origin + (wantMax ? b[axis + 3]! : b[axis]!);
          if (!(wantMax ? value <= bound : value >= bound)) bound = value;
        }
      }
    }
  }
  return bound;
}

/** True when the box overlaps at least one solid block (or one box of a shaped block). */
export function boxCollides(
  blocks: BlockQuery,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): boolean {
  return !Number.isNaN(overlapBound(blocks, minX, minY, minZ, maxX, maxY, maxZ, 0, true));
}

/** Bound on `axis` of the solid boxes a player-shaped box standing at `feet` overlaps, or NaN. */
function bodyBound(
  blocks: BlockQuery,
  feet: Vec3Like,
  halfWidth: number,
  height: number,
  axis: number,
  wantMax: boolean,
): number {
  return overlapBound(
    blocks,
    feet.x - halfWidth,
    feet.y,
    feet.z - halfWidth,
    feet.x + halfWidth,
    feet.y + height,
    feet.z + halfWidth,
    axis,
    wantMax,
  );
}

/** True when a player-shaped box standing at `feet` overlaps solid blocks. */
export function bodyCollides(
  blocks: BlockQuery,
  feet: Vec3Like,
  halfWidth: number,
  height: number,
): boolean {
  return boxCollides(
    blocks,
    feet.x - halfWidth,
    feet.y,
    feet.z - halfWidth,
    feet.x + halfWidth,
    feet.y + height,
    feet.z + halfWidth,
  );
}

/**
 * Moves an axis-aligned box (described by its feet centre, half width and
 * height) by `velocity * dt`, resolving collisions one axis at a time.
 * Velocity components are zeroed on impact. Large moves are sub-stepped so the
 * box can never tunnel through a block.
 */
export function moveAndCollide(
  blocks: BlockQuery,
  position: Vec3Like,
  velocity: Vec3Like,
  dt: number,
  halfWidth: number,
  height: number,
  result: MoveResult,
): MoveResult {
  result.onGround = false;
  result.hitCeiling = false;
  result.hitWall = false;

  const longest = Math.max(Math.abs(velocity.x), Math.abs(velocity.y), Math.abs(velocity.z)) * dt;
  const steps = Math.max(1, Math.ceil(longest / MAX_STEP));
  const stepDt = dt / steps;

  for (let i = 0; i < steps; i++) {
    // Y first so the player lands before sliding along the ground.
    const dy = velocity.y * stepDt;
    if (dy !== 0) {
      position.y += dy;
      // Push back out to the face of whatever was hit: the top of the highest
      // box when falling, the underside of the lowest when rising.
      const bound = bodyBound(blocks, position, halfWidth, height, 1, dy < 0);
      if (!Number.isNaN(bound)) {
        if (dy < 0) {
          position.y = bound;
          result.onGround = true;
        } else {
          position.y = bound - height - EPSILON;
          result.hitCeiling = true;
        }
        velocity.y = 0;
      }
    }

    const dx = velocity.x * stepDt;
    if (dx !== 0) {
      position.x += dx;
      const bound = bodyBound(blocks, position, halfWidth, height, 0, dx < 0);
      if (!Number.isNaN(bound)) {
        position.x = dx > 0 ? bound - halfWidth - EPSILON : bound + halfWidth + EPSILON;
        velocity.x = 0;
        result.hitWall = true;
      }
    }

    const dz = velocity.z * stepDt;
    if (dz !== 0) {
      position.z += dz;
      const bound = bodyBound(blocks, position, halfWidth, height, 2, dz < 0);
      if (!Number.isNaN(bound)) {
        position.z = dz > 0 ? bound - halfWidth - EPSILON : bound + halfWidth + EPSILON;
        velocity.z = 0;
        result.hitWall = true;
      }
    }
  }
  return result;
}

const stepProbe: Vec3Like = { x: 0, y: 0, z: 0 };
const stepVelocity: Vec3Like = { x: 0, y: 0, z: 0 };
const stepResult: MoveResult = { onGround: false, hitCeiling: false, hitWall: false };

/**
 * `moveAndCollide` for a body standing on the ground that can climb ledges up
 * to `stepHeight` without jumping. When the plain move is stopped by a wall, the
 * move is retried from `stepHeight` higher and then lowered again; it is kept
 * only if the body ends up standing higher and further along than before.
 *
 * Returns the height climbed (0 when no step was taken).
 */
export function moveWithStepUp(
  blocks: BlockQuery,
  position: Vec3Like,
  velocity: Vec3Like,
  dt: number,
  halfWidth: number,
  height: number,
  result: MoveResult,
  stepHeight: number,
): number {
  const startX = position.x;
  const startY = position.y;
  const startZ = position.z;
  const vx = velocity.x;
  const vz = velocity.z;

  moveAndCollide(blocks, position, velocity, dt, halfWidth, height, result);
  if (!result.hitWall || stepHeight <= 0 || (vx === 0 && vz === 0)) return 0;

  // Retry from the raised position, if there is headroom for it.
  stepProbe.x = startX;
  stepProbe.y = startY + stepHeight;
  stepProbe.z = startZ;
  if (bodyCollides(blocks, stepProbe, halfWidth, height)) return 0;
  stepVelocity.x = vx;
  stepVelocity.y = 0;
  stepVelocity.z = vz;
  moveAndCollide(blocks, stepProbe, stepVelocity, dt, halfWidth, height, stepResult);
  const hitWall = stepResult.hitWall;
  const keptX = stepVelocity.x;
  const keptZ = stepVelocity.z;

  // Settle back down onto whatever is underneath.
  stepVelocity.x = 0;
  stepVelocity.z = 0;
  stepVelocity.y = -stepHeight / dt;
  moveAndCollide(blocks, stepProbe, stepVelocity, dt, halfWidth, height, stepResult);

  const rise = stepProbe.y - startY;
  const plain = (position.x - startX) ** 2 + (position.z - startZ) ** 2;
  const stepped = (stepProbe.x - startX) ** 2 + (stepProbe.z - startZ) ** 2;
  if (!stepResult.onGround || rise <= EPSILON || stepped <= plain + 1e-9) return 0;

  position.x = stepProbe.x;
  position.y = stepProbe.y;
  position.z = stepProbe.z;
  velocity.x = keptX;
  velocity.y = 0;
  velocity.z = keptZ;
  result.onGround = true;
  result.hitCeiling = false;
  result.hitWall = hitWall;
  return rise;
}
