import { Emitter } from '@/utils/Emitter';
import {
  buildCodeLookup,
  defaultBindings,
  mouseCode,
  type ActionId,
  type Bindings,
} from './actions';

export interface InputEvents {
  keydown: { code: string };
  keyup: { code: string };
  mousedown: { button: number };
  mouseup: { button: number };
  /** +1 = wheel down / next, -1 = wheel up / previous. */
  wheel: { direction: 1 | -1 };
  lockchange: { locked: boolean };
  /** A key or mouse button bound to an action was pressed. */
  action: { action: ActionId };
}

const MAX_MOUSE_DELTA = 400;
/** Keys whose browser default (scrolling, focus change) must not fire while playing. */
const CAPTURED_KEYS = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
/** Function keys have browser defaults (find, help) that a bound action must replace. */
const FUNCTION_KEY = /^F\d{1,2}$/;

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Collects keyboard and mouse state and translates it into game actions through
 * the current bindings. Continuous state (held actions, look delta) is polled by
 * gameplay code; discrete presses are delivered through `events`.
 */
export class InputManager {
  readonly events = new Emitter<InputEvents>();
  /** Codes currently held: keyboard codes and `Mouse0`–`Mouse2`. */
  private readonly keys = new Set<string>();
  /** Actions pressed since the simulation last asked, so quick taps are never missed. */
  private readonly pressed = new Set<ActionId>();
  private bindings: Bindings = defaultBindings();
  private codeToAction = buildCodeLookup(this.bindings);
  private lookX = 0;
  private lookY = 0;
  private wheelAccum = 0;
  private locked = false;
  private lockOverride = false;
  /** The next movement sample is the first one since the mouse was captured. */
  private skipNextMove = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    // Listened for on the window and filtered by target: browsers occasionally
    // hit-test a press on the game view to the page root instead of the canvas.
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('contextmenu', this.onContextMenu);
  }

  get isLocked(): boolean {
    return this.locked;
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Replaces the key and mouse bindings. Held state carries over by code. */
  setBindings(bindings: Bindings): void {
    this.bindings = bindings;
    this.codeToAction = buildCodeLookup(bindings);
  }

  /** True while any key or button bound to the action is held. */
  isActionDown(action: ActionId): boolean {
    const codes = this.bindings[action];
    for (let i = 0; i < codes.length; i++) {
      if (this.keys.has(codes[i]!)) return true;
    }
    return false;
  }

  /**
   * True once for each press of the action since the previous call. Unlike
   * `isActionDown`, this still reports a tap that began and ended between two
   * simulation steps.
   */
  consumePress(action: ActionId): boolean {
    return this.pressed.delete(action);
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
    this.pressed.clear();
    this.lookX = 0;
    this.lookY = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('contextmenu', this.onContextMenu);
    this.events.clear();
  }

  private press(action: ActionId): void {
    // Only gameplay consumes presses, and only while input is captured.
    if (this.locked) this.pressed.add(action);
    this.events.emit('action', { action });
  }

  /**
   * True for events aimed at the game view: the canvas itself, or the bare page
   * behind the interface. Anything on a button, panel or field belongs to the UI.
   */
  private isGameTarget(target: EventTarget | null): boolean {
    return (
      target === this.canvas || target === document.documentElement || target === document.body
    );
  }

  private readonly onContextMenu = (event: Event): void => {
    if (this.isGameTarget(event.target)) event.preventDefault();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTextInput(event.target)) return;
    const action = this.codeToAction.get(event.code);
    const shortcut = event.ctrlKey || event.metaKey;
    if (this.locked && !shortcut && (CAPTURED_KEYS.has(event.code) || action !== undefined)) {
      event.preventDefault();
    }
    if (action !== undefined && FUNCTION_KEY.test(event.code)) event.preventDefault();
    if (event.repeat) return;
    this.keys.add(event.code);
    this.events.emit('keydown', { code: event.code });
    if (action !== undefined) this.press(action);
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
    // Browsers may report a stale delta (measured from the pre-capture cursor
    // position) on the first movement after capture, which would jerk the view.
    this.skipNextMove = locked;
    if (!locked) this.releaseAll();
    this.events.emit('lockchange', { locked });
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    if (this.skipNextMove) {
      this.skipNextMove = false;
      return;
    }
    const dx = event.movementX || 0;
    const dy = event.movementY || 0;
    // Some browsers occasionally report a huge spurious delta; drop those samples.
    if (Math.abs(dx) > MAX_MOUSE_DELTA || Math.abs(dy) > MAX_MOUSE_DELTA) return;
    this.lookX += dx;
    this.lookY += dy;
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button > 2 || !this.isGameTarget(event.target)) return;
    const code = mouseCode(event.button);
    this.keys.add(code);
    this.events.emit('mousedown', { button: event.button });
    const action = this.codeToAction.get(code);
    if (action !== undefined) this.press(action);
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button > 2) return;
    this.keys.delete(mouseCode(event.button));
    this.events.emit('mouseup', { button: event.button });
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.isGameTarget(event.target)) return;
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
