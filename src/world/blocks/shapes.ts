/**
 * Geometry of blocks that are not full cubes. A shape is a set of axis-aligned
 * boxes in block-local coordinates (0..1), chosen by the block's state byte.
 * The same boxes drive meshing, collision and targeting, so they always agree.
 */

export type Shape = 'cube' | 'slab' | 'stairs' | 'door' | 'ladder' | 'pane' | 'post' | 'cross';

/** `[x0, y0, z0, x1, y1, z1]` in block-local coordinates. */
export type Box = readonly [number, number, number, number, number, number];

/**
 * Horizontal directions used by state bytes, in clockwise order seen from
 * above: 0 = north (-Z), 1 = east (+X), 2 = south (+Z), 3 = west (-X).
 */
export const DIRECTIONS: ReadonlyArray<readonly [dx: number, dz: number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** State bits. The low two bits are always a direction for directional shapes. */
export const META_DIRECTION = 0b0011;
/** Slab: occupies the upper half. Door: swung open. */
export const META_FLAG = 0b0100;
/** Door: this is the upper of its two blocks. */
export const META_UPPER = 0b1000;

const FULL: readonly Box[] = [[0, 0, 0, 1, 1, 1]];
const DOOR_THICKNESS = 3 / 16;
const LADDER_THICKNESS = 2 / 16;
const PANE_HALF = 1 / 16;

/** A slab of `thickness` lying against the given side of the cell. */
function wall(direction: number, thickness: number): Box {
  switch (direction & 3) {
    case 0:
      return [0, 0, 0, 1, 1, thickness];
    case 1:
      return [1 - thickness, 0, 0, 1, 1, 1];
    case 2:
      return [0, 0, 1 - thickness, 1, 1, 1];
    default:
      return [0, 0, 0, thickness, 1, 1];
  }
}

function build(shape: Shape, meta: number): readonly Box[] {
  const direction = meta & META_DIRECTION;
  switch (shape) {
    case 'slab':
      return meta & META_FLAG ? [[0, 0.5, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.5, 1]];
    case 'stairs': {
      // A bottom slab plus an upper half on the side the stairs climb toward.
      const upper: Box = [
        direction === 1 ? 0.5 : 0,
        0.5,
        direction === 2 ? 0.5 : 0,
        direction === 3 ? 0.5 : 1,
        1,
        direction === 0 ? 0.5 : 1,
      ];
      return [[0, 0, 0, 1, 0.5, 1], upper];
    }
    case 'door':
      // An open door has swung a quarter turn onto the neighbouring side.
      return [wall(meta & META_FLAG ? direction + 1 : direction, DOOR_THICKNESS)];
    case 'ladder':
      return [wall(direction, LADDER_THICKNESS)];
    case 'pane':
      // Bit 0 picks the axis the pane runs along: 0 = east–west, 1 = north–south.
      return meta & 1
        ? [[0.5 - PANE_HALF, 0, 0, 0.5 + PANE_HALF, 1, 1]]
        : [[0, 0, 0.5 - PANE_HALF, 1, 1, 0.5 + PANE_HALF]];
    case 'post':
      return [[7 / 16, 0, 7 / 16, 9 / 16, 10 / 16, 9 / 16]];
    case 'cross':
      // Plants are drawn as crossed quads; this box is only what the crosshair can hit.
      return [[0.15, 0, 0.15, 0.85, 0.8, 0.85]];
    default:
      return FULL;
  }
}

const cache = new Map<string, readonly Box[]>();

/** Boxes of a shape in a given state. The returned array is shared; do not modify it. */
export function shapeBoxes(shape: Shape, meta: number): readonly Box[] {
  if (shape === 'cube') return FULL;
  const key = `${shape}:${meta & 0xf}`;
  let boxes = cache.get(key);
  if (!boxes) {
    boxes = build(shape, meta);
    cache.set(key, boxes);
  }
  return boxes;
}

/** Whether the state byte of this shape holds a direction that turns with the block. */
export function isDirectional(shape: Shape): boolean {
  return shape === 'stairs' || shape === 'door' || shape === 'ladder';
}

/** State after turning a block a quarter turn clockwise, seen from above. */
export function rotateMeta(shape: Shape, meta: number): number {
  if (isDirectional(shape)) return (meta & ~META_DIRECTION) | (((meta & 3) + 1) & 3);
  if (shape === 'pane') return meta ^ 1;
  return meta;
}

/** Direction index (see `DIRECTIONS`) closest to a yaw angle; yaw 0 looks north. */
export function directionFromYaw(yaw: number): number {
  // Yaw increases turning left (counter-clockwise from above), directions go clockwise.
  const quarter = Math.round(-yaw / (Math.PI / 2));
  return ((quarter % 4) + 4) % 4;
}
