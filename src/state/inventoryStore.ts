import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  addItem,
  clickCell,
  clickSlot,
  createInventory,
  cycleSelection,
  expandInventory,
  makeStack,
  MAX_STACK,
  maxStackOf,
  pickBlock,
  removeFromSlot,
  selectSlot,
  type Inventory,
  type ItemStack,
  type Slot,
  wearSelectedTool,
} from '@/gameplay/inventory/inventory';
import { GRID_CELLS, gridCells, matchRecipe } from '@/gameplay/crafting/recipes';
import { getItemDef } from '@/gameplay/items/items';

export interface InventoryState extends Inventory {
  /** Stack attached to the pointer while the inventory screen is open. */
  cursor: Slot;
  /** Crafting grid, always 3 × 3; with `craftSide` 2 only its top-left corner is used. */
  craft: readonly Slot[];
  craftSide: number;
  /** What the grid currently makes, or null. */
  craftResult: ItemStack | null;
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
  clickCraft(index: number, secondary?: boolean): void;
  /** Takes one batch of the crafted item onto the pointer, using up the ingredients. */
  takeCraftResult(): void;
  /** Sets the grid size (2 in the inventory, 3 at a crafting table), emptying the grid first. */
  openCraft(side: number): void;
  /** Returns everything in the grid to the inventory. */
  clearCraft(): void;
  expand(): void;
}

function apply(set: (partial: Partial<InventoryState>) => void, inventory: Inventory): void {
  set({ slots: inventory.slots, selected: inventory.selected });
}

const EMPTY_GRID: readonly Slot[] = new Array<Slot>(GRID_CELLS).fill(null);

/** The stack a crafting grid makes right now, or null. */
function resultOf(craft: readonly Slot[]): ItemStack | null {
  const recipe = matchRecipe(craft.map((slot) => slot?.item ?? 0));
  return recipe ? makeStack(recipe.result.item, recipe.result.count) : null;
}

export const inventoryStore = createStore<InventoryState>()(
  subscribeWithSelector((set, get) => {
    const current = (): Inventory => ({ slots: get().slots, selected: get().selected });
    return {
      ...createInventory(),
      cursor: null,
      craft: EMPTY_GRID,
      craftSide: 2,
      craftResult: null,
      load(inventory) {
        set({
          slots: inventory.slots,
          selected: inventory.selected,
          cursor: null,
          craft: EMPTY_GRID,
          craftSide: 2,
          craftResult: null,
        });
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
      clickCraft(index, secondary = false) {
        if (!gridCells(get().craftSide).includes(index)) return;
        const result = clickCell(get().craft[index] ?? null, get().cursor, secondary);
        const craft = [...get().craft];
        craft[index] = result.slot;
        set({ craft, cursor: result.cursor, craftResult: resultOf(craft) });
      },
      takeCraftResult() {
        const { craftResult, cursor } = get();
        if (!craftResult) return;
        // The batch must fit on the pointer: empty, or the same stackable item with room.
        let carried: ItemStack;
        if (!cursor) {
          carried = craftResult;
        } else if (
          cursor.item === craftResult.item &&
          cursor.count + craftResult.count <= maxStackOf(cursor.item)
        ) {
          carried = { item: cursor.item, count: cursor.count + craftResult.count };
        } else {
          return;
        }
        const craft = get().craft.map((slot) =>
          slot ? (slot.count > 1 ? { ...slot, count: slot.count - 1 } : null) : null,
        );
        set({ craft, cursor: carried, craftResult: resultOf(craft) });
      },
      openCraft(side) {
        get().clearCraft();
        set({ craftSide: side === 3 ? 3 : 2 });
      },
      clearCraft() {
        let inventory = current();
        for (const slot of get().craft) {
          if (slot)
            inventory = addItem(inventory, slot.item, slot.count, slot.durability).inventory;
        }
        set({ slots: inventory.slots, craft: EMPTY_GRID, craftResult: null });
      },
      expand: () => apply(set, expandInventory(current())),
    };
  }),
);
