import { sessionStore } from '@/state/sessionStore';
import { settingsStore } from '@/state/settingsStore';
import { uiStore } from '@/state/uiStore';
import { h, type View } from '../components/dom';
import { gameplayTips } from '../components/controlsSummary';
import { bindScreen } from '../components/screen';

export function createLoadingScreen(): View {
  const title = h('h2', { class: 'loading__title' });
  const bar = h('div', { class: 'progress__bar' });
  const percent = h('span', { class: 'loading__percent', text: '0%' });
  const tip = h('p', { class: 'loading__tip' });
  const progress = h(
    'div',
    {
      class: 'progress',
      attrs: {
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': '0',
      },
    },
    bar,
  );
  const el = h(
    'div',
    { class: 'overlay loading', attrs: { 'data-screen': 'loading' } },
    h('div', { class: 'loading__box' }, title, progress, percent, tip),
  );

  const unsubscribers = [
    bindScreen(el, ['loading', 'boot'], () => {
      const tips = gameplayTips(settingsStore.getState().bindings);
      tip.textContent = tips[Math.floor(Math.random() * tips.length)]!;
    }),
    sessionStore.subscribe(
      (s) => s.worldName,
      (name) => (title.textContent = name ? `Loading ${name}` : 'Starting VISIONMINE'),
    ),
    uiStore.subscribe(
      (s) => s.loadProgress,
      (value) => {
        const pct = Math.round(value * 100);
        bar.style.transform = `scaleX(${value})`;
        percent.textContent = `${pct}%`;
        progress.setAttribute('aria-valuenow', String(pct));
      },
    ),
  ];
  title.textContent = 'Starting VISIONMINE';

  return {
    el,
    dispose() {
      for (const unsubscribe of unsubscribers) unsubscribe();
      el.remove();
    },
  };
}
