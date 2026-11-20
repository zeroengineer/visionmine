import { BlockId, PLACEABLE_BLOCKS } from '@/world/blocks/blocks';
import { Chunk } from '@/world/chunks/Chunk';
import { CHUNK_SIZE } from '@/world/constants';
import type { World } from '@/world/World';

export const SHOWCASE_RADIUS = 2;
export const SHOWCASE_GROUND = 40;

/**
 * Fills a small hand-built area that exercises every block type: layered
 * terrain, a pond, and a row of pillars. Used until procedural terrain exists.
 */
export function buildShowcaseWorld(world: World): void {
  for (let cz = -SHOWCASE_RADIUS; cz < SHOWCASE_RADIUS; cz++) {
    for (let cx = -SHOWCASE_RADIUS; cx < SHOWCASE_RADIUS; cx++) {
      const chunk = new Chunk(cx, cz);
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const wx = cx * CHUNK_SIZE + lx;
          const wz = cz * CHUNK_SIZE + lz;
          const pond = Math.hypot(wx + 10, wz - 8) < 6;
          const height =
            SHOWCASE_GROUND + Math.round(Math.sin(wx * 0.2) * 1.5 + Math.cos(wz * 0.17) * 1.5);
          chunk.set(lx, 0, lz, BlockId.Bedrock);
          for (let y = 1; y <= height; y++) {
            let id: number = BlockId.Stone;
            if (y === height) id = pond ? BlockId.Sand : BlockId.Grass;
            else if (y > height - 4) id = pond ? BlockId.Sand : BlockId.Dirt;
            chunk.set(lx, y, lz, id);
          }
          if (pond) {
            for (let y = height - 2; y <= height; y++) chunk.set(lx, y, lz, BlockId.Water);
          }
        }
      }
      world.addChunk(chunk);
    }
  }

  // One pillar per placeable block type.
  PLACEABLE_BLOCKS.forEach((id, i) => {
    if (id === BlockId.Water) return;
    const x = -12 + i * 2;
    for (let y = 0; y < 3; y++) world.setBlock(x, SHOWCASE_GROUND + 3 + y, -6, id);
  });
}
