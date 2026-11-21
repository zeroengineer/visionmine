import {
  ACTIONS,
  assignBinding,
  BINDING_SLOTS,
  CATEGORY_LABELS,
  clearBinding,
  defaultBindings,
  FIXED_CONTROLS,
  formatCode,
  getAction,
  isBindableCode,
  mouseCode,
  type ActionCategory,
  type ActionId,
} from '@/core/input/actions';
import { settingsStore } from '@/state/settingsStore';
import { uiStore } from '@/state/uiStore';
import { button } from '../components/controls';
import { h, type View } from '../components/dom';

interface Capture {
  action: ActionId;
  slot: number;
}

const CATEGORIES: readonly ActionCategory[] = ['movement', 'building', 'interface'];

/**
 * Lists every action with its key caps and lets the player rebind them: click a
 * cap, then press a key or mouse button. Escape cancels, Backspace clears.
 */
export function createBindingsEditor(): View {
  const store = settingsStore;
  const caps = new Map<string, HTMLButtonElement>();
  const status = h('p', { class: 'bindings__status', attrs: { role: 'status' } });
  let capture: Capture | null = null;

  const capKey = (action: ActionId, slot: number): string => `${action}:${slot}`;

  const render = (): void => {
    const { bindings } = store.getState();
    for (const action of ACTIONS) {
      for (let slot = 0; slot < BINDING_SLOTS; slot++) {
        const cap = caps.get(capKey(action.id, slot))!;
        const code = bindings[action.id][slot];
        const capturing = capture?.action === action.id && capture.slot === slot;
        const text = capturing ? 'Press a key…' : code ? formatCode(code) : '—';
        cap.textContent = text;
        cap.classList.toggle('is-capturing', capturing);
        cap.classList.toggle('is-empty', !code && !capturing);
        // An action nobody can trigger is worth pointing out.
        cap.classList.toggle('is-unbound', slot === 0 && bindings[action.id].length === 0);
        cap.setAttribute(
          'aria-label',
          `${action.label}, binding ${slot + 1}: ${code ? formatCode(code) : 'none'}`,
        );
      }
    }
  };

  const swallow = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  const endCapture = (): void => {
    if (!capture) return;
    capture = null;
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('mousedown', onMouseDown, true);
    render();
  };

  const assign = (code: string): void => {
    if (!capture) return;
    const { action, slot } = capture;
    const result = assignBinding(store.getState().bindings, action, slot, code);
    store.getState().set({ bindings: result.bindings });
    status.textContent = result.swappedWith
      ? `${formatCode(code)} was used by “${getAction(result.swappedWith).label}”, so the two were swapped.`
      : `${getAction(action).label} is now ${formatCode(code)}.`;
    endCapture();
  };

  // Capture-phase listeners on window see the input before the game does.
  function onKeyDown(event: KeyboardEvent): void {
    if (!capture) return;
    swallow(event);
    if (event.repeat) return;
    if (event.code === 'Escape') {
      status.textContent = '';
      endCapture();
    } else if (event.code === 'Backspace' || event.code === 'Delete') {
      const { action, slot } = capture;
      store.getState().set({ bindings: clearBinding(store.getState().bindings, action, slot) });
      status.textContent = `Removed a binding from “${getAction(action).label}”.`;
      endCapture();
    } else if (isBindableCode(event.code)) {
      assign(event.code);
    } else {
      status.textContent = `${formatCode(event.code)} cannot be used.`;
    }
  }

  function onMouseDown(event: MouseEvent): void {
    if (!capture || event.button > 2) return;
    swallow(event);
    // The press is consumed as a binding, so the click it would produce must not land.
    window.addEventListener('click', swallow, { capture: true, once: true });
    window.addEventListener('auxclick', swallow, { capture: true, once: true });
    window.addEventListener('contextmenu', swallow, { capture: true, once: true });
    window.setTimeout(() => {
      window.removeEventListener('click', swallow, true);
      window.removeEventListener('auxclick', swallow, true);
      window.removeEventListener('contextmenu', swallow, true);
    }, 400);
    assign(mouseCode(event.button));
  }

  const beginCapture = (action: ActionId, slot: number): void => {
    endCapture();
    capture = { action, slot };
    status.textContent = 'Press a key or mouse button. Esc cancels, Backspace removes.';
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('mousedown', onMouseDown, true);
    render();
  };

  const groups = CATEGORIES.map((category) => {
    const rows: HTMLElement[] = [];
    for (const action of ACTIONS.filter((a) => a.category === category)) {
      const slots = Array.from({ length: BINDING_SLOTS }, (_, slot) => {
        const cap = h('button', {
          class: 'keycap',
          attrs: { type: 'button', 'data-action': action.id, 'data-slot': String(slot) },
          on: { click: () => beginCapture(action.id, slot) },
        });
        caps.set(capKey(action.id, slot), cap);
        return cap;
      });
      rows.push(
        h(
          'div',
          { class: 'bindings__row', attrs: { 'data-binding-row': action.id } },
          h('span', { class: 'bindings__label', text: action.label }),
          h('span', { class: 'bindings__caps' }, ...slots),
        ),
      );
    }
    for (const fixed of FIXED_CONTROLS.filter((f) => f.category === category)) {
      rows.push(
        h(
          'div',
          { class: 'bindings__row bindings__row--fixed' },
          h('span', { class: 'bindings__label', text: fixed.label }),
          h(
            'span',
            { class: 'bindings__caps' },
            ...fixed.keys.map((key) => h('span', { class: 'keycap keycap--fixed', text: key })),
          ),
        ),
      );
    }
    return h(
      'section',
      { class: 'bindings__group' },
      h('h3', { class: 'inv__heading', text: CATEGORY_LABELS[category] }),
      ...rows,
    );
  });

  const reset = button(
    'Reset controls',
    () => {
      endCapture();
      store.getState().set({ bindings: defaultBindings() });
      status.textContent = 'Controls restored to their defaults.';
    },
    { variant: 'ghost', small: true, id: 'controls-reset' },
  );

  const el = h(
    'div',
    { class: 'bindings', attrs: { 'data-testid': 'bindings' } },
    h('div', { class: 'bindings__groups' }, ...groups),
    h('div', { class: 'bindings__footer' }, status, reset),
  );

  const unsubscribers = [
    store.subscribe((s) => s.bindings, render),
    // Leaving the screen mid-capture must not leave the listeners behind.
    uiStore.subscribe(
      (s) => s.screen,
      () => {
        endCapture();
        status.textContent = '';
      },
    ),
  ];
  render();

  return {
    el,
    dispose() {
      endCapture();
      for (const unsubscribe of unsubscribers) unsubscribe();
      el.remove();
    },
  };
}
