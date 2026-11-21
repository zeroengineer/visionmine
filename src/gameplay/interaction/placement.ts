import { BlockId, getBlockDef, IS_SOLID } from '@/world/blocks/blocks';
import { directionFromYaw, DIRECTIONS, META_FLAG } from '@/world/blocks/shapes';
import type { RaycastHit } from './voxelRaycast';

/** One block write of a placement. */
export interface PlacedBlock {
  x: number;
  y: number;
  z: number;
  block: number;
  meta: number;
}

/**
 * State byte a block gets when the player places it against `hit` while
 * looking along `yaw`: which half a slab fills, which way stairs climb, which
 * wall a ladder hangs on.
 */
export function placementMeta(block: number, hit: Readonly<RaycastHit>, yaw: number): number {
  const shape = getBlockDef(block).shape;
  switch (shape) {
    case 'slab': {
      // Under a ceiling, or against the upper half of a wall, the slab goes on top.
      if (hit.ny < 0) return META_FLAG;
      if (hit.ny > 0) return 0;
      const height = hit.py - Math.floor(hit.py);
      return height > 0.5 ? META_FLAG : 0;
    }
    case 'stairs':
      // Stairs climb away from the player.
      return directionFromYaw(yaw);
    case 'ladder': {
      // Against a wall, hang on that wall; otherwise on the far side of the cell.
      if (hit.ny !== 0) return directionFromYaw(yaw);
      return DIRECTIONS.findIndex(([dx, dz]) => dx === -hit.nx && dz === -hit.nz);
    }
    case 'door':
      // The door stands on the edge of its cell nearest the player.
      return (directionFromYaw(yaw) + 2) & 3;
    case 'pane':
      // A pane runs across the player's view.
      return directionFromYaw(yaw) & 1;
    default:
      return 0;
  }
}

/**
 * Everything that placing `block` against `hit` would write, or null when the
 * block cannot go there at all. Most blocks are a single write; a door is two.
 */
export function planPlacement(
  block: number,
  hit: Readonly<RaycastHit>,
  yaw: number,
): PlacedBlock[] | null {
  const def = getBlockDef(block);
  const x = hit.x + hit.nx;
  const y = hit.y + hit.ny;
  const z = hit.z + hit.nz;
  // Plants and torches stand on top of something solid.
  if (def.needsSupport && (hit.ny !== 1 || IS_SOLID[hit.block] !== 1)) return null;
  const meta = placementMeta(block, hit, yaw);
  if (block === BlockId.Door) {
    return [
      { x, y, z, block: BlockId.Door, meta },
      { x, y: y + 1, z, block: BlockId.DoorUpper, meta },
    ];
  }
  return [{ x, y, z, block, meta }];
}
