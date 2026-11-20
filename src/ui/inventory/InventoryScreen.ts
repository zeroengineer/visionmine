import { GAME_MODES } from '@/gameplay/modes/gameMode';
import {
  HOTBAR_SIZE,
  MAX_BAG_ROWS,
  PALETTE_BLOCKS,
  ROW_SIZE,
} from '@/gameplay/inventory/inventory';
import { inventoryStore } from '@/state/inventoryStore';
import { sessionStore } from '@/state/sessionStore';
import { uiStore } from '@/state/uiStore';
import { getBlockDef } from '@/world/blocks/blocks';
import { blockIconUrl } from '../components/blockIcon';
import { h, type View } from '../components/dom';
import { createSlotElement, renderSlot, type SlotElement } from '../components/slot';

export interface InventoryScreenOptions {
  onClose(): void;
}

/**
 * Full inventory: backpack grid, hotbar row, the creative block palette and a
 * pointer-carried stack for moving items between slots.
 */
export function createInventoryScreen(options: InventoryScreenOptions): View {
  const store = inventoryStore;
  const slotViews: SlotElement[] = [];

  const bagGrid = h('div', { class: 'inv__grid' });
  const hotbarGrid = h('div', { class: 'inv__grid inv__grid--hotbar' });
  const palette = h('div', { class: 'inv__palette' });
  const paletteSection = h(
    'section',
    { class: 'inv__section' },
    h('h3', { class: 'inv__heading', text: 'Block palette' }),
    palette,
  );
  const capacity = h('span', { class: 'inv__capacity' });
  const expandButton = h('button', {
    class: 'btn btn--small',
    text: 'Expand backpack',
    attrs: { type: 'button' },
    on: { click: () => store.getState().expand() },
  });
  const modeBadge = h('span', { class: 'badge' });
  const hint = h('p', { class: 'inv__hint' });
  const cursorView = createSlotElement('slot--cursor');

  const panel = h(
    'div',
    { class: 'panel inv', attrs: { role: 'dialog', 'aria-label': 'Inventory' } },
    h(
      'header',
      { class: 'panel__header' },
      h('h2', { class: 'panel__title', text: 'Inventory' }),
      modeBadge,
      h('button', {
        class: 'btn btn--ghost btn--small',
        text: 'Close · E',
        attrs: { type: 'button' },
        on: { click: () => options.onClose() },
      }),
    ),
    paletteSection,
    h(
      'section',
      { class: 'inv__section' },
      h(
        'div',
        { class: 'inv__row' },
        h('h3', { class: 'inv__heading', text: 'Backpack' }),
        capacity,
        expandButton,
      ),
      bagGrid,
    ),
    h(
      'section',
      { class: 'inv__section' },
      h('h3', { class: 'inv__heading', text: 'Hotbar' }),
      hotbarGrid,
    ),
    hint,
  );
  const el = h('div', { class: 'overlay overlay--dim inv-screen' }, panel, cursorView.el);
  el.hidden = true;

  // Palette entries never change, so they are built once.
  for (const block of PALETTE_BLOCKS) {
    const def = getBlockDef(block);
    palette.append(
      h(
        'button',
        {
          class: 'slot slot--palette',
          attrs: { type: 'button', title: def.name, 'aria-label': def.name },
          on: { click: () => store.getState().grab(block) },
        },
        h('img', {
          class: 'slot__icon',
          attrs: { src: blockIconUrl(block), alt: '', draggable: 'false' },
        }),
      ),
    );
  }

  const ensureSlots = (count: number): void => {
    while (slotViews.length < count) {
      const index = slotViews.length;
      const view = createSlotElement('slot--interactive');
      view.el.addEventListener('mousedown', (event) => {
        if (event.button !== 0 && event.button !== 2) return;
        event.preventDefault();
        store.getState().click(index, event.button === 2);
      });
      slotViews.push(view);
      (index < HOTBAR_SIZE ? hotbarGrid : bagGrid).append(view.el);
    }
  };

  const render = (): void => {
    const { slots, selected, cursor } = store.getState();
    const rules = GAME_MODES[sessionStore.getState().mode];
    ensureSlots(slots.length);
    slotViews.forEach((view, i) => {
      renderSlot(view, slots[i] ?? null, false);
      view.el.classList.toggle('is-selected', i === selected);
    });
    renderSlot(cursorView, cursor, false);
    cursorView.el.hidden = cursor === null;

    const rows = (slots.length - HOTBAR_SIZE) / ROW_SIZE;
    capacity.textContent = `${slots.length - HOTBAR_SIZE} slots`;
    expandButton.disabled = rows >= MAX_BAG_ROWS;
    expandButton.textContent =
      rows >= MAX_BAG_ROWS ? 'Backpack at max size' : 'Expand backpack (+9)';
    paletteSection.hidden = !rules.infiniteBlocks;
    modeBadge.textContent = rules.label;
    hint.textContent = rules.infiniteBlocks
      ? 'Click a palette block, then click a slot to place it. Right-click splits or drops one.'
      : 'Blocks you mine are collected here. Click to move stacks; right-click splits or drops one.';
  };

  const onMouseMove = (event: MouseEvent): void => {
    cursorView.el.style.transform = `translate(${event.clientX - 24}px, ${event.clientY - 24}px)`;
  };
  const onContextMenu = (event: Event): void => event.preventDefault();
  el.addEventListener('mousemove', onMouseMove);
  el.addEventListener('contextmenu', onContextMenu);

  const unsubscribers = [
    store.subscribe((s) => s.slots, render),
    store.subscribe((s) => s.selected, render),
    store.subscribe((s) => s.cursor, render),
    sessionStore.subscribe((s) => s.mode, render),
    uiStore.subscribe(
      (s) => s.screen,
      (screen) => {
        el.hidden = screen !== 'inventory';
        if (!el.hidden) render();
      },
    ),
  ];
  render();

  return {
    el,
    dispose() {
      for (const unsubscribe of unsubscribers) unsubscribe();
      el.remove();
    },
  };
}
