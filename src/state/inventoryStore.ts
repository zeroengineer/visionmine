import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  addItem,
  clickSlot,
  createInventory,
  cycleSelection,
  expandInventory,
  makeStack,
  MAX_STACK,
  pickBlock,
  removeFromSlot,
  selectSlot,
  type Inventory,
  type Slot,
  wearSelectedTool,
} from '@/gameplay/inventory/inventory';
import { getItemDef } from '@/gameplay/items/items';

export interface InventoryState extends Inventory {
  /** Stack attached to the pointer while the inventory screen is open. */
  cursor: Slot;
  load(inventory: Inventory): void;
  snapshot(): Inventory;
  select(index: number): void;
  cycle(direction: number): void;
  /** Adds items; returns the amount that did not fit. */
  add(item: number, count: number, durability?: number): number;
  /** Uses the selected tool once; returns true if it wore out. */
  wearSelected(): boolean;
  consumeSelected(count?: number): void;
  click(index: number, secondary?: boolean): void;
  /** Creative palette: grab a full stack of a block onto the pointer. */
  grab(item: number): void;
  /** Returns the pointer stack to the inventory (or discards what does not fit). */
  dropCursor(): void;
  pick(block: number): void;
  expand(): void;
}

function apply(set: (partial: Partial<InventoryState>) => void, inventory: Inventory): void {
  set({ slots: inventory.slots, selected: inventory.selected });
}

export const inventoryStore = createStore<InventoryState>()(
  subscribeWithSelector((set, get) => {
    const current = (): Inventory => ({ slots: get().slots, selected: get().selected });
    return {
      ...createInventory(),
      cursor: null,
      load(inventory) {
        set({ slots: inventory.slots, selected: inventory.selected, cursor: null });
      },
      snapshot: current,
      select: (index) => apply(set, selectSlot(current(), index)),
      cycle: (direction) => apply(set, cycleSelection(current(), direction)),
      add(item, count, durability) {
        const result = addItem(current(), item, count, durability);
        apply(set, result.inventory);
        return result.leftover;
      },
      wearSelected() {
        const result = wearSelectedTool(current());
        apply(set, result.inventory);
        return result.broke;
      },
      consumeSelected: (count = 1) => apply(set, removeFromSlot(current(), get().selected, count)),
      click(index, secondary = false) {
        const result = clickSlot(current(), get().cursor, index, secondary);
        set({ slots: result.inventory.slots, cursor: result.cursor });
      },
      grab: (item) =>
        set({ cursor: makeStack(item, Math.min(MAX_STACK, getItemDef(item).maxStack)) }),
      dropCursor() {
        const cursor = get().cursor;
        if (!cursor) return;
        const result = addItem(current(), cursor.item, cursor.count, cursor.durability);
        set({ slots: result.inventory.slots, cursor: null });
      },
      pick: (block) => apply(set, pickBlock(current(), block)),
      expand: () => apply(set, expandInventory(current())),
    };
  }),
);
