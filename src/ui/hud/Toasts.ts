import { uiStore, type Toast } from '@/state/uiStore';
import { h, type View } from '../components/dom';

const TOAST_MS = 4200;

/** Short, self-dismissing notifications. */
export function createToasts(): View {
  const el = h('div', { class: 'toasts', attrs: { role: 'status', 'aria-live': 'polite' } });
  const shown = new Map<number, HTMLElement>();

  const render = (toasts: readonly Toast[]): void => {
    for (const toast of toasts) {
      if (shown.has(toast.id)) continue;
      const node = h('div', { class: `toast toast--${toast.kind}`, text: toast.text });
      shown.set(toast.id, node);
      el.append(node);
      window.setTimeout(() => uiStore.getState().dismissToast(toast.id), TOAST_MS);
    }
    for (const [id, node] of shown) {
      if (toasts.some((toast) => toast.id === id)) continue;
      node.remove();
      shown.delete(id);
    }
  };
  const unsubscribe = uiStore.subscribe((s) => s.toasts, render, { fireImmediately: true });

  return {
    el,
    dispose() {
      unsubscribe();
      el.remove();
    },
  };
}
