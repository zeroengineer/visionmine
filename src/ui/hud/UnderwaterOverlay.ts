import { sessionStore } from '@/state/sessionStore';
import { h, type View } from '../components/dom';

/** Blue screen tint shown while the camera is below the water surface. */
export function createUnderwaterOverlay(): View {
  const el = h('div', { class: 'underwater', attrs: { 'aria-hidden': 'true' } });
  const unsubscribe = sessionStore.subscribe(
    (s) => s.underwater,
    (underwater) => el.classList.toggle('is-active', underwater),
  );
  return {
    el,
    dispose() {
      unsubscribe();
      el.remove();
    },
  };
}
