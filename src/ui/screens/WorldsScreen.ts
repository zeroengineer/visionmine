import { GAME_MODES } from '@/gameplay/modes/gameMode';
import { uiStore } from '@/state/uiStore';
import { TERRAIN_PRESETS } from '@/world/generation/config';
import { MAX_WORLD_NAME_LENGTH } from '@/world/persistence/codec';
import type { WorldSummary } from '@/world/persistence/types';
import { button, confirmButton } from '../components/controls';
import { h, type View } from '../components/dom';
import { bindScreen, formatRelativeTime } from '../components/screen';
import type { GameCommands } from '../GameCommands';

/** Saved worlds: play, rename and delete. */
export function createWorldsScreen(commands: GameCommands): View {
  const list = h('ul', { class: 'world-list', attrs: { 'aria-label': 'Saved worlds' } });
  const status = h('p', { class: 'world-list__status', attrs: { role: 'status' } });
  const notify = uiStore.getState().notify;

  const refresh = async (): Promise<void> => {
    status.textContent = 'Loading worlds…';
    status.hidden = false;
    let worlds: WorldSummary[];
    try {
      worlds = await commands.listWorlds();
    } catch {
      list.replaceChildren();
      status.textContent = 'Saved worlds could not be read from browser storage.';
      return;
    }
    list.replaceChildren(...worlds.map(renderRow));
    status.hidden = worlds.length > 0;
    status.textContent = worlds.length > 0 ? '' : 'No worlds yet. Create one to get started.';
  };

  const remove = (id: string): void => {
    void commands
      .deleteWorld(id)
      .then(() => notify('World deleted.', 'success'))
      .catch(() => notify('The world could not be deleted.', 'error'))
      .finally(() => void refresh());
  };

  function renderRow(world: WorldSummary): HTMLElement {
    if (world.corrupt) {
      return h(
        'li',
        { class: 'world world--corrupt', attrs: { 'data-world-id': world.id } },
        h(
          'div',
          { class: 'world__info' },
          h('span', { class: 'world__name', text: world.name }),
          h('span', {
            class: 'world__meta',
            text: 'This save is damaged and cannot be opened.',
          }),
        ),
        h(
          'div',
          { class: 'world__actions' },
          confirmButton('Delete', 'Confirm delete', () => remove(world.id), {
            variant: 'danger',
            small: true,
          }),
        ),
      );
    }

    const { record } = world;
    const nameLabel = h('span', { class: 'world__name', text: record.name });
    const meta = h('span', {
      class: 'world__meta',
      text: [
        TERRAIN_PRESETS[record.config.terrain].label,
        GAME_MODES[record.mode].label,
        `Seed ${record.config.seed}`,
        `Played ${formatRelativeTime(record.lastPlayedAt)}`,
      ].join(' · '),
    });
    const info = h('div', { class: 'world__info' }, nameLabel, meta);

    const startRename = (): void => {
      const input = h('input', {
        class: 'field__input',
        attrs: {
          type: 'text',
          maxlength: String(MAX_WORLD_NAME_LENGTH),
          'aria-label': 'World name',
          'data-testid': 'rename-input',
        },
      });
      input.value = record.name;
      let done = false;
      const finish = (save: boolean): void => {
        if (done) return;
        done = true;
        const next = input.value.trim();
        if (!save || next.length === 0 || next === record.name) {
          input.replaceWith(nameLabel);
          return;
        }
        void commands
          .renameWorld(record.id, next)
          .catch(() => notify('The world could not be renamed.', 'error'))
          .finally(() => void refresh());
      };
      input.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(true);
        else if (event.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
      nameLabel.replaceWith(input);
      input.focus();
      input.select();
    };

    return h(
      'li',
      { class: 'world', attrs: { 'data-world-id': record.id } },
      info,
      h(
        'div',
        { class: 'world__actions' },
        button(
          'Play',
          () => {
            commands.playClick();
            void commands.playWorld(record.id);
          },
          { small: true, id: 'world-play' },
        ),
        button('Rename', startRename, { variant: 'secondary', small: true, id: 'world-rename' }),
        confirmButton('Delete', 'Confirm delete', () => remove(record.id), {
          variant: 'danger',
          small: true,
          id: 'world-delete',
        }),
      ),
    );
  }

  const back = button('Back', () => uiStore.getState().setScreen('menu'), { variant: 'ghost' });
  back.setAttribute('data-autofocus', '');
  const panel = h(
    'div',
    { class: 'panel panel--wide', attrs: { role: 'region', 'aria-label': 'Worlds' } },
    h(
      'header',
      { class: 'panel__header' },
      h('h2', { class: 'panel__title', text: 'Worlds' }),
      button('New World', () => uiStore.getState().setScreen('create'), { small: true }),
    ),
    status,
    list,
    h('footer', { class: 'panel__footer' }, back),
  );
  const el = h('div', { class: 'overlay overlay--dim', attrs: { 'data-screen': 'worlds' } }, panel);

  const unsubscribe = bindScreen(el, ['worlds'], () => void refresh());
  return {
    el,
    dispose() {
      unsubscribe();
      el.remove();
    },
  };
}
