import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  addItem,
  clickSlot,
  createInventory,
  cycleSelection,
  expandInventory,
  MAX_STACK,
  pickBlock,
  removeFromSlot,
  selectSlot,
  type Inventory,
  type Slot,
} from '@/gameplay/inventory/inventory';
import type { BlockId } from '@/world/blocks/blocks';

export interface InventoryState extends Inventory {
  /** Stack attached to the pointer while the inventory screen is open. */
  cursor: Slot;
  load(inventory: Inventory): void;
  snapshot(): Inventory;
  select(index: number): void;
  cycle(direction: number): void;
  /** Adds items; returns the amount that did not fit. */
  add(block: number, count: number): number;
  consumeSelected(count?: number): void;
  click(index: number, secondary?: boolean): void;
  /** Creative palette: grab a full stack of a block onto the pointer. */
  grab(block: BlockId): void;
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
      add(block, count) {
        const result = addItem(current(), block, count);
        apply(set, result.inventory);
        return result.leftover;
      },
      consumeSelected: (count = 1) => apply(set, removeFromSlot(current(), get().selected, count)),
      click(index, secondary = false) {
        const result = clickSlot(current(), get().cursor, index, secondary);
        set({ slots: result.inventory.slots, cursor: result.cursor });
      },
      grab: (block) => set({ cursor: { block, count: MAX_STACK } }),
      dropCursor() {
        const cursor = get().cursor;
        if (!cursor) return;
        const result = addItem(current(), cursor.block, cursor.count);
        set({ slots: result.inventory.slots, cursor: null });
      },
      pick: (block) => apply(set, pickBlock(current(), block)),
      expand: () => apply(set, expandInventory(current())),
    };
  }),
);
