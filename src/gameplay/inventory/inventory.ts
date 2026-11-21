import { BlockId, PLACEABLE_BLOCKS } from '@/world/blocks/blocks';
import { getItemDef, isBlockItem, isValidItem, NON_BLOCK_ITEMS } from '../items/items';
import type { GameMode } from '../modes/gameMode';

export interface ItemStack {
  /** Item id: a block id, or an id from `ItemId` for things that are not blocks. */
  readonly item: number;
  readonly count: number;
  /** Uses left, for tools. */
  readonly durability?: number;
}

export type Slot = ItemStack | null;

/** Immutable inventory value. Slots 0..8 are the hotbar; the rest is the backpack. */
export interface Inventory {
  readonly slots: readonly Slot[];
  /** Selected hotbar index, 0..8. */
  readonly selected: number;
}

export const HOTBAR_SIZE = 9;
export const ROW_SIZE = 9;
export const BASE_BAG_ROWS = 3;
export const MAX_BAG_ROWS = 6;
export const MAX_STACK = 64;

export function slotCount(bagRows: number): number {
  return HOTBAR_SIZE + bagRows * ROW_SIZE;
}

export function bagRows(inventory: Inventory): number {
  return (inventory.slots.length - HOTBAR_SIZE) / ROW_SIZE;
}

export function createInventory(rows = BASE_BAG_ROWS): Inventory {
  return { slots: new Array<Slot>(slotCount(rows)).fill(null), selected: 0 };
}

const isHoldable = isValidItem;

/** Largest stack of an item (1 for tools). */
function stackLimit(item: number): number {
  return Math.min(MAX_STACK, getItemDef(item).maxStack);
}

/** A fresh stack, with full durability if the item is a tool. */
export function makeStack(item: number, count: number, durability?: number): ItemStack {
  const tool = getItemDef(item).tool;
  if (!tool) return { item, count };
  return { item, count: 1, durability: durability ?? tool.durability };
}

/** Starting items for a new world. */
export function starterInventory(mode: GameMode): Inventory {
  const inventory = createInventory();
  const slots = [...inventory.slots];
  if (mode === 'creative') {
    const hotbar: BlockId[] = [
      BlockId.Grass,
      BlockId.Dirt,
      BlockId.Stone,
      BlockId.Cobblestone,
      BlockId.Planks,
      BlockId.Log,
      BlockId.Glass,
      BlockId.Brick,
      BlockId.Tnt,
    ];
    hotbar.forEach((block, i) => (slots[i] = { item: block, count: MAX_STACK }));
  } else {
    slots[0] = { item: BlockId.Planks, count: 32 };
    slots[1] = { item: BlockId.Cobblestone, count: 32 };
    slots[2] = { item: BlockId.Glass, count: 16 };
    slots[3] = { item: BlockId.Tnt, count: 4 };
  }
  return { slots, selected: 0 };
}

export function selectedStack(inventory: Inventory): Slot {
  return inventory.slots[inventory.selected] ?? null;
}

export function selectSlot(inventory: Inventory, index: number): Inventory {
  if (!Number.isInteger(index) || index < 0 || index >= HOTBAR_SIZE) return inventory;
  return index === inventory.selected ? inventory : { ...inventory, selected: index };
}

