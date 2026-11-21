import { actionForCode, defaultBindings, type ActionId } from '@/core/input/actions';
import type { InputEvents, InputManager } from '@/core/input/InputManager';
import { Emitter } from '@/utils/Emitter';

/** Stands in for InputManager with the default bindings. */
export class FakeInput {
  readonly events = new Emitter<InputEvents>();
  isLocked = true;
  /** Held codes: keyboard codes and `Mouse0`–`Mouse2`. */
  readonly keys = new Set<string>();
  private readonly bindings = defaultBindings();
  private readonly pressed = new Set<ActionId>();
  isDown = (code: string): boolean => this.keys.has(code);
  isActionDown = (action: ActionId): boolean =>
    this.bindings[action].some((code) => this.keys.has(code));
  /** A momentary press: fires the bound action without holding the code. */
  press(code: string): void {
    const action = actionForCode(this.bindings, code);
    if (!action) return;
    this.pressed.add(action);
    this.events.emit('action', { action });
  }
  consumePress = (action: ActionId): boolean => this.pressed.delete(action);
  consumeLook(out: { x: number; y: number }): void {
    out.x = 0;
    out.y = 0;
  }
  asManager(): InputManager {
    return this as unknown as InputManager;
  }
}
