import { describe, expect, it } from 'vitest';
import {
  actionForCode,
  ACTIONS,
  assignBinding,
  BINDING_SLOTS,
  bindingsEqual,
  buildCodeLookup,
  clearBinding,
  defaultBindings,
  formatCode,
  isBindableCode,
  primaryKeyLabel,
  sanitizeBindings,
} from '@/core/input/actions';
import { sanitizeSettings, settingsStore } from '@/state/settingsStore';
import { controlsSummary } from '@/ui/components/controlsSummary';

describe('default bindings', () => {
  it('give every action at least one binding and never reuse a code', () => {
    const bindings = defaultBindings();
    const seen = new Set<string>();
    for (const action of ACTIONS) {
      expect(bindings[action.id].length).toBeGreaterThan(0);
      expect(bindings[action.id].length).toBeLessThanOrEqual(BINDING_SLOTS);
      for (const code of bindings[action.id]) {
        expect(isBindableCode(code), code).toBe(true);
        expect(seen.has(code), `${code} is bound twice`).toBe(false);
        seen.add(code);
      }
    }
  });

  it('are returned as a fresh copy each time', () => {
    const a = defaultBindings();
    a.jump.push('KeyJ');
    expect(defaultBindings().jump).toEqual(['Space']);
  });

  it('map codes back to actions', () => {
    const bindings = defaultBindings();
    expect(actionForCode(bindings, 'KeyW')).toBe('moveForward');
    expect(actionForCode(bindings, 'ArrowUp')).toBe('moveForward');
    expect(actionForCode(bindings, 'Mouse2')).toBe('placeBlock');
    expect(actionForCode(bindings, 'KeyQ')).toBeNull();
    const lookup = buildCodeLookup(bindings);
    expect(lookup.get('F3')).toBe('debugOverlay');
    expect(lookup.size).toBe(ACTIONS.reduce((n, a) => n + bindings[a.id].length, 0));
  });
});

describe('bindable codes', () => {
  it('accepts keys and the three mouse buttons', () => {
    for (const code of ['KeyQ', 'Space', 'ShiftLeft', 'F6', 'Numpad0', 'Mouse0', 'Mouse2', 'Tab']) {
      expect(isBindableCode(code), code).toBe(true);
    }
  });

  it('rejects reserved keys and malformed values', () => {
    for (const code of [
      'Escape',
      'Digit1',
      'Digit9',
      'MetaLeft',
      'Mouse3',
      '',
      'key w',
      42,
      null,
    ]) {
      expect(isBindableCode(code), String(code)).toBe(false);
    }
  });
});

describe('assigning bindings', () => {
  it('replaces the chosen slot and leaves other actions alone', () => {
    const before = defaultBindings();
    const { bindings, swappedWith } = assignBinding(before, 'jump', 0, 'KeyJ');
    expect(bindings.jump).toEqual(['KeyJ']);
    expect(swappedWith).toBeNull();
    expect(bindings.moveForward).toEqual(['KeyW', 'ArrowUp']);
    // The input is not mutated.
    expect(before.jump).toEqual(['Space']);
  });

  it('fills an empty second slot', () => {
    const { bindings } = assignBinding(defaultBindings(), 'jump', 1, 'KeyJ');
    expect(bindings.jump).toEqual(['Space', 'KeyJ']);
  });

  it('swaps with the action that already uses the code', () => {
    const { bindings, swappedWith } = assignBinding(defaultBindings(), 'jump', 0, 'KeyF');
    expect(swappedWith).toBe('toggleFly');
    expect(bindings.jump).toEqual(['KeyF']);
    expect(bindings.toggleFly).toEqual(['Space']);
  });

  it('takes the code away when the slot being filled was empty', () => {
    const { bindings, swappedWith } = assignBinding(defaultBindings(), 'jump', 1, 'KeyE');
    expect(swappedWith).toBe('inventory');
    expect(bindings.jump).toEqual(['Space', 'KeyE']);
    expect(bindings.inventory).toEqual([]);
  });

  it('exchanges the two slots of one action', () => {
    const { bindings } = assignBinding(defaultBindings(), 'moveForward', 0, 'ArrowUp');
    expect(bindings.moveForward).toEqual(['ArrowUp', 'KeyW']);
  });

  it('never leaves a code on two actions', () => {
    let bindings = defaultBindings();
    const codes = ['KeyW', 'Space', 'Mouse0', 'KeyE', 'F3', 'ShiftLeft', 'KeyQ', 'Mouse1'];
    let n = 0;
    for (const action of ACTIONS) {
      for (let slot = 0; slot < BINDING_SLOTS; slot++) {
        bindings = assignBinding(bindings, action.id, slot, codes[n++ % codes.length]!).bindings;
        const all = ACTIONS.flatMap((a) => bindings[a.id]);
        expect(new Set(all).size).toBe(all.length);
      }
    }
  });

  it('ignores codes that cannot be bound and bad slots', () => {
    const before = defaultBindings();
    expect(assignBinding(before, 'jump', 0, 'Escape').bindings).toBe(before);
    expect(assignBinding(before, 'jump', 0, 'Digit3').bindings).toBe(before);
    expect(assignBinding(before, 'jump', 5, 'KeyJ').bindings).toBe(before);
    expect(assignBinding(before, 'jump', 0, 'Space').bindings).toBe(before);
  });

  it('clears a slot', () => {
    const cleared = clearBinding(defaultBindings(), 'moveForward', 0);
    expect(cleared.moveForward).toEqual(['ArrowUp']);
    expect(clearBinding(cleared, 'moveForward', 0).moveForward).toEqual([]);
    const same = defaultBindings();
    expect(clearBinding(same, 'jump', 1)).toBe(same);
  });
});

