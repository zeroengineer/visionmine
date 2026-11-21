import * as THREE from 'three';
import { ATLAS_TILES_PER_ROW, Tile, TILE_COUNT, TILE_PIXELS } from '@/world/blocks/tiles';

type Rgba = readonly [number, number, number, number];
type Painter = (x: number, y: number, rand: (salt?: number) => number) => Rgba;

const S = TILE_PIXELS;

/** Deterministic per-pixel hash in 0..1. */
function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function shade(color: number, factor: number, alpha = 255): Rgba {
  const r = Math.min(255, Math.max(0, ((color >> 16) & 255) * factor));
  const g = Math.min(255, Math.max(0, ((color >> 8) & 255) * factor));
  const b = Math.min(255, Math.max(0, (color & 255) * factor));
  return [r, g, b, alpha];
}

/** Base colour with random per-pixel brightness variation. */
function speckle(color: number, amount: number): Painter {
  return (_x, _y, rand) => shade(color, 1 - amount / 2 + rand() * amount);
}

const dirt: Painter = (_x, _y, rand) => {
  const r = rand();
  if (r > 0.9) return shade(0x5f3d22, 1);
  if (r < 0.08) return shade(0xa6764a, 1);
  return shade(0x8a5a36, 0.9 + rand(1) * 0.2);
};

const grassTop: Painter = (_x, _y, rand) => {
  const r = rand();
  if (r > 0.88) return shade(0x4f8f2d, 1);
  if (r < 0.1) return shade(0x86c755, 1);
  return shade(0x6aaa3a, 0.9 + rand(1) * 0.2);
};

/**
 * Item sprites as 16 × 16 pixel maps. `.` is transparent, `h`/`H` are the
 * light and dark of a wooden handle, and `m`/`M`/`l` are the main, shaded and
 * highlighted colour of whatever the item is made of.
 */
const STICK = [
  '................',
  '................',
  '...........hH...',
  '..........hH....',
  '.........hH.....',
  '........hH......',
  '.......hH.......',
  '......hH........',
  '.....hH.........',
  '....hH..........',
  '...hH...........',
  '..hH............',
  '................',
  '................',
  '................',
  '................',
];
const LUMP = [
  '................',
  '................',
  '................',
  '.....mmmm.......',
  '....mlmmmmM.....',
  '...mllmmmmmM....',
  '...mlmmmmmmM....',
  '..mmmmmmmmmMM...',
  '..mmmmmmmmMMM...',
  '..mmmmmmmMMMM...',
  '...mmmmmMMMM....',
  '....MMMMMMM.....',
  '.....MMMM.......',
  '................',
  '................',
  '................',
];
const APPLE = [
  '................',
  '........H.......',
  '.......H........',
  '....mm.H.mm.....',
  '...mlmmmmmmM....',
  '..mllmmmmmmmM...',
  '..mlmmmmmmmmM...',
  '..mmmmmmmmmmM...',
  '..mmmmmmmmmMM...',
  '..mmmmmmmmmMM...',
  '...mmmmmmmMM....',
  '...mmmmmmMMM....',
  '....MMM.MMM.....',
  '................',
  '................',
  '................',
];
const PICKAXE = [
  '................',
  '....mmmmmmm.....',
  '...mlllllmmMh...',
  '..mM.....mhHM...',
  '..M.....hH.mM...',
  '.......hH..mM...',
  '......hH...mM...',
  '.....hH.....M...',
  '....hH..........',
  '...hH...........',
  '..hH............',
  '.hH.............',
  '.H..............',
  '................',
  '................',
  '................',
];
const AXE = [
  '................',
  '.........mm.....',
  '........mlmm....',
  '.......mllmmh...',
  '......mmlmmhHM..',
  '......mmmmhH.M..',
  '.......mmhHmM...',
  '........hHmM....',
  '.......hH.......',
  '......hH........',
  '.....hH.........',
  '....hH..........',
  '...hH...........',
  '..hH............',
  '..H.............',
  '................',
];
const SHOVEL = [
  '................',
  '..........mmm...',
  '.........mllmM..',
  '.........mlmmM..',
  '.........mmmMM..',
  '........hmMMM...',
  '.......hH.......',
  '......hH........',
  '.....hH.........',
  '....hH..........',
  '...hH...........',
  '..hH............',
  '.hH.............',
  '.H..............',
  '................',
  '................',
];
const WOOD = { m: 0xb98d55, M: 0x8a6739, l: 0xd6b07a };
const STONE = { m: 0x8b8f94, M: 0x5f6368, l: 0xb4b8bd };
const IRON = { m: 0xd9dde2, M: 0x9aa1a9, l: 0xffffff };

