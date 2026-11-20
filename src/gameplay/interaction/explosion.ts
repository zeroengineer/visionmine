import { BlockId, getBlockDef, IS_LIQUID } from '@/world/blocks/blocks';
import type { World } from '@/world/World';

export interface ExplosionResult {
  /** Blocks that were destroyed, with the block they used to be. */
  removed: Array<{ x: number; y: number; z: number; block: number }>;
  /** Positions of other TNT blocks caught in the blast (left in place for chain reactions). */
  chained: Array<{ x: number; y: number; z: number }>;
}

/**
 * Destroys every breakable block within `radius` of a block centre. Liquids
 * and unbreakable blocks survive. Other TNT blocks are not removed; they are
 * reported in `chained` so the caller can prime them.
 *
 * @param roughness 0..1 — how ragged the crater edge is
 */
export function explode(
  world: World,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  roughness = 0.25,
  random: () => number = Math.random,
): ExplosionResult {
  const result: ExplosionResult = { removed: [], chained: [] };
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const limit = radius * (1 - roughness * random());
        if (distance > limit) continue;
        const x = cx + dx;
        const y = cy + dy;
        const z = cz + dz;
        const block = world.getBlock(x, y, z);
        if (block === BlockId.Air || IS_LIQUID[block] === 1) continue;
        if (!getBlockDef(block).breakable) continue;
        if (block === BlockId.Tnt && (dx !== 0 || dy !== 0 || dz !== 0)) {
          result.chained.push({ x, y, z });
          continue;
        }
        if (world.setBlock(x, y, z, BlockId.Air)) result.removed.push({ x, y, z, block });
      }
    }
  }
  return result;
}
