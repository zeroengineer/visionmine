import { Emitter } from '@/utils/Emitter';
import { BlockId } from '@/world/blocks/blocks';
import type { World } from '@/world/World';
import { explode, type ExplosionResult } from './explosion';

export interface PrimedTnt {
  x: number;
  y: number;
  z: number;
  /** Seconds until detonation. */
  fuse: number;
}

export interface TntEvents {
  primed: { x: number; y: number; z: number };
  exploded: { x: number; y: number; z: number; radius: number; result: ExplosionResult };
}

export const TNT_FUSE = 1.6;
export const TNT_RADIUS = 4.2;
const MAX_PRIMED = 48;

/** Tracks lit TNT blocks, counts down their fuses and triggers chain reactions. */
export class TntManager {
  readonly events = new Emitter<TntEvents>();
  private readonly primed: PrimedTnt[] = [];

  constructor(
    private readonly world: World,
    private readonly random: () => number = Math.random,
  ) {}

  get active(): readonly PrimedTnt[] {
    return this.primed;
  }

  /** Lights the TNT block at this position. Returns false if there is none or it is already lit. */
  ignite(x: number, y: number, z: number, fuse = TNT_FUSE): boolean {
    if (this.world.getBlock(x, y, z) !== BlockId.Tnt) return false;
    if (this.primed.length >= MAX_PRIMED) return false;
    if (this.primed.some((t) => t.x === x && t.y === y && t.z === z)) return false;
    this.primed.push({ x, y, z, fuse });
    this.events.emit('primed', { x, y, z });
    return true;
  }

  update(dt: number): void {
    for (let i = this.primed.length - 1; i >= 0; i--) {
      const tnt = this.primed[i]!;
      tnt.fuse -= dt;
      if (tnt.fuse > 0) continue;
      this.primed.splice(i, 1);
      // The block may have been mined or blown up while the fuse burned.
      if (this.world.getBlock(tnt.x, tnt.y, tnt.z) !== BlockId.Tnt) continue;
      const result = explode(this.world, tnt.x, tnt.y, tnt.z, TNT_RADIUS, 0.25, this.random);
      for (const next of result.chained) {
        this.ignite(next.x, next.y, next.z, 0.12 + this.random() * 0.3);
      }
      this.events.emit('exploded', { x: tnt.x, y: tnt.y, z: tnt.z, radius: TNT_RADIUS, result });
    }
  }

  clear(): void {
    this.primed.length = 0;
  }

  dispose(): void {
    this.clear();
    this.events.clear();
  }
}