function sprite(rows: readonly string[], colours: Record<string, number>): Painter {
  const palette: Record<string, number> = { h: 0x8a6739, H: 0x5b4025, ...colours };
  return (x, y) => {
    const colour = palette[rows[y]?.[x] ?? '.'];
    return colour === undefined ? [0, 0, 0, 0] : shade(colour, 1);
  };
}

const PAINTERS: Record<Tile, Painter> = {
  [Tile.GrassTop]: grassTop,
  [Tile.GrassSide]: (x, y, rand) => {
    const depth = 3 + Math.floor(hash(x, 91, 7) * 3);
    return y < depth ? grassTop(x, y, rand) : dirt(x, y, rand);
  },
  [Tile.Dirt]: dirt,
  [Tile.Stone]: (x, y, rand) => {
    const band = hash(Math.floor(x / 4), Math.floor((y + (x >> 2)) / 3), 31);
    if (rand() > 0.93) return shade(0x6b6f74, 1);
    return shade(0x8b8f94, 0.86 + band * 0.18 + rand(1) * 0.06);
  },
  [Tile.Sand]: (_x, _y, rand) => {
    if (rand() > 0.92) return shade(0xcdbd82, 1);
    return shade(0xe2d39a, 0.94 + rand(1) * 0.1);
  },
  [Tile.Water]: (x, y, rand) => {
    const wave = Math.sin((x + y * 0.5) * 0.8) * 0.5 + Math.sin((y - x * 0.3) * 1.1) * 0.5;
    const highlight = wave > 0.72 ? 1.22 : 1;
    return shade(0x3a78d0, (0.92 + rand() * 0.1) * highlight, 178);
  },
  [Tile.LogSide]: (x, _y, rand) => {
    const stripe = hash(x, 5, 3);
    const dark = stripe > 0.7 ? 0.78 : stripe < 0.2 ? 1.1 : 0.95;
    return shade(0x6e4f2e, dark * (0.94 + rand() * 0.1));
  },
  [Tile.LogTop]: (x, y, rand) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.6) return shade(0x5b4025, 0.95 + rand() * 0.1);
    const ring = Math.floor(d) % 2 === 0 ? 1 : 0.84;
    return shade(0xb99560, ring * (0.95 + rand() * 0.08));
  },
  [Tile.Leaves]: (_x, _y, rand) => {
    const r = rand();
    if (r < 0.17) return [0, 0, 0, 0];
    if (r > 0.8) return shade(0x2f6f22, 1);
    return shade(0x3f8a2e, 0.85 + rand(1) * 0.3);
  },
  [Tile.Planks]: (x, y, rand) => {
    const board = Math.floor(y / 4);
    if (y % 4 === 3) return shade(0x7a5a33, 0.9);
    const seam = (x + board * 5) % 9 === 0;
    if (seam) return shade(0x8a6739, 0.92);
    return shade(0xb98d55, 0.92 + hash(board, 2, 9) * 0.1 + rand() * 0.06);
  },
  [Tile.Cobblestone]: (x, y, rand) => {
    const cx = Math.floor((x + (Math.floor(y / 4) % 2) * 2) / 4);
    const cy = Math.floor(y / 4);
    const edge = (x + (cy % 2) * 2) % 4 === 0 || y % 4 === 0;
    if (edge) return shade(0x55585c, 0.9 + rand() * 0.1);
    return shade(0x8a8d91, 0.8 + hash(cx, cy, 17) * 0.3 + rand(1) * 0.05);
  },
  [Tile.Glass]: (x, y) => {
    const border = x === 0 || y === 0 || x === S - 1 || y === S - 1;
    if (border) return [214, 236, 245, 255];
    const shine = (x + y === 6 || x + y === 7) && x > 1 && x < 6;
    if (shine) return [255, 255, 255, 255];
    return [0, 0, 0, 0];
  },
  [Tile.Brick]: (x, y, rand) => {
    const row = Math.floor(y / 4);
    const mortar = y % 4 === 3 || (x + (row % 2) * 4) % 8 === 7;
    if (mortar) return shade(0xc9c2b4, 0.9 + rand() * 0.1);
    return shade(
      0xa5503f,
      0.88 + hash(Math.floor((x + (row % 2) * 4) / 8), row, 4) * 0.2 + rand(1) * 0.06,
    );
  },
  [Tile.Snow]: (_x, _y, rand) => {
    if (rand() > 0.9) return shade(0xdbe7f3, 1);
    return shade(0xf4f8fc, 0.97 + rand(1) * 0.03);
  },
  [Tile.Gravel]: (_x, _y, rand) => {
    const r = rand();
    if (r > 0.75) return shade(0x6a6663, 1);
    if (r < 0.2) return shade(0xa6a29e, 1);
    return shade(0x8a8683, 0.92 + rand(1) * 0.14);
  },
  [Tile.TntSide]: (x, y, rand) => {
    if (y >= 5 && y <= 10) {
      // White band with a blocky "TNT" label.
      const label = ['111 1 1 111', ' 1  111  1 ', ' 1  1 1  1 '];
      const row = y - 6;
      const col = x - 3;
      if (row >= 0 && row < 3 && col >= 0 && col < 11 && label[row]![col] === '1') {
        return [34, 30, 32, 255];
      }
      return shade(0xf1ece2, 0.96 + rand() * 0.05);
    }
    const stripe = x % 4 === 3 ? 0.82 : 1;
    return shade(0xc8402f, stripe * (0.94 + rand() * 0.08));
  },
  [Tile.TntTop]: (x, y, rand) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < 2.2) return shade(0x2a2628, 1);
    if (d < 3.4) return shade(0xf1ece2, 1);
    return shade(0xc8402f, 0.94 + rand() * 0.08);
  },
  [Tile.TntBottom]: speckle(0xb5382a, 0.12),
  [Tile.Bedrock]: (_x, _y, rand) => {
    const r = rand();
    if (r > 0.7) return shade(0x1e1e22, 1);
    if (r < 0.2) return shade(0x5a5a62, 1);
    return shade(0x3a3a3f, 0.9 + rand(1) * 0.2);
  },
  [Tile.DoorTop]: (x, y, rand) => {
    const frame = x === 0 || x === S - 1 || y === 0;
    if (frame) return shade(0x6b4d2a, 0.95 + rand() * 0.08);
    // Two small windows.
    const window = y >= 3 && y <= 9 && ((x >= 3 && x <= 6) || (x >= 9 && x <= 12));
    if (window)
      return y === 3 || y === 9 || x === 3 || x === 6 || x === 9 || x === 12
        ? shade(0x6b4d2a, 1)
        : [0, 0, 0, 0];
    return shade(0x9a7446, 0.92 + hash(x >> 2, 3, 11) * 0.1 + rand() * 0.05);
  },
  [Tile.DoorBottom]: (x, y, rand) => {
    const frame = x === 0 || x === S - 1 || y === S - 1;
    if (frame) return shade(0x6b4d2a, 0.95 + rand() * 0.08);
    // Handle near the top edge, which meets the upper half.
    if (y >= 1 && y <= 2 && x >= 11 && x <= 12) return shade(0xd9c56a, 1);
    const panel = y >= 5 && y <= 12 && x >= 3 && x <= 12;
    const inset = panel && (y === 5 || y === 12 || x === 3 || x === 12);
    if (inset) return shade(0x7a5a33, 1);
    return shade(0x9a7446, 0.92 + hash(x >> 2, 5, 11) * 0.1 + rand() * 0.05);
  },
  [Tile.Ladder]: (x, y, rand) => {
    const rail = (x >= 2 && x <= 3) || (x >= 12 && x <= 13);
    const rung = y % 4 === 1 && x >= 2 && x <= 13;
    if (rail) return shade(0x8a6739, 0.95 + rand() * 0.1);
    if (rung) return shade(0xa67c47, 0.95 + rand() * 0.1);
    return [0, 0, 0, 0];
  },
  // A torch is a 2 × 10 pixel post, so only the bottom-left corner of its tiles is seen.
  [Tile.TorchSide]: (_x, y, rand) => {
    if (y <= 7) return shade(0xffd35a, 1.05 + rand() * 0.1);
    if (y <= 8) return shade(0xff8a2a, 1);
    return shade(0x7a5a33, 0.9 + rand() * 0.15);
  },
  [Tile.TorchTop]: (_x, _y, rand) => shade(0xffe27a, 1 + rand() * 0.1),
  [Tile.FlowerRed]: (x, y) => flower(x, y, 0xd8342c, 0x2a1a12),
  [Tile.FlowerYellow]: (x, y) => flower(x, y, 0xf2d024, 0xe89a1c),
  [Tile.TallGrass]: (x, y) => {
    // Blades of different heights rising from the bottom edge.
    const height = 5 + Math.floor(hash(x, 13, 5) * 9);
    const blade = hash(x, 2, 8) > 0.38;
    if (!blade || S - 1 - y >= height) return [0, 0, 0, 0];
    return shade(0x6aaa3a, 0.8 + hash(x, y, 3) * 0.35);
  },
  [Tile.CoalOre]: (x, y, rand) => ore(x, y, rand, 0x26262a),
  [Tile.IronOre]: (x, y, rand) => ore(x, y, rand, 0xd8a47c),
  [Tile.CraftingTop]: (x, y, rand) => {
    const edge = x === 0 || y === 0 || x === S - 1 || y === S - 1;
    if (edge) return shade(0x6b4d2a, 1);
    // A 3 × 3 grid scored into the top.
    if (x % 5 === 0 || y % 5 === 0) return shade(0x8a6739, 0.95);
    return shade(0xc79a5c, 0.94 + rand() * 0.08);
  },
  [Tile.CraftingSide]: (x, y, rand) => {
    if (y < 3) return shade(0x6b4d2a, 0.95 + rand() * 0.08);
    // Tools hanging on the side: a saw-like bar and a hammer head.
    if (y >= 5 && y <= 6 && x >= 2 && x <= 7) return shade(0xb9bec4, 1);
    if (x >= 10 && x <= 13 && y >= 5 && y <= 7) return shade(0x8b8f94, 1);
    if (x >= 11 && x <= 12 && y >= 8 && y <= 12) return shade(0x7a5a33, 1);
    return shade(0xb98d55, 0.9 + hash(x >> 2, 4, 9) * 0.12 + rand() * 0.05);
  },
  [Tile.ItemStick]: sprite(STICK, {}),
  [Tile.ItemCoal]: sprite(LUMP, { m: 0x2b2b30, M: 0x15151a, l: 0x4a4a52 }),
  [Tile.ItemIron]: sprite(LUMP, { m: 0xd9dde2, M: 0x9aa1a9, l: 0xffffff }),
  [Tile.ItemApple]: sprite(APPLE, { m: 0xd8342c, M: 0xa3221c, l: 0xf47a6c }),
  [Tile.ItemWoodPickaxe]: sprite(PICKAXE, WOOD),
  [Tile.ItemWoodAxe]: sprite(AXE, WOOD),
  [Tile.ItemWoodShovel]: sprite(SHOVEL, WOOD),
  [Tile.ItemStonePickaxe]: sprite(PICKAXE, STONE),
  [Tile.ItemStoneAxe]: sprite(AXE, STONE),
  [Tile.ItemStoneShovel]: sprite(SHOVEL, STONE),
  [Tile.ItemIronPickaxe]: sprite(PICKAXE, IRON),
  [Tile.ItemIronAxe]: sprite(AXE, IRON),
  [Tile.ItemIronShovel]: sprite(SHOVEL, IRON),
};

