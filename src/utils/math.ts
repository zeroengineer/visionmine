export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Mathematical modulo: the result always has the sign of `n`. */
export function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}

/** Frame-rate independent exponential approach factor. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export function lerpAngle(a: number, b: number, t: number): number {
  const diff = mod(b - a + Math.PI, Math.PI * 2) - Math.PI;
  return a + diff * t;
}
