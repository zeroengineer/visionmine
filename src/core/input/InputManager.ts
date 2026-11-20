import { Emitter } from '@/utils/Emitter';

export interface InputEvents {
  keydown: { code: string };
  keyup: { code: string };
  mousedown: { button: number };
  mouseup: { button: number };
  /** +1 = wheel down / next, -1 = wheel up / previous. */
  wheel: { direction: 1 | -1 };
  lockchange: { locked: boolean };
}

const MAX_MOUSE_DELTA = 400;
/** Keys whose browser default (scrolling, focus change, find) must not fire while playing. */
const CAPTURED_KEYS = new Set([
  'Space',
  'Tab',
  'F3',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Collects keyboard and mouse state. Continuous state (held keys, look delta) is
 * polled by gameplay code; discrete actions are delivered through `events`.
 */
export class InputManager {
  readonly events = new Emitter<InputEvents>();
  private readonly keys = new Set<string>();
  private readonly buttons = [false, false, false];
  private lookX = 0;
  private lookY = 0;
  private wheelAccum = 0;
  private locked = false;
  private lockOverride = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.preventDefault);
  }

  get isLocked(): boolean {
    return this.locked;
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  isButtonDown(button: number): boolean {
    return this.buttons[button] === true;
  }

  /** Returns the mouse movement accumulated since the last call and resets it. */
  consumeLook(out: { x: number; y: number }): void {
    out.x = this.lookX;
    out.y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
  }

  /** Requests pointer lock. Must be called from a user gesture. */
  requestLock(): void {
    if (this.locked) return;
    if (this.lockOverride) {
      this.onLockChange();
      return;
    }
    try {
      const result = this.canvas.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      // Browsers reject re-locking shortly after an Escape exit; the UI offers a retry.
    }
  }

  exitLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    else if (this.lockOverride) this.setLockOverride(false);
  }

  /**
   * Treats input as captured without real pointer lock. For automated tests in
   * browsers that cannot grant pointer lock; never used in normal play.
   */
  setLockOverride(locked: boolean): void {
    this.lockOverride = locked;
    this.onLockChange();
  }

  /** Drops all held keys and buttons (used when gameplay input is suspended). */
  releaseAll(): void {
    this.keys.clear();
    this.buttons.fill(false);
    this.lookX = 0;
    this.lookY = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.preventDefault);
    this.events.clear();
  }

  private readonly preventDefault = (event: Event): void => event.preventDefault();

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTextInput(event.target)) return;
    if (this.locked && CAPTURED_KEYS.has(event.code)) event.preventDefault();
    if (event.code === 'F3') event.preventDefault();
    if (event.repeat) return;
    this.keys.add(event.code);
    this.events.emit('keydown', { code: event.code });
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
    this.events.emit('keyup', { code: event.code });
  };

  private readonly onBlur = (): void => this.releaseAll();

  private readonly onLockChange = (): void => {
    const locked = this.lockOverride || document.pointerLockElement === this.canvas;
    if (locked === this.locked) return;
    this.locked = locked;
    if (!locked) this.releaseAll();
    this.events.emit('lockchange', { locked });
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    const dx = event.movementX || 0;
    const dy = event.movementY || 0;
    // Some browsers occasionally report a huge spurious delta; drop those samples.
    if (Math.abs(dx) > MAX_MOUSE_DELTA || Math.abs(dy) > MAX_MOUSE_DELTA) return;
    this.lookX += dx;
    this.lookY += dy;
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button > 2) return;
    this.buttons[event.button] = true;
    this.events.emit('mousedown', { button: event.button });
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button > 2) return;
    this.buttons[event.button] = false;
    this.events.emit('mouseup', { button: event.button });
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    // Trackpads emit many small deltas; accumulate to one step per notch.
    this.wheelAccum += event.deltaY;
    const threshold = 40;
    while (Math.abs(this.wheelAccum) >= threshold) {
      const direction = this.wheelAccum > 0 ? 1 : -1;
      this.wheelAccum -= direction * threshold;
      this.events.emit('wheel', { direction });
    }
  };
}