/** Stone with flecks of a mineral. */
function ore(x: number, y: number, rand: (salt?: number) => number, mineral: number): Rgba {
  const cluster = hash(Math.floor((x + 1) / 3), Math.floor((y + 2) / 3), 57) > 0.62;
  if (cluster && hash(x, y, 58) > 0.3) return shade(mineral, 0.9 + rand() * 0.2);
  return shade(0x8b8f94, 0.86 + rand(1) * 0.14);
}

/** A stem with two leaves and a round bloom. */
function flower(x: number, y: number, petal: number, centre: number): Rgba {
  const dx = x - 7.5;
  const dy = y - 5.5;
  const d = Math.hypot(dx, dy);
  if (d < 1.2) return shade(centre, 1);
  if (d < 3.3) return shade(petal, 0.9 + hash(x, y, 21) * 0.2);
  if ((x === 7 || x === 8) && y >= 8) return shade(0x3f8a2e, x === 7 ? 1 : 0.85);
  if (y >= 11 && y <= 12 && ((x >= 4 && x <= 6) || (x >= 9 && x <= 11))) return shade(0x4f9a35, 1);
  return [0, 0, 0, 0];
}

/**
 * Procedurally painted block texture atlas. All art is generated at startup, so
 * the game ships without image assets. Also serves 2D tile images to the UI.
 */
