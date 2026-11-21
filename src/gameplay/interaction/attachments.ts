import { BlockId, getBlockDef, IS_SOLID } from '@/world/blocks/blocks';
import { META_FLAG } from '@/world/blocks/shapes';
import type { World } from '@/world/World';

const isDoor = (block: number): boolean => block === BlockId.Door || block === BlockId.DoorUpper;

/** Position of the other half of the door at this cell, or null if it is not a door. */
function doorPartner(world: World, x: number, y: number, z: number, block: number): number | null {
  if (block === BlockId.Door)
    return world.getBlock(x, y + 1, z) === BlockId.DoorUpper ? y + 1 : null;
  if (block === BlockId.DoorUpper)
    return world.getBlock(x, y - 1, z) === BlockId.Door ? y - 1 : null;
  return null;
}

/** Opens or closes the door at this cell (both halves). Returns false if there is no door. */
export function toggleDoor(world: World, x: number, y: number, z: number): boolean {
  const block = world.getBlock(x, y, z);
  if (!isDoor(block)) return false;
  const meta = world.getMeta(x, y, z) ^ META_FLAG;
  world.setBlock(x, y, z, block, meta);
  const partnerY = doorPartner(world, x, y, z, block);
  if (partnerY !== null) world.setBlock(x, partnerY, z, world.getBlock(x, partnerY, z), meta);
  return true;
}

/**
 * Keeps blocks that depend on another block consistent, whatever removed it
 * (a click, an explosion, a fill): the other half of a door goes with it, and
 * plants and torches go when the block under them stops being solid.
 * Returns the function that removes the rule.
 */
export function installAttachmentRules(world: World): () => void {
  return world.events.on('blockChanged', ({ x, y, z, previous, next }) => {
    if (isDoor(previous) && !isDoor(next)) {
      const partnerY = previous === BlockId.Door ? y + 1 : y - 1;
      const expected = previous === BlockId.Door ? BlockId.DoorUpper : BlockId.Door;
      if (world.getBlock(x, partnerY, z) === expected) world.setBlock(x, partnerY, z, BlockId.Air);
    }
    if (IS_SOLID[previous] === 1 && IS_SOLID[next] !== 1) {
      const above = world.getBlock(x, y + 1, z);
      if (above !== BlockId.Air && getBlockDef(above).needsSupport) {
        world.setBlock(x, y + 1, z, BlockId.Air);
      }
    }
  });
}
