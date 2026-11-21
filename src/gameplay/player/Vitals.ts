/** Health and hunger are counted in half-icons: 20 points fill ten hearts. */
export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
/** Seconds of breath under water. */
export const MAX_AIR = 10;

/** Falls shorter than this many blocks do not hurt. */
export const SAFE_FALL = 3;
const DROWN_INTERVAL = 1;
const DROWN_DAMAGE = 2;
const REGEN_INTERVAL = 4;
const STARVE_INTERVAL = 4;
/** Hunger must be at least this for health to come back. */
const REGEN_HUNGER = 18;
/** Exhaustion added per second while standing, walking and sprinting. One point costs one hunger. */
const EXHAUSTION = { idle: 0.01, moving: 0.03, sprinting: 0.1 } as const;
const REGEN_COST = 0.6;

export interface VitalsSnapshot {
  health: number;
  hunger: number;
}

export interface Activity {
  headInWater: boolean;
  moving: boolean;
  sprinting: boolean;
}

/**
 * The survival player's health, hunger and breath. Pure state and rules: the
 * caller reports what the player is doing and what hit them, and reads back
 * the result. When `enabled` is false (creative mode) nothing changes.
 */
export class Vitals {
  enabled = true;
  health = MAX_HEALTH;
  hunger = MAX_HUNGER;
  air = MAX_AIR;
  private exhaustion = 0;
  private regenTimer = 0;
  private starveTimer = 0;
  private drownTimer = 0;

  get dead(): boolean {
    return this.health <= 0;
  }

  /** Advances hunger, healing, starvation and drowning by `dt` seconds. */
  update(dt: number, activity: Activity): void {
    if (!this.enabled || this.dead) return;

    this.exert(
      (activity.sprinting
        ? EXHAUSTION.sprinting
        : activity.moving
          ? EXHAUSTION.moving
          : EXHAUSTION.idle) * dt,
    );

    if (activity.headInWater) {
      this.air = Math.max(0, this.air - dt);
      if (this.air === 0) {
        this.drownTimer += dt;
        if (this.drownTimer >= DROWN_INTERVAL) {
          this.drownTimer -= DROWN_INTERVAL;
          this.damage(DROWN_DAMAGE);
        }
      }
    } else {
      // Breath comes back much faster than it runs out.
      this.air = Math.min(MAX_AIR, this.air + dt * 5);
      this.drownTimer = 0;
    }
    if (this.dead) return;

    if (this.hunger >= REGEN_HUNGER && this.health < MAX_HEALTH) {
      this.regenTimer += dt;
      if (this.regenTimer >= REGEN_INTERVAL) {
        this.regenTimer -= REGEN_INTERVAL;
        this.health = Math.min(MAX_HEALTH, this.health + 1);
        this.exert(REGEN_COST);
      }
    } else {
      this.regenTimer = 0;
    }

    if (this.hunger === 0) {
      this.starveTimer += dt;
      if (this.starveTimer >= STARVE_INTERVAL) {
        this.starveTimer -= STARVE_INTERVAL;
        // Starving weakens the player but does not finish them off.
        if (this.health > 1) this.health -= 1;
      }
    } else {
      this.starveTimer = 0;
    }
  }

  /** Effort that makes the player hungry: one point of exertion costs one hunger. */
  exert(amount: number): void {
    if (!this.enabled || amount <= 0) return;
    this.exhaustion += amount;
    while (this.exhaustion >= 1) {
      this.exhaustion -= 1;
      this.hunger = Math.max(0, this.hunger - 1);
    }
  }

  /** Removes health. Returns the amount actually taken. */
  damage(amount: number): number {
    if (!this.enabled || this.dead) return 0;
    const taken = Math.min(this.health, Math.max(0, Math.floor(amount)));
    this.health -= taken;
    this.regenTimer = 0;
    return taken;
  }

  /** Applies the damage of landing after falling `distance` blocks. Returns what was taken. */
  land(distance: number): number {
    return this.damage(fallDamage(distance));
  }

  /** Eats food worth `points` of hunger. Returns false when the player is not hungry. */
  eat(points: number): boolean {
    if (!this.enabled || this.dead || this.hunger >= MAX_HUNGER || points <= 0) return false;
    this.hunger = Math.min(MAX_HUNGER, this.hunger + points);
    return true;
  }

  /** Back to full, as after respawning. */
  reset(): void {
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.air = MAX_AIR;
    this.exhaustion = this.regenTimer = this.starveTimer = this.drownTimer = 0;
  }

  snapshot(): VitalsSnapshot {
    return { health: this.health, hunger: this.hunger };
  }

  /** Restores saved values, ignoring anything out of range. A saved dead player wakes up healed. */
  restore(saved: Partial<VitalsSnapshot> | null | undefined): void {
    this.reset();
    if (!saved) return;
    const valid = (value: unknown, max: number): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
    if (valid(saved.health, MAX_HEALTH) && saved.health > 0) this.health = Math.floor(saved.health);
    if (valid(saved.hunger, MAX_HUNGER)) this.hunger = Math.floor(saved.hunger);
  }
}

/** Health lost by falling `distance` blocks: one point per block beyond the safe height. */
export function fallDamage(distance: number): number {
  return Math.max(0, Math.floor(distance - SAFE_FALL));
}
