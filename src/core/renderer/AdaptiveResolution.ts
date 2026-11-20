import type { Renderer } from './Renderer';

const WINDOW_SECONDS = 1;
const LOW_FPS = 42;
const HIGH_FPS = 57;
const MIN_SCALE = 0.6;
/** Consecutive slow windows before lowering resolution. */
const DOWN_AFTER = 2;
/** Consecutive fast windows before raising it again (slower, to avoid oscillation). */
const UP_AFTER = 5;

/**
 * Keeps the game playable on weak GPUs by trading resolution for frame rate:
 * sustained low FPS lowers the render scale, sustained high FPS restores it.
 */
export class AdaptiveResolution {
  enabled = true;
  private time = 0;
  private frames = 0;
  private slowWindows = 0;
  private fastWindows = 0;

  constructor(private readonly renderer: Renderer) {}

  /** Call once per rendered frame while gameplay is running. */
  update(dt: number): void {
    if (!this.enabled) {
      if (this.renderer.getResolutionScale() !== 1) this.renderer.setResolutionScale(1);
      return;
    }
    this.time += dt;
    this.frames++;
    if (this.time < WINDOW_SECONDS) return;

    const fps = this.frames / this.time;
    this.time = 0;
    this.frames = 0;
    const scale = this.renderer.getResolutionScale();

    if (fps < LOW_FPS) {
      this.fastWindows = 0;
      if (++this.slowWindows >= DOWN_AFTER && scale > MIN_SCALE) {
        this.slowWindows = 0;
        this.renderer.setResolutionScale(Math.max(MIN_SCALE, scale - 0.1));
      }
    } else if (fps > HIGH_FPS) {
      this.slowWindows = 0;
      if (++this.fastWindows >= UP_AFTER && scale < 1) {
        this.fastWindows = 0;
        this.renderer.setResolutionScale(Math.min(1, scale + 0.05));
      }
    } else {
      this.slowWindows = 0;
      this.fastWindows = 0;
    }
  }

  /** Forgets measurements (after loading hitches or a settings change). */
  reset(): void {
    this.time = 0;
    this.frames = 0;
    this.slowWindows = 0;
    this.fastWindows = 0;
  }
}
