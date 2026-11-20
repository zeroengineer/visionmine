import type { Slot } from '@/gameplay/inventory/inventory';
import { getBlockDef } from '@/world/blocks/blocks';
import { blockIconUrl } from './blockIcon';
import { h } from './dom';

export interface SlotElement {
  el: HTMLElement;
  icon: HTMLImageElement;
  count: HTMLElement;
  /** Last rendered content key, to skip redundant DOM writes. */
  key: string;
}

export function createSlotElement(extraClass = ''): SlotElement {
  const icon = h('img', { class: 'slot__icon', attrs: { alt: '', draggable: 'false' } });
  const count = h('span', { class: 'slot__count' });
  const el = h('div', { class: `slot ${extraClass}`.trim() }, icon, count);
  return { el, icon, count, key: '' };
}

/** Updates a slot element to show `slot`. `infinite` hides stack counts (creative mode). */
export function renderSlot(view: SlotElement, slot: Slot, infinite: boolean): void {
  const key = slot ? `${slot.block}:${infinite ? '∞' : slot.count}` : '';
  if (key === view.key) return;
  view.key = key;
  if (!slot) {
    view.icon.removeAttribute('src');
    view.icon.style.visibility = 'hidden';
    view.count.textContent = '';
    view.el.removeAttribute('title');
    return;
  }
  view.icon.src = blockIconUrl(slot.block);
  view.icon.style.visibility = 'visible';
  view.count.textContent = infinite ? '' : slot.count > 1 ? String(slot.count) : '';
  view.el.title = getBlockDef(slot.block).name;
}
