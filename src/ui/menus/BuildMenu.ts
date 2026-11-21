import type { BuildAction } from '@/gameplay/building/BuildTools';
import { MAX_REGION_BLOCKS } from '@/gameplay/building/regionOps';
import { selectedStack } from '@/gameplay/inventory/inventory';
import { primaryKeyLabel } from '@/core/input/actions';
import { buildStore } from '@/state/buildStore';
import { inventoryStore } from '@/state/inventoryStore';
import { settingsStore } from '@/state/settingsStore';
import { getBlockDef } from '@/world/blocks/blocks';
import { button } from '../components/controls';
import { h, type View } from '../components/dom';
import { bindScreen } from '../components/screen';
import type { GameCommands } from '../GameCommands';

/** Creative-mode builder tools: operations on the two-corner selection, copy/paste and undo. */
export function createBuildMenu(commands: GameCommands): View {
  const selectionInfo = h('p', {
    class: 'build__info',
    attrs: { 'data-testid': 'build-selection' },
  });
  const heldInfo = h('p', { class: 'build__info' });
  const clipboardInfo = h('p', {
    class: 'build__info',
    attrs: { 'data-testid': 'build-clipboard' },
  });
  const status = h('p', {
    class: 'build__status',
    attrs: { role: 'status', 'data-testid': 'build-status' },
  });

  const run = (action: BuildAction): void => {
    const result = commands.buildAction(action);
    status.textContent = result.message;
    status.classList.toggle('is-error', !result.ok);
  };
  const tool = (label: string, action: BuildAction, variant?: 'secondary' | 'danger') =>
    button(label, () => run(action), { variant, small: true, id: `build-${action}` });

  const fill = tool('Fill', 'fill');
  const replace = tool('Replace', 'replace');
  const clear = tool('Clear', 'clear', 'danger');
  const copy = tool('Copy', 'copy', 'secondary');
  const paste = tool('Paste', 'paste', 'secondary');
  const rotate = tool('Rotate copy', 'rotate', 'secondary');
  const deselect = tool('Deselect', 'deselect', 'secondary');
  const undo = tool('Undo', 'undo', 'secondary');
  const redo = tool('Redo', 'redo', 'secondary');
  const close = button('Close', () => commands.closeBuildMenu(), {
    variant: 'ghost',
    id: 'build-close',
  });
  close.setAttribute('data-autofocus', '');

  const group = (title: string, hint: string, ...buttons: HTMLElement[]): HTMLElement =>
    h(
      'section',
      { class: 'build__group' },
      h('h3', { class: 'inv__heading', text: title }),
      h('div', { class: 'build__buttons' }, ...buttons),
      h('p', { class: 'field__hint', text: hint }),
    );

  const panel = h(
    'div',
    { class: 'panel build', attrs: { role: 'dialog', 'aria-label': 'Build tools' } },
    h(
      'header',
      { class: 'panel__header' },
      h('h2', { class: 'panel__title', text: 'Build tools' }),
    ),
    selectionInfo,
    heldInfo,
    group(
      'Selection',
      'Fill sets every cell. Replace changes existing blocks only. Clear removes them.',
      fill,
      replace,
      clear,
      deselect,
    ),
    clipboardInfo,
    group(
      'Copy and paste',
      'Paste starts at the block face you are looking at and skips empty space in the copy.',
      copy,
      paste,
      rotate,
    ),
    group('History', 'Each click, explosion or tool use is one step.', undo, redo),
    status,
    h('footer', { class: 'panel__footer' }, h('span', {}), close),
  );
  const el = h('div', { class: 'overlay overlay--dim', attrs: { 'data-screen': 'build' } }, panel);

  const render = (): void => {
    const state = buildStore.getState();
    const bindings = settingsStore.getState().bindings;
    const cornerKey = primaryKeyLabel(bindings, 'selectCorner');
    if (state.selection) {
      const { sx, sy, sz } = state.selection;
      const volume = sx * sy * sz;
      selectionInfo.textContent =
        `Selection: ${sx} × ${sy} × ${sz} (${volume.toLocaleString('en-US')} blocks)` +
        (volume > MAX_REGION_BLOCKS ? ' — too large to edit' : '');
    } else if (state.corners === 1) {
      selectionInfo.textContent = `First corner set. Look at the opposite corner and press ${cornerKey}.`;
    } else {
      selectionInfo.textContent = `No selection. Look at a block and press ${cornerKey} to mark a corner.`;
    }
    const held = selectedStack(inventoryStore.getState());
    heldInfo.textContent = held ? `Holding: ${getBlockDef(held.block).name}` : 'Holding: nothing';
    clipboardInfo.textContent = state.clipboard
      ? `Copy: ${state.clipboard.sx} × ${state.clipboard.sy} × ${state.clipboard.sz}`
      : 'Copy: empty';

    const hasSelection = state.selection !== null;
    fill.disabled = !hasSelection || !held;
    replace.disabled = !hasSelection || !held;
    clear.disabled = !hasSelection;
    copy.disabled = !hasSelection;
    deselect.disabled = state.corners === 0;
    paste.disabled = state.clipboard === null;
    rotate.disabled = state.clipboard === null;
    undo.disabled = !state.canUndo;
    redo.disabled = !state.canRedo;
  };

  const unsubscribers = [
    bindScreen(el, ['build'], () => {
      status.textContent = '';
      status.classList.remove('is-error');
      render();
    }),
    buildStore.subscribe(render),
    inventoryStore.subscribe((s) => s.selected, render),
    inventoryStore.subscribe((s) => s.slots, render),
    settingsStore.subscribe((s) => s.bindings, render),
  ];

  return {
    el,
    dispose() {
      for (const unsubscribe of unsubscribers) unsubscribe();
      el.remove();
    },
  };
}
