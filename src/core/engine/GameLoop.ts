export interface LoopCallbacks {
  /** Deterministic simulation step; called zero or more times per frame. */
  fixedUpdate(step: number): void;
  /** Per-frame update with the real (clamped) frame delta in seconds. */
  update(dt: number, elapsed: number): void;
  /** Render with `alpha` = progress between the last two fixed steps (0..1). */
  render(alpha: number): void;
}

export const FIXED_STEP = 1 / 60;
const MAX_FRAME_DELTA = 0.1;
const MAX_STEPS_PER_FRAME = 5;

/** requestAnimationFrame loop with a fixed-timestep simulation accumulator. */
export class GameLoop {
  private rafId = 0;
  private running = false;
  private last = 0;
  private accumulator = 0;
  private elapsed = 0;

  constructor(private readonly callbacks: LoopCallbacks) {
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  dispose(): void {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private readonly onVisibility = (): void => {
    // Avoid a huge delta after the tab was in the background.
    this.last = performance.now();
    this.accumulator = 0;
  };

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);

    const dt = Math.min((now - this.last) / 1000, MAX_FRAME_DELTA);
    this.last = now;
    if (dt <= 0) return;
    this.elapsed += dt;

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
      this.callbacks.fixedUpdate(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    this.callbacks.update(dt, this.elapsed);
    this.callbacks.render(this.accumulator / FIXED_STEP);
  };
}
