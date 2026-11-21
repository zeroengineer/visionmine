import { GAME_MODES } from '@/gameplay/modes/gameMode';
import { HOTBAR_SIZE } from '@/gameplay/inventory/inventory';
import { inventoryStore } from '@/state/inventoryStore';
import { sessionStore } from '@/state/sessionStore';
import { getItemDef } from '@/gameplay/items/items';
import { h, type View } from '../components/dom';
import { createSlotElement, renderSlot } from '../components/slot';

const LABEL_VISIBLE_MS = 1600;

/** The nine quick-access slots at the bottom of the screen. */
export function createHotbar(): View {
  const slots = Array.from({ length: HOTBAR_SIZE }, (_, i) => {
    const slot = createSlotElement('hotbar__slot');
    slot.el.append(h('span', { class: 'slot__key', text: String(i + 1) }));
    return slot;
  });
  const label = h('div', { class: 'hotbar__label' });
  const bar = h('div', { class: 'hotbar__bar' }, ...slots.map((s) => s.el));
  const el = h('div', { class: 'hotbar', attrs: { 'aria-label': 'Hotbar' } }, label, bar);
  let labelTimer = 0;

  const render = (): void => {
    const { slots: items, selected } = inventoryStore.getState();
    const infinite = GAME_MODES[sessionStore.getState().mode].infiniteBlocks;
    slots.forEach((view, i) => {
      renderSlot(view, items[i] ?? null, infinite);
      view.el.classList.toggle('is-selected', i === selected);
    });
  };

  const showLabel = (): void => {
    const { slots: items, selected } = inventoryStore.getState();
    const item = items[selected];
    label.textContent = item ? getItemDef(item.item).name : '';
    label.classList.toggle('is-visible', Boolean(item));
    window.clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => label.classList.remove('is-visible'), LABEL_VISIBLE_MS);
  };

  const unsubscribers = [
    inventoryStore.subscribe((s) => s.slots, render),
    inventoryStore.subscribe(
      (s) => s.selected,
      () => {
        render();
        showLabel();
      },
    ),
    sessionStore.subscribe((s) => s.mode, render),
  ];
  render();

  return {
    el,
    dispose() {
      window.clearTimeout(labelTimer);
      for (const unsubscribe of unsubscribers) unsubscribe();
      el.remove();
    },
  };
}
