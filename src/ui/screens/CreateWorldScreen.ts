import { GAME_MODES, type GameMode } from '@/gameplay/modes/gameMode';
import { uiStore } from '@/state/uiStore';
import { randomSeed } from '@/utils/rng';
import { TERRAIN_PRESETS, type TerrainType } from '@/world/generation/config';
import { MAX_WORLD_NAME_LENGTH } from '@/world/persistence/codec';
import { button, segmented, textField } from '../components/controls';
import { h, type View } from '../components/dom';
import { bindScreen } from '../components/screen';
import type { GameCommands } from '../GameCommands';

type Density = 'none' | 'sparse' | 'normal' | 'dense';
const DENSITY_VALUES: Record<Density, number> = { none: 0, sparse: 0.5, normal: 1, dense: 1.8 };

export function createCreateWorldScreen(commands: GameCommands): View {
  const name = textField('World name', {
    value: 'New World',
    maxLength: MAX_WORLD_NAME_LENGTH,
    id: 'create-name',
  });
  name.input.setAttribute('data-autofocus', '');

  const seed = textField('Seed', {
    value: randomSeed(),
    maxLength: 64,
    hint: 'The same seed always produces the same terrain.',
    id: 'create-seed',
  });
  const randomize = button('Random', () => (seed.input.value = randomSeed()), {
    variant: 'secondary',
    small: true,
  });
  seed.row.classList.add('field--with-action');
  seed.input.after(randomize);

  const terrain = segmented<TerrainType>(
    'Terrain',
    (Object.keys(TERRAIN_PRESETS) as TerrainType[]).map((value) => ({
      value,
      label: TERRAIN_PRESETS[value].label,
      description: TERRAIN_PRESETS[value].description,
    })),
    'standard',
    undefined,
    true,
  );
  const density = segmented<Density>(
    'Vegetation',
    [
      { value: 'none', label: 'None' },
      { value: 'sparse', label: 'Sparse' },
      { value: 'normal', label: 'Normal' },
      { value: 'dense', label: 'Dense' },
    ],
    'normal',
  );
  const mode = segmented<GameMode>(
    'Game mode',
    (Object.keys(GAME_MODES) as GameMode[]).map((value) => ({
      value,
      label: GAME_MODES[value].label,
      description: GAME_MODES[value].description,
    })),
    'creative',
    undefined,
    true,
  );

  const create = button(
    'Create World',
    () => {
      commands.playClick();
      create.disabled = true;
      void commands
        .createWorld({
          name: name.input.value,
          seed: seed.input.value.trim() || randomSeed(),
          terrain: terrain.get(),
          treeDensity: DENSITY_VALUES[density.get()],
          mode: mode.get(),
        })
        .finally(() => (create.disabled = false));
    },
    { id: 'create-submit' },
  );
  const back = button('Back', () => uiStore.getState().setScreen('menu'), { variant: 'ghost' });

  const form = h(
    'form',
    {
      class: 'panel panel--wide',
      attrs: { 'aria-label': 'Create world' },
      on: {
        submit: (event) => {
          event.preventDefault();
          create.click();
        },
      },
    },
    h(
      'header',
      { class: 'panel__header' },
      h('h2', { class: 'panel__title', text: 'Create World' }),
    ),
    h('div', { class: 'form-grid' }, name.row, seed.row),
    terrain.row,
    density.row,
    mode.row,
    h('footer', { class: 'panel__footer' }, back, create),
  );
  const el = h('div', { class: 'overlay overlay--dim', attrs: { 'data-screen': 'create' } }, form);

  const unsubscribe = bindScreen(el, ['create'], () => {
    seed.input.value = randomSeed();
    name.input.select();
  });
  return {
    el,
    dispose() {
      unsubscribe();
      el.remove();
    },
  };
}
