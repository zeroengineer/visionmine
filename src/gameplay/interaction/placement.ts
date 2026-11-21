import { getBlockDef } from '@/world/blocks/blocks';
import { directionFromYaw, META_FLAG } from '@/world/blocks/shapes';
import type { RaycastHit } from './voxelRaycast';

/**
 * State byte a block gets when the player places it against `hit` while
 * looking along `yaw`: which half a slab fills, which way stairs climb.
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
    default:
      return 0;
  }
}
