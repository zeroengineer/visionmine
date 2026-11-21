import type { Slot } from '@/gameplay/inventory/inventory';
import { getItemDef } from '@/gameplay/items/items';
import { itemIconUrl } from './blockIcon';
import { h } from './dom';

export interface SlotElement {
  el: HTMLElement;
  icon: HTMLImageElement;
  count: HTMLElement;
  /** Bar showing how worn a tool is. */
  wear: HTMLElement;
  /** Last rendered content key, to skip redundant DOM writes. */
  key: string;
}

export function createSlotElement(extraClass = ''): SlotElement {
  const icon = h('img', { class: 'slot__icon', attrs: { alt: '', draggable: 'false' } });
  const count = h('span', { class: 'slot__count' });
  const wear = h('span', { class: 'slot__wear' }, h('span', { class: 'slot__wear-fill' }));
  wear.hidden = true;
  const el = h('div', { class: `slot ${extraClass}`.trim() }, icon, count, wear);
  return { el, icon, count, wear, key: '' };
}

/** Updates a slot element to show `slot`. `infinite` hides stack counts (creative mode). */
export function renderSlot(view: SlotElement, slot: Slot, infinite: boolean): void {
  const key = slot ? `${slot.item}:${infinite ? '∞' : slot.count}:${slot.durability ?? ''}` : '';
  if (key === view.key) return;
  view.key = key;
  if (!slot) {
    view.icon.removeAttribute('src');
    view.icon.style.visibility = 'hidden';
    view.count.textContent = '';
    view.wear.hidden = true;
    view.el.removeAttribute('title');
    return;
  }
  const def = getItemDef(slot.item);
  view.icon.src = itemIconUrl(slot.item);
  view.icon.style.visibility = 'visible';
  view.count.textContent = infinite ? '' : slot.count > 1 ? String(slot.count) : '';
  view.el.title = def.name;
  // Show wear only once a tool has been used.
  const worn =
    def.tool !== null && slot.durability !== undefined && slot.durability < def.tool.durability;
  view.wear.hidden = !worn;
  if (worn && def.tool) {
    const left = slot.durability! / def.tool.durability;
    const fill = view.wear.firstElementChild as HTMLElement;
    fill.style.width = `${Math.max(4, Math.round(left * 100))}%`;
    fill.style.background = left > 0.5 ? '#6fd24a' : left > 0.2 ? '#ffb648' : '#ff6b5e';
  }
}
