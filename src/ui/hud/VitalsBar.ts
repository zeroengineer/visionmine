import { GAME_MODES } from '@/gameplay/modes/gameMode';
import { MAX_AIR, MAX_HEALTH, MAX_HUNGER } from '@/gameplay/player/Vitals';
import { sessionStore } from '@/state/sessionStore';
import { h, type View } from '../components/dom';

const PIPS = 10;

/** A row of ten pips, each worth two points and able to show a half. */
function createRow(kind: string, label: string) {
  const pips = Array.from({ length: PIPS }, () =>
    h('span', { class: `vital__pip vital__pip--${kind}` }),
  );
  const el = h(
    'div',
    { class: `vital vital--${kind}`, attrs: { role: 'img', 'data-testid': `vital-${kind}` } },
    ...pips,
  );
  let shown = -1;
  return {
    el,
    /** `points` out of twenty. */
    set(points: number, max: number): void {
      const value = Math.max(0, Math.min(max, Math.round(points)));
      if (value === shown) return;
      shown = value;
      el.setAttribute('aria-label', `${label} ${value} of ${max}`);
      el.dataset.value = String(value);
      pips.forEach((pip, i) => {
        const fill = Math.max(0, Math.min(2, value - i * 2));
        pip.classList.toggle('is-full', fill === 2);
        pip.classList.toggle('is-half', fill === 1);
      });
    },
  };
}

/** Hearts, hunger and — while under water — breath, shown in survival mode. */
export function createVitalsBar(): View {
  const health = createRow('health', 'Health');
  const hunger = createRow('hunger', 'Hunger');
  const air = createRow('air', 'Air');
  const el = h(
    'div',
    { class: 'vitals', attrs: { 'data-testid': 'vitals' } },
    h('div', { class: 'vitals__row' }, health.el, hunger.el),
    air.el,
  );

  const render = (): void => {
    const state = sessionStore.getState();
    el.hidden = !GAME_MODES[state.mode].vitals;
    health.set(state.health, MAX_HEALTH);
    hunger.set(state.hunger, MAX_HUNGER);
    // Breath is ten seconds shown as ten pips, and only while some is missing.
    air.set((state.air / MAX_AIR) * 20, 20);
    air.el.hidden = state.air >= MAX_AIR;
  };
  const unsubscribe = sessionStore.subscribe(
    (s) => `${s.mode}|${s.health}|${s.hunger}|${Math.ceil(s.air * 2)}`,
    render,
    { fireImmediately: true },
  );

  return {
    el,
    dispose() {
      unsubscribe();
      el.remove();
    },
  };
}
