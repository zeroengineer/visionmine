import { GAME_MODES, type GameMode } from '@/gameplay/modes/gameMode';
import { sessionStore, type SaveStatus } from '@/state/sessionStore';
import { uiStore } from '@/state/uiStore';
import { randomSeed } from '@/utils/rng';
import { button, confirmButton, segmented } from '../components/controls';
import { h, type View } from '../components/dom';
import { bindScreen } from '../components/screen';
import type { GameCommands } from '../GameCommands';

const SAVE_LABELS: Record<SaveStatus, string> = {
  idle: 'Not saved yet',
  saving: 'Saving…',
  saved: 'All changes saved',
  memory: 'Saved for this session only',
  error: 'Saving failed — will retry',
};

export function createPauseMenu(commands: GameCommands): View {
  const worldName = h('p', { class: 'pause__world' });
  const saveStatus = h('p', { class: 'pause__save', attrs: { role: 'status' } });

  const resume = button('Resume', () => commands.resume(), { wide: true, id: 'pause-resume' });
  resume.setAttribute('data-autofocus', '');

  const mode = segmented<GameMode>(
    'Game mode',
    (Object.keys(GAME_MODES) as GameMode[]).map((value) => ({
      value,
      label: GAME_MODES[value].label,
    })),
    sessionStore.getState().mode,
    (value) => commands.setMode(value),
  );

  const save = button(
    'Save Now',
    () => {
      void commands.saveNow().then(() => {
        if (sessionStore.getState().saveStatus !== 'error') {
          uiStore.getState().notify('World saved.', 'success');
        }
      });
    },
    { variant: 'secondary', wide: true, id: 'pause-save' },
  );
  const settings = button('Settings', () => uiStore.getState().setScreen('settings'), {
    variant: 'secondary',
    wide: true,
  });
  const reset = confirmButton(
    'Reset World',
    'Discard all changes?',
    () => void commands.resetWorld(),
    { variant: 'danger', small: true, id: 'pause-reset' },
  );
  const regenerate = confirmButton(
    'New Terrain',
    'Replace with new seed?',
    () => void commands.regenerateWorld(randomSeed()),
    { variant: 'danger', small: true, id: 'pause-regenerate' },
  );
  const quit = button('Save & Quit to Menu', () => void commands.quitToMenu(), {
    variant: 'ghost',
    wide: true,
    id: 'pause-quit',
  });

  const panel = h(
    'div',
    { class: 'panel pause', attrs: { role: 'dialog', 'aria-label': 'Game paused' } },
    h('header', { class: 'panel__header' }, h('h2', { class: 'panel__title', text: 'Paused' })),
    worldName,
    resume,
    mode.row,
    save,
    settings,
    h(
      'div',
      { class: 'pause__danger' },
      h('span', { class: 'field__label', text: 'World tools' }),
      h('div', { class: 'pause__danger-actions' }, reset, regenerate),
      h('p', {
        class: 'field__hint',
        text: 'Reset removes everything you built. New Terrain also changes the seed.',
      }),
    ),
    quit,
    saveStatus,
  );
  const el = h('div', { class: 'overlay overlay--dim', attrs: { 'data-screen': 'paused' } }, panel);

  const unsubscribers = [
    bindScreen(el, ['paused']),
    sessionStore.subscribe(
      (s) => s.mode,
      (value) => mode.set(value),
    ),
    sessionStore.subscribe(
      (s) => `${s.worldName}|${s.seed}`,
      () => {
        const { worldName: name, seed } = sessionStore.getState();
        worldName.textContent = name ? `${name} · seed ${seed}` : '';
      },
      { fireImmediately: true },
    ),
    sessionStore.subscribe(
      (s) => s.saveStatus,
      (status) => {
        saveStatus.textContent = SAVE_LABELS[status];
        saveStatus.classList.toggle('is-error', status === 'error' || status === 'memory');
      },
      { fireImmediately: true },
    ),
  ];

  return {
    el,
    dispose() {
      for (const unsubscribe of unsubscribers) unsubscribe();
      el.remove();
    },
  };
}
