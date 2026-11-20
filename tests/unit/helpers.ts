import { Chunk } from '@/world/chunks/Chunk';
import { BlockId } from '@/world/blocks/blocks';
import { World } from '@/world/World';

/** A world of empty chunks covering chunk coordinates [-radius, radius]. */
export function emptyWorld(radius = 1): World {
  const world = new World();
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) world.addChunk(new Chunk(cx, cz));
  }
  return world;
}

/** Empty world with a solid stone floor filling y = 0..floorY across all loaded chunks. */
export function flatWorld(floorY = 10, radius = 1): World {
  const world = emptyWorld(radius);
  for (const chunk of world.loadedChunks()) {
    for (let y = 0; y <= floorY; y++) chunk.blocks.fill(BlockId.Stone, y * 256, (y + 1) * 256);
  }
  return world;
}
