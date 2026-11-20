import type { TileAtlas } from '@/rendering/textures/TileAtlas';
import { Face, getBlockDef } from '@/world/blocks/blocks';
import type { Tile } from '@/world/blocks/tiles';

const ICON_SIZE = 64;
let atlas: TileAtlas | null = null;
const cache = new Map<number, string>();

/** Provides the texture atlas used to draw block icons. Call once at startup. */
export function initBlockIcons(source: TileAtlas): void {
  atlas = source;
  cache.clear();
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  source: TileAtlas,
  tile: Tile,
  transform: [number, number, number, number, number, number],
  shade: number,
): void {
  ctx.save();
  ctx.setTransform(...transform);
  ctx.beginPath();
  ctx.rect(0, 0, 1, 1);
  ctx.clip();
  source.drawTile(ctx, tile, 0, 0, 1, 1);
  if (shade > 0) {
    // Darken only the pixels this face actually drew (keeps glass and leaves see-through).
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(0, 0, 0, ${shade})`;
    ctx.fillRect(0, 0, 1, 1);
  }
  ctx.restore();
}

/** Isometric cube icon for a block, as a cached data URL. */
export function blockIconUrl(block: number): string {
  const cached = cache.get(block);
  if (cached) return cached;
  if (!atlas) return '';

  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingEnabled = false;

  const tiles = getBlockDef(block).tiles;
  // Unit-square → screen transforms for the three visible faces of a cube.
  drawFace(ctx, atlas, tiles[Face.PY], [28, 14, -28, 14, 32, 3], 0);
  drawFace(ctx, atlas, tiles[Face.PZ], [28, 14, 0, 30, 4, 17], 0.2);
  drawFace(ctx, atlas, tiles[Face.PX], [28, -14, 0, 30, 32, 31], 0.38);

  const url = canvas.toDataURL();
  cache.set(block, url);
  return url;
}