/** Moves the hotbar selection by `direction` (±1), wrapping around. */
export function cycleSelection(inventory: Inventory, direction: number): Inventory {
  const next = (((inventory.selected + direction) % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
  return selectSlot(inventory, next);
}

/**
 * Adds items, topping up existing stacks before using empty slots.
 * `leftover` is the amount that did not fit.
 */
export function addItem(
  inventory: Inventory,
  item: number,
  count: number,
  durability?: number,
): { inventory: Inventory; leftover: number } {
  if (!isHoldable(item) || count <= 0) return { inventory, leftover: Math.max(0, count) };
  const slots = [...inventory.slots];
  const limit = stackLimit(item);
  let remaining = Math.floor(count);

  if (limit > 1) {
    for (let i = 0; i < slots.length && remaining > 0; i++) {
      const slot = slots[i];
      if (slot && slot.item === item && slot.count < limit) {
        const moved = Math.min(limit - slot.count, remaining);
        slots[i] = { item, count: slot.count + moved };
        remaining -= moved;
      }
    }
  }
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    if (!slots[i]) {
      const moved = Math.min(limit, remaining);
      slots[i] = makeStack(item, moved, durability);
      remaining -= moved;
    }
  }
  return { inventory: { ...inventory, slots }, leftover: remaining };
}

/** Removes up to `count` items from one slot. */
export function removeFromSlot(inventory: Inventory, index: number, count = 1): Inventory {
  const slot = inventory.slots[index];
  if (!slot || count <= 0) return inventory;
  const slots = [...inventory.slots];
  const left = slot.count - count;
  slots[index] = left > 0 ? { ...slot, count: left } : null;
  return { ...inventory, slots };
}

export function setSlot(inventory: Inventory, index: number, slot: Slot): Inventory {
  if (index < 0 || index >= inventory.slots.length) return inventory;
  const slots = [...inventory.slots];
  slots[index] = slot;
  return { ...inventory, slots };
}

export function countOf(inventory: Inventory, block: number): number {
  let total = 0;
  for (const slot of inventory.slots) if (slot?.item === block) total += slot.count;
  return total;
}

/**
 * Resolves a click on one cell while the pointer may be carrying a stack.
 * Primary click: pick up / put down / merge / swap. Secondary click: take half
 * or drop a single item.
 */
export function clickCell(
  slot: Slot,
  cursor: Slot,
  secondary = false,
): { slot: Slot; cursor: Slot } {
  if (!cursor) {
    if (!slot) return { slot, cursor };
    if (secondary && slot.count > 1) {
      const taken = Math.ceil(slot.count / 2);
      return {
        slot: { item: slot.item, count: slot.count - taken },
        cursor: { item: slot.item, count: taken },
      };
    }
    return { slot: null, cursor: slot };
  }

  if (!slot) {
    if (secondary && cursor.count > 1) {
      return {
        slot: { item: cursor.item, count: 1 },
        cursor: { item: cursor.item, count: cursor.count - 1 },
      };
    }
    return { slot: cursor, cursor: null };
  }

  // Tools never stack, so two of the same tool swap like different items.
  if (slot.item === cursor.item && stackLimit(slot.item) > 1) {
    const moved = Math.min(secondary ? 1 : cursor.count, stackLimit(slot.item) - slot.count);
    if (moved <= 0) return { slot, cursor };
    const left = cursor.count - moved;
    return {
      slot: { item: slot.item, count: slot.count + moved },
      cursor: left > 0 ? { item: cursor.item, count: left } : null,
    };
  }

  // Different items: swap.
  return { slot: cursor, cursor: slot };
}

/** `clickCell` applied to a slot of the inventory. */
export function clickSlot(
  inventory: Inventory,
  cursor: Slot,
  index: number,
  secondary = false,
): { inventory: Inventory; cursor: Slot } {
  if (index < 0 || index >= inventory.slots.length) return { inventory, cursor };
  const current = inventory.slots[index] ?? null;
  const result = clickCell(current, cursor, secondary);
  if (result.slot === current && result.cursor === cursor) return { inventory, cursor };
  return { inventory: setSlot(inventory, index, result.slot), cursor: result.cursor };
}

/** Largest stack of an item, exported for code that merges stacks outside the inventory. */
export function maxStackOf(item: number): number {
  return stackLimit(item);
}

export function canExpand(inventory: Inventory): boolean {
  return bagRows(inventory) < MAX_BAG_ROWS;
}

/** Adds one more backpack row, up to the maximum. */
export function expandInventory(inventory: Inventory): Inventory {
  if (!canExpand(inventory)) return inventory;
  return { ...inventory, slots: [...inventory.slots, ...new Array<Slot>(ROW_SIZE).fill(null)] };
}

/**
 * Puts `block` in the player's hand (creative "pick block"): selects it if it
 * is already on the hotbar, otherwise replaces the selected slot.
 */
export function pickBlock(inventory: Inventory, block: number): Inventory {
  if (!isHoldable(block)) return inventory;
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    if (inventory.slots[i]?.item === block) return selectSlot(inventory, i);
  }
  return setSlot(inventory, inventory.selected, makeStack(block, stackLimit(block)));
}

/** Rebuilds a valid inventory from untrusted (saved) data. */
export function sanitizeInventory(raw: unknown): Inventory {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const rawSlots = Array.isArray(r.slots) ? r.slots : [];
  const extra = Math.max(0, rawSlots.length - HOTBAR_SIZE);
  const rows = Math.min(MAX_BAG_ROWS, Math.max(BASE_BAG_ROWS, Math.ceil(extra / ROW_SIZE)));
  const slots = new Array<Slot>(slotCount(rows)).fill(null);
  for (let i = 0; i < slots.length; i++) {
    const stored = rawSlots[i] as
      { item?: unknown; block?: unknown; count?: unknown; durability?: unknown } | null | undefined;
    if (!stored) continue;
    // Saves from before non-block items existed call the field `block`.
    const id = stored.item ?? stored.block;
    if (!isHoldable(id)) continue;
    const count = typeof stored.count === 'number' ? Math.floor(stored.count) : 0;
    if (count <= 0) continue;
    const tool = getItemDef(id).tool;
    if (!tool) {
      slots[i] = { item: id, count: Math.min(stackLimit(id), count) };
      continue;
    }
    const left =
      typeof stored.durability === 'number' && Number.isFinite(stored.durability)
        ? Math.floor(stored.durability)
        : tool.durability;
    // A tool with no uses left would have broken; drop it rather than restore it.
    if (left > 0) slots[i] = { item: id, count: 1, durability: Math.min(tool.durability, left) };
  }
  const selected =
    typeof r.selected === 'number' &&
    Number.isInteger(r.selected) &&
    r.selected >= 0 &&
    r.selected < HOTBAR_SIZE
      ? r.selected
      : 0;
  return { slots, selected };
}

/** Everything offered by the creative palette: every placeable block, then the other items. */
export const PALETTE_ITEMS: readonly number[] = [
  ...PLACEABLE_BLOCKS,
  ...NON_BLOCK_ITEMS.map((item) => item.id),
];

/** The block the selected stack would place, or 0 when the hand is empty or holds a non-block item. */
export function selectedBlock(inventory: Inventory): number {
  const stack = selectedStack(inventory);
  return stack && isBlockItem(stack.item) ? stack.item : 0;
}

/**
 * Uses the selected tool once. Returns the new inventory and whether the tool
 * wore out (its slot is then empty). Anything that is not a tool is unchanged.
 */
export function wearSelectedTool(inventory: Inventory): { inventory: Inventory; broke: boolean } {
  const stack = selectedStack(inventory);
  if (!stack || stack.durability === undefined) return { inventory, broke: false };
  const left = stack.durability - 1;
  return {
    inventory: setSlot(
      inventory,
      inventory.selected,
      left > 0 ? { ...stack, durability: left } : null,
    ),
    broke: left <= 0,
  };
}
