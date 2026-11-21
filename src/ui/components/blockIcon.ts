import type { TileAtlas } from '@/rendering/textures/TileAtlas';
import { getItemDef } from '@/gameplay/items/items';
import { blockBoxes, Face, getBlockDef } from '@/world/blocks/blocks';
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
  /** Part of the tile's unit square to draw: x, y, width, height. */
  [rx, ry, rw, rh]: [number, number, number, number],
): void {
  if (rw <= 0 || rh <= 0) return;
  // Each face is painted on its own layer so that shading it only darkens the
  // pixels it drew (keeps glass and leaves see-through) and never the faces beneath.
  const layer = document.createElement('canvas');
  layer.width = ICON_SIZE;
  layer.height = ICON_SIZE;
  const paint = layer.getContext('2d');
  if (!paint) return;
  paint.imageSmoothingEnabled = false;
  paint.setTransform(...transform);
  paint.beginPath();
  paint.rect(rx, ry, rw, rh);
  paint.clip();
  source.drawTile(paint, tile, 0, 0, 1, 1);
  if (shade > 0) {
    paint.globalCompositeOperation = 'source-atop';
    paint.fillStyle = `rgba(0, 0, 0, ${shade})`;
    paint.fillRect(rx, ry, rw, rh);
  }
  ctx.drawImage(layer, 0, 0);
}

/** Icon for anything that fits in a slot: a block's isometric shape, or an item's sprite. */
export function itemIconUrl(item: number): string {
  const sprite = getItemDef(item).tile;
  if (sprite === null) return blockIconUrl(item);
  return atlas ? atlas.tileUrl(sprite) : '';
}

/** Isometric icon of a block's shape, as a cached data URL. */
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

  const def = getBlockDef(block);
  const tiles = def.tiles;
  // Draw the block's boxes back to front; a cube is a single full box.
  const boxes = [...blockBoxes(block, 0)].sort((p, q) => p[3] + p[4] + p[5] - (q[3] + q[4] + q[5]));
  for (const [x0, y0, z0, x1, y1, z1] of boxes) {
    // Isometric projection of a point: (32 + 28(x - z), 3 + 14(x + z) + 30(1 - y)).
    // Each visible face maps the tile's unit square onto its plane and is
    // clipped to the part of the tile the box covers.
    drawFace(ctx, atlas, tiles[Face.PY], [28, 14, -28, 14, 32, 3 + 30 * (1 - y1)], 0, [
      x0,
      z0,
      x1 - x0,
      z1 - z0,
    ]);
    drawFace(ctx, atlas, tiles[Face.PZ], [28, 14, 0, 30, 32 - 28 * z1, 3 + 14 * z1], 0.2, [
      x0,
      1 - y1,
      x1 - x0,
      y1 - y0,
    ]);
    drawFace(ctx, atlas, tiles[Face.PX], [28, -14, 0, 30, 4 + 28 * x1, 17 + 14 * x1], 0.38, [
      1 - z1,
      1 - y1,
      z1 - z0,
      y1 - y0,
    ]);
  }

  const url = canvas.toDataURL();
  cache.set(block, url);
  return url;
}