export class TileAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private readonly tileUrls = new Map<Tile, string>();

  constructor() {
    const size = ATLAS_TILES_PER_ROW * S;
    this.canvas = document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is unavailable; cannot build block textures.');

    const image = ctx.createImageData(size, size);
    for (let tile = 0; tile < TILE_COUNT; tile++) {
      const painter = PAINTERS[tile as Tile];
      const ox = (tile % ATLAS_TILES_PER_ROW) * S;
      const oy = Math.floor(tile / ATLAS_TILES_PER_ROW) * S;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const rand = (salt = 0): number => hash(x + tile * 64, y + salt * 131, tile + salt);
          const [r, g, b, a] = painter(x, y, rand);
          const i = ((oy + y) * size + ox + x) * 4;
          image.data[i] = r;
          image.data[i + 1] = g;
          image.data[i + 2] = b;
          image.data[i + 3] = a;
        }
      }
    }
    ctx.putImageData(image, 0, 0);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  /** Draws one tile into a 2D context (used for inventory icons). */
  drawTile(
    ctx: CanvasRenderingContext2D,
    tile: Tile,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    const sx = (tile % ATLAS_TILES_PER_ROW) * S;
    const sy = Math.floor(tile / ATLAS_TILES_PER_ROW) * S;
    ctx.drawImage(this.canvas, sx, sy, S, S, dx, dy, dw, dh);
  }

  /** Data URL of a single tile, cached. */
  tileUrl(tile: Tile): string {
    let url = this.tileUrls.get(tile);
    if (!url) {
      const canvas = document.createElement('canvas');
      canvas.width = S;
      canvas.height = S;
      const ctx = canvas.getContext('2d');
      if (ctx) this.drawTile(ctx, tile, 0, 0, S, S);
      url = canvas.toDataURL();
      this.tileUrls.set(tile, url);
    }
    return url;
  }

  dispose(): void {
    this.texture.dispose();
    this.tileUrls.clear();
  }
}
