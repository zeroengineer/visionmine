import { settingsStore } from '@/state/settingsStore';
import { uiStore } from '@/state/uiStore';
import type { WorldRecord } from '@/world/persistence/types';
import { button } from '../components/controls';
import { controlsSummary } from '../components/controlsSummary';
import { h, type View } from '../components/dom';
import { bindScreen } from '../components/screen';
import type { GameCommands } from '../GameCommands';

export function createMainMenu(commands: GameCommands): View {
  let latest: WorldRecord | null = null;
  const ui = uiStore.getState();

  const continueButton = button(
    'Continue',
    () => {
      commands.playClick();
      if (latest) void commands.playWorld(latest.id);
    },
    { wide: true, id: 'menu-continue' },
  );
  continueButton.setAttribute('data-autofocus', '');
  const continueDetail = h('span', { class: 'menu__detail' });
  const continueGroup = h('div', { class: 'menu__continue' }, continueButton, continueDetail);

  const newButton = button(
    'New World',
    () => {
      commands.playClick();
      ui.setScreen('create');
    },
    { wide: true, id: 'menu-new' },
  );
  const worldsButton = button(
    'Worlds',
    () => {
      commands.playClick();
      ui.setScreen('worlds');
    },
    { variant: 'secondary', wide: true, id: 'menu-worlds' },
  );
  const settingsButton = button(
    'Settings',
    () => {
      commands.playClick();
      ui.setScreen('settings');
    },
    { variant: 'secondary', wide: true, id: 'menu-settings' },
  );

  const storageNote = h('p', { class: 'menu__note', attrs: { role: 'status' } });

  const controlsList = h('dl', { class: 'keys', attrs: { 'data-testid': 'menu-controls' } });
  const renderControls = (): void => {
    controlsList.replaceChildren(
      ...controlsSummary(settingsStore.getState().bindings).flatMap(([key, action]) => [
        h('dt', { class: 'keys__key', text: key }),
        h('dd', { class: 'keys__action', text: action }),
      ]),
    );
  };
  renderControls();
  const unsubscribeBindings = settingsStore.subscribe((s) => s.bindings, renderControls);

  const el = h(
    'div',
    { class: 'menu', attrs: { 'data-screen': 'menu' } },
    h(
      'div',
      { class: 'menu__column' },
      h(
        'header',
        { class: 'menu__brand' },
        h('h1', { class: 'logo', text: 'VISIONMINE' }),
        h('p', { class: 'menu__tagline', text: 'Dig, build and explore an endless voxel world.' }),
      ),
      h('nav', { class: 'menu__actions' }, continueGroup, newButton, worldsButton, settingsButton),
      storageNote,
    ),
    h(
      'aside',
      { class: 'menu__controls', attrs: { 'aria-label': 'Controls' } },
      h('h2', { class: 'menu__controls-title', text: 'Controls' }),
      controlsList,
    ),
  );

  const refresh = (): void => {
    storageNote.textContent = commands.storagePersistent
      ? ''
      : 'Browser storage is unavailable, so worlds will be lost when this tab closes.';
    storageNote.hidden = commands.storagePersistent;
    void commands
      .listWorlds()
      .then((worlds) => {
        const first = worlds.find((world) => !world.corrupt);
        latest = first && !first.corrupt ? first.record : null;
      })
      .catch(() => {
        latest = null;
      })
      .finally(() => {
        continueGroup.hidden = latest === null;
        continueDetail.textContent = latest ? latest.name : '';
        newButton.classList.toggle('btn--secondary', latest !== null);
      });
  };

  const unsubscribe = bindScreen(el, ['menu'], refresh);
  return {
    el,
    dispose() {
      unsubscribe();
      unsubscribeBindings();
      el.remove();
    },
  };
}