describe('sanitising stored bindings', () => {
  it('returns defaults for missing or malformed data', () => {
    for (const raw of [undefined, null, 'x', 7, []]) {
      expect(bindingsEqual(sanitizeBindings(raw), defaultBindings())).toBe(true);
    }
  });

  it('keeps valid stored bindings, including an action left unbound', () => {
    const bindings = sanitizeBindings({ jump: ['KeyJ'], pickBlock: [] });
    expect(bindings.jump).toEqual(['KeyJ']);
    expect(bindings.pickBlock).toEqual([]);
    expect(bindings.sprint).toEqual(['ShiftLeft', 'ShiftRight']);
  });

  it('drops invalid codes, unknown actions and extra slots', () => {
    const bindings = sanitizeBindings({
      jump: ['Escape', 12, 'KeyJ', 'KeyK', 'KeyL'],
      nonsense: ['KeyZ'],
      sprint: 'ShiftLeft',
    });
    expect(bindings.jump).toEqual(['KeyJ', 'KeyK']);
    expect(bindings.sprint).toEqual(['ShiftLeft', 'ShiftRight']);
    expect('nonsense' in bindings).toBe(false);
  });

  it('gives a stored binding priority over another action’s default', () => {
    // Jump stored on F; toggle-fly has no stored entry and F is its default.
    const bindings = sanitizeBindings({ jump: ['KeyF'] });
    expect(bindings.jump).toEqual(['KeyF']);
    expect(bindings.toggleFly).toEqual([]);
  });

  it('keeps a duplicated code only on the first action', () => {
    const bindings = sanitizeBindings({ jump: ['KeyJ'], sprint: ['KeyJ', 'KeyK'] });
    expect(bindings.jump).toEqual(['KeyJ']);
    expect(bindings.sprint).toEqual(['KeyK']);
  });

  it('is applied by the settings sanitiser', () => {
    const base = sanitizeSettings({}, settingsStore.getState());
    expect(bindingsEqual(base.bindings, defaultBindings())).toBe(true);
    const changed = sanitizeSettings({ bindings: { jump: ['KeyJ', 'Escape'] } }, base);
    expect(changed.bindings.jump).toEqual(['KeyJ']);
    // Unchanged bindings keep their identity so subscribers are not notified.
    expect(sanitizeSettings({ fov: 90 }, base).bindings).toBe(base.bindings);
    expect(sanitizeSettings({ bindings: defaultBindings() }, base).bindings).toBe(base.bindings);
  });
});

describe('display', () => {
  it('names codes the way key caps read', () => {
    expect(formatCode('KeyW')).toBe('W');
    expect(formatCode('Mouse0')).toBe('Left click');
    expect(formatCode('ShiftLeft')).toBe('Shift');
    expect(formatCode('ArrowUp')).toBe('↑');
    expect(formatCode('F3')).toBe('F3');
    expect(formatCode('Numpad5')).toBe('Num 5');
  });

  it('summarises the controls from the current bindings', () => {
    const summary = controlsSummary(defaultBindings());
    expect(summary[0]).toEqual(['W A S D', 'Move']);
    expect(summary).toContainEqual(['Space', 'Jump · fly up']);
    expect(summary).toContainEqual(['Esc', 'Pause']);

    const rebound = assignBinding(defaultBindings(), 'jump', 0, 'KeyJ').bindings;
    expect(controlsSummary(rebound)).toContainEqual(['J', 'Jump · fly up']);
    expect(primaryKeyLabel(clearBinding(rebound, 'jump', 0), 'jump')).toBe('Unbound');
  });
});
