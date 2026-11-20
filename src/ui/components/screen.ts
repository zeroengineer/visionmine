import { uiStore, type Screen } from '@/state/uiStore';

/**
 * Shows `el` only while one of `screens` is active. `onShow` runs each time it
 * becomes visible. Returns the unsubscribe function.
 */
export function bindScreen(
  el: HTMLElement,
  screens: readonly Screen[],
  onShow?: () => void,
): () => void {
  const apply = (screen: Screen): void => {
    const visible = screens.includes(screen);
    const wasHidden = el.hidden;
    el.hidden = !visible;
    if (visible && wasHidden) {
      onShow?.();
      // Move keyboard focus into the newly shown screen for keyboard users.
      el.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    }
  };
  el.hidden = true;
  apply(uiStore.getState().screen);
  return uiStore.subscribe((s) => s.screen, apply);
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(timestamp).toLocaleDateString();
}
