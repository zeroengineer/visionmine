import { GAME_MODES } from '@/gameplay/modes/gameMode';
import { sessionStore } from '@/state/sessionStore';
import { isInGame, uiStore } from '@/state/uiStore';
import { h, type View } from '../components/dom';
import type { GameCommands } from '../GameCommands';
import { createCrosshair } from './Crosshair';
import { createDebugOverlay } from './DebugOverlay';
import { createHotbar } from './Hotbar';
import { createUnderwaterOverlay } from './UnderwaterOverlay';

/** In-game heads-up display: everything drawn over the world while playing. */
export function createHud(commands: GameCommands): View {
  const underwater = createUnderwaterOverlay();
  const hotbar = createHotbar();
  const debug = createDebugOverlay(commands);
  const crosshair = createCrosshair();
  const modeBadge = h('div', { class: 'hud__mode' });
  const hurtFlash = h('div', { class: 'hud__hurt', attrs: { 'aria-hidden': 'true' } });
  const notice = h('div', { class: 'hud__notice', attrs: { 'data-testid': 'hud-notice' } });
  let noticeTimer = 0;
  const showNotice = (text: string): void => {
    notice.textContent = text;
    notice.classList.add('is-visible');
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => notice.classList.remove('is-visible'), 1600);
  };
  const hint = h(
    'div',
    { class: 'hud__hint', attrs: { 'data-testid': 'click-to-play' } },
    h('strong', { text: 'Click to play' }),
    h('span', { text: 'Esc releases the mouse' }),
  );

  const el = h(
    'div',
    { class: 'hud', attrs: { 'data-testid': 'hud' } },
    underwater.el,
    hurtFlash,
    crosshair,
    modeBadge,
    notice,
    debug.el,
    hotbar.el,
    hint,
  );

  const refresh = (): void => {
    const { screen, pointerLocked, hudHidden } = uiStore.getState();
    // A hidden HUD comes back for menus that are drawn over it.
    el.hidden = !isInGame(screen) || (hudHidden && screen === 'playing' && pointerLocked);
    const waiting = screen === 'playing' && !pointerLocked;
    hint.hidden = !waiting;
    crosshair.style.visibility = screen === 'playing' && pointerLocked ? 'visible' : 'hidden';
  };

  const unsubscribers = [
    uiStore.subscribe((s) => s.screen, refresh),
    uiStore.subscribe((s) => s.pointerLocked, refresh),
    sessionStore.subscribe(
      (s) => s.mode,
      (mode) => (modeBadge.textContent = GAME_MODES[mode].label),
      { fireImmediately: true },
    ),
    uiStore.subscribe((s) => s.hudHidden, refresh),
    sessionStore.subscribe(
      (s) => s.hurtCount,
      () => {
        // Restart the fade each time the player is hurt.
        hurtFlash.classList.remove('is-active');
        void hurtFlash.offsetWidth;
        hurtFlash.classList.add('is-active');
      },
    ),
    uiStore.subscribe(
      (s) => s.notice,
      (message) => showNotice(message.text),
    ),
    sessionStore.subscribe(
      (s) => s.flySpeed,
      (scale) => showNotice(`Fly speed ${scale.toFixed(2)}×`),
    ),
  ];
  refresh();

  return {
    el,
    dispose() {
      for (const unsubscribe of unsubscribers) unsubscribe();
      window.clearTimeout(noticeTimer);
      underwater.dispose();
      hotbar.dispose();
      debug.dispose();
      el.remove();
    },
  };
}
